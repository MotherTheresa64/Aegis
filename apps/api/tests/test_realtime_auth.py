import asyncio
import uuid

from app.realtime_auth import consume_realtime_ticket, issue_realtime_ticket


def test_realtime_ticket_is_single_use_and_scoped() -> None:
    user_id = uuid.uuid4()
    organization_id = uuid.uuid4()

    ticket = asyncio.run(issue_realtime_ticket(user_id, organization_id))
    identity = asyncio.run(consume_realtime_ticket(ticket))

    assert ticket.startswith("aeg_rt_")
    assert identity is not None
    assert identity.user_id == user_id
    assert identity.organization_id == organization_id
    assert asyncio.run(consume_realtime_ticket(ticket)) is None


def test_realtime_ticket_rejects_unrecognized_tokens() -> None:
    assert asyncio.run(consume_realtime_ticket("not-a-realtime-ticket")) is None
