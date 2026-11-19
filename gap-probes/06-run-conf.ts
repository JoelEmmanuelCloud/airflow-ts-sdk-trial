import { Dag, getContext } from "@apache-airflow/ts-sdk";

const dag = new Dag("probe_run_conf", { queue: "typescript" });

dag.task("load_report", async () => {
  const { conf } = getContext<{ report_path: string }>();
  return conf.report_path;
})();
