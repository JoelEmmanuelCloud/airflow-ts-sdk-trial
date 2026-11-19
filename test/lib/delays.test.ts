import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeRouteDelays,
  delayMinutes,
  hasIncident,
  isFresh,
  newestTripAt,
  parseAsOf,
  parseThreshold,
  scoreRoutes,
  serviceDateAt,
  statusFor,
  tripsOnServiceDate,
} from "../../src/lib/delays.ts";
import type { Route, Trip } from "../../src/lib/types.ts";

function trip(routeId: string, scheduledAt: string, lateMinutes: number, serviceDate = "2026-11-19"): Trip {
  const actual = new Date(Date.parse(scheduledAt) + lateMinutes * 60_000).toISOString();
  return { tripId: `${routeId}-${scheduledAt}`, routeId, serviceDate, scheduledAt, actualAt: actual };
}

const routes: Route[] = [
  { id: "A", name: "Alpha" },
  { id: "B", name: "Beta" },
];

describe("delayMinutes", () => {
  it("returns minutes late", () => {
    assert.equal(delayMinutes(trip("A", "2026-11-19T12:00:00Z", 4)), 4);
  });

  it("returns a negative number for an early trip", () => {
    assert.equal(delayMinutes(trip("A", "2026-11-19T12:00:00Z", -2)), -2);
  });

  it("rejects an unreadable time", () => {
    const bad = { ...trip("A", "2026-11-19T12:00:00Z", 1), actualAt: "not a time" };
    assert.throws(() => delayMinutes(bad), /unreadable time/);
  });
});

describe("serviceDateAt", () => {
  it("uses the Toronto calendar date", () => {
    assert.equal(serviceDateAt(new Date("2026-11-20T03:00:00Z")), "2026-11-19");
    assert.equal(serviceDateAt(new Date("2026-11-20T06:00:00Z")), "2026-11-20");
  });
});

describe("freshness", () => {
  const trips = [trip("A", "2026-11-19T12:00:00Z", 0), trip("A", "2026-11-19T20:00:00Z", 5)];

  it("finds the newest actual time", () => {
    assert.equal(newestTripAt(trips), "2026-11-19T20:05:00.000Z");
    assert.equal(newestTripAt([]), null);
  });

  it("is fresh within 24 hours and stale after", () => {
    assert.equal(isFresh("2026-11-19T20:05:00Z", "2026-11-20T20:04:00Z"), true);
    assert.equal(isFresh("2026-11-19T20:05:00Z", "2026-11-20T20:05:00Z"), false);
  });

  it("is stale with no data or data from the future", () => {
    assert.equal(isFresh(null, "2026-11-20T00:00:00Z"), false);
    assert.equal(isFresh("2026-11-21T00:00:00Z", "2026-11-20T00:00:00Z"), false);
  });

  it("filters trips by service date", () => {
    const mixed = [...trips, trip("A", "2026-11-18T12:00:00Z", 0, "2026-11-18")];
    assert.equal(tripsOnServiceDate(mixed, "2026-11-18").length, 1);
  });
});

describe("computeRouteDelays and scoreRoutes", () => {
  const trips = [
    trip("A", "2026-11-19T12:00:00Z", 1),
    trip("A", "2026-11-19T13:00:00Z", 2),
    trip("B", "2026-11-19T12:00:00Z", 11),
  ];

  it("averages delay per route and keeps routes with no trips", () => {
    const delays = computeRouteDelays(trips, [...routes, { id: "C", name: "Gamma" }]);
    assert.deepEqual(
      delays.map((d) => [d.routeId, d.tripCount, d.averageDelayMinutes]),
      [
        ["A", 2, 1.5],
        ["B", 1, 11],
        ["C", 0, 0],
      ],
    );
  });

  it("labels ok, degraded and bad against the threshold", () => {
    assert.equal(statusFor(5, 5), "ok");
    assert.equal(statusFor(5.1, 5), "degraded");
    assert.equal(statusFor(10, 5), "degraded");
    assert.equal(statusFor(10.1, 5), "bad");
  });

  it("flags an incident when any route is not ok", () => {
    const scores = scoreRoutes(computeRouteDelays(trips, routes), 5);
    assert.deepEqual(
      scores.map((s) => s.status),
      ["ok", "bad"],
    );
    assert.equal(hasIncident(scores), true);
    assert.equal(hasIncident(scoreRoutes(computeRouteDelays(trips, routes), 20)), false);
  });
});

describe("input parsing", () => {
  it("defaults the threshold and rejects bad values", () => {
    assert.equal(parseThreshold(null), 5);
    assert.equal(parseThreshold(" "), 5);
    assert.equal(parseThreshold("7.5"), 7.5);
    assert.throws(() => parseThreshold("0"), /positive number/);
    assert.throws(() => parseThreshold("abc"), /positive number/);
  });

  it("defaults the as-of time to now and rejects bad values", () => {
    const now = new Date("2026-11-19T00:00:00Z");
    assert.equal(parseAsOf(null, now), now);
    assert.equal(parseAsOf("2026-11-19T23:30:00-05:00", now).toISOString(), "2026-11-20T04:30:00.000Z");
    assert.throws(() => parseAsOf("yesterday", now), /ISO 8601/);
  });
});
