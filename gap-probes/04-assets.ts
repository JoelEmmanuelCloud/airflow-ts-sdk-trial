import { Asset, Dag } from "@apache-airflow/ts-sdk";

const routeReport = new Asset({ name: "route_health_report", uri: "file:///opt/airflow/output/route-health.json" });

const producer = new Dag("probe_asset_producer", { queue: "typescript", schedule: "@daily" });
producer.task("write_report", async () => "written", { outlets: [routeReport] })();

const consumer = new Dag("probe_asset_consumer", { queue: "typescript", schedule: [routeReport] });
consumer.task("notify_riders", async () => "notified", { inlets: [routeReport] })();
