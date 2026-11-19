import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { TaskFunction } from "@apache-airflow/ts-sdk";
import { bundle } from "../../src/bundle.ts";
import {
  AS_OF_VARIABLE,
  DELAYS_CHECKPOINT_KEY,
  INJECT_FAILURE_VARIABLE,
  LATEST_REPORT_VARIABLE,
  NOTIFY_DAG_ID,
  PER_ROUTE_DAG_ID,
  REPORT_DAG_ID,
} from "../../src/config.ts";
import { routeHealthReport } from "../../src/dags/route-health-report.ts";
import { renderReport } from "../../src/lib/report.ts";
import type { RouteDelay, RouteScore, TripBatch } from "../../src/lib/types.ts";
import { stubBundle } from "../../stubs/bundle.ts";
import { FakeTaskClient, runTask, taskContext } from "../support/task-scope.ts";

const AS_OF = "2026-11-19T23:30:00-05:00";

function handler(dagId: string, taskId: string): TaskFunction<unknown, unknown> {
  const fn = (dagId === PER_ROUTE_DAG_ID ? stubBundle : bundle).getTaskHandler(dagId, taskId);
  assert.ok(fn, `no handler for ${dagId}.${taskId}`);
  return fn as unknown as TaskFunction<unknown, unknown>;
}

function clientFor(taskId: string, overrides: { tryNumber?: number; dagId?: string; mapIndex?: number } = {}) {
  return new FakeTaskClient(taskContext({ dagId: REPORT_DAG_ID, taskId, ...overrides }), { [AS_OF_VARIABLE]: AS_OF });
}

async function freshBatch(): Promise<TripBatch> {
  return (await runTask(clientFor("extract_trips"), () => handler(REPORT_DAG_ID, "extract_trips")(undefined))) as TripBatch;
}

describe("the Dag as declared", () => {
  it("has every task in the plan, with group prefixes", () => {
    assert.deepEqual([...routeHealthReport.taskIds].sort(), [
      "alert_stale",
      "build_all_good_report",
      "build_incident_report",
      "check_freshness",
      "extract_trips",
      "pick_report_type",
      "sign_off",
      "transform.compute_delays",
      "transform.score_routes",
      "trigger_notify",
      "write_report",
    ]);
  });

  it("gives a handler for function tasks but not for operator tasks", () => {
    assert.equal(typeof bundle.getTaskHandler(REPORT_DAG_ID, "extract_trips"), "function");
    assert.equal(bundle.getTaskHandler(REPORT_DAG_ID, "sign_off"), undefined);
    assert.equal(bundle.getTaskHandler(REPORT_DAG_ID, "trigger_notify"), undefined);
  });
});

describe("handlers called without a task scope", () => {
  it("fail as soon as they touch getContext()", async () => {
    await assert.rejects(
      async () => handler(REPORT_DAG_ID, "extract_trips")(undefined),
      /getContext\(\) is only available inside a task handler/,
    );
  });

  it("fail even for a pure decider, because the SDK's wrapper calls getClient() to skip a branch", async () => {
    const batch = { asOf: "2026-11-20T04:30:00Z", newestTripAt: "2026-11-19T23:57:00Z" };
    await assert.rejects(
      async () => handler(REPORT_DAG_ID, "check_freshness")({ batch }),
      /getClient\(\) is only available inside a task handler/,
    );
  });
});

describe("handlers called inside a fake task scope", () => {
  it("extract_trips returns the trips on the as-of service date", async () => {
    const batch = await freshBatch();
    assert.equal(batch.serviceDate, "2026-11-19");
    assert.equal(batch.trips.length, 25);
    assert.equal(batch.routes.length, 5);
    assert.equal(batch.newestTripAt, "2026-11-19T23:57:00.000Z");
  });

  it("check_freshness returns true and skips the stale branch", async () => {
    const batch = await freshBatch();
    const client = clientFor("check_freshness");
    const result = await runTask(client, () => handler(REPORT_DAG_ID, "check_freshness")({ batch }));
    assert.equal(result, true);
    assert.deepEqual(client.skipped, ["alert_stale"]);
  });

  it("check_freshness skips the transform when the data is stale", async () => {
    const batch = { ...(await freshBatch()), asOf: "2026-12-01T00:00:00.000Z" };
    const client = clientFor("check_freshness");
    const result = await runTask(client, () => handler(REPORT_DAG_ID, "check_freshness")({ batch }));
    assert.equal(result, false);
    assert.deepEqual(client.skipped, ["transform.compute_delays"]);
  });

  it("compute_delays fails try 1 on purpose, then try 2 reads the saved delays back", async () => {
    const batch = await freshBatch();
    const first = clientFor("transform.compute_delays");
    first.variables.set(INJECT_FAILURE_VARIABLE, "true");
    await assert.rejects(
      runTask(first, () => handler(REPORT_DAG_ID, "transform.compute_delays")({ batch })),
      /Failing try 1 on purpose/,
    );
    const saved = await first.taskStateStore.get<RouteDelay[]>(DELAYS_CHECKPOINT_KEY);
    assert.equal(saved?.length, 5);

    first.context = { ...first.context, tryNumber: 2 };
    const delays = await runTask(first, () => handler(REPORT_DAG_ID, "transform.compute_delays")({ batch }));
    assert.deepEqual(delays, saved);
    assert.equal(await first.taskStateStore.get(DELAYS_CHECKPOINT_KEY), null);
  });

  it("pick_report_type picks the incident report and skips the all good one", async () => {
    const batch = await freshBatch();
    const delays = (await runTask(clientFor("transform.compute_delays"), () =>
      handler(REPORT_DAG_ID, "transform.compute_delays")({ batch }),
    )) as RouteDelay[];
    const scores = (await runTask(clientFor("transform.score_routes"), () =>
      handler(REPORT_DAG_ID, "transform.score_routes")({ delays }),
    )) as RouteScore[];
    const client = clientFor("pick_report_type");
    const picked = await runTask(client, () => handler(REPORT_DAG_ID, "pick_report_type")({ scores }));
    assert.equal(picked, "build_incident_report");
    assert.deepEqual(client.skipped, ["build_all_good_report"]);
  });
});

describe("write_report and notify_riders", () => {
  let outDir = "";
  const savedOutput = process.env["ROUTE_HEALTH_OUTPUT_DIR"];

  before(async () => {
    outDir = await mkdtemp(path.join(tmpdir(), "route-health-"));
    process.env["ROUTE_HEALTH_OUTPUT_DIR"] = outDir;
  });

  after(async () => {
    if (savedOutput === undefined) {
      delete process.env["ROUTE_HEALTH_OUTPUT_DIR"];
    } else {
      process.env["ROUTE_HEALTH_OUTPUT_DIR"] = savedOutput;
    }
    await rm(outDir, { recursive: true, force: true });
  });

  it("writes the report that ran, sets the Variable, and Dag 2 reads it back", async () => {
    const scores: RouteScore[] = [
      { routeId: "R104", routeName: "Northgate Express", tripCount: 5, averageDelayMinutes: 12.4, status: "bad" },
    ];
    const client = clientFor("write_report");
    await client.setXCom({
      taskId: "build_incident_report",
      key: "return_value",
      value: renderReport("incident", "2026-11-19", scores),
    });

    const written = (await runTask(client, () => handler(REPORT_DAG_ID, "write_report")(undefined))) as {
      jsonPath: string;
      markdownPath: string;
      kind: string;
    };
    assert.equal(written.kind, "incident");
    assert.match(await readFile(written.markdownPath, "utf8"), /1 route\(s\) need attention/);
    assert.equal(client.variables.get(LATEST_REPORT_VARIABLE), written.jsonPath);

    const notify = new FakeTaskClient(taskContext({ dagId: NOTIFY_DAG_ID, taskId: "load_latest_report" }), {
      [LATEST_REPORT_VARIABLE]: written.jsonPath,
    });
    const report = await runTask(notify, () => handler(NOTIFY_DAG_ID, "load_latest_report")(undefined));
    const notices = await runTask(notify, () => handler(NOTIFY_DAG_ID, "send_rider_notices")({ report }));
    assert.deepEqual(notices, [
      "Rider notice: R104 Northgate Express is running about 12 minutes late. Plan extra travel time.",
    ]);
  });

  it("write_report fails clearly when neither report task ran", async () => {
    await assert.rejects(
      runTask(clientFor("write_report"), () => handler(REPORT_DAG_ID, "write_report")(undefined)),
      /Neither report task left a draft/,
    );
  });
});

describe("stub handler for the Python Dag", () => {
  it("scores one route per mapped task", async () => {
    const client = new FakeTaskClient(
      taskContext({ dagId: PER_ROUTE_DAG_ID, taskId: "score_route", mapIndex: 3 }),
      { [AS_OF_VARIABLE]: AS_OF },
    );
    const score = (await runTask(client, () => handler(PER_ROUTE_DAG_ID, "score_route")({ routeId: "R104" }))) as RouteScore;
    assert.equal(score.status, "bad");
    assert.equal(score.averageDelayMinutes, 12.4);
  });

  it("falls back to the upstream list by map index when Airflow passes no route_id", async () => {
    const client = new FakeTaskClient(
      taskContext({ dagId: PER_ROUTE_DAG_ID, taskId: "score_route", mapIndex: 2 }),
      { [AS_OF_VARIABLE]: AS_OF },
    );
    await client.setXCom({ taskId: "list_route_ids", key: "return_value", value: ["R101", "R102", "R103"] });
    const score = (await runTask(client, () => handler(PER_ROUTE_DAG_ID, "score_route")({}))) as RouteScore;
    assert.equal(score.routeId, "R103");
    assert.equal(score.status, "degraded");
  });

  it("fails clearly when there is no route_id and no upstream entry", async () => {
    const client = new FakeTaskClient(taskContext({ dagId: PER_ROUTE_DAG_ID, taskId: "score_route", mapIndex: 7 }));
    await assert.rejects(
      runTask(client, () => handler(PER_ROUTE_DAG_ID, "score_route")({})),
      /no entry 7 in the list_route_ids output/,
    );
  });

  it("rejects an unknown route id", async () => {
    const client = new FakeTaskClient(taskContext({ dagId: PER_ROUTE_DAG_ID, taskId: "score_route" }));
    await assert.rejects(
      runTask(client, () => handler(PER_ROUTE_DAG_ID, "score_route")({ routeId: "R999" })),
      /Unknown route id "R999"/,
    );
  });
});
