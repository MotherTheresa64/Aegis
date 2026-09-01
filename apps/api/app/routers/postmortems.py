import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..db import get_db
from ..deps import get_current_user, membership_for, require_role
from ..models import AuditEvent, Incident, IncidentStatus, Postmortem, Role, Service, User
from ..schemas import PostmortemOut

router = APIRouter(prefix="/organizations/{organization_id}/incidents/{incident_id}/postmortem", tags=["postmortems"])


@router.get("", response_model=PostmortemOut)
async def get_postmortem(
    organization_id: uuid.UUID,
    incident_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Postmortem:
    await membership_for(db, user.id, organization_id)
    incident = await db.scalar(
        select(Incident).where(
            Incident.id == incident_id,
            Incident.organization_id == organization_id,
        )
    )
    if incident is None:
        raise HTTPException(status_code=404, detail="Incident not found")
    postmortem = await db.scalar(select(Postmortem).where(Postmortem.incident_id == incident_id))
    if postmortem is None:
        raise HTTPException(status_code=404, detail="Postmortem has not been generated")
    return postmortem


@router.post("/generate", response_model=PostmortemOut)
async def generate_postmortem(
    organization_id: uuid.UUID,
    incident_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Postmortem:
    await require_role(db, user.id, organization_id, {Role.owner, Role.admin, Role.engineer, Role.responder})
    incident = await db.scalar(
        select(Incident).options(selectinload(Incident.events)).where(
            Incident.id == incident_id,
            Incident.organization_id == organization_id,
        )
    )
    if incident is None:
        raise HTTPException(status_code=404, detail="Incident not found")
    if incident.status != IncidentStatus.resolved:
        raise HTTPException(status_code=409, detail="Resolve the incident before generating a postmortem")

    existing = await db.scalar(select(Postmortem).where(Postmortem.incident_id == incident.id))
    if existing:
        return existing

    service = await db.get(Service, incident.service_id) if incident.service_id else None
    event_summary = " ".join(event.message for event in incident.events[-4:])
    postmortem = Postmortem(
        incident_id=incident.id,
        summary=incident.summary or f"{incident.title} affected {service.name if service else 'production systems'}.",
        customer_impact=f"{service.name if service else 'A production service'} was impacted during a {incident.severity.value.upper()} incident.",
        root_cause="Pending engineering review. Aegis preserves the incident timeline so the final root cause can be validated rather than guessed.",
        resolution=event_summary or "Resolution details should be completed by the incident team.",
        follow_up_actions=[
            "Validate the root cause with service owners.",
            "Add or tune an alert that detects the failure mode earlier.",
            "Create a regression test or operational guardrail for the identified failure mode.",
        ],
    )
    db.add(postmortem)
    await db.flush()
    db.add(AuditEvent(
        organization_id=organization_id,
        actor_id=user.id,
        action="postmortem.generated",
        resource_type="postmortem",
        resource_id=str(postmortem.id),
        details={"incident_id": str(incident.id)},
    ))
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        concurrent = await db.scalar(select(Postmortem).where(Postmortem.incident_id == incident.id))
        if concurrent is None:
            raise
        return concurrent
    await db.refresh(postmortem)
    return postmortem
