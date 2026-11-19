import { Bundle, TaskHandler } from "@apache-airflow/ts-sdk";
import { PER_ROUTE_DAG_ID } from "../src/config.ts";
import { scoreRoute } from "./score-route.ts";

export const stubBundle = new Bundle(new TaskHandler(PER_ROUTE_DAG_ID, "score_route", scoreRoute));
