import { Dag, triggerDagRun } from "@apache-airflow/ts-sdk";

const dag = new Dag("probe_trigger_conf", { queue: "typescript" });

const written = dag.task("write_report", async (): Promise<string> => "/opt/airflow/output/route-health-2026-11-19.json")();

dag.task("trigger_notify", triggerDagRun({ dagId: "notify_riders", conf: { report_path: written } }))();
