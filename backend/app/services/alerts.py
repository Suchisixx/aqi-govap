from __future__ import annotations

from app.database import database


DEFAULT_THRESHOLDS = {
    "aqi_warning": 100,
    "aqi_danger": 150,
    "pm25_warning": 35.0,
    "pm10_warning": 150.0,
    "consecutive_readings": 1,
    "updated_by": None,
    "updated_at": None,
}


async def get_thresholds() -> dict:
    row = await database.fetch_one(
        """
        SELECT id, aqi_warning, aqi_danger, pm25_warning, pm10_warning,
               consecutive_readings, updated_by, updated_at
        FROM alert_thresholds
        WHERE id = 1
        """
    )
    if not row:
        return DEFAULT_THRESHOLDS.copy()
    return dict(row)
