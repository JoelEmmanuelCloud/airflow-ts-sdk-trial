import type { Route, RouteDelay, RouteScore, RouteStatus, Trip } from "./types.ts";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const SERVICE_TIME_ZONE = "America/Toronto";

export const DEFAULT_DELAY_THRESHOLD_MINUTES = 5;
export const DEFAULT_MAX_DATA_AGE_HOURS = 24;

export function delayMinutes(trip: Trip): number {
  const scheduled = Date.parse(trip.scheduledAt);
  const actual = Date.parse(trip.actualAt);
  if (Number.isNaN(scheduled) || Number.isNaN(actual)) {
    throw new Error(`Trip ${trip.tripId} has an unreadable time`);
  }
  return (actual - scheduled) / MINUTE_MS;
}

export function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

export function serviceDateAt(instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SERVICE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function tripsOnServiceDate(trips: readonly Trip[], serviceDate: string): Trip[] {
  return trips.filter((trip) => trip.serviceDate === serviceDate);
}

export function newestTripAt(trips: readonly Trip[]): string | null {
  let newest: number | null = null;
  for (const trip of trips) {
    const actual = Date.parse(trip.actualAt);
    if (!Number.isNaN(actual) && (newest === null || actual > newest)) {
      newest = actual;
    }
  }
  return newest === null ? null : new Date(newest).toISOString();
}

export function isFresh(
  newest: string | null,
  asOf: string,
  maxAgeHours: number = DEFAULT_MAX_DATA_AGE_HOURS,
): boolean {
  if (newest === null) {
    return false;
  }
  const age = Date.parse(asOf) - Date.parse(newest);
  return age >= 0 && age < maxAgeHours * HOUR_MS;
}

export function computeRouteDelays(trips: readonly Trip[], routes: readonly Route[]): RouteDelay[] {
  return routes.map((route) => {
    const routeTrips = trips.filter((trip) => trip.routeId === route.id);
    const total = routeTrips.reduce((sum, trip) => sum + delayMinutes(trip), 0);
    return {
      routeId: route.id,
      routeName: route.name,
      tripCount: routeTrips.length,
      averageDelayMinutes: routeTrips.length === 0 ? 0 : roundToTenth(total / routeTrips.length),
    };
  });
}

export function statusFor(averageDelayMinutes: number, thresholdMinutes: number): RouteStatus {
  if (averageDelayMinutes > thresholdMinutes * 2) {
    return "bad";
  }
  if (averageDelayMinutes > thresholdMinutes) {
    return "degraded";
  }
  return "ok";
}

export function scoreRoutes(delays: readonly RouteDelay[], thresholdMinutes: number): RouteScore[] {
  return delays.map((delay) => ({
    ...delay,
    status: statusFor(delay.averageDelayMinutes, thresholdMinutes),
  }));
}

export function hasIncident(scores: readonly RouteScore[]): boolean {
  return scores.some((score) => score.status !== "ok");
}

export function parseThreshold(raw: string | null): number {
  if (raw === null || raw.trim() === "") {
    return DEFAULT_DELAY_THRESHOLD_MINUTES;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Delay threshold must be a positive number of minutes, got ${JSON.stringify(raw)}`);
  }
  return value;
}

export function parseAsOf(raw: string | null, now: Date): Date {
  if (raw === null || raw.trim() === "") {
    return now;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`As-of time must be an ISO 8601 date and time, got ${JSON.stringify(raw)}`);
  }
  return parsed;
}
