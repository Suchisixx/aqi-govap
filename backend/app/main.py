import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import database
from app.models import calc_aqi
from app.routers import auth, dashboard, interpolate, stations, wards, ws
from app.services.runtime_schema import ensure_runtime_schema

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
DATABASE_CONNECT_RETRIES = 12
DATABASE_CONNECT_DELAY_SECONDS = 2


async def sync_aqi_values():
    station_rows = await database.fetch_all("SELECT id, pm25, pm10 FROM stations")
    for row in station_rows:
        await database.execute(
            "UPDATE stations SET aqi = :aqi WHERE id = :id",
            {"id": row["id"], "aqi": calc_aqi(row["pm25"], row["pm10"])},
        )

    reading_rows = await database.fetch_all("SELECT id, pm25, pm10 FROM readings")
    for row in reading_rows:
        await database.execute(
            "UPDATE readings SET aqi = :aqi WHERE id = :id",
            {"id": row["id"], "aqi": calc_aqi(row["pm25"], row["pm10"])},
        )

    logger.info("AQI values synchronized with VN_AQI breakpoints")


async def ensure_admin_account():
    await database.execute(
        """
        INSERT INTO users (username, password_hash, role)
        VALUES ('admin', 'plain$123', 'admin')
        ON CONFLICT (username) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            role = EXCLUDED.role
        """
    )
    logger.info("Admin account synchronized: admin / 123")


@asynccontextmanager
async def lifespan(app: FastAPI):
    last_error = None
    for attempt in range(1, DATABASE_CONNECT_RETRIES + 1):
        try:
            await database.connect()
            last_error = None
            break
        except Exception as exc:
            last_error = exc
            if attempt == DATABASE_CONNECT_RETRIES:
                raise
            logger.warning(
                "Database connect attempt %s/%s failed: %s",
                attempt,
                DATABASE_CONNECT_RETRIES,
                exc,
            )
            await asyncio.sleep(DATABASE_CONNECT_DELAY_SECONDS)

    if last_error is not None:
        raise last_error

    logger.info("Database connected")
    await ensure_runtime_schema()
    await ensure_admin_account()
    await sync_aqi_values()
    yield
    await database.disconnect()
    logger.info("Database disconnected")


app = FastAPI(
    title="AQI Go Vap API",
    description="He thong quan trac chat luong khong khi 6 phuong Go Vap",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])
app.include_router(stations.router, prefix="/api/stations", tags=["Stations"])
app.include_router(wards.router, prefix="/api/wards", tags=["Wards"])
app.include_router(interpolate.router, prefix="/api/interpolate", tags=["Interpolation"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["Dashboard"])
app.include_router(ws.router, tags=["WebSocket"])


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "AQI Go Vap API v1.0"}
