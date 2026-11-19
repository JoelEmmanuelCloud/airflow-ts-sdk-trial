import { readFile } from "node:fs/promises";
import { Dag, getClient, getContext } from "@apache-airflow/ts-sdk";
import { LATEST_REPORT_VARIABLE, NOTIFY_DAG_ID, QUEUE } from "../config.ts";
import { riderNotice, routesNeedingAttention } from "../lib/report.ts";
import type { ReportDraft, RouteScore } from "../lib/types.ts";

function parseDraft(raw: string, source: string): ReportDraft {
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("serviceDate" in parsed) ||
    !("scores" in parsed) ||
    !Array.isArray(parsed.scores)
  ) {
    throw new Error(`${source} is not a route health report`);
  }
  return parsed as ReportDraft;
}

export async function loadLatestReport(): Promise<ReportDraft> {
  const { runId } = getContext();
  const reportPath = await getClient().getVariableOrThrow(LATEST_REPORT_VARIABLE);
  const draft = parseDraft(await readFile(reportPath, "utf8"), reportPath);
  console.log(`run ${runId}: loaded the ${draft.kind} report for ${draft.serviceDate} from ${reportPath}`);
  return draft;
}

export async function sendRiderNotices({ report }: { report: ReportDraft }): Promise<string[]> {
  const notices = routesNeedingAttention(report.scores).map((score: RouteScore) => riderNotice(score));
  if (notices.length === 0) {
    console.log(`No rider notices needed for ${report.serviceDate}`);
  }
  for (const notice of notices) {
    console.log(notice);
  }
  return notices;
}

export const notifyRiders = new Dag(NOTIFY_DAG_ID, {
  catchup: false,
  tags: ["typescript", "transit", "trial"],
  description: "Logs rider notices for routes the latest route health report flagged.",
  queue: QUEUE,
});

const load = notifyRiders.task("load_latest_report", loadLatestReport);
const send = notifyRiders.task("send_rider_notices", sendRiderNotices);

send({ report: load() });
