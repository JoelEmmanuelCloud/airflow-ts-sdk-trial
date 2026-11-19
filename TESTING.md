# Manual test run

Follow these steps in order. Each step says what to do and what you should see. Tick the box when it matches.
When it does not match, or something feels awkward, add an entry to `FRICTION.md` with
**Found by:** `Joel during manual run`.

Every claim in `FEEDBACK-DRAFT.md` points to a step here, so this run is also the check on the draft.

Steps marked **(not checked yet)** have never been run. The expected result comes from the guide or the unit
tests, not from a run in Airflow. These are the ones most likely to need a new `FRICTION.md` entry.

---

## 0. Before you start

- [ ] Docker Desktop is running.
- [ ] `node --version` prints 22 or later.
- [ ] You are in `C:\Users\JOE\Desktop\airflow-ts-sdk-trial`.

If a `route_health_report` run is still waiting at `sign_off`, approve or reject it first (step 6.4).
The Dag allows one active run at a time, so a waiting run blocks every new one.

## 1. Tests without Airflow

```bash
npm install
npm test
```

- [ ] The summary ends with `ℹ tests 34`, `ℹ pass 34`, `ℹ fail 0`.
- [ ] Note how long it took and whether the output was easy to read.

Things to judge: would you trust these tests? Look at `test/support/task-scope.ts`. Is it reasonable that a
user has to write this (F-09)?

## 2. Type check and build

```bash
npm run deploy
```

- [ ] Three `Wrote dist/....min.mjs (airflow metadata, source, and integrity embedded)` lines.
- [ ] Three `deployed ... to dags` lines.

Now break it on purpose. In `src/dags/route-health-report.ts`, change `scoresTask({ delays })` to
`scoresTask({ delayz: delays })` and run `npm run typecheck`.

- [ ] `tsc` reports `'delayz' does not exist in type 'TaskInputs<{ delays: RouteDelay[]; }>'. Did you mean to write 'delays'?`

Then, with the typo still in place, run `npx airflow-ts-pack src/main.ts --outfile dist/x.min.mjs`.

- [ ] The build succeeds anyway (F-21). Undo the change and delete `dist/x.min.mjs`.

## 3. Start Airflow and log in

```bash
npm run airflow:up
```

- [ ] After about a minute, http://localhost:8080 opens.
- [ ] Log in as `joel`. The password is in `airflow/state/passwords.json`.

## 4. Variables and Dag list

```bash
npm run airflow:variables
```

- [ ] Three lines: `Variable route_health_as_of created` (or `updated`), and the same for the other two.
- [ ] In the UI, Admin > Variables shows `route_health_as_of`, `route_health_delay_threshold_minutes`,
      `route_health_inject_failure`, and, after one run, `route_health_latest_report`.
- [ ] The Dags page lists `route_health_report`, `notify_riders`, `route_health_per_route`, `ts_hello`.
- [ ] No import errors are shown.
- [ ] `route_health_report` and `notify_riders` show the tags `typescript`, `transit`, `trial`.

## 5. The guide's hello Dag

- [ ] Unpause `ts_hello` and trigger it. Both tasks go green.
- [ ] The `report` task log contains `extracted 42 rows`.
- [ ] Pause `ts_hello` again so it does not run daily.
- [ ] **(not checked yet)** Open the Code tab of `ts_hello`. The guide says it shows the TypeScript source, not
      the minified bundle. Note what you see.

## 6. `route_health_report`, incident path

Trigger `route_health_report` from the UI (the Trigger button, no conf).

### 6.1 Graph

- [ ] **(not checked yet)** The `transform` group is drawn as a group holding `compute_delays` and `score_routes`.
- [ ] **(not checked yet)** The edges out of `check_freshness` are labelled `fresh` and `stale`.
- [ ] **(not checked yet)** The edges out of `pick_report_type` are labelled `all routes ok` and `incident`.
- [ ] Does the graph look like the code reads? Judge this yourself (question 1).

### 6.2 Branches and retry

- [ ] `check_freshness` succeeded. `alert_stale` is skipped.
- [ ] `transform.compute_delays` shows 2 tries. Try 1 failed with
      `Failing try 1 on purpose because route_health_inject_failure is "true"`.
- [ ] Try 2 log has `try 2: read 5 route delays back from the task state store`.
- [ ] The try 1 error stack points at `route-health.min.mjs:...`, not the `.ts` file (F-14).
- [ ] `pick_report_type` succeeded. Its XCom `return_value` is `build_incident_report`.
- [ ] `build_all_good_report` is skipped. `build_incident_report` succeeded.
- [ ] `write_report` succeeded even though one of its upstreams was skipped.
- [ ] `output/route-health-2026-11-19.md` exists and lists R103 as degraded and R104 as bad.

### 6.3 The approval task

- [ ] `sign_off` is in the `awaiting_input` state.
- [ ] Its log has the warning `Task argument not bound by this task's call` with `requested="then"` (F-13).
- [ ] **(not checked yet)** Find the request on the Required Actions page. The subject reads
      `Publish the incident report for 2026-11-19?` and the body shows the markdown table.
- [ ] Does the request show who should answer and what happens on reject? Judge this yourself.

### 6.4 Approve

- [ ] Approve it in the UI.
- [ ] `sign_off` succeeds, then `trigger_notify` succeeds.
- [ ] A new `notify_riders` run appears. Its conf shows `source_dag_id` and `report_variable`.
- [ ] The `send_rider_notices` log has two lines starting `Rider notice:` for R103 and R104.
- [ ] Remember: no task can read that conf in 1.0.0 (F-01). Dag 2 found the report through the
      `route_health_latest_report` Variable.

## 7. Reject path (not checked yet)

- [ ] Trigger `route_health_report` again. Wait for `sign_off`.
- [ ] Reject it.
- [ ] `sign_off` succeeds (it does not fail) and `trigger_notify` is skipped. No new `notify_riders` run.

## 8. All good path (not checked yet)

```bash
docker compose exec airflow airflow variables set route_health_delay_threshold_minutes 15
```

- [ ] Trigger again. `pick_report_type` returns `build_all_good_report`. `build_incident_report` is skipped.
- [ ] The approval subject reads `Publish the all good report for 2026-11-19?`.
- [ ] Approve. `send_rider_notices` logs `No rider notices needed for 2026-11-19`.
- [ ] Set the threshold back to `5`.

## 9. Stale path (not checked yet)

```bash
docker compose exec airflow airflow variables set route_health_as_of 2026-11-25T12:00:00-05:00
```

- [ ] Trigger again. `check_freshness` returns `False`.
- [ ] `alert_stale` succeeds and its log shows `Trip data is stale: ...` at error level (it writes to stderr).
- [ ] `transform.compute_delays` is skipped, and everything after it is skipped too. The run still ends as success.
- [ ] Put it back: `npm run airflow:variables`.

## 10. `route_health_per_route` (Python Dag, TypeScript stub)

- [ ] Unpause and trigger it.
- [ ] `list_route_ids` succeeds, then `score_route` shows 5 mapped instances, all green.
- [ ] Mapped instance 3 log has
      `route_id was not passed to this mapped task; using entry 3 of list_route_ids: R104` (F-17).
- [ ] `publish_scores` succeeds and `output/route-scores.json` has 5 routes.
- [ ] The Assets page shows a `route_health_scores` event from `publish_scores`.
- [ ] Read `stubs/score-route.ts` and `dags/route_health_per_route.py` side by side. How painful is this
      workaround to you (question 5)?

## 11. The CLI test commands

```bash
docker compose exec airflow airflow dags test route_health_report
docker compose exec airflow airflow tasks test route_health_report extract_trips
```

- [ ] Both end with `Dag 'route_health_report' could not be found; either it does not exist or it failed to parse.` (F-18)

```bash
docker compose exec airflow airflow dags test route_health_per_route
```

- [ ] Every `score_route` fails with `@task.stub should not be executed directly` and the run fails (F-19).
      This adds one failed run to the history.

## 12. Compiler probes

```bash
npx tsc -p gap-probes
```

- [ ] 17 `error TS` lines, matching `gap-probes/tsc-output.txt`.
- [ ] No error for `05-trigger-rule.ts` (the misspelled trigger rule, F-10).
- [ ] Open `gap-probes/03-callbacks.ts` in VS Code and hover the error on the task line. Is it clear what is
      wrong (F-11)?

Optional, to see F-10 in Airflow:

```bash
npx airflow-ts-pack gap-probes/05-trigger-rule-bundle.ts --outfile dags/probe-trigger-rule.min.mjs
```

- [ ] After about 30 seconds `probe_trigger_rule` appears with no import error.
- [ ] Unpause and trigger it. `a` and `b` succeed, the run fails, and `docker compose logs airflow` shows
      `Task deadlock (no runnable tasks)`.
- [ ] Clean up: delete `dags/probe-trigger-rule.min.mjs`, then
      `docker compose exec airflow airflow dags delete probe_trigger_rule -y`.

## 13. Your judgement

Write a few sentences on each, in your own words, before you edit `FEEDBACK-DRAFT.md`:

1. Wiring: does connecting tasks by calling them feel natural?
2. Options: camelCase names and durations in plain seconds, good or confusing?
3. Type safety: what surprised you by not being caught?
4. Build and deploy: would an `npm create` template have helped you?
5. Missing features: which would you need first, for a real Dag of yours?
6. Local testing: what would you want to write in a test?

## 14. Stop

```bash
npm run airflow:down
```

`airflow:down` removes the container, so the run history and Variables are gone next time. To keep them, use
`docker compose stop` instead.
