import type { ReportDraft, ReportKind, RouteScore } from "./types.ts";

const STATUS_LABEL: Record<RouteScore["status"], string> = {
  ok: "OK",
  degraded: "Degraded",
  bad: "Bad",
};

function scoreTable(scores: readonly RouteScore[]): string[] {
  return [
    "| Route | Name | Trips | Average delay (min) | Status |",
    "|---|---|---|---|---|",
    ...scores.map(
      (s) => `| ${s.routeId} | ${s.routeName} | ${s.tripCount} | ${s.averageDelayMinutes} | ${STATUS_LABEL[s.status]} |`,
    ),
  ];
}

export function routesNeedingAttention(scores: readonly RouteScore[]): RouteScore[] {
  return scores.filter((score) => score.status !== "ok");
}

export function renderReport(kind: ReportKind, serviceDate: string, scores: readonly RouteScore[]): ReportDraft {
  const attention = routesNeedingAttention(scores);
  const heading =
    kind === "all_good"
      ? `# Route health for ${serviceDate}: all routes on time`
      : `# Route health for ${serviceDate}: ${attention.length} route(s) need attention`;
  const summary =
    kind === "all_good"
      ? ["Every route ran within the delay threshold."]
      : attention.map((s) => `- **${s.routeId} ${s.routeName}** is ${s.status}, averaging ${s.averageDelayMinutes} min late.`);
  const markdown = [heading, "", ...summary, "", ...scoreTable(scores), ""].join("\n");
  return { kind, serviceDate, markdown, scores: [...scores] };
}

export function riderNotice(score: RouteScore): string {
  return `Rider notice: ${score.routeId} ${score.routeName} is running about ${Math.round(score.averageDelayMinutes)} minutes late. Plan extra travel time.`;
}
