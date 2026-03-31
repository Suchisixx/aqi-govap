from decimal import Decimal
import math

from fastapi import APIRouter, Depends, HTTPException, Query

from app.database import database
from app.models import AlertThresholdsOut, AlertThresholdsUpdate, aqi_color, aqi_label
from app.security import require_roles
from app.services.alerts import get_thresholds
from app.services.audit import log_action

router = APIRouter()
SAFE_PM25_SQL = """
CASE
    WHEN r.pm25 IS NULL THEN NULL
    WHEN r.pm25 != r.pm25 THEN NULL
    WHEN r.pm25 IN ('Infinity'::float8, '-Infinity'::float8) THEN NULL
    ELSE r.pm25
END
"""
SAFE_PM10_SQL = """
CASE
    WHEN r.pm10 IS NULL THEN NULL
    WHEN r.pm10 != r.pm10 THEN NULL
    WHEN r.pm10 IN ('Infinity'::float8, '-Infinity'::float8) THEN NULL
    ELSE r.pm10
END
"""


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


def _build_station_scope_sql(ward_id: int | None) -> tuple[str, dict]:
    if ward_id:
        return "WHERE s.ward_id = :ward_id", {"ward_id": ward_id}
    return "", {}


def _build_station_filter_sql(ward_id: int | None, prefix: str = "AND") -> tuple[str, dict]:
    if ward_id:
        return f" {prefix} s.ward_id = :ward_id", {"ward_id": ward_id}
    return "", {}


@router.get("/summary")
async def get_summary(ward_id: int | None = Query(None)):
    where_sql, params = _build_station_scope_sql(ward_id)
    row = await database.fetch_one(
        f"""
        SELECT
            COUNT(*) as total_stations,
            ROUND(AVG(s.aqi)::numeric, 1) as avg_aqi,
            MAX(s.aqi) as max_aqi,
            MIN(s.aqi) as min_aqi,
            COUNT(CASE WHEN s.aqi <= 50 THEN 1 END) as good,
            COUNT(CASE WHEN s.aqi BETWEEN 51 AND 100 THEN 1 END) as moderate,
            COUNT(CASE WHEN s.aqi BETWEEN 101 AND 150 THEN 1 END) as unhealthy_sensitive,
            COUNT(CASE WHEN s.aqi BETWEEN 151 AND 200 THEN 1 END) as unhealthy,
            COUNT(CASE WHEN s.aqi > 200 THEN 1 END) as very_unhealthy
        FROM stations s
        {where_sql}
        """,
        params,
    )
    data = dict(row)
    avg = float(data["avg_aqi"] or 0)
    data["avg_aqi_color"] = aqi_color(avg)
    data["avg_aqi_label"] = aqi_label(int(avg))
    return data


@router.get("/ward-ranking")
async def ward_ranking(hours: int | None = Query(None, ge=1, le=720)):
    if hours:
        rows = await database.fetch_all(
            """
            SELECT w.id, w.code, w.name,
                   ROUND(AVG(r.aqi)::numeric, 1) as avg_aqi,
                   MAX(r.aqi) as max_aqi,
                   COUNT(DISTINCT s.id) as station_count
            FROM wards w
            LEFT JOIN stations s ON s.ward_id = w.id
            LEFT JOIN readings r ON r.station_id = s.id
                AND r.timestamp >= NOW() - (:hours * INTERVAL '1 hour')
            GROUP BY w.id, w.code, w.name
            ORDER BY avg_aqi DESC NULLS LAST
            """,
            {"hours": hours},
        )
    else:
        rows = await database.fetch_all(
            """
            SELECT w.id, w.code, w.name,
                   ROUND(AVG(s.aqi)::numeric, 1) as avg_aqi,
                   MAX(s.aqi) as max_aqi,
                   COUNT(s.id) as station_count
            FROM wards w
            LEFT JOIN stations s ON s.ward_id = w.id
            GROUP BY w.id, w.code, w.name
            ORDER BY avg_aqi DESC NULLS LAST
            """
        )
    result = []
    for row in rows:
        item = dict(row)
        avg = float(item["avg_aqi"] or 0)
        item["aqi_color"] = aqi_color(avg)
        item["aqi_label"] = aqi_label(int(avg))
        result.append(item)
    return result


@router.get("/station-ranking")
async def station_ranking(limit: int = Query(5, ge=1, le=20), ward_id: int | None = Query(None)):
    ward_filter_sql, params = _build_station_filter_sql(ward_id)
    rows = await database.fetch_all(
        f"""
        SELECT s.id, s.code, s.name, s.aqi, s.pm25, s.pm10, s.note,
               w.name as ward_name
        FROM stations s JOIN wards w ON s.ward_id = w.id
        WHERE s.aqi IS NOT NULL
          {ward_filter_sql}
        ORDER BY s.aqi DESC
        LIMIT :lim
        """,
        {"lim": limit, **params},
    )
    result = []
    for row in rows:
        item = dict(row)
        item["aqi_color"] = aqi_color(item["aqi"] or 0)
        item["aqi_label"] = aqi_label(item["aqi"] or 0)
        result.append(item)
    return result


@router.get("/timeseries")
async def timeseries(
    station_id: int | None = Query(None),
    ward_id: int | None = Query(None),
    hours: int = Query(24, ge=1, le=720),
    bucket: str = Query("hour", pattern="^(hour|day)$"),
):
    if station_id:
        rows = await database.fetch_all(
            """
            SELECT r.timestamp, r.pm25, r.pm10, r.aqi, s.name as station_name
            FROM readings r JOIN stations s ON r.station_id = s.id
            WHERE r.station_id = :sid
              AND r.timestamp >= NOW() - (:hours * INTERVAL '1 hour')
            ORDER BY r.timestamp ASC
            """,
            {"sid": station_id, "hours": hours},
        )
        return [_json_safe_row(row) for row in rows]

    trunc_unit = "day" if bucket == "day" else "hour"
    ward_filter_sql, params = _build_station_filter_sql(ward_id)
    rows = await database.fetch_all(
        f"""
        SELECT DATE_TRUNC('{trunc_unit}', r.timestamp) as timestamp,
               ROUND(AVG({SAFE_PM25_SQL})::numeric, 1) as pm25,
               ROUND(AVG({SAFE_PM10_SQL})::numeric, 1) as pm10,
               ROUND(AVG(r.aqi)::numeric, 0) as aqi,
               COALESCE(MAX(w.name), 'Tat ca tram') as station_name
        FROM readings r
        JOIN stations s ON r.station_id = s.id
        LEFT JOIN wards w ON s.ward_id = w.id
        WHERE r.timestamp >= NOW() - (:hours * INTERVAL '1 hour')
          {ward_filter_sql}
        GROUP BY DATE_TRUNC('{trunc_unit}', r.timestamp)
        ORDER BY timestamp ASC
        """,
        {"hours": hours, **params},
    )
    return [_json_safe_row(row) for row in rows]


@router.get("/trends")
async def get_trends(hours: int = Query(24, ge=6, le=720), ward_id: int | None = Query(None)):
    ward_filter_sql, params = _build_station_filter_sql(ward_id)
    current = await database.fetch_one(
        f"""
        SELECT ROUND(AVG(r.aqi)::numeric, 1) as avg_aqi,
               ROUND(AVG({SAFE_PM25_SQL})::numeric, 1) as avg_pm25,
               ROUND(AVG({SAFE_PM10_SQL})::numeric, 1) as avg_pm10
        FROM readings r
        JOIN stations s ON s.id = r.station_id
        WHERE r.timestamp >= NOW() - (:hours * INTERVAL '1 hour')
          {ward_filter_sql}
        """,
        {"hours": hours, **params},
    )
    previous = await database.fetch_one(
        f"""
        SELECT ROUND(AVG(r.aqi)::numeric, 1) as avg_aqi,
               ROUND(AVG({SAFE_PM25_SQL})::numeric, 1) as avg_pm25,
               ROUND(AVG({SAFE_PM10_SQL})::numeric, 1) as avg_pm10
        FROM readings r
        JOIN stations s ON s.id = r.station_id
        WHERE r.timestamp >= NOW() - ((:hours * 2) * INTERVAL '1 hour')
          AND r.timestamp < NOW() - (:hours * INTERVAL '1 hour')
          {ward_filter_sql}
        """,
        {"hours": hours, **params},
    )

    current_data = _json_safe_row(current)
    previous_data = _json_safe_row(previous)

    def delta(field: str):
        if current_data[field] is None or previous_data[field] is None:
            return None
        return round(float(current_data[field]) - float(previous_data[field]), 1)

    return {
        "window_hours": hours,
        "current": current_data,
        "previous": previous_data,
        "delta": {
            "avg_aqi": delta("avg_aqi"),
            "avg_pm25": delta("avg_pm25"),
            "avg_pm10": delta("avg_pm10"),
        },
    }


@router.get("/alerts")
async def get_alerts(ward_id: int | None = Query(None)):
    thresholds = await get_thresholds()
    ward_filter_sql, params = _build_station_filter_sql(ward_id, prefix="WHERE")
    rows = await database.fetch_all(
        f"""
        SELECT s.id, s.code, s.name, s.aqi, s.pm25, s.pm10, s.note,
               s.lat, s.lng, w.name as ward_name, s.timestamp
        FROM stations s JOIN wards w ON s.ward_id = w.id
        {ward_filter_sql}
        ORDER BY s.aqi DESC NULLS LAST
        """,
        params,
    )
    result = []
    for row in rows:
        item = dict(row)
        aqi = item["aqi"] or 0
        pm25 = item["pm25"] or 0
        pm10 = item["pm10"] or 0
        if aqi < thresholds["aqi_warning"] and pm25 < thresholds["pm25_warning"] and pm10 < thresholds["pm10_warning"]:
            continue

        level = "danger" if aqi >= thresholds["aqi_danger"] else "warning"
        item["aqi_color"] = aqi_color(aqi)
        item["aqi_label"] = aqi_label(aqi)
        item["level"] = level
        item["thresholds"] = thresholds
        item["message"] = (
            "Mức nguy hiểm, cần hạn chế ra ngoài" if level == "danger"
            else "Vượt ngưỡng cảnh báo, cần theo dõi sát"
        )
        result.append(item)
    return result


@router.get("/thresholds", response_model=AlertThresholdsOut)
async def thresholds():
    return await get_thresholds()


@router.put("/thresholds", response_model=AlertThresholdsOut)
async def update_thresholds(
    body: AlertThresholdsUpdate,
    current_user: dict = Depends(require_roles("admin")),
):
    if body.aqi_danger < body.aqi_warning:
        raise HTTPException(status_code=400, detail="aqi_danger phai lon hon hoac bang aqi_warning")

    await database.execute(
        """
        UPDATE alert_thresholds
        SET aqi_warning=:aqi_warning,
            aqi_danger=:aqi_danger,
            pm25_warning=:pm25_warning,
            pm10_warning=:pm10_warning,
            consecutive_readings=:consecutive_readings,
            updated_by=:updated_by,
            updated_at=NOW()
        WHERE id = 1
        """,
        {
            **body.model_dump(),
            "updated_by": current_user["id"],
        },
    )
    await log_action(
        user=current_user,
        action="update_thresholds",
        entity_type="settings",
        entity_id=1,
        details=body.model_dump(),
    )
    return await get_thresholds()


@router.get("/audit-logs")
async def audit_logs(
    limit: int = Query(30, ge=1, le=200),
    entity_type: str | None = Query(None),
    current_user: dict = Depends(require_roles("admin", "officer")),
):
    where_sql = ""
    params = {"lim": limit}
    if entity_type:
      where_sql = "WHERE entity_type = :entity_type"
      params["entity_type"] = entity_type
    rows = await database.fetch_all(
        f"""
        SELECT id, user_id, username, action, entity_type, entity_id, details, created_at
        FROM audit_logs
        {where_sql}
        ORDER BY created_at DESC
        LIMIT :lim
        """,
        params,
    )
    return [dict(row) for row in rows]
