import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import get_current_user
from ..models import Organization, OrganizationMember, Role, User
from ..schemas import LoginRequest, MembershipOut, TokenResponse, UserCreate, UserOut
from ..security import DUMMY_PASSWORD_HASH, create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


def slugify(value: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-") or "organization"
    return f"{base}-{uuid.uuid4().hex[:6]}"


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(payload: UserCreate, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    email = payload.email.lower()
    existing = await db.scalar(select(User).where(User.email == email))
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    user = User(
        email=email,
        full_name=payload.full_name,
        password_hash=hash_password(payload.password),
    )
    organization = Organization(
        name=payload.organization_name,
        slug=slugify(payload.organization_name),
    )
    db.add_all([user, organization])
    await db.flush()
    db.add(OrganizationMember(organization_id=organization.id, user_id=user.id, role=Role.owner))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Account could not be created because it already exists") from None
    await db.refresh(user)
    return TokenResponse(access_token=create_access_token(user.id), user=UserOut.model_validate(user))


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    user = await db.scalar(select(User).where(User.email == payload.email.lower()))
    password_hash = user.password_hash if user is not None else DUMMY_PASSWORD_HASH
    password_valid = verify_password(payload.password, password_hash)
    if user is None or not user.is_active or not password_valid:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return TokenResponse(access_token=create_access_token(user.id), user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)) -> User:
    return user


@router.get("/memberships", response_model=list[MembershipOut])
async def memberships(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> list[MembershipOut]:
    result = await db.execute(
        select(OrganizationMember, Organization)
        .join(Organization, Organization.id == OrganizationMember.organization_id)
        .where(OrganizationMember.user_id == user.id)
        .order_by(Organization.name)
    )
    return [
        MembershipOut(organization=organization, role=membership.role)
        for membership, organization in result.all()
    ]
