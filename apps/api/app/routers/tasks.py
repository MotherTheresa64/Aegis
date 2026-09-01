import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..deps import get_current_user, require_role
from ..integrations import enqueue_webhook_deliveries, stage_webhook_event
from ..models import Incident, IncidentEvent, IncidentTask, OrganizationMember, Role, TaskStatus, User
from ..realtime import manager
from ..schemas import IncidentTaskCreate, IncidentTaskOut, IncidentTaskUpdate

router = APIRouter(
    prefix="/organizations/{organization_id}/incidents/{incident_id}/tasks",
    tags=["incident tasks"],
)


async def _incident_for_organization(
    db: AsyncSession, organization_id: uuid.UUID, incident_id: uuid.UUID
) -> Incident:
    incident = await db.scalar(
        select(Incident).where(
            Incident.id == incident_id,
            Incident.organization_id == organization_id,
        )
    )
    if incident is None:
        raise HTTPException(status_code=404, detail="Incident not found")
    return incident


@router.get("", response_model=list[IncidentTaskOut])
async def list_tasks(
    organization_id: uuid.UUID,
    incident_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[IncidentTask]:
    await require_role(
        db,
        user.id,
        organization_id,
        {Role.owner, Role.admin, Role.engineer, Role.responder, Role.viewer},
    )
    await _incident_for_organization(db, organization_id, incident_id)
    result = await db.execute(
        select(IncidentTask)
        .where(IncidentTask.incident_id == incident_id)
        .order_by(IncidentTask.created_at.asc())
    )
    return list(result.scalars())


@router.post("", response_model=IncidentTaskOut, status_code=status.HTTP_201_CREATED)
async def create_task(
    organization_id: uuid.UUID,
    incident_id: uuid.UUID,
    payload: IncidentTaskCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> IncidentTask:
    await require_role(
        db,
        user.id,
        organization_id,
        {Role.owner, Role.admin, Role.engineer, Role.responder},
    )
    await _incident_for_organization(db, organization_id, incident_id)

    if payload.assigned_to_id is not None:
        assignee_membership = await db.scalar(
            select(OrganizationMember).where(
                OrganizationMember.organization_id == organization_id,
                OrganizationMember.user_id == payload.assigned_to_id,
            )
        )
        if assignee_membership is None:
            raise HTTPException(status_code=422, detail="Assignee must belong to the organization")

    task = IncidentTask(
        incident_id=incident_id,
        assigned_to_id=payload.assigned_to_id,
        title=payload.title,
    )
    db.add(task)
    await db.flush()
    db.add(
        IncidentEvent(
            incident_id=incident_id,
            actor_id=user.id,
            event_type="task.created",
            message=f"Task created: {task.title}",
            event_metadata={"task_id": str(task.id)},
        )
    )
    deliveries = await stage_webhook_event(
        db,
        organization_id,
        "incident.task_created",
        {
            "incident_id": str(incident_id),
            "task_id": str(task.id),
            "title": task.title,
            "assigned_to_id": str(task.assigned_to_id) if task.assigned_to_id else None,
            "status": task.status.value,
        },
    )
    await db.commit()
    await db.refresh(task)
    await enqueue_webhook_deliveries(db, deliveries)
    await manager.broadcast(
        organization_id,
        {"type": "incident.task_created", "incident_id": str(incident_id), "task_id": str(task.id)},
    )
    return task


@router.patch("/{task_id}", response_model=IncidentTaskOut)
async def update_task(
    organization_id: uuid.UUID,
    incident_id: uuid.UUID,
    task_id: uuid.UUID,
    payload: IncidentTaskUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> IncidentTask:
    await require_role(
        db,
        user.id,
        organization_id,
        {Role.owner, Role.admin, Role.engineer, Role.responder},
    )
    await _incident_for_organization(db, organization_id, incident_id)
    task = await db.scalar(
        select(IncidentTask).where(
            IncidentTask.id == task_id,
            IncidentTask.incident_id == incident_id,
        )
    )
    if task is None:
        raise HTTPException(status_code=404, detail="Incident task not found")
    if task.status == payload.status:
        raise HTTPException(status_code=409, detail="Task is already in that status")

    previous = task.status.value
    task.status = payload.status
    task.completed_at = datetime.now(timezone.utc) if payload.status == TaskStatus.done else None
    db.add(
        IncidentEvent(
            incident_id=incident_id,
            actor_id=user.id,
            event_type="task.status_changed",
            message=f"Task '{task.title}' changed from {previous} to {payload.status.value}.",
            event_metadata={
                "task_id": str(task.id),
                "from": previous,
                "to": payload.status.value,
            },
        )
    )
    deliveries = await stage_webhook_event(
        db,
        organization_id,
        "incident.task_updated",
        {
            "incident_id": str(incident_id),
            "task_id": str(task.id),
            "from": previous,
            "to": task.status.value,
        },
    )
    await db.commit()
    await db.refresh(task)
    await enqueue_webhook_deliveries(db, deliveries)
    await manager.broadcast(
        organization_id,
        {"type": "incident.task_updated", "incident_id": str(incident_id), "task_id": str(task.id)},
    )
    return task
