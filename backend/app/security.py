from __future__ import annotations

import os
from datetime import datetime, timedelta
from fastapi import Depends, Header, HTTPException
from jose import jwt
from passlib.context import CryptContext

from app.database import database


SECRET_KEY = os.getenv("SECRET_KEY", "supersecret_jwt_key")
ALGORITHM = "HS256"
EXPIRE_HOURS = 24

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def create_token(data: dict) -> str:
    payload = data.copy()
    payload["exp"] = datetime.utcnow() + timedelta(hours=EXPIRE_HOURS)
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def verify_token(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Token không hợp lệ") from exc


def verify_password(plain_password: str, stored_password: str) -> bool:
    if not stored_password:
        return False
    if stored_password.startswith("plain$"):
        return plain_password == stored_password.split("$", 1)[1]
    return pwd_context.verify(plain_password, stored_password)


async def get_current_user(authorization: str | None = Header(default=None)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Cần đăng nhập")

    token = authorization.split(" ", 1)[1].strip()
    payload = verify_token(token)
    user = await database.fetch_one(
        "SELECT id, username, role, created_at FROM users WHERE id = :id",
        {"id": payload["uid"]},
    )
    if not user:
        raise HTTPException(status_code=401, detail="Người dùng không tồn tại")
    return dict(user)


def require_roles(*roles: str):
    allowed = set(roles)

    async def dependency(current_user: dict = Depends(get_current_user)) -> dict:
        if current_user["role"] not in allowed:
            raise HTTPException(status_code=403, detail="Bạn không có quyền thực hiện thao tác này")
        return current_user

    return dependency


def can_manage_station(role: str) -> bool:
    return role in {"admin", "officer"}


def can_admin(role: str) -> bool:
    return role == "admin"


def normalize_details(details: dict | None) -> dict:
    return details or {}
