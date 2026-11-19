import { Dag } from "@apache-airflow/ts-sdk";

async function alertOnCall(context: { dagId: string; taskId: string; exception: unknown }) {
  console.error(`task ${context.dagId}.${context.taskId} failed: ${String(context.exception)}`);
}

const dag = new Dag("probe_callbacks", {
  queue: "typescript",
  onFailureCallback: alertOnCall,
  onSuccessCallback: async () => console.log("run succeeded"),
});

dag.task("write_report", async () => "written", {
  onFailureCallback: alertOnCall,
  onRetryCallback: alertOnCall,
})();
