# Airflow TypeScript SDK field trial

A small, real use of `@apache-airflow/ts-sdk` 1.0.0 on Airflow 3.4.0, built to answer the questions in
[apache/airflow#76370](https://github.com/apache/airflow/issues/76370). The domain is kept simple on purpose:
a daily on-time report for five invented Toronto bus routes, read from local JSON files. The data is made up
and is not real TTC data.

The most useful file here is [`FRICTION.md`](FRICTION.md): every problem and every pleasant surprise, written
down when it happened, with the exact error text.

## What is in it

| Dag | Written in | What it shows |
|---|---|---|
| `route_health_report` | TypeScript only | Task inputs, a task group, `dag.if`, `dag.switch`, edge labels, retries, a Variable, the task state store, an `approval` task, `triggerDagRun` |
| `notify_riders` | TypeScript only | A Dag started by another Dag |
| `route_health_per_route` | Python, with TypeScript stub tasks | The documented workaround for dynamic task mapping and assets |
| `ts_hello` | TypeScript only | The guide's quick start, unchanged |

```
route_health_report
  extract_trips -> check_freshness --fresh--> transform.compute_delays -> transform.score_routes -> pick_report_type
                                   \--stale--> alert_stale
  pick_report_type --all routes ok--> build_all_good_report --\
                   \--incident------> build_incident_report ---> write_report -> sign_off -> trigger_notify -> notify_riders
```

| Folder | Contents |
|---|---|
| `src/` | `dags/` (the two TypeScript Dags), `lib/` (plain functions), `bundle.ts`, `main.ts`, `hello/` |
| `stubs/` | The TypeScript handler for the Python Dag's stub task |
| `dags/` | The Python Dag. Built bundles are copied here and mounted into Airflow |
| `fixtures/` | `routes.json` (5 routes) and `trips.json` (50 trips over Nov 18 and 19, 2026) |
| `gap-probes/` | Code a user would want to write but cannot yet, with the compiler output |
| `test/` | Unit tests for `lib/` and for the task handlers |
| `airflow/` | The Docker image: Airflow 3.4.0 plus Node.js 22 |

## Run it

You need Node.js 22 or later and Docker Desktop.

```bash
npm install
npm test                    # 34 tests, no Airflow needed
npm run airflow:up          # builds the image and starts `airflow standalone` on http://localhost:8080
npm run deploy              # type check, build the three bundles, copy them into dags/
npm run airflow:variables   # sets the three Variables below
```

Log in as `joel`. The password is in `airflow/state/passwords.json`, which Airflow writes on first start.

| npm script | What it does |
|---|---|
| `typecheck` | `tsc`. `airflow-ts-pack` does not type check, so this runs first |
| `build` | Type check, then `airflow-ts-pack` for each bundle into `dist/` |
| `deploy` | `build`, then copy `dist/*.min.mjs` into `dags/` |
| `test` | `node --test` on `test/**/*.test.ts` |
| `airflow:up` / `airflow:down` / `airflow:logs` | Start, stop, follow the logs |
| `airflow:variables` | Set the Variables below inside the container |

There is no Makefile, so everything works the same on Windows, macOS and Linux.

### Variables

| Variable | Set to | Effect |
|---|---|---|
| `route_health_as_of` | `2026-11-19T23:30:00-05:00` | The time the report is "run" at. Without it, the real clock is used, the data is days old, and the `alert_stale` branch runs instead |
| `route_health_delay_threshold_minutes` | `5` | A route is degraded above this average delay and bad above twice it. Set it to `15` to get the `build_all_good_report` branch |
| `route_health_inject_failure` | `true` | `compute_delays` fails its first try on purpose, so the retry and the task state store are exercised |

`route_health_latest_report` is written by `write_report` and read by `notify_riders` (see F-01 in the
friction log for why this is a Variable and not the run's `conf`).

### Airflow setup

Set in `compose.yaml`, as the guide describes:

```ini
[sdk]
coordinators = {"ts": {"classpath": "airflow.sdk.coordinators.node.NodeCoordinator"}}
queue_to_coordinator = {"typescript": "ts"}
```

`airflow standalone` in this image uses `LocalExecutor`, so tasks run in the scheduler process, which is
where Node.js has to be.

## Testing, in three layers

1. **Plain functions** (`test/lib/`): delay maths, scoring, fixture checks, report text. Ordinary
   `node:test`, nothing Airflow specific.
2. **Task handlers without Airflow** (`test/handlers/`): handlers are taken from the bundle with
   `bundle.getTaskHandler(dagId, taskId)` and run inside a fake task scope (`test/support/task-scope.ts`), so
   `getContext()`, `getClient()`, XComs, Variables, the task state store and branch skipping all work in a
   test. The fake scope relies on SDK internals; see F-07 to F-09.
3. **The whole Dag in Airflow**: trigger from the UI or CLI and read the logs. `airflow dags test` does not
   work for these Dags; see F-18 and F-19.

## Versions

`@apache-airflow/ts-sdk` 1.0.0, `typescript` 7.0.2, `esbuild` 0.28.2, Node.js 24.16.0 (build) and 22.23.5 (in
Airflow), Airflow 3.4.0 with `apache-airflow-task-sdk` 1.4.0 and Python 3.12.
