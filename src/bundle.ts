import { Bundle } from "@apache-airflow/ts-sdk";
import { notifyRiders } from "./dags/notify-riders.ts";
import { routeHealthReport } from "./dags/route-health-report.ts";

export const bundle = new Bundle(routeHealthReport, notifyRiders);
