from fastapi import APIRouter, HTTPException, status
from datetime import datetime, timedelta
from jose import jwt
from passlib.context import CryptContext
import os

from app.database import database
from app.models import TokenRequest, TokenOut

router = APIRouter()

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
    except Exception:
        raise HTTPException(status_code=401, detail="Token không hợp lệ")


@router.post("/login", response_model=TokenOut)
async def login(body: TokenRequest):
    user = await database.fetch_one(
        "SELECT * FROM users WHERE username = :u", {"u": body.username}
    )
    if not user or not pwd_context.verify(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Sai tên đăng nhập hoặc mật khẩu")

    token = create_token({"sub": user["username"], "role": user["role"], "uid": user["id"]})
    return TokenOut(access_token=token, role=user["role"])


@router.get("/me")
async def me(token: str):
    payload = verify_token(token)
    return {"username": payload["sub"], "role": payload["role"]}
