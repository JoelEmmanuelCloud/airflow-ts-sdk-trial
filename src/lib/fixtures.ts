import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Route, Trip } from "./types.ts";

export function dataDir(): string {
  return process.env["ROUTE_HEALTH_DATA_DIR"] ?? path.resolve("fixtures");
}

export function outputDir(): string {
  return process.env["ROUTE_HEALTH_OUTPUT_DIR"] ?? path.resolve("output");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== "string" || value === "") {
    throw new Error(`${where}: "${key}" must be a non-empty string`);
  }
  return value;
}

function requireTimestamp(record: Record<string, unknown>, key: string, where: string): string {
  const value = requireString(record, key, where);
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`${where}: "${key}" is not a valid timestamp`);
  }
  return value;
}

async function readJsonArray(file: string): Promise<unknown[]> {
  const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new Error(`${file} must contain a JSON array`);
  }
  return parsed;
}

export function parseRoutes(items: readonly unknown[], source: string): Route[] {
  return items.map((item, index) => {
    const where = `${source}[${index}]`;
    if (!isRecord(item)) {
      throw new Error(`${where} must be an object`);
    }
    return { id: requireString(item, "id", where), name: requireString(item, "name", where) };
  });
}

export function parseTrips(items: readonly unknown[], source: string): Trip[] {
  return items.map((item, index) => {
    const where = `${source}[${index}]`;
    if (!isRecord(item)) {
      throw new Error(`${where} must be an object`);
    }
    const serviceDate = requireString(item, "serviceDate", where);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
      throw new Error(`${where}: "serviceDate" must look like YYYY-MM-DD`);
    }
    return {
      tripId: requireString(item, "tripId", where),
      routeId: requireString(item, "routeId", where),
      serviceDate,
      scheduledAt: requireTimestamp(item, "scheduledAt", where),
      actualAt: requireTimestamp(item, "actualAt", where),
    };
  });
}

export async function loadRoutes(dir: string = dataDir()): Promise<Route[]> {
  const file = path.join(dir, "routes.json");
  return parseRoutes(await readJsonArray(file), file);
}

export async function loadTrips(dir: string = dataDir()): Promise<Trip[]> {
  const file = path.join(dir, "trips.json");
  return parseTrips(await readJsonArray(file), file);
}
