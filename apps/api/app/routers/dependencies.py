import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import get_current_user, membership_for, require_role
from ..models import Role, Service, ServiceDependency, User
from ..schemas import DependencyCreate, DependencyOut

router = APIRouter(prefix="/organizations/{organization_id}/dependencies", tags=["dependencies"])


@router.get("", response_model=list[DependencyOut])
async def list_dependencies(
    organization_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ServiceDependency]:
    await membership_for(db, user.id, organization_id)
    result = await db.execute(select(ServiceDependency).where(ServiceDependency.organization_id == organization_id))
    return list(result.scalars())


@router.post("", response_model=DependencyOut, status_code=status.HTTP_201_CREATED)
async def create_dependency(
    organization_id: uuid.UUID,
    payload: DependencyCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ServiceDependency:
    await require_role(db, user.id, organization_id, {Role.owner, Role.admin, Role.engineer})
    if payload.source_service_id == payload.target_service_id:
        raise HTTPException(status_code=422, detail="A service cannot depend on itself")
    services = list((await db.scalars(select(Service).where(
        Service.organization_id == organization_id,
        Service.id.in_([payload.source_service_id, payload.target_service_id]),
    ))).all())
    if len(services) != 2:
        raise HTTPException(status_code=404, detail="Both services must belong to this organization")
    dependency = ServiceDependency(
        organization_id=organization_id,
        source_service_id=payload.source_service_id,
        target_service_id=payload.target_service_id,
        relationship=payload.relationship,
    )
    db.add(dependency)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Dependency already exists") from None
    await db.refresh(dependency)
    return dependency
