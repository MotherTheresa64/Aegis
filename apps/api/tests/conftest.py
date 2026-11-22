import pytest

from app import ratelimit


@pytest.fixture(autouse=True)
def reset_rate_limits():
    # The development limiter is process-global; without this, registrations from earlier
    # tests count against later ones and the suite fails once it grows past the auth limit.
    ratelimit._MEMORY_BUCKETS.clear()
    yield
