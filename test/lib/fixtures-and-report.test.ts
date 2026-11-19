import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeRouteDelays, scoreRoutes, tripsOnServiceDate } from "../../src/lib/delays.ts";
import { loadRoutes, loadTrips, parseRoutes, parseTrips } from "../../src/lib/fixtures.ts";
import { renderReport, riderNotice } from "../../src/lib/report.ts";

describe("fixtures", () => {
  it("loads five routes and fifty trips", async () => {
    const [routes, trips] = await Promise.all([loadRoutes("fixtures"), loadTrips("fixtures")]);
    assert.equal(routes.length, 5);
    assert.equal(trips.length, 50);
    assert.equal(tripsOnServiceDate(trips, "2026-11-19").length, 25);
  });

  it("rejects malformed records with the field that is wrong", () => {
    assert.throws(() => parseRoutes([{ id: "R1" }], "routes"), /routes\[0\]: "name"/);
    assert.throws(() => parseTrips(["x"], "trips"), /trips\[0\] must be an object/);
    assert.throws(
      () =>
        parseTrips(
          [{ tripId: "t", routeId: "R1", serviceDate: "19/11/2026", scheduledAt: "2026-11-19T00:00:00Z", actualAt: "2026-11-19T00:00:00Z" }],
          "trips",
        ),
      /YYYY-MM-DD/,
    );
    assert.throws(
      () =>
        parseTrips(
          [{ tripId: "t", routeId: "R1", serviceDate: "2026-11-19", scheduledAt: "soon", actualAt: "2026-11-19T00:00:00Z" }],
          "trips",
        ),
      /"scheduledAt" is not a valid timestamp/,
    );
  });

  it("scores the fixture routes as two needing attention at a 5 minute threshold", async () => {
    const [routes, trips] = await Promise.all([loadRoutes("fixtures"), loadTrips("fixtures")]);
    const scores = scoreRoutes(computeRouteDelays(tripsOnServiceDate(trips, "2026-11-19"), routes), 5);
    assert.deepEqual(
      scores.map((s) => `${s.routeId}:${s.status}`),
      ["R101:ok", "R102:ok", "R103:degraded", "R104:bad", "R105:ok"],
    );
  });
});

describe("report", () => {
  const scores = [
    { routeId: "A", routeName: "Alpha", tripCount: 2, averageDelayMinutes: 1, status: "ok" as const },
    { routeId: "B", routeName: "Beta", tripCount: 2, averageDelayMinutes: 12.4, status: "bad" as const },
  ];

  it("renders an incident report that names the late routes", () => {
    const draft = renderReport("incident", "2026-11-19", scores);
    assert.match(draft.markdown, /^# Route health for 2026-11-19: 1 route\(s\) need attention/);
    assert.match(draft.markdown, /\*\*B Beta\*\* is bad, averaging 12.4 min late/);
    assert.match(draft.markdown, /\| A \| Alpha \| 2 \| 1 \| OK \|/);
  });

  it("renders an all good report", () => {
    const draft = renderReport("all_good", "2026-11-19", scores.slice(0, 1));
    assert.match(draft.markdown, /all routes on time/);
    assert.equal(draft.kind, "all_good");
  });

  it("writes a rider notice in whole minutes", () => {
    assert.equal(
      riderNotice(scores[1]!),
      "Rider notice: B Beta is running about 12 minutes late. Plan extra travel time.",
    );
  });
});
