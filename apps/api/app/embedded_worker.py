"""Optional Celery worker running as a child of the API process.

Free hosting tiers often allow a single web process and no background worker. With
AEGIS_EMBEDDED_WORKER=true the API starts one solo-pool worker beside itself so outbound
webhooks are still delivered with retries. A dedicated worker process remains the right
shape once the deployment can afford one; this keeps the same queue and task code.
"""

import logging
import subprocess
import sys

logger = logging.getLogger(__name__)


def start_embedded_worker() -> subprocess.Popen:
    process = subprocess.Popen(
        [
            sys.executable, "-m", "celery", "-A", "app.worker.celery", "worker",
            "--pool=solo", "--concurrency=1", "--loglevel=INFO",
            "--without-gossip", "--without-mingle", "--without-heartbeat",
        ],
    )
    logger.info("embedded_worker_started pid=%s", process.pid)
    return process


def stop_embedded_worker(process: subprocess.Popen) -> None:
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
    logger.info("embedded_worker_stopped pid=%s", process.pid)
