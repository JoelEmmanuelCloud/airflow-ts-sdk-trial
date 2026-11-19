import { Bundle, Dag } from "@apache-airflow/ts-sdk";

const dag = new Dag("ts_hello", { schedule: "@daily", queue: "typescript" });

const extract = dag.task("extract", async (): Promise<number> => 42);
const report = dag.task("report", async ({ rows }: { rows: number }) => {
  console.log(`extracted ${rows} rows`);
});

report({ rows: extract() });

await new Bundle(dag).serve();
