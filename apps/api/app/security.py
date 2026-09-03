import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from .config import settings

ALGORITHM = "HS256"
TOKEN_ISSUER = "aegis-api"
DUMMY_PASSWORD_HASH = bcrypt.hashpw(
    b"aegis-dummy-password-for-timing-normalization",
    bcrypt.gensalt(),
).decode()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), password_hash.encode())
    except ValueError:
        return False


def create_access_token(user_id: uuid.UUID) -> str:
    issued_at = datetime.now(timezone.utc)
    expires = issued_at + timedelta(minutes=settings.aegis_access_token_minutes)
    return jwt.encode(
        {
            "sub": str(user_id),
            "iss": TOKEN_ISSUER,
            "iat": issued_at,
            "exp": expires,
            "jti": str(uuid.uuid4()),
        },
        settings.aegis_secret_key,
        algorithm=ALGORITHM,
    )


def decode_access_token(token: str) -> uuid.UUID:
    payload = jwt.decode(
        token,
        settings.aegis_secret_key,
        algorithms=[ALGORITHM],
        issuer=TOKEN_ISSUER,
        options={"require": ["sub", "iss", "iat", "exp", "jti"]},
    )
    return uuid.UUID(payload["sub"])


def issue_api_key() -> tuple[str, str, str]:
    raw = f"aeg_live_{secrets.token_urlsafe(32)}"
    prefix = raw[:18]
    digest = hashlib.sha256(raw.encode()).hexdigest()
    return raw, prefix, digest


def hash_api_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()
