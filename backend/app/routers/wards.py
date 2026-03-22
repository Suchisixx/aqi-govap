from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
import os
from app.database import database

router = APIRouter()


@router.get("")
async def get_wards():
    rows = await database.fetch_all("""
        SELECT w.id, w.code, w.name, w.kmz_path,
               COUNT(s.id) as station_count,
               ROUND(AVG(s.aqi)::numeric, 1) as avg_aqi,
               MAX(s.aqi) as max_aqi
        FROM wards w
        LEFT JOIN stations s ON s.ward_id = w.id
        GROUP BY w.id, w.code, w.name, w.kmz_path
        ORDER BY avg_aqi DESC NULLS LAST
    """)
    return [dict(r) for r in rows]


@router.get("/geojson")
async def get_wards_geojson():
    """Return wards as GeoJSON FeatureCollection with AQI stats"""
    rows = await database.fetch_all("""
        SELECT w.id, w.code, w.name,
               ST_AsGeoJSON(w.geom)::json as geometry,
               COUNT(s.id) as station_count,
               ROUND(AVG(s.aqi)::numeric, 1) as avg_aqi,
               MAX(s.aqi) as max_aqi
        FROM wards w
        LEFT JOIN stations s ON s.ward_id = w.id
        GROUP BY w.id, w.code, w.name, w.geom
        ORDER BY w.id
    """)
    features = []
    for r in rows:
        features.append({
            "type": "Feature",
            "geometry": r["geometry"],
            "properties": {
                "id": r["id"],
                "code": r["code"],
                "name": r["name"],
                "station_count": r["station_count"],
                "avg_aqi": float(r["avg_aqi"]) if r["avg_aqi"] else None,
                "max_aqi": r["max_aqi"],
            }
        })
    return {"type": "FeatureCollection", "features": features}


@router.get("/{ward_id}/kmz")
async def get_ward_kmz(ward_id: int):
    """Serve KMZ file for a specific ward"""
    row = await database.fetch_one("""
        SELECT kmz_path FROM wards WHERE id = :ward_id
    """, {"ward_id": ward_id})

    if not row or not row["kmz_path"]:
        raise HTTPException(status_code=404, detail="KMZ file not found for this ward")

    kmz_path = os.path.join("/app", "kmz", row["kmz_path"])
    if not os.path.exists(kmz_path):
        raise HTTPException(status_code=404, detail="KMZ file does not exist")

    return FileResponse(kmz_path, media_type="application/vnd.google-earth.kmz", filename=row["kmz_path"])


@router.get("/{ward_id}")
async def get_ward(ward_id: int):
    row = await database.fetch_one(
        "SELECT id, code, name FROM wards WHERE id = :id", {"id": ward_id}
    )
    if not row:
        from fastapi import HTTPException
        raise HTTPException(404, "Không tìm thấy phường")
    return dict(row)
