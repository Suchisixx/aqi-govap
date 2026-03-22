from fastapi import APIRouter, HTTPException
import numpy as np
from typing import Optional

from app.database import database
from app.models import InterpolateRequest
from app.services.interpolation import (
    idw_interpolate, kriging_interpolate,
    grid_to_geojson, heatmap_points
)

router = APIRouter()


@router.post("")
async def interpolate(body: InterpolateRequest):
    """
    Perform spatial interpolation (IDW or Kriging) over station AQI values.
    Returns GeoJSON grid + heatmap points for Leaflet.
    """
    # Fetch stations
    if body.ward_id:
        rows = await database.fetch_all("""
            SELECT s.lat, s.lng, s.aqi, s.factory_near, s.construction
            FROM stations s
            WHERE s.ward_id = :wid AND s.aqi IS NOT NULL
        """, {"wid": body.ward_id})
    else:
        rows = await database.fetch_all("""
            SELECT s.lat, s.lng, s.aqi, s.factory_near, s.construction
            FROM stations s
            WHERE s.aqi IS NOT NULL
        """)

    if len(rows) < 2:
        raise HTTPException(400, "Cần ít nhất 2 trạm để nội suy")

    points = [(r["lat"], r["lng"]) for r in rows]
    values = []
    for r in rows:
        aqi = float(r["aqi"])
        # Apply modifiers: factory nearby → +20%
        if r["factory_near"] and r["factory_near"] < 0.5:
            aqi *= 1.2
        # Construction → +10%
        if r["construction"]:
            aqi *= 1.1
        values.append(min(500, aqi))

    # Determine bounding box
    if body.ward_id:
        # Use ward boundary for bbox
        ward_row = await database.fetch_one("""
            SELECT ST_AsGeoJSON(ST_Envelope(geom)) as bbox_geom
            FROM wards WHERE id = :wid
        """, {"wid": body.ward_id})
        if ward_row:
            import json
            bbox_json = json.loads(ward_row["bbox_geom"])
            bbox_coords = bbox_json["coordinates"][0]
            lngs_bbox = [p[0] for p in bbox_coords]
            lats_bbox = [p[1] for p in bbox_coords]
            lng_min, lng_max = min(lngs_bbox), max(lngs_bbox)
            lat_min, lat_max = min(lats_bbox), max(lats_bbox)
        else:
            # Fallback to station bbox
            lats = [p[0] for p in points]
            lngs = [p[1] for p in points]
            lat_min, lat_max = min(lats) - 0.005, max(lats) + 0.005
            lng_min, lng_max = min(lngs) - 0.005, max(lngs) + 0.005
    else:
        # Global interpolation - use station bbox
        lats = [p[0] for p in points]
        lngs = [p[1] for p in points]
        lat_min, lat_max = min(lats) - 0.005, max(lats) + 0.005
        lng_min, lng_max = min(lngs) - 0.005, max(lngs) + 0.005

    res = body.resolution
    grid_lat_vals = np.linspace(lat_min, lat_max, res)
    grid_lng_vals = np.linspace(lng_min, lng_max, res)
    grid_lngs, grid_lats = np.meshgrid(grid_lng_vals, grid_lat_vals)

    # Interpolate
    if body.method == "kriging":
        grid_values = kriging_interpolate(points, values, grid_lats, grid_lngs)
    else:
        grid_values = idw_interpolate(points, values, grid_lats, grid_lngs)

    # Build outputs
    heat_pts = heatmap_points(grid_lats, grid_lngs, grid_values)

    # Reduced resolution GeoJSON (every 3rd point to keep payload small)
    step = max(1, res // 20)
    geojson = grid_to_geojson(
        grid_lats[::step, ::step],
        grid_lngs[::step, ::step],
        grid_values[::step, ::step],
    )

    return {
        "method": body.method,
        "station_count": len(rows),
        "bbox": {"lat_min": lat_min, "lat_max": lat_max, "lng_min": lng_min, "lng_max": lng_max},
        "heatmap_points": heat_pts,
        "geojson": geojson,
    }
