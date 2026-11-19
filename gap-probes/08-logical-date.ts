import { Dag, getContext } from "@apache-airflow/ts-sdk";

const dag = new Dag("probe_logical_date", { queue: "typescript", schedule: "@daily" });

dag.task("extract_trips", async () => {
  const { logicalDate, dataIntervalStart, dataIntervalEnd } = getContext();
  return `${logicalDate.toISOString()} covers ${dataIntervalStart.toISOString()} to ${dataIntervalEnd.toISOString()}`;
})();
