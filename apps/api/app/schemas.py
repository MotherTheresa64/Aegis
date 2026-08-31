import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from .models import IncidentStatus, Role, ServiceStatus, Severity


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=160)
    password: str = Field(min_length=8, max_length=128)
    organization_name: str = Field(min_length=2, max_length=160)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserOut(ORMModel):
    id: uuid.UUID
    email: EmailStr
    full_name: str
    created_at: datetime


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class OrganizationOut(ORMModel):
    id: uuid.UUID
    name: str
    slug: str
    created_at: datetime


class MembershipOut(BaseModel):
    organization: OrganizationOut
    role: Role


class ServiceCreate(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    description: str = Field(default="", max_length=2000)


class ServiceOut(ORMModel):
    id: uuid.UUID
    organization_id: uuid.UUID
    name: str
    slug: str
    description: str
    status: ServiceStatus
    created_at: datetime


class ServiceStatusUpdate(BaseModel):
    status: ServiceStatus


class IncidentCreate(BaseModel):
    title: str = Field(min_length=3, max_length=240)
    summary: str = Field(default="", max_length=5000)
    severity: Severity = Severity.sev3
    service_id: uuid.UUID | None = None


class IncidentEventOut(ORMModel):
    id: uuid.UUID
    incident_id: uuid.UUID
    actor_id: uuid.UUID | None
    event_type: str
    message: str
    event_metadata: dict
    created_at: datetime


class IncidentOut(ORMModel):
    id: uuid.UUID
    organization_id: uuid.UUID
    service_id: uuid.UUID | None
    created_by_id: uuid.UUID
    commander_id: uuid.UUID | None
    title: str
    summary: str
    severity: Severity
    status: IncidentStatus
    created_at: datetime
    resolved_at: datetime | None


class IncidentDetail(IncidentOut):
    events: list[IncidentEventOut] = []


class IncidentStatusUpdate(BaseModel):
    status: IncidentStatus
    message: str | None = Field(default=None, max_length=2000)


class IncidentEventCreate(BaseModel):
    message: str = Field(min_length=1, max_length=4000)


class SimulationRequest(BaseModel):
    service_id: uuid.UUID
    severity: Severity = Severity.sev1
    title: str = "Elevated production error rate"


class DashboardOverview(BaseModel):
    services_total: int
    services_impacted: int
    active_incidents: int
    sev1_incidents: int
    services: list[ServiceOut]
    incidents: list[IncidentOut]
