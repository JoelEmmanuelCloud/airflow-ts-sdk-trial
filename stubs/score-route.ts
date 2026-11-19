import { getClient, getContext } from "@apache-airflow/ts-sdk";
import { AS_OF_VARIABLE, THRESHOLD_VARIABLE } from "../src/config.ts";
import { computeRouteDelays, parseAsOf, parseThreshold, scoreRoutes, serviceDateAt, tripsOnServiceDate } from "../src/lib/delays.ts";
import { loadRoutes, loadTrips } from "../src/lib/fixtures.ts";
import type { RouteScore } from "../src/lib/types.ts";

export const ROUTE_IDS_TASK_ID = "list_route_ids";

async function resolveRouteId(routeId: string | undefined): Promise<string> {
  if (typeof routeId === "string" && routeId !== "") {
    return routeId;
  }
  const { mapIndex } = getContext();
  const routeIds = await getClient().getXCom<unknown>({ key: "return_value", taskId: ROUTE_IDS_TASK_ID, mapIndex: null });
  if (!Array.isArray(routeIds) || mapIndex < 0 || mapIndex >= routeIds.length) {
    throw new Error(`No route_id argument, and no entry ${mapIndex} in the ${ROUTE_IDS_TASK_ID} output to fall back on`);
  }
  const fallback: unknown = routeIds[mapIndex];
  if (typeof fallback !== "string" || fallback === "") {
    throw new Error(`Entry ${mapIndex} of the ${ROUTE_IDS_TASK_ID} output is not a route id`);
  }
  console.log(`route_id was not passed to this mapped task; using entry ${mapIndex} of ${ROUTE_IDS_TASK_ID}: ${fallback}`);
  return fallback;
}

export async function scoreRoute({ routeId: passedRouteId }: { routeId?: string }): Promise<RouteScore> {
  const { mapIndex, tryNumber } = getContext();
  const client = getClient();
  const routeId = await resolveRouteId(passedRouteId);
  const [rawAsOf, rawThreshold] = await Promise.all([
    client.getVariable(AS_OF_VARIABLE),
    client.getVariable(THRESHOLD_VARIABLE),
  ]);
  const [routes, trips] = await Promise.all([loadRoutes(), loadTrips()]);
  const route = routes.find((r) => r.id === routeId);
  if (route === undefined) {
    throw new Error(`Unknown route id ${JSON.stringify(routeId)}`);
  }
  const serviceDate = serviceDateAt(parseAsOf(rawAsOf, new Date()));
  const [delay] = computeRouteDelays(tripsOnServiceDate(trips, serviceDate), [route]);
  const [score] = scoreRoutes([delay!], parseThreshold(rawThreshold));
  console.log(
    `map index ${mapIndex}, try ${tryNumber}: ${routeId} on ${serviceDate} is ${score!.status} at ${score!.averageDelayMinutes} min`,
  );
  return score!;
}
