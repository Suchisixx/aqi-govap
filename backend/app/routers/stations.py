from decimal import Decimal
from datetime import datetime
import math
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

from app.database import database
from app.models import StationCreate, StationOut, StationUpdate, calc_aqi, calc_aqi_details
from app.security import get_current_user, require_roles
from app.services.audit import log_action
from app.services.importer import import_station_rows, parse_station_upload
from app.services.ws_manager import manager

router = APIRouter()


def _json_safe_value(value):
    if isinstance(value, Decimal):
        if value.is_nan() or value.is_infinite():
            return None
        if value == value.to_integral_value():
            return int(value)
        return float(value)
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    return value


def _json_safe_row(row) -> dict:
    return {key: _json_safe_value(value) for key, value in dict(row).items()}


async def _enrich(row) -> dict:
    details = calc_aqi_details(row["pm25"], row["pm10"])
    return {
        **dict(row),
        "aqi": details["aqi"],
        "aqi_pm25": details["aqi_pm25"],
        "aqi_pm10": details["aqi_pm10"],
        "primary_pollutant": details["primary_pollutant"],
        "aqi_color": details["aqi_color"],
        "aqi_label": details["aqi_label"],
    }


async def _fetch_station(station_id: int):
    return await database.fetch_one(
        """
        SELECT s.*, w.name as ward_name
        FROM stations s JOIN wards w ON s.ward_id = w.id
        WHERE s.id = :id
        """,
        {"id": station_id},
    )


def _summarize_history(rows: list[dict]) -> dict:
    if not rows:
        return {
            "reading_count": 0,
            "avg_aqi": None,
            "max_aqi": None,
            "min_aqi": None,
            "latest_aqi": None,
            "delta_aqi": None,
            "last_updated": None,
        }

    aqi_values = [row["aqi"] for row in rows if row["aqi"] is not None]
    latest = rows[-1]
    earliest = rows[0]
    return {
        "reading_count": len(rows),
        "avg_aqi": round(sum(aqi_values) / len(aqi_values), 1) if aqi_values else None,
        "max_aqi": max(aqi_values) if aqi_values else None,
        "min_aqi": min(aqi_values) if aqi_values else None,
        "latest_aqi": latest["aqi"],
        "delta_aqi": latest["aqi"] - earliest["aqi"] if latest["aqi"] is not None and earliest["aqi"] is not None else None,
        "last_updated": latest["timestamp"],
    }


@router.get("", response_model=list[StationOut])
async def get_stations(ward_id: Optional[int] = Query(None)):
    if ward_id:
        rows = await database.fetch_all(
            """
            SELECT s.*, w.name as ward_name
            FROM stations s JOIN wards w ON s.ward_id = w.id
            WHERE s.ward_id = :wid
            ORDER BY s.aqi DESC NULLS LAST
            """,
            {"wid": ward_id},
        )
    else:
        rows = await database.fetch_all(
            """
            SELECT s.*, w.name as ward_name
            FROM stations s JOIN wards w ON s.ward_id = w.id
            ORDER BY s.aqi DESC NULLS LAST
            """
        )
    return [await _enrich(r) for r in rows]


@router.get("/geojson")
async def get_stations_geojson(ward_id: Optional[int] = Query(None)):
    stations = await get_stations(ward_id)
    features = []
    for station in stations:
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [station["lng"], station["lat"]]},
                "properties": {k: v for k, v in station.items() if k not in ("lat", "lng")},
            }
        )
    return {"type": "FeatureCollection", "features": features}


@router.get("/detail/{station_id}")
async def get_station_detail(station_id: int, hours: int = Query(72, ge=1, le=720)):
    row = await _fetch_station(station_id)
    if not row:
        raise HTTPException(404, "Không tìm thấy trạm")

    history_rows = await database.fetch_all(
        """
        SELECT station_id, pm25, pm10, aqi, timestamp
        FROM readings
        WHERE station_id = :sid
          AND timestamp >= NOW() - (:h * INTERVAL '1 hour')
        ORDER BY timestamp ASC
        """,
        {"sid": station_id, "h": hours},
    )
    audits = await database.fetch_all(
        """
        SELECT id, user_id, username, action, entity_type, entity_id, details, created_at
        FROM audit_logs
        WHERE entity_type = 'station'
          AND entity_id = :sid
        ORDER BY created_at DESC
        LIMIT 20
        """,
        {"sid": station_id},
    )

    history = [_json_safe_row(item) for item in history_rows]
    return {
        "station": await _enrich(row),
        "summary": _summarize_history(history),
        "history": history,
        "audit_logs": [_json_safe_row(item) for item in audits],
    }


@router.get("/{station_id}", response_model=StationOut)
async def get_station(station_id: int):
    row = await _fetch_station(station_id)
    if not row:
        raise HTTPException(404, "Không tìm thấy trạm")
    return await _enrich(row)


@router.get("/{station_id}/history")
async def get_station_history(station_id: int, hours: int = Query(24, ge=1, le=168)):
    rows = await database.fetch_all(
        """
        SELECT station_id, pm25, pm10, aqi, timestamp
        FROM readings
        WHERE station_id = :sid
          AND timestamp >= NOW() - (:h * INTERVAL '1 hour')
        ORDER BY timestamp ASC
        """,
        {"sid": station_id, "h": hours},
    )
    return [_json_safe_row(r) for r in rows]


@router.post("", response_model=StationOut, status_code=201)
async def create_station(
    body: StationCreate,
    current_user: dict = Depends(require_roles("admin")),
):
    aqi = calc_aqi(body.pm25, body.pm10)
    row = await database.fetch_one(
        """
        INSERT INTO stations (code, name, ward_id, lat, lng, pm25, pm10, aqi,
            traffic_level, construction, factory_near, note)
        VALUES (:code,:name,:ward_id,:lat,:lng,:pm25,:pm10,:aqi,
            :traffic,:constr,:factory,:note)
        RETURNING *, (SELECT name FROM wards WHERE id = :ward_id) as ward_name
        """,
        {
            "code": body.code,
            "name": body.name,
            "ward_id": body.ward_id,
            "lat": body.lat,
            "lng": body.lng,
            "pm25": body.pm25,
            "pm10": body.pm10,
            "aqi": aqi,
            "traffic": body.traffic_level,
            "constr": body.construction,
            "factory": body.factory_near,
            "note": body.note,
        },
    )
    await database.execute(
        """
        INSERT INTO readings (station_id, pm25, pm10, aqi)
        VALUES (:sid, :pm25, :pm10, :aqi)
        """,
        {"sid": row["id"], "pm25": body.pm25, "pm10": body.pm10, "aqi": aqi},
    )

    result = await _enrich(row)
    await log_action(
        user=current_user,
        action="create",
        entity_type="station",
        entity_id=row["id"],
        details={"code": body.code, "name": body.name},
    )
    await manager.broadcast({"event": "station_created", "data": result})
    return result


@router.put("/{station_id}", response_model=StationOut)
async def update_station(
    station_id: int,
    body: StationUpdate,
    current_user: dict = Depends(require_roles("admin", "officer")),
):
    existing = await database.fetch_one("SELECT * FROM stations WHERE id = :id", {"id": station_id})
    if not existing:
        raise HTTPException(404, "Không tìm thấy trạm")

    pm25 = body.pm25 if body.pm25 is not None else existing["pm25"]
    pm10 = body.pm10 if body.pm10 is not None else existing["pm10"]
    aqi = calc_aqi(pm25, pm10)

    updates = {
        "name": body.name if body.name is not None else existing["name"],
        "pm25": pm25,
        "pm10": pm10,
        "aqi": aqi,
        "traffic_level": body.traffic_level if body.traffic_level is not None else existing["traffic_level"],
        "construction": body.construction if body.construction is not None else existing["construction"],
        "factory_near": body.factory_near if body.factory_near is not None else existing["factory_near"],
        "note": body.note if body.note is not None else existing["note"],
        "id": station_id,
    }

    row = await database.fetch_one(
        """
        UPDATE stations SET
            name=:name, pm25=:pm25, pm10=:pm10, aqi=:aqi,
            traffic_level=:traffic_level, construction=:construction,
            factory_near=:factory_near, note=:note,
            timestamp=NOW()
        WHERE id=:id
        RETURNING *, (SELECT name FROM wards WHERE id = ward_id) as ward_name
        """,
        updates,
    )

    await database.execute(
        """
        INSERT INTO readings (station_id, pm25, pm10, aqi)
        VALUES (:sid, :pm25, :pm10, :aqi)
        """,
        {"sid": station_id, "pm25": pm25, "pm10": pm10, "aqi": aqi},
    )

    result = await _enrich(row)
    await log_action(
        user=current_user,
        action="update",
        entity_type="station",
        entity_id=station_id,
        details={
            "before": {
                "pm25": existing["pm25"],
                "pm10": existing["pm10"],
                "aqi": existing["aqi"],
                "note": existing["note"],
            },
            "after": {
                "pm25": pm25,
                "pm10": pm10,
                "aqi": aqi,
                "note": updates["note"],
            },
        },
    )
    await manager.broadcast({"event": "station_updated", "data": result})
    return result


@router.delete("/{station_id}")
async def delete_station(
    station_id: int,
    current_user: dict = Depends(require_roles("admin")),
):
    existing = await database.fetch_one("SELECT id, code, name FROM stations WHERE id = :id", {"id": station_id})
    if not existing:
        raise HTTPException(404, "Không tìm thấy trạm")
    await database.execute("DELETE FROM stations WHERE id = :id", {"id": station_id})
    await log_action(
        user=current_user,
        action="delete",
        entity_type="station",
        entity_id=station_id,
        details={"code": existing["code"], "name": existing["name"]},
    )
    await manager.broadcast({"event": "station_deleted", "data": {"id": station_id}})
    return {"message": "Đã xóa trạm"}


@router.post("/import")
async def import_stations(
    file: UploadFile = File(...),
    current_user: dict = Depends(require_roles("admin", "officer")),
):
    parsed_rows = await parse_station_upload(file)
    result = await import_station_rows(parsed_rows, current_user)
    await log_action(
        user=current_user,
        action="import",
        entity_type="station",
        details={"filename": file.filename, **result},
    )
    return result
