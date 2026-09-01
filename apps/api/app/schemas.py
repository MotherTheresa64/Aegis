import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints

from .models import IncidentStatus, PostmortemStatus, Role, ServiceStatus, Severity, TaskStatus


ShortName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=160)]
ServiceName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=160)]
IncidentTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=240)]
TaskTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=240)]
SourceName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
ServiceSlug = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=180)]
ApiKeyName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=120)]
NonBlankMessage = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class UserCreate(BaseModel):
    email: EmailStr
    full_name: ShortName
    password: str = Field(min_length=8, max_length=128)
    organization_name: ShortName


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


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
    name: ServiceName
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)] = ""


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


class DependencyCreate(BaseModel):
    source_service_id: uuid.UUID
    target_service_id: uuid.UUID
    relationship: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=80)] = "depends_on"


class DependencyOut(ORMModel):
    id: uuid.UUID
    organization_id: uuid.UUID
    source_service_id: uuid.UUID
    target_service_id: uuid.UUID
    relationship: str
    created_at: datetime


class IncidentCreate(BaseModel):
    title: IncidentTitle
    summary: Annotated[str, StringConstraints(strip_whitespace=True, max_length=5000)] = ""
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


class IncidentTaskOut(ORMModel):
    id: uuid.UUID
    incident_id: uuid.UUID
    assigned_to_id: uuid.UUID | None
    title: str
    status: TaskStatus
    created_at: datetime
    completed_at: datetime | None


class IncidentOut(ORMModel):
    id: uuid.UUID
    organization_id: uuid.UUID
    service_id: uuid.UUID | None
    created_by_id: uuid.UUID | None
    commander_id: uuid.UUID | None
    title: str
    summary: str
    severity: Severity
    status: IncidentStatus
    created_at: datetime
    resolved_at: datetime | None


class IncidentDetail(IncidentOut):
    events: list[IncidentEventOut] = Field(default_factory=list)
    tasks: list[IncidentTaskOut] = Field(default_factory=list)


class IncidentStatusUpdate(BaseModel):
    status: IncidentStatus
    message: Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)] | None = None


class IncidentEventCreate(BaseModel):
    message: NonBlankMessage


class IncidentTaskCreate(BaseModel):
    title: TaskTitle
    assigned_to_id: uuid.UUID | None = None


class IncidentTaskUpdate(BaseModel):
    status: TaskStatus


class SimulationRequest(BaseModel):
    service_id: uuid.UUID
    severity: Severity = Severity.sev1
    title: IncidentTitle = "Elevated production error rate"


class ApiKeyCreate(BaseModel):
    name: ApiKeyName


class ApiKeySummary(ORMModel):
    id: uuid.UUID
    name: str
    key_prefix: str
    last_used_at: datetime | None
    created_at: datetime


class ApiKeyCreated(ApiKeySummary):
    key: str


class AlertIngest(BaseModel):
    service_slug: ServiceSlug
    title: IncidentTitle
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=5000)] = ""
    severity: Severity = Severity.sev3
    fingerprint: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)] | None = None
    source: SourceName = "external"
    payload: dict = Field(default_factory=dict)


class DashboardOverview(BaseModel):
    services_total: int
    services_impacted: int
    active_incidents: int
    sev1_incidents: int
    services: list[ServiceOut]
    incidents: list[IncidentOut]


class PublicStatus(BaseModel):
    organization_name: str
    organization_slug: str
    overall_status: ServiceStatus
    services: list[ServiceOut]
    active_incidents: list[IncidentOut]
    generated_at: datetime


class AnalyticsOverview(BaseModel):
    incidents_30d: int
    resolved_30d: int
    sev1_30d: int
    mean_time_to_resolve_minutes: float | None
    current_active: int
    current_impacted_services: int


class PostmortemOut(ORMModel):
    id: uuid.UUID
    incident_id: uuid.UUID
    status: PostmortemStatus
    summary: str
    customer_impact: str
    root_cause: str
    resolution: str
    follow_up_actions: list
    created_at: datetime
    updated_at: datetime


class AuditEventOut(ORMModel):
    id: uuid.UUID
    organization_id: uuid.UUID
    actor_id: uuid.UUID | None
    action: str
    resource_type: str
    resource_id: str | None
    details: dict
    created_at: datetime
