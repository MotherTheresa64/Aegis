from prometheus_client import Counter, Histogram

HTTP_REQUESTS = Counter(
    "aegis_http_requests_total",
    "HTTP requests processed by Aegis",
    ("method", "route", "status"),
)

HTTP_REQUEST_DURATION = Histogram(
    "aegis_http_request_duration_seconds",
    "HTTP request duration in seconds",
    ("method", "route"),
    buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0),
)


def observe_request(method: str, route: str, status_code: int, duration_seconds: float) -> None:
    HTTP_REQUESTS.labels(method=method, route=route, status=str(status_code)).inc()
    HTTP_REQUEST_DURATION.labels(method=method, route=route).observe(duration_seconds)
