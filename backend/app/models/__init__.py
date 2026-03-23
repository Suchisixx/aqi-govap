from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


# ─── AQI Calculation ─────────────────────────────────────────────────────────

def calc_aqi_pm25(pm25: float) -> int:
    """QCVN 05:2021/BTNMT breakpoints for PM2.5 (24h avg, µg/m³)"""
    breakpoints = [
        (0,    12.0,  0,   50),
        (12.1, 35.4,  51,  100),
        (35.5, 55.4,  101, 150),
        (55.5, 150.4, 151, 200),
        (150.5,250.4, 201, 300),
        (250.5,350.4, 301, 400),
        (350.5,500.4, 401, 500),
    ]
    return _linear_interp(pm25, breakpoints)


def calc_aqi_pm10(pm10: float) -> int:
    """QCVN 05:2021/BTNMT breakpoints for PM10 (24h avg, µg/m³)"""
    breakpoints = [
        (0,    54,   0,   50),
        (55,   154,  51,  100),
        (155,  254,  101, 150),
        (255,  354,  151, 200),
        (355,  424,  201, 300),
        (425,  504,  301, 400),
        (505,  604,  401, 500),
    ]
    return _linear_interp(pm10, breakpoints)


def _linear_interp(conc: float, breakpoints: list) -> int:
    for (c_lo, c_hi, i_lo, i_hi) in breakpoints:
        if c_lo <= conc <= c_hi:
            aqi = ((i_hi - i_lo) / (c_hi - c_lo)) * (conc - c_lo) + i_lo
            return round(aqi)
    return 500  # beyond scale


def calc_aqi(pm25: Optional[float], pm10: Optional[float]) -> int:
    values = []
    if pm25 is not None:
        values.append(calc_aqi_pm25(pm25))
    if pm10 is not None:
        values.append(calc_aqi_pm10(pm10))
    return max(values) if values else 0


def aqi_color(aqi: int) -> str:
    if aqi <= 50:   return "#00e400"   # Tốt
    if aqi <= 100:  return "#ffff00"   # Trung bình
    if aqi <= 150:  return "#ff7e00"   # Kém
    if aqi <= 200:  return "#ff0000"   # Xấu
    if aqi <= 300:  return "#8f3f97"   # Rất xấu
    return "#7e0023"                   # Nguy hiểm


def aqi_label(aqi: int) -> str:
    if aqi <= 50:   return "Tốt"
    if aqi <= 100:  return "Trung bình"
    if aqi <= 150:  return "Kém"
    if aqi <= 200:  return "Xấu"
    if aqi <= 300:  return "Rất xấu"
    return "Nguy hiểm"


# ─── Pydantic Schemas ─────────────────────────────────────────────────────────

class StationCreate(BaseModel):
    code: str
    name: str
    ward_id: int
    lat: float
    lng: float
    pm25: Optional[float] = None
    pm10: Optional[float] = None
    traffic_level: int = Field(default=0, ge=0, le=10)
    construction: bool = False
    factory_near: float = 0.0
    note: Optional[str] = None


class StationUpdate(BaseModel):
    name: Optional[str] = None
    pm25: Optional[float] = None
    pm10: Optional[float] = None
    traffic_level: Optional[int] = Field(default=None, ge=0, le=10)
    construction: Optional[bool] = None
    factory_near: Optional[float] = None
    note: Optional[str] = None


class StationOut(BaseModel):
    id: int
    code: str
    name: str
    ward_id: int
    ward_name: Optional[str] = None
    lat: float
    lng: float
    pm25: Optional[float]
    pm10: Optional[float]
    aqi: Optional[int]
    aqi_color: Optional[str]
    aqi_label: Optional[str]
    timestamp: datetime
    traffic_level: int
    construction: bool
    factory_near: float
    note: Optional[str]


class ReadingOut(BaseModel):
    station_id: int
    pm25: Optional[float]
    pm10: Optional[float]
    aqi: Optional[int]
    timestamp: datetime


class InterpolateRequest(BaseModel):
    ward_id: Optional[int] = None  # None = tất cả
    method: str = "idw"            # "idw" | "kriging"
    resolution: int = 50           # grid points per axis


class WardOut(BaseModel):
    id: int
    code: str
    name: str
    avg_aqi: Optional[float] = None
    max_aqi: Optional[int] = None
    station_count: int = 0


class TokenRequest(BaseModel):
    username: str
    password: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str

class InterpolateRequest(BaseModel):
    ward_id: Optional[int] = None
    method: str = "idw"
    resolution: int = 50
    clip_to_ward: bool = True
    per_ward: bool = True
