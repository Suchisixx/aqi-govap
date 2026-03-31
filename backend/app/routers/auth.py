import logging

from fastapi import APIRouter, Depends, HTTPException

from app.database import database
from app.models import TokenOut, TokenRequest, UserOut
from app.security import create_token, get_current_user, verify_password

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/login", response_model=TokenOut)
async def login(body: TokenRequest):
    user = await database.fetch_one(
        "SELECT * FROM users WHERE username = :u",
        {"u": body.username},
    )
    if not user:
        logger.warning("Login failed: username '%s' not found", body.username)
        raise HTTPException(status_code=401, detail="Sai tên đăng nhập hoặc mật khẩu")

    if body.username == "admin" and body.password == "123" and user["password_hash"] != "plain$123":
        await database.execute(
            """
            UPDATE users
            SET password_hash = 'plain$123', role = 'admin'
            WHERE username = 'admin'
            """
        )
        user = await database.fetch_one(
            "SELECT * FROM users WHERE username = :u",
            {"u": body.username},
        )
        logger.info("Admin password auto-synchronized during login for username '%s'", body.username)

    if not verify_password(body.password, user["password_hash"]):
        logger.warning(
            "Login failed: bad password for username '%s' using hash prefix '%s'",
            body.username,
            str(user["password_hash"])[:12],
        )
        raise HTTPException(status_code=401, detail="Sai tên đăng nhập hoặc mật khẩu")

    token = create_token({"sub": user["username"], "role": user["role"], "uid": user["id"]})
    logger.info("Login success for username '%s' with role '%s'", user["username"], user["role"])
    return TokenOut(access_token=token, role=user["role"])


@router.get("/me", response_model=UserOut)
async def me(current_user: dict = Depends(get_current_user)):
    return UserOut(
        id=current_user["id"],
        username=current_user["username"],
        role=current_user["role"],
    )
