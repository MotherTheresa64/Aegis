import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..collaboration_models import OrganizationInvitation
from ..db import get_db
from ..deps import get_current_user, membership_for, require_role
from ..models import AuditEvent, Organization, OrganizationMember, Role, User

router = APIRouter(tags=["collaboration"])

ASSIGNABLE_ROLES = {Role.admin, Role.engineer, Role.responder, Role.viewer}


class MemberOut(BaseModel):
    user_id: uuid.UUID
    email: EmailStr
    full_name: str
    role: Role
    joined_at: datetime


class InviteCreate(BaseModel):
    email: EmailStr
    role: Role = Role.engineer


class InviteCreated(BaseModel):
    id: uuid.UUID
    email: EmailStr
    role: Role
    expires_at: datetime
    token: str


class InvitePreview(BaseModel):
    organization_name: str
    email: EmailStr
    role: Role
    expires_at: datetime
    accepted: bool


class MemberRoleUpdate(BaseModel):
    role: Role


def _token_digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def _owner_count(db: AsyncSession, organization_id: uuid.UUID) -> int:
    return int(
        await db.scalar(
            select(func.count()).select_from(OrganizationMember).where(
                OrganizationMember.organization_id == organization_id,
                OrganizationMember.role == Role.owner,
            )
        )
        or 0
    )


@router.get("/organizations/{organization_id}/members", response_model=list[MemberOut])
async def list_members(
    organization_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[MemberOut]:
    await membership_for(db, user.id, organization_id)
    result = await db.execute(
        select(OrganizationMember, User)
        .join(User, User.id == OrganizationMember.user_id)
        .where(OrganizationMember.organization_id == organization_id)
        .order_by(OrganizationMember.created_at.asc())
    )
    return [
        MemberOut(
            user_id=member.user_id,
            email=member_user.email,
            full_name=member_user.full_name,
            role=member.role,
            joined_at=member.created_at,
        )
        for member, member_user in result.all()
    ]


@router.post(
    "/organizations/{organization_id}/invitations",
    response_model=InviteCreated,
    status_code=status.HTTP_201_CREATED,
)
async def create_invitation(
    organization_id: uuid.UUID,
    payload: InviteCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> InviteCreated:
    await require_role(db, user.id, organization_id, {Role.owner, Role.admin})
    if payload.role not in ASSIGNABLE_ROLES:
        raise HTTPException(status_code=422, detail="Owner role cannot be assigned through an invitation")

    email = payload.email.lower()
    existing_user = await db.scalar(select(User).where(User.email == email))
    if existing_user is not None:
        existing_member = await db.scalar(
            select(OrganizationMember).where(
                OrganizationMember.organization_id == organization_id,
                OrganizationMember.user_id == existing_user.id,
            )
        )
        if existing_member is not None:
            raise HTTPException(status_code=409, detail="User is already an organization member")

    raw_token = f"aeg_inv_{secrets.token_urlsafe(32)}"
    invitation = OrganizationInvitation(
        organization_id=organization_id,
        invited_by_id=user.id,
        email=email,
        role=payload.role,
        token_hash=_token_digest(raw_token),
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
    )
    db.add(invitation)
    await db.flush()
    db.add(
        AuditEvent(
            organization_id=organization_id,
            actor_id=user.id,
            action="organization.invitation_created",
            resource_type="invitation",
            resource_id=str(invitation.id),
            details={"email": email, "role": payload.role.value},
        )
    )
    await db.commit()
    await db.refresh(invitation)
    return InviteCreated(
        id=invitation.id,
        email=invitation.email,
        role=invitation.role,
        expires_at=invitation.expires_at,
        token=raw_token,
    )


@router.get("/invitations/{token}", response_model=InvitePreview)
async def preview_invitation(token: str, db: AsyncSession = Depends(get_db)) -> InvitePreview:
    invitation = await db.scalar(
        select(OrganizationInvitation).where(OrganizationInvitation.token_hash == _token_digest(token))
    )
    if invitation is None:
        raise HTTPException(status_code=404, detail="Invitation not found")
    organization = await db.get(Organization, invitation.organization_id)
    if organization is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    return InvitePreview(
        organization_name=organization.name,
        email=invitation.email,
        role=invitation.role,
        expires_at=invitation.expires_at,
        accepted=invitation.accepted_at is not None,
    )


@router.post("/invitations/{token}/accept", response_model=MemberOut)
async def accept_invitation(
    token: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MemberOut:
    invitation = await db.scalar(
        select(OrganizationInvitation).where(OrganizationInvitation.token_hash == _token_digest(token))
    )
    if invitation is None:
        raise HTTPException(status_code=404, detail="Invitation not found")
    now = datetime.now(timezone.utc)
    if invitation.accepted_at is not None:
        raise HTTPException(status_code=409, detail="Invitation has already been accepted")
    if invitation.expires_at < now:
        raise HTTPException(status_code=410, detail="Invitation has expired")
    if invitation.email != user.email.lower():
        raise HTTPException(status_code=403, detail="Invitation email does not match the signed-in user")

    existing = await db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == invitation.organization_id,
            OrganizationMember.user_id == user.id,
        )
    )
    if existing is not None:
        invitation.accepted_at = now
        await db.commit()
        return MemberOut(
            user_id=user.id,
            email=user.email,
            full_name=user.full_name,
            role=existing.role,
            joined_at=existing.created_at,
        )

    membership = OrganizationMember(
        organization_id=invitation.organization_id,
        user_id=user.id,
        role=invitation.role,
    )
    invitation.accepted_at = now
    db.add(membership)
    await db.flush()
    db.add(
        AuditEvent(
            organization_id=invitation.organization_id,
            actor_id=user.id,
            action="organization.invitation_accepted",
            resource_type="membership",
            resource_id=str(membership.id),
            details={"role": membership.role.value},
        )
    )
    await db.commit()
    await db.refresh(membership)
    return MemberOut(
        user_id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=membership.role,
        joined_at=membership.created_at,
    )


@router.patch(
    "/organizations/{organization_id}/members/{member_user_id}",
    response_model=MemberOut,
)
async def update_member_role(
    organization_id: uuid.UUID,
    member_user_id: uuid.UUID,
    payload: MemberRoleUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MemberOut:
    actor = await require_role(db, user.id, organization_id, {Role.owner, Role.admin})
    target = await db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.user_id == member_user_id,
        )
    )
    if target is None:
        raise HTTPException(status_code=404, detail="Organization member not found")
    if target.role == Role.owner and actor.role != Role.owner:
        raise HTTPException(status_code=403, detail="Only an owner can modify another owner")
    if payload.role == Role.owner and actor.role != Role.owner:
        raise HTTPException(status_code=403, detail="Only an owner can grant owner role")
    if target.role == Role.owner and payload.role != Role.owner and await _owner_count(db, organization_id) <= 1:
        raise HTTPException(status_code=409, detail="Organization must retain at least one owner")

    previous = target.role
    target.role = payload.role
    db.add(
        AuditEvent(
            organization_id=organization_id,
            actor_id=user.id,
            action="organization.member_role_changed",
            resource_type="membership",
            resource_id=str(target.id),
            details={"user_id": str(member_user_id), "from": previous.value, "to": payload.role.value},
        )
    )
    await db.commit()
    target_user = await db.get(User, member_user_id)
    if target_user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return MemberOut(
        user_id=target.user_id,
        email=target_user.email,
        full_name=target_user.full_name,
        role=target.role,
        joined_at=target.created_at,
    )


@router.delete("/organizations/{organization_id}/members/{member_user_id}", status_code=204)
async def remove_member(
    organization_id: uuid.UUID,
    member_user_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    actor = await require_role(db, user.id, organization_id, {Role.owner, Role.admin})
    target = await db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.user_id == member_user_id,
        )
    )
    if target is None:
        raise HTTPException(status_code=404, detail="Organization member not found")
    if target.role == Role.owner and actor.role != Role.owner:
        raise HTTPException(status_code=403, detail="Only an owner can remove another owner")
    if target.role == Role.owner and await _owner_count(db, organization_id) <= 1:
        raise HTTPException(status_code=409, detail="Organization must retain at least one owner")

    db.add(
        AuditEvent(
            organization_id=organization_id,
            actor_id=user.id,
            action="organization.member_removed",
            resource_type="membership",
            resource_id=str(target.id),
            details={"user_id": str(member_user_id), "role": target.role.value},
        )
    )
    await db.delete(target)
    await db.commit()
