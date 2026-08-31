import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..db import get_db
from ..deps import get_current_user, membership_for
from ..models import User
from ..realtime_auth import issue_realtime_ticket

router = APIRouter(tags=["realtime"])


class RealtimeTicketOut(BaseModel):
    ticket: str
    expires_in: int


@router.post(
    "/organizations/{organization_id}/realtime-ticket",
    response_model=RealtimeTicketOut,
)
async def create_realtime_ticket(
    organization_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RealtimeTicketOut:
    await membership_for(db, user.id, organization_id)
    try:
        ticket = await issue_realtime_ticket(user.id, organization_id)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Realtime authentication is temporarily unavailable",
        ) from exc
    return RealtimeTicketOut(
        ticket=ticket,
        expires_in=max(10, settings.aegis_realtime_ticket_seconds),
    )
