from fastapi import APIRouter, Query
from app.database import database
from app.models import aqi_color, aqi_label

router = APIRouter()


@router.get("/summary")
async def get_summary():
    """Overall AQI summary across all stations"""
    row = await database.fetch_one("""
        SELECT
            COUNT(*) as total_stations,
            ROUND(AVG(aqi)::numeric, 1) as avg_aqi,
            MAX(aqi) as max_aqi,
            MIN(aqi) as min_aqi,
            COUNT(CASE WHEN aqi <= 50 THEN 1 END) as good,
            COUNT(CASE WHEN aqi BETWEEN 51 AND 100 THEN 1 END) as moderate,
            COUNT(CASE WHEN aqi BETWEEN 101 AND 150 THEN 1 END) as unhealthy_sensitive,
            COUNT(CASE WHEN aqi BETWEEN 151 AND 200 THEN 1 END) as unhealthy,
            COUNT(CASE WHEN aqi > 200 THEN 1 END) as very_unhealthy
        FROM stations
    """)
    d = dict(row)
    d["avg_aqi_color"] = aqi_color(float(d["avg_aqi"] or 0))
    d["avg_aqi_label"] = aqi_label(int(d["avg_aqi"] or 0))
    return d


@router.get("/ward-ranking")
async def ward_ranking():
    """Average AQI per ward, ranked"""
    rows = await database.fetch_all("""
        SELECT w.id, w.code, w.name,
               ROUND(AVG(s.aqi)::numeric, 1) as avg_aqi,
               MAX(s.aqi) as max_aqi,
               COUNT(s.id) as station_count
        FROM wards w
        LEFT JOIN stations s ON s.ward_id = w.id
        GROUP BY w.id, w.code, w.name
        ORDER BY avg_aqi DESC NULLS LAST
    """)
    result = []
    for r in rows:
        d = dict(r)
        avg = float(d["avg_aqi"] or 0)
        d["aqi_color"] = aqi_color(avg)
        d["aqi_label"] = aqi_label(int(avg))
        result.append(d)
    return result


@router.get("/station-ranking")
async def station_ranking(limit: int = Query(5, ge=1, le=20)):
    """Top N most polluted stations"""
    rows = await database.fetch_all("""
        SELECT s.id, s.code, s.name, s.aqi, s.pm25, s.pm10, s.note,
               w.name as ward_name
        FROM stations s JOIN wards w ON s.ward_id = w.id
        WHERE s.aqi IS NOT NULL
        ORDER BY s.aqi DESC
        LIMIT :lim
    """, {"lim": limit})
    result = []
    for r in rows:
        d = dict(r)
        d["aqi_color"] = aqi_color(d["aqi"] or 0)
        d["aqi_label"] = aqi_label(d["aqi"] or 0)
        result.append(d)
    return result


@router.get("/timeseries")
async def timeseries(station_id: int = Query(None), hours: int = Query(24, ge=1, le=168)):
    """Time-series readings for chart"""
    if station_id:
        rows = await database.fetch_all("""
            SELECT r.timestamp, r.pm25, r.pm10, r.aqi, s.name as station_name
            FROM readings r JOIN stations s ON r.station_id = s.id
            WHERE r.station_id = :sid
              AND r.timestamp >= NOW() - (:h * INTERVAL '1 hour')
            ORDER BY r.timestamp ASC
        """, {"sid": station_id, "h": hours})
    else:
        rows = await database.fetch_all("""
            SELECT r.timestamp,
                   ROUND(AVG(r.pm25)::numeric,1) as pm25,
                   ROUND(AVG(r.pm10)::numeric,1) as pm10,
                   ROUND(AVG(r.aqi)::numeric,0) as aqi,
                   'Tất cả trạm' as station_name
            FROM readings r
            WHERE r.timestamp >= NOW() - (:h * INTERVAL '1 hour')
            GROUP BY r.timestamp
            ORDER BY r.timestamp ASC
        """, {"h": hours})
    return [dict(r) for r in rows]


@router.get("/alerts")
async def get_alerts():
    """Stations exceeding thresholds"""
    rows = await database.fetch_all("""
        SELECT s.id, s.code, s.name, s.aqi, s.pm25, s.pm10, s.note,
               s.lat, s.lng, w.name as ward_name, s.timestamp
        FROM stations s JOIN wards w ON s.ward_id = w.id
        WHERE s.aqi > 100
        ORDER BY s.aqi DESC
    """)
    result = []
    for r in rows:
        d = dict(r)
        d["aqi_color"] = aqi_color(d["aqi"])
        d["aqi_label"] = aqi_label(d["aqi"])
        d["message"] = (
            "⚠️ Nguy hiểm - Hạn chế ra ngoài!" if d["aqi"] > 200
            else "🔴 Xấu - Đeo khẩu trang N95!" if d["aqi"] > 150
            else "🟠 Kém - Nhóm nhạy cảm cần chú ý"
        )
        result.append(d)
    return result
