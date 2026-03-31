from __future__ import annotations

from app.database import database


RUNTIME_DDL = [
    """
    CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        user_id INT REFERENCES users(id) ON DELETE SET NULL,
        username VARCHAR(50),
        action VARCHAR(50) NOT NULL,
        entity_type VARCHAR(50) NOT NULL,
        entity_id INT,
        details JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW()
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at
    ON audit_logs(created_at DESC)
    """,
    """
    CREATE TABLE IF NOT EXISTS alert_thresholds (
        id INT PRIMARY KEY,
        aqi_warning INT NOT NULL DEFAULT 100,
        aqi_danger INT NOT NULL DEFAULT 150,
        pm25_warning FLOAT NOT NULL DEFAULT 35,
        pm10_warning FLOAT NOT NULL DEFAULT 150,
        consecutive_readings INT NOT NULL DEFAULT 1,
        updated_by INT REFERENCES users(id) ON DELETE SET NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
    )
    """,
    """
    INSERT INTO alert_thresholds (
        id, aqi_warning, aqi_danger, pm25_warning, pm10_warning, consecutive_readings
    )
    VALUES (1, 100, 150, 35, 150, 1)
    ON CONFLICT (id) DO NOTHING
    """,
]


async def ensure_runtime_schema() -> None:
    for statement in RUNTIME_DDL:
        await database.execute(statement)
