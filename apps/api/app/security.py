import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from .config import settings

ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode(), password_hash.encode())


def create_access_token(user_id: uuid.UUID) -> str:
    expires = datetime.now(timezone.utc) + timedelta(minutes=settings.aegis_access_token_minutes)
    return jwt.encode({"sub": str(user_id), "exp": expires}, settings.aegis_secret_key, algorithm=ALGORITHM)


def decode_access_token(token: str) -> uuid.UUID:
    payload = jwt.decode(token, settings.aegis_secret_key, algorithms=[ALGORITHM])
    return uuid.UUID(payload["sub"])


def issue_api_key() -> tuple[str, str, str]:
    raw = f"aeg_live_{secrets.token_urlsafe(32)}"
    prefix = raw[:18]
    digest = hashlib.sha256(raw.encode()).hexdigest()
    return raw, prefix, digest


def hash_api_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()
