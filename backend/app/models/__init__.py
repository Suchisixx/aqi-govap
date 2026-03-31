from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


AQI_INDEX_BREAKPOINTS = [0, 50, 100, 150, 200, 300, 400, 500]
PM25_BREAKPOINTS = [0, 25, 50, 80, 150, 250, 350, 500]
PM10_BREAKPOINTS = [0, 50, 150, 250, 350, 420, 500, 600]


def _linear_interp(value: float, concentration_breakpoints: list[float]) -> int:
    if value is None:
        return 0

    bounded_value = max(0.0, float(value))

    for idx in range(len(concentration_breakpoints) - 1):
        c_low = concentration_breakpoints[idx]
        c_high = concentration_breakpoints[idx + 1]
        i_low = AQI_INDEX_BREAKPOINTS[idx]
        i_high = AQI_INDEX_BREAKPOINTS[idx + 1]

        if bounded_value <= c_high:
            if c_high == c_low:
                return int(round(i_high))
            aqi = ((i_high - i_low) / (c_high - c_low)) * (bounded_value - c_low) + i_low
            return int(round(aqi))

    return AQI_INDEX_BREAKPOINTS[-1]


def calc_aqi_pm25(pm25: float) -> int:
    return _linear_interp(pm25, PM25_BREAKPOINTS)


def calc_aqi_pm10(pm10: float) -> int:
    return _linear_interp(pm10, PM10_BREAKPOINTS)


def calc_aqi_details(pm25: Optional[float], pm10: Optional[float]) -> dict:
    sub_indices = {}

    if pm25 is not None:
        sub_indices["pm25"] = calc_aqi_pm25(pm25)
    if pm10 is not None:
        sub_indices["pm10"] = calc_aqi_pm10(pm10)

    if not sub_indices:
        overall = 0
        primary_pollutant = None
    else:
        primary_pollutant, overall = max(sub_indices.items(), key=lambda item: item[1])

    return {
        "aqi": overall,
        "aqi_pm25": sub_indices.get("pm25"),
        "aqi_pm10": sub_indices.get("pm10"),
        "primary_pollutant": primary_pollutant,
        "aqi_color": aqi_color(overall),
        "aqi_label": aqi_label(overall),
    }


def calc_aqi(pm25: Optional[float], pm10: Optional[float]) -> int:
    return calc_aqi_details(pm25, pm10)["aqi"]


def aqi_color(aqi: int) -> str:
    if aqi <= 50:
        return "#00e400"
    if aqi <= 100:
        return "#ffff00"
    if aqi <= 150:
        return "#ff7e00"
    if aqi <= 200:
        return "#ff0000"
    if aqi <= 300:
        return "#8f3f97"
    return "#7e0023"


def aqi_label(aqi: int) -> str:
    if aqi <= 50:
        return "Tot"
    if aqi <= 100:
        return "Trung binh"
    if aqi <= 150:
        return "Kem"
    if aqi <= 200:
        return "Xau"
    if aqi <= 300:
        return "Rat xau"
    return "Nguy hai"


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
    aqi_pm25: Optional[int] = None
    aqi_pm10: Optional[int] = None
    primary_pollutant: Optional[str] = None
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
    ward_id: Optional[int] = None
    method: Literal["idw", "kriging"] = "idw"
    resolution: int = Field(default=50, ge=20, le=200)
    clip_to_ward: bool = True
    per_ward: bool = True


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


class UserOut(BaseModel):
    id: int
    username: str
    role: str


class AlertThresholdsOut(BaseModel):
    aqi_warning: int
    aqi_danger: int
    pm25_warning: float
    pm10_warning: float
    consecutive_readings: int
    updated_by: Optional[int] = None
    updated_at: Optional[datetime] = None


class AlertThresholdsUpdate(BaseModel):
    aqi_warning: int = Field(ge=1, le=500)
    aqi_danger: int = Field(ge=1, le=500)
    pm25_warning: float = Field(ge=0)
    pm10_warning: float = Field(ge=0)
    consecutive_readings: int = Field(ge=1, le=24)


class StationImportRow(BaseModel):
    code: str
    name: str
    ward_id: Optional[int] = None
    ward_code: Optional[str] = None
    lat: float
    lng: float
    pm25: Optional[float] = None
    pm10: Optional[float] = None
    traffic_level: int = Field(default=0, ge=0, le=10)
    construction: bool = False
    factory_near: float = 0.0
    note: Optional[str] = None


class AuditLogOut(BaseModel):
    id: int
    user_id: Optional[int] = None
    username: Optional[str] = None
    action: str
    entity_type: str
    entity_id: Optional[int] = None
    details: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
