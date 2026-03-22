from fastapi import APIRouter, HTTPException, Query
from typing import Optional, List
from datetime import datetime

from app.database import database
from app.models import StationCreate, StationUpdate, StationOut, calc_aqi, aqi_color, aqi_label
from app.services.ws_manager import manager

router = APIRouter()


async def _enrich(row) -> dict:
    aqi = row["aqi"] or calc_aqi(row["pm25"], row["pm10"])
    return {
        **dict(row),
        "aqi": aqi,
        "aqi_color": aqi_color(aqi),
        "aqi_label": aqi_label(aqi),
    }


@router.get("", response_model=List[StationOut])
async def get_stations(ward_id: Optional[int] = Query(None)):
    if ward_id:
        rows = await database.fetch_all("""
            SELECT s.*, w.name as ward_name
            FROM stations s JOIN wards w ON s.ward_id = w.id
            WHERE s.ward_id = :wid
            ORDER BY s.aqi DESC NULLS LAST
        """, {"wid": ward_id})
    else:
        rows = await database.fetch_all("""
            SELECT s.*, w.name as ward_name
            FROM stations s JOIN wards w ON s.ward_id = w.id
            ORDER BY s.aqi DESC NULLS LAST
        """)
    return [await _enrich(r) for r in rows]


@router.get("/geojson")
async def get_stations_geojson(ward_id: Optional[int] = Query(None)):
    """Return stations as GeoJSON FeatureCollection"""
    stations = await get_stations(ward_id)
    features = []
    for s in stations:
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [s["lng"], s["lat"]]},
            "properties": {k: v for k, v in s.items() if k not in ("lat", "lng")},
        })
    return {"type": "FeatureCollection", "features": features}


@router.get("/{station_id}", response_model=StationOut)
async def get_station(station_id: int):
    row = await database.fetch_one("""
        SELECT s.*, w.name as ward_name
        FROM stations s JOIN wards w ON s.ward_id = w.id
        WHERE s.id = :id
    """, {"id": station_id})
    if not row:
        raise HTTPException(404, "Không tìm thấy trạm")
    return await _enrich(row)


@router.get("/{station_id}/history")
async def get_station_history(station_id: int, hours: int = Query(24, ge=1, le=168)):
    rows = await database.fetch_all("""
        SELECT station_id, pm25, pm10, aqi, timestamp
        FROM readings
        WHERE station_id = :sid
          AND timestamp >= NOW() - (:h * INTERVAL '1 hour')
        ORDER BY timestamp ASC
    """, {"sid": station_id, "h": hours})
    return [dict(r) for r in rows]


@router.post("", response_model=StationOut, status_code=201)
async def create_station(body: StationCreate):
    aqi = calc_aqi(body.pm25, body.pm10)
    row = await database.fetch_one("""
        INSERT INTO stations (code, name, ward_id, lat, lng, pm25, pm10, aqi,
            traffic_level, construction, factory_near, note)
        VALUES (:code,:name,:ward_id,:lat,:lng,:pm25,:pm10,:aqi,
            :traffic,:constr,:factory,:note)
        RETURNING *, (SELECT name FROM wards WHERE id = :ward_id) as ward_name
    """, {
        "code": body.code, "name": body.name, "ward_id": body.ward_id,
        "lat": body.lat, "lng": body.lng, "pm25": body.pm25, "pm10": body.pm10,
        "aqi": aqi, "traffic": body.traffic_level, "constr": body.construction,
        "factory": body.factory_near, "note": body.note,
    })
    # Save to readings history
    await database.execute("""
        INSERT INTO readings (station_id, pm25, pm10, aqi)
        VALUES (:sid, :pm25, :pm10, :aqi)
    """, {"sid": row["id"], "pm25": body.pm25, "pm10": body.pm10, "aqi": aqi})

    result = await _enrich(row)
    # Broadcast via WebSocket
    await manager.broadcast({"event": "station_created", "data": result})
    return result


@router.put("/{station_id}", response_model=StationOut)
async def update_station(station_id: int, body: StationUpdate):
    existing = await database.fetch_one(
        "SELECT * FROM stations WHERE id = :id", {"id": station_id}
    )
    if not existing:
        raise HTTPException(404, "Không tìm thấy trạm")

    pm25 = body.pm25 if body.pm25 is not None else existing["pm25"]
    pm10 = body.pm10 if body.pm10 is not None else existing["pm10"]
    aqi = calc_aqi(pm25, pm10)

    updates = {
        "name": body.name or existing["name"],
        "pm25": pm25,
        "pm10": pm10,
        "aqi": aqi,
        "traffic_level": body.traffic_level if body.traffic_level is not None else existing["traffic_level"],
        "construction": body.construction if body.construction is not None else existing["construction"],
        "factory_near": body.factory_near if body.factory_near is not None else existing["factory_near"],
        "note": body.note or existing["note"],
        "id": station_id,
    }

    row = await database.fetch_one("""
        UPDATE stations SET
            name=:name, pm25=:pm25, pm10=:pm10, aqi=:aqi,
            traffic_level=:traffic_level, construction=:construction,
            factory_near=:factory_near, note=:note,
            timestamp=NOW()
        WHERE id=:id
        RETURNING *, (SELECT name FROM wards WHERE id = ward_id) as ward_name
    """, updates)

    # Save reading to history
    await database.execute("""
        INSERT INTO readings (station_id, pm25, pm10, aqi)
        VALUES (:sid, :pm25, :pm10, :aqi)
    """, {"sid": station_id, "pm25": pm25, "pm10": pm10, "aqi": aqi})

    result = await _enrich(row)
    await manager.broadcast({"event": "station_updated", "data": result})
    return result


@router.delete("/{station_id}")
async def delete_station(station_id: int):
    existing = await database.fetch_one(
        "SELECT id FROM stations WHERE id = :id", {"id": station_id}
    )
    if not existing:
        raise HTTPException(404, "Không tìm thấy trạm")
    await database.execute("DELETE FROM stations WHERE id = :id", {"id": station_id})
    await manager.broadcast({"event": "station_deleted", "data": {"id": station_id}})
    return {"message": "Đã xóa trạm"}
