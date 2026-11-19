import { Dag, getContext } from "@apache-airflow/ts-sdk";

const dag = new Dag("probe_params", {
  queue: "typescript",
  params: {
    city: { value: "Toronto", schema: { type: "string", enum: ["Toronto", "Ottawa"] } },
    serviceDate: { value: "2026-11-19", schema: { type: "string", format: "date" } },
  },
});

dag.task("extract_trips", async () => {
  const { params } = getContext<{ city: string; serviceDate: string }>();
  return `${params.city} on ${params.serviceDate}`;
})();
