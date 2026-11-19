import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Dag, Label, getClient, getContext, triggerDagRun } from "@apache-airflow/ts-sdk";
import { approval } from "@apache-airflow/ts-sdk/hitl";
import {
  AS_OF_VARIABLE,
  DELAYS_CHECKPOINT_KEY,
  INJECT_FAILURE_VARIABLE,
  LATEST_REPORT_VARIABLE,
  NOTIFY_DAG_ID,
  QUEUE,
  REPORT_DAG_ID,
  THRESHOLD_VARIABLE,
} from "../config.ts";
import {
  computeRouteDelays,
  hasIncident,
  isFresh,
  newestTripAt,
  parseAsOf,
  parseThreshold,
  scoreRoutes as scoreAll,
  serviceDateAt,
  tripsOnServiceDate,
} from "../lib/delays.ts";
import { dataDir, loadRoutes, loadTrips, outputDir } from "../lib/fixtures.ts";
import { renderReport, routesNeedingAttention } from "../lib/report.ts";
import type { ReportDraft, ReportFile, RouteDelay, RouteScore, TripBatch } from "../lib/types.ts";

export async function extractTrips(): Promise<TripBatch> {
  const { runId, tryNumber } = getContext();
  const asOf = parseAsOf(await getClient().getVariable(AS_OF_VARIABLE), new Date());
  const dir = dataDir();
  const [routes, allTrips] = await Promise.all([loadRoutes(dir), loadTrips(dir)]);
  const serviceDate = serviceDateAt(asOf);
  const trips = tripsOnServiceDate(allTrips, serviceDate);
  console.log(
    `run ${runId}, try ${tryNumber}: ${trips.length} of ${allTrips.length} trips fall on service date ${serviceDate}`,
  );
  return { asOf: asOf.toISOString(), serviceDate, newestTripAt: newestTripAt(allTrips), routes, trips };
}

export async function checkFreshness({ batch }: { batch: TripBatch }): Promise<boolean> {
  const fresh = isFresh(batch.newestTripAt, batch.asOf);
  console.log(`newest trip ${batch.newestTripAt ?? "none"}, as of ${batch.asOf}: ${fresh ? "fresh" : "stale"}`);
  return fresh;
}

export async function alertStale({ batch }: { batch: TripBatch }): Promise<string> {
  const message = `Trip data is stale: newest trip is ${batch.newestTripAt ?? "missing"}, report time is ${batch.asOf}`;
  console.error(message);
  return message;
}

export async function computeDelays({ batch }: { batch: TripBatch }): Promise<RouteDelay[]> {
  const { tryNumber } = getContext();
  const client = getClient();
  const store = client.taskStateStore;

  const saved = await store.get<RouteDelay[]>(DELAYS_CHECKPOINT_KEY);
  if (saved !== null) {
    console.log(`try ${tryNumber}: read ${saved.length} route delays back from the task state store`);
    await store.delete(DELAYS_CHECKPOINT_KEY);
    return saved;
  }

  const delays = computeRouteDelays(batch.trips, batch.routes);
  await store.set(DELAYS_CHECKPOINT_KEY, delays, { retention: 24 * 60 * 60 });
  console.log(`try ${tryNumber}: saved ${delays.length} route delays to the task state store`);

  if (tryNumber === 1 && (await client.getVariable(INJECT_FAILURE_VARIABLE)) === "true") {
    throw new Error(`Failing try 1 on purpose because ${INJECT_FAILURE_VARIABLE} is "true"`);
  }

  await store.delete(DELAYS_CHECKPOINT_KEY);
  return delays;
}

export async function scoreRoutes({ delays }: { delays: RouteDelay[] }): Promise<RouteScore[]> {
  const threshold = parseThreshold(await getClient().getVariable(THRESHOLD_VARIABLE));
  const scores = scoreAll(delays, threshold);
  for (const score of scores) {
    console.log(`${score.routeId}: ${score.averageDelayMinutes} min average, ${score.status} (threshold ${threshold})`);
  }
  return scores;
}

export async function buildAllGoodReport({ batch, scores }: { batch: TripBatch; scores: RouteScore[] }) {
  return renderReport("all_good", batch.serviceDate, scores);
}

export async function buildIncidentReport({ batch, scores }: { batch: TripBatch; scores: RouteScore[] }) {
  return renderReport("incident", batch.serviceDate, scores);
}

export async function writeReport(): Promise<ReportFile> {
  const client = getClient();
  const [allGood, incident] = await Promise.all([
    client.getXCom<ReportDraft>({ key: "return_value", taskId: "build_all_good_report" }),
    client.getXCom<ReportDraft>({ key: "return_value", taskId: "build_incident_report" }),
  ]);
  const draft = allGood ?? incident;
  if (draft === null) {
    throw new Error("Neither report task left a draft to write");
  }

  const dir = outputDir();
  await mkdir(dir, { recursive: true });
  const base = path.join(dir, `route-health-${draft.serviceDate}`);
  const markdownPath = `${base}.md`;
  const jsonPath = `${base}.json`;
  await writeFile(markdownPath, draft.markdown, "utf8");
  await writeFile(jsonPath, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
  await client.setVariable(LATEST_REPORT_VARIABLE, jsonPath, `Written by ${REPORT_DAG_ID}`);
  console.log(`wrote ${markdownPath} and ${jsonPath}`);

  return {
    kind: draft.kind,
    serviceDate: draft.serviceDate,
    markdownPath,
    jsonPath,
    markdown: draft.markdown,
    routesNeedingAttention: routesNeedingAttention(draft.scores).length,
  };
}

export const routeHealthReport = new Dag(REPORT_DAG_ID, {
  schedule: "@daily",
  catchup: false,
  maxActiveRuns: 1,
  tags: ["typescript", "transit", "trial"],
  description: "Daily on-time report for invented Toronto bus routes, read from local JSON fixtures.",
  queue: QUEUE,
});

const extract = routeHealthReport.task("extract_trips", extractTrips, {
  retries: 2,
  retryDelay: 10,
  executionTimeout: 120,
});
const alert = routeHealthReport.task("alert_stale", alertStale);

const transform = routeHealthReport.taskGroup("transform");
const delaysTask = transform.task("compute_delays", computeDelays, { retries: 1, retryDelay: 5 });
const scoresTask = transform.task("score_routes", scoreRoutes);

const allGoodTask = routeHealthReport.task("build_all_good_report", buildAllGoodReport);
const incidentTask = routeHealthReport.task("build_incident_report", buildIncidentReport);
const writeTask = routeHealthReport.task("write_report", writeReport, {
  triggerRule: "none_failed_min_one_success",
});

const signOffTask = routeHealthReport.task(
  "sign_off",
  approval({
    subject: ({ report }: { report: ReportFile }) =>
      `Publish the ${report.kind === "all_good" ? "all good" : "incident"} report for ${report.serviceDate}?`,
    body: ({ report }: { report: ReportFile }) => report.markdown,
    responseTimeout: 4 * 60 * 60,
    defaults: "Reject",
  }),
);

const notifyTask = routeHealthReport.task(
  "trigger_notify",
  triggerDagRun({
    dagId: NOTIFY_DAG_ID,
    conf: { source_dag_id: REPORT_DAG_ID, report_variable: LATEST_REPORT_VARIABLE },
  }),
);

const batch = extract();
const alerted = alert({ batch });
const delays = delaysTask({ batch });
const scores = scoresTask({ delays });
const allGood = allGoodTask({ batch, scores });
const incident = incidentTask({ batch, scores });

async function pickReportType({ scores }: { scores: RouteScore[] }) {
  return hasIncident(scores) ? incident : allGood;
}

const freshness = routeHealthReport
  .if(checkFreshness, { batch }, { taskId: "check_freshness" });
freshness.then(delays).else(alerted);
freshness.before(Label.of("fresh").on(delays), Label.of("stale").on(alerted));

const reportType = routeHealthReport
  .switch(pickReportType, { scores }, { taskId: "pick_report_type" })
  .case(allGood)
  .case(incident);
reportType.before(Label.of("all routes ok").on(allGood), Label.of("incident").on(incident));

const written = writeTask().after(allGood, incident);
const signedOff = signOffTask({ report: written });
notifyTask().after(signedOff);
