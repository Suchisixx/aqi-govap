from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import logging

from app.database import database
from app.routers import stations, wards, auth, interpolate, dashboard, ws

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await database.connect()
    logger.info("✅ Database connected")
    yield
    await database.disconnect()
    logger.info("🔌 Database disconnected")


app = FastAPI(
    title="AQI Gò Vấp API",
    description="Hệ thống quan trắc chất lượng không khí 6 phường Gò Vấp",
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
    return {"status": "ok", "service": "AQI Gò Vấp API v1.0"}
