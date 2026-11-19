import { Bundle, Dag } from "@apache-airflow/ts-sdk";

const dag = new Dag("probe_trigger_rule", { queue: "typescript" });

const a = dag.task("a", async () => 1)();
const b = dag.task("b", async () => 2)();

dag.task("typo_rule", async () => 3, { triggerRule: "none_failed_min_one_sucess" })().after(a, b);
dag.task("made_up_rule", async () => 4, { triggerRule: "whenever_you_like" })().after(a, b);

await new Bundle(dag).serve();
