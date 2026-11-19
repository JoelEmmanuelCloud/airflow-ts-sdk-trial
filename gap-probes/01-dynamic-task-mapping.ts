import { Dag } from "@apache-airflow/ts-sdk";

const dag = new Dag("probe_mapping", { queue: "typescript" });

const listRouteIds = dag.task("list_route_ids", async (): Promise<string[]> => ["R101", "R102", "R103"]);
const scoreRoute = dag.task("score_route", async ({ routeId }: { routeId: string }) => routeId.length);

const routeIds = listRouteIds();
scoreRoute.expand({ routeId: routeIds });
scoreRoute.map((routeId: string) => ({ routeId }), routeIds);
