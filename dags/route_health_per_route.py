from __future__ import annotations

import json
import os
from pathlib import Path

from airflow.sdk import Asset, dag, task

DATA_DIR = Path(os.environ.get("ROUTE_HEALTH_DATA_DIR", "/opt/airflow/fixtures"))
OUTPUT_DIR = Path(os.environ.get("ROUTE_HEALTH_OUTPUT_DIR", "/opt/airflow/output"))
ROUTE_SCORES = Asset(name="route_health_scores", uri=f"file://{OUTPUT_DIR / 'route-scores.json'}")


@dag(
    dag_id="route_health_per_route",
    schedule=None,
    catchup=False,
    tags=["python", "typescript", "transit", "trial"],
    description="Scores each route in its own mapped TypeScript task, then publishes an asset.",
)
def route_health_per_route():
    @task
    def list_route_ids() -> list[str]:
        routes = json.loads((DATA_DIR / "routes.json").read_text(encoding="utf-8"))
        return [route["id"] for route in routes]

    @task.stub(queue="typescript")
    def score_route(route_id: str): ...

    @task(outlets=[ROUTE_SCORES])
    def publish_scores(scores: list[dict]) -> str:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        target = OUTPUT_DIR / "route-scores.json"
        target.write_text(json.dumps(list(scores), indent=2) + "\n", encoding="utf-8")
        return str(target)

    publish_scores(score_route.expand(route_id=list_route_ids()))


route_health_per_route()
