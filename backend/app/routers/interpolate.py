from fastapi import APIRouter, HTTPException
import numpy as np
import json

from app.database import database
from app.models import InterpolateRequest
from app.services.interpolation import (
    build_polygon_mask,
    idw_interpolate,
    kriging_interpolate,
    grid_to_geojson,
    heatmap_points,
)

router = APIRouter()

def apply_station_modifiers(row):
    aqi = float(row["aqi"])

    if row["factory_near"] and row["factory_near"] < 0.5:
        aqi *= 1.2

    if row["construction"]:
        aqi *= 1.1

    return min(500, aqi)


async def interpolate_single_zone(rows, ward_geom, lat_min, lat_max, lng_min, lng_max, body):
    if len(rows) < 2:
        return {
            "heatmap_points": [],
            "geojson": {"type": "FeatureCollection", "features": []},
            "station_count": len(rows),
            "bbox": {
                "lat_min": lat_min,
                "lat_max": lat_max,
                "lng_min": lng_min,
                "lng_max": lng_max,
            },
        }

    points = [(r["lat"], r["lng"]) for r in rows]
    values = [apply_station_modifiers(r) for r in rows]

    res = body.resolution
    grid_lat_vals = np.linspace(lat_min, lat_max, res)
    grid_lng_vals = np.linspace(lng_min, lng_max, res)
    grid_lngs, grid_lats = np.meshgrid(grid_lng_vals, grid_lat_vals)

    mask = build_polygon_mask(
        grid_lats,
        grid_lngs,
        ward_geom if body.clip_to_ward else None,
    )

    if body.method == "kriging":
        grid_values = kriging_interpolate(points, values, grid_lats, grid_lngs, mask=mask)
    else:
        grid_values = idw_interpolate(points, values, grid_lats, grid_lngs, mask=mask)

    heat_pts = heatmap_points(grid_lats, grid_lngs, grid_values)

    step = max(1, res // 20)
    geojson = grid_to_geojson(
        grid_lats[::step, ::step],
        grid_lngs[::step, ::step],
        grid_values[::step, ::step],
    )

    return {
        "heatmap_points": heat_pts,
        "geojson": geojson,
        "station_count": len(rows),
        "bbox": {
            "lat_min": lat_min,
            "lat_max": lat_max,
            "lng_min": lng_min,
            "lng_max": lng_max,
        },
    }


@router.post("")
async def interpolate(body: InterpolateRequest):
    if body.ward_id:
        ward_row = await database.fetch_one(
            """
            SELECT
                id,
                name,
                ST_AsGeoJSON(geom) AS ward_geom,
                ST_XMin(geom) AS lng_min,
                ST_XMax(geom) AS lng_max,
                ST_YMin(geom) AS lat_min,
                ST_YMax(geom) AS lat_max
            FROM wards
            WHERE id = :wid
            """,
            {"wid": body.ward_id},
        )

        if not ward_row:
            raise HTTPException(404, "Không tìm thấy phường")

        rows = await database.fetch_all(
            """
            SELECT s.lat, s.lng, s.aqi, s.factory_near, s.construction
            FROM stations s
            WHERE s.ward_id = :wid
              AND s.aqi IS NOT NULL
            """,
            {"wid": body.ward_id},
        )

        ward_geom = json.loads(ward_row["ward_geom"]) if ward_row["ward_geom"] else None
        if not ward_geom:
            raise HTTPException(400, "Phường chưa có hình học (geom), không thể nội suy")

        result = await interpolate_single_zone(
            rows=rows,
            ward_geom=ward_geom,
            lat_min=float(ward_row["lat_min"]),
            lat_max=float(ward_row["lat_max"]),
            lng_min=float(ward_row["lng_min"]),
            lng_max=float(ward_row["lng_max"]),
            body=body,
        )

        if result["station_count"] < 2:
            raise HTTPException(
                400,
                f"Phường '{ward_row['name']}' chỉ có {result['station_count']} trạm. Cần ít nhất 2 trạm để nội suy.",
            )

        return {
            "method": body.method,
            "mode": "single_ward",
            "ward_id": ward_row["id"],
            "ward_name": ward_row["name"],
            "warnings": [],
            **result,
        }

    if body.per_ward:
        ward_rows = await database.fetch_all(
            """
            SELECT
                id,
                name,
                ST_AsGeoJSON(geom) AS ward_geom,
                ST_XMin(geom) AS lng_min,
                ST_XMax(geom) AS lng_max,
                ST_YMin(geom) AS lat_min,
                ST_YMax(geom) AS lat_max
            FROM wards
            WHERE geom IS NOT NULL
            ORDER BY id
            """
        )

        all_heat = []
        all_features = []
        ward_summaries = []
        skipped_wards = []
        total_station_count = 0
        processed_ward_count = 0

        for ward in ward_rows:
            rows = await database.fetch_all(
                """
                SELECT s.lat, s.lng, s.aqi, s.factory_near, s.construction
                FROM stations s
                WHERE s.ward_id = :wid
                  AND s.aqi IS NOT NULL
                """,
                {"wid": ward["id"]},
            )

            if len(rows) < 2:
                skipped_wards.append({
                    "ward_id": ward["id"],
                    "ward_name": ward["name"],
                    "reason": f"Chỉ có {len(rows)} trạm có AQI.",
                })
                continue

            zone_result = await interpolate_single_zone(
                rows=rows,
                ward_geom=json.loads(ward["ward_geom"]) if ward["ward_geom"] else None,
                lat_min=float(ward["lat_min"]),
                lat_max=float(ward["lat_max"]),
                lng_min=float(ward["lng_min"]),
                lng_max=float(ward["lng_max"]),
                body=body,
            )

            all_heat.extend(zone_result["heatmap_points"])
            all_features.extend(zone_result["geojson"]["features"])
            total_station_count += zone_result["station_count"]
            processed_ward_count += 1

            ward_summaries.append({
                "ward_id": ward["id"],
                "ward_name": ward["name"],
                "station_count": zone_result["station_count"],
                "bbox": zone_result["bbox"],
            })

        if processed_ward_count == 0:
            raise HTTPException(
                400,
                {
                    "message": "Không có phường nào đủ điều kiện nội suy (mỗi phường cần >= 2 trạm có AQI).",
                    "skipped_wards": skipped_wards,
                },
            )

        return {
            "method": body.method,
            "mode": "per_ward",
            "station_count": total_station_count,
            "heatmap_points": all_heat,
            "geojson": {
                "type": "FeatureCollection",
                "features": all_features,
            },
            "wards": ward_summaries,
            "warnings": skipped_wards,
        }

    rows = await database.fetch_all(
        """
        SELECT s.lat, s.lng, s.aqi, s.factory_near, s.construction
        FROM stations s
        WHERE s.aqi IS NOT NULL
        """
    )

    if len(rows) < 2:
        raise HTTPException(400, "Cần ít nhất 2 trạm để nội suy")

    points = [(r["lat"], r["lng"]) for r in rows]
    values = [apply_station_modifiers(r) for r in rows]

    lats = [p[0] for p in points]
    lngs = [p[1] for p in points]
    lat_min, lat_max = min(lats) - 0.005, max(lats) + 0.005
    lng_min, lng_max = min(lngs) - 0.005, max(lngs) + 0.005

    res = body.resolution
    grid_lat_vals = np.linspace(lat_min, lat_max, res)
    grid_lng_vals = np.linspace(lng_min, lng_max, res)
    grid_lngs, grid_lats = np.meshgrid(grid_lng_vals, grid_lat_vals)

    if body.method == "kriging":
        grid_values = kriging_interpolate(points, values, grid_lats, grid_lngs)
    else:
        grid_values = idw_interpolate(points, values, grid_lats, grid_lngs)

    heat_pts = heatmap_points(grid_lats, grid_lngs, grid_values)
    step = max(1, res // 20)
    geojson = grid_to_geojson(
        grid_lats[::step, ::step],
        grid_lngs[::step, ::step],
        grid_values[::step, ::step],
    )

    return {
        "method": body.method,
        "mode": "global",
        "station_count": len(rows),
        "bbox": {
            "lat_min": lat_min,
            "lat_max": lat_max,
            "lng_min": lng_min,
            "lng_max": lng_max,
        },
        "heatmap_points": heat_pts,
        "geojson": geojson,
    }
