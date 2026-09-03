FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY pyproject.toml ./
COPY alembic.ini ./
COPY migrations ./migrations
COPY app ./app

RUN pip install --no-cache-dir . \
    && useradd --create-home --uid 10001 aegis \
    && chown -R aegis:aegis /app

USER aegis

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
