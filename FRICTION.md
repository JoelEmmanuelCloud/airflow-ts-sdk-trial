# Friction log

One entry per point of friction, written when it happened. Positive notes are included.

Setup for every entry unless it says otherwise: `@apache-airflow/ts-sdk` 1.0.0 from npm, `typescript` 7.0.2,
`esbuild` 0.28.2, Node 24.16.0 on Windows 11 for the build, Airflow 3.4.0 in Docker for the run.

Question key: 1 wiring | 2 options | 3 type safety | 4 build/deploy | 5 missing feature | testing | docs

---

### F-01: The guide documents `getContext().conf`, but 1.0.0 does not have it
- **Question:** docs, 5 missing feature
- **What I tried:** Read the "Writing tasks" section of the guide, then the installed type definitions in
  `node_modules/@apache-airflow/ts-sdk/dist/sdk/task.d.ts`.
- **What happened:** The guide says `getContext()` returns `conf` (the Dag run's conf) and that
  `getContext<T>()` types it. In 1.0.0, `TaskContext` has only `dagId`, `taskId`, `runId`, `tryNumber`,
  `mapIndex` and `signal`, and `getContext` takes no type argument. The feature landed in apache/airflow#75563
  on Nov 7, 2026 but did not ship in the 1.0.0 package published on Nov 13. The run conf is sent to the
  runtime (`StartupDetails.conf` in `generated/supervisor.d.ts`) but never reaches the handler.
- **What I expected / wanted to write:**
  ```ts
  const { conf } = getContext<{ report_path: string }>();
  ```
- **Workaround:** Dag 1 stores the report path in an Airflow Variable (`route_health_latest_report`) and
  Dag 2 reads the Variable. The `conf` passed by `triggerDagRun` is still sent, but no task can read it.
  This is racy if two runs of Dag 1 overlap, so Dag 1 uses `maxActiveRuns: 1`.
- **Severity:** annoying (blocker for any Dag whose whole job is to act on its trigger's conf)
- **Found by:** Claude Code during build

### F-02: `npm install --save-dev typescript` now installs TypeScript 7
- **Question:** 4 build/deploy
- **What I tried:** `npm install --save-dev esbuild typescript @types/node`, as the guide says.
- **What happened:** It installed `typescript@7.0.2`. The SDK's own example pins `typescript@^6.0.2`. So far
  `tsc` 7 type checks the SDK's types without trouble, but the guide never says which major version it was
  tested with.
- **What I expected / wanted to write:** A version range in the guide, or an `npm create` template that pins
  known-good versions.
- **Workaround:** None needed yet.
- **Severity:** papercut
- **Found by:** Claude Code during build

### F-03: The guide's `tsconfig.json` cannot be shared with Node's built-in test runner
- **Question:** testing, 4 build/deploy
- **What I tried:** Imported local modules with a `.ts` extension (`import { bundle } from "./bundle.ts"`)
  so `node --test` can run the test files directly with Node's type stripping, with the guide's
  `tsconfig.json` unchanged.
- **What happened:**
  ```
  src/bundle.ts(2,30): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
  ```
- **What I expected / wanted to write:** A tsconfig in the guide that works for both `tsc` and running
  tests, since the guide already has `noEmit: true`.
- **Workaround:** Add `"allowImportingTsExtensions": true`. `airflow-ts-pack` (esbuild) accepts `.ts`
  imports either way.
- **Severity:** papercut
- **Found by:** Claude Code during build

### F-04: `taskStateStore.set` rejects an interface type that a task can return without complaint
- **Question:** 3 type safety
- **What I tried:**
  ```ts
  export interface RouteDelay { routeId: string; routeName: string; tripCount: number; averageDelayMinutes: number }
  const delays: RouteDelay[] = computeRouteDelays(batch.trips, batch.routes);
  await store.set(DELAYS_CHECKPOINT_KEY, delays, { retention: 24 * 60 * 60 });
  ```
- **What happened:**
  ```
  src/dags/route-health-report.ts(68,42): error TS2345: Argument of type 'RouteDelay[]' is not assignable to parameter of type 'NonNullable<JsonValue>'.
    Type 'RouteDelay[]' is not assignable to type 'JsonValue[]'.
      Type 'RouteDelay' is not assignable to type 'JsonValue'.
        Type 'RouteDelay' is not assignable to type '{ [key: string]: JsonValue; }'.
          Index signature for type 'string' is missing in type 'RouteDelay'.
  ```
  The same `RouteDelay[]` is fine as a task's return value, and the SDK's `dag.d.ts` has a
  `JsonCompatible<T>` helper written for exactly this problem ("collapses an `interface` to `never`").
  `taskStateStore.set` and `setXCom` use the plain `JsonValue` type instead, so the two APIs disagree.
- **What I expected / wanted to write:** The code above, unchanged. `set<T>(key: string, value: JsonCompatible<T>)`
  would accept it and still reject a `Date` or a function.
- **Workaround:** Turn the interfaces in `src/lib/types.ts` into `type` aliases, which TypeScript treats as
  having an implicit index signature. That is a change to domain types for the sake of one SDK call.
- **Severity:** annoying
- **Found by:** Claude Code during build

### F-05: Positive: the first real Dag type checked and packed on the first try
- **Question:** 1 wiring, 4 build/deploy
- **What I tried:** Wrote `route_health_report` (11 tasks: a task group, `dag.if`, `dag.switch`, edge labels,
  `approval`, `triggerDagRun`) and ran `npx tsc` then `npx airflow-ts-pack src/main.ts --outfile dist/route-health.min.mjs`.
- **What happened:** After F-03 and F-04, no wiring errors at all. Pack printed one line:
  `Wrote dist/route-health.min.mjs (airflow metadata, source, and integrity embedded)`. Passing a task's
  result straight into the next call (`scoresTask({ delays })`) read like ordinary code.
- **Severity:** positive
- **Found by:** Claude Code during build

### F-06: `airflow-ts-pack --help` is an error
- **Question:** 4 build/deploy
- **What I tried:** `npx airflow-ts-pack --help`
- **What happened:** `Unknown option --help`, followed by the usage text. It works, but it reads as a failure
  and exits non-zero.
- **What I expected / wanted to write:** `--help` prints usage and exits 0.
- **Severity:** papercut
- **Found by:** Claude Code during build

### F-07: A pure `dag.if` decider cannot be unit tested through `bundle.getTaskHandler`
- **Question:** testing
- **What I tried:**
  ```ts
  const fn = bundle.getTaskHandler("route_health_report", "check_freshness");
  await fn({ batch: { asOf: "2026-11-20T04:30:00Z", newestTripAt: "2026-11-19T23:57:00Z" } });
  ```
  `checkFreshness` itself only compares two dates and never touches the runtime.
- **What happened:**
  ```
  Error: getClient() is only available inside a task handler. The scope is in place only for the duration of the handler call, so this ran either at module top level or in work that outlived it.
      at getClient (.../ts-sdk/dist/sdk/task.js:86:12)
      at wrapped (.../ts-sdk/dist/sdk/dag.js:409:33)
  ```
  `getTaskHandler` returns the SDK's wrapper, not my function. The wrapper calls `getClient()` to skip the
  branch that was not taken. The guide says a test can call a handler this way "without running Airflow",
  which is only true for handlers that never touch the runtime and are not deciders.
- **What I expected / wanted to write:** Either the raw handler, or a supported test scope (see F-09).
- **Workaround:** Export each handler and test the function directly, or use the fake scope from F-09.
- **Severity:** annoying
- **Found by:** Claude Code during build

### F-08: `getTaskHandler` drops the handler's types, and returns `undefined` for operator tasks
- **Question:** testing, 3 type safety
- **What I tried:** `bundle.getTaskHandler(dagId, taskId)` for a task with arguments, and for `sign_off`
  (`approval`) and `trigger_notify` (`triggerDagRun`).
- **What happened:** The return type is `TaskFunction | undefined`, which is `(args: void) => unknown`. Calling it
  with arguments needs `fn as unknown as TaskFunction<unknown, unknown>`. For the two operator tasks it returns
  `undefined`, so there is no way to check, for example, what `subject` text the approval task would show for a
  given report.
- **What I expected / wanted to write:** Something typed from the Dag itself, such as
  `const r = await testTask(checkFreshnessRef, { batch })`, and a way to render an operator task's fields.
- **Workaround:** Cast, and test the `subject` function separately.
- **Severity:** papercut
- **Found by:** Claude Code during build

### F-09: Testing a handler that uses `getContext()` or `getClient()` needs SDK internals
- **Question:** testing (Ash's point on #76370)
- **What I tried:** Calling `extract_trips`, `compute_delays` (task state store and retries) and
  `write_report` (XCom and Variables) in a unit test.
- **What happened:** Outside Airflow each one throws
  `getContext() is only available inside a task handler.` The SDK has `runInTaskScope(scope, fn)` in
  `dist/sdk/task.js`, but it is not exported and the package `exports` map blocks deep imports.
- **What I expected / wanted to write:**
  ```ts
  import { runInTestScope, FakeTaskClient } from "@apache-airflow/ts-sdk/testing";

  const client = new FakeTaskClient({ variables: { route_health_as_of: "2026-11-19T23:30:00-05:00" } });
  const batch = await runInTestScope({ client, tryNumber: 1 }, () => extractTrips());
  assert.deepEqual(client.skipped, []);
  ```
- **Workaround:** `test/support/task-scope.ts` installs a fake scope in the SDK's private
  `AsyncLocalStorage`, found through `Symbol.for("airflow.ts-sdk.task-scope")` in the shipped code, and a
  `FakeTaskClient` that implements `TaskClient` plus the undocumented `skipDownstreamTasks` that deciders call.
  With it, all 32 tests pass, including the retry and state store path. It depends on internals and could break
  in any release.
- **Severity:** annoying
- **Found by:** Claude Code during build

### F-10: A misspelled `triggerRule` passes every check, then fails the run with an unrelated message
- **Question:** 3 type safety, 2 options
- **What I tried:** `gap-probes/05-trigger-rule.ts`:
  ```ts
  dag.task("typo_rule", async () => 3, { triggerRule: "none_failed_min_one_sucess" })().after(a, b);
  dag.task("made_up_rule", async () => 4, { triggerRule: "whenever_you_like" })().after(a, b);
  ```
- **What happened:** `npx tsc` passed. `airflow-ts-pack` passed. The Dag processor parsed it with no import
  error. On a run, `a` and `b` succeeded, then the scheduler logged:
  ```
  [error    ] Task deadlock (no runnable tasks); marking run <DagRun probe_trigger_rule @ None: manual__2026-11-19T07:31:05.602156+00:00, state:running, ...> failed
  ```
  Nothing names the trigger rule. `triggerRule` is typed `string` in `GeneratedTaskFields`, while
  `triggerDagRun`'s `allowedStates` already uses a union (`DagRunState`).
- **What I expected / wanted to write:** The same code, rejected by `tsc` with
  `Type '"none_failed_min_one_sucess"' is not assignable to type 'TriggerRule'`, plus autocomplete for the
  real values. A check when the Dag is read would catch plain JavaScript users too.
- **Workaround:** Copy trigger rule strings from the Python docs carefully.
- **Severity:** annoying (a silent wrong Dag is worse than a loud one)
- **Found by:** Claude Code during build

### F-11: An unknown task option gives an error that blames the handler, not the option
- **Question:** 3 type safety, 2 options
- **What I tried:** `gap-probes/03-callbacks.ts`:
  ```ts
  dag.task("write_report", async () => "written", { onFailureCallback: alertOnCall, onRetryCallback: alertOnCall })();
  ```
- **What happened:**
  ```
  error TS2769: No overload matches this call.
    The last overload gave the following error.
      Argument of type '() => Promise<string>' is not assignable to parameter of type 'Operator<void, unknown>'.
  ```
  The real problem is `onFailureCallback` in the third argument. On `new Dag(...)` the same mistake gives the clear
  `'onFailureCallback' does not exist in type 'DagSpec'`, because the constructor has no overloads.
- **What I expected / wanted to write:** `'onFailureCallback' does not exist in type 'TaskSpec'`.
- **Workaround:** Pass the options object through a typed variable (`const opts: TaskOptions = {...}`) to get
  the clear message.
- **Severity:** papercut
- **Found by:** Claude Code during build

### F-12: Positive: the core flow ran end to end on Airflow 3.4.0 on the first deploy
- **Question:** 1 wiring, 4 build/deploy
- **What I tried:** `npm run deploy`, then `airflow dags trigger route_health_report`.
- **What happened:** No import errors. In one run: `check_freshness` took the fresh side and skipped
  `alert_stale`; `transform.compute_delays` failed try 1 on purpose, then try 2 logged
  `try 2: read 5 route delays back from the task state store`; `pick_report_type` chose
  `build_incident_report` and skipped the other; `write_report` ran after a skipped upstream thanks to
  `triggerRule: "none_failed_min_one_success"`; `sign_off` went to `awaiting_input` with the right subject
  (`Publish the incident report for 2026-11-19?`) and the markdown report as the body. After approval,
  `trigger_notify` started `notify_riders`, which logged both rider notices. The task log shows
  `console.log` lines as `logger: task.stdout`, as the guide says.
- **Severity:** positive
- **Found by:** Claude Code during build

### F-13: `approval` logs a false warning about an argument called `then`
- **Question:** 1 wiring
- **What I tried:** `signOffTask({ report: written })`, where the `approval` `subject` and `body` are
  functions of `{ report }`.
- **What happened:** Every `sign_off` attempt logs:
  ```
  [warning] [ts-sdk.runtime] Task argument not bound by this task's call  requested="then" renamed_to=None bound=["report"]
  ```
  My code never reads `then`. It looks like the SDK `await`s the arguments object, and JavaScript checks any
  awaited object for a `then` method. Plain tasks such as `send_rider_notices({ report })` do not log it.
- **What I expected / wanted to write:** No warning.
- **Workaround:** None. It is harmless, but it trains people to ignore this warning, which is useful when it is
  real.
- **Severity:** papercut
- **Found by:** Claude Code during build

### F-14: Error stack traces point into the minified bundle
- **Question:** 4 build/deploy
- **What I tried:** Read the log of the failed `compute_delays` try 1.
- **What happened:**
  ```
  Error: Failing try 1 on purpose because route_health_inject_failure is "true"
      at computeDelays (file:///opt/airflow/dags/route-health.min.mjs:270:14599)
      at async runHandler (file:///opt/airflow/dags/route-health.min.mjs:269:919)
  ```
  The function name survives (good), but the line and column are in minified code. There is no source map
  option in `airflow-ts-pack`, even though the bundle already embeds the original source for the Code view.
- **What I expected / wanted to write:** `at computeDelays (src/dags/route-health-report.ts:72:11)`, from an
  inline source map, or a `--sourcemap` flag.
- **Workaround:** Search the source for the error text.
- **Severity:** annoying (for a real bug, not a planned one)
- **Found by:** Claude Code during build

### F-15: Joining after `dag.switch` needs a trigger rule and `getXCom` by task id
- **Question:** 1 wiring
- **What I tried:** One `write_report` task after the two report tasks, only one of which runs.
- **What happened:** Passing both as inputs (`writeTask({ allGood, incident })`) does not work, since one is
  always skipped and has no value. What works:
  ```ts
  const written = writeTask().after(allGood, incident);   // plus triggerRule: "none_failed_min_one_success"
  const draft = (await client.getXCom({ key: "return_value", taskId: "build_all_good_report" }))
    ?? (await client.getXCom({ key: "return_value", taskId: "build_incident_report" }));
  ```
  The task ids are strings again, so a rename in the Dag breaks this at run time, not compile time. The rest
  of the wiring API avoids string ids on purpose ("renaming a handler cannot silently change which task runs").
- **What I expected / wanted to write:**
  ```ts
  const written = writeTask({ draft: reportType.result(allGood, incident) });
  ```
  where `draft` is whichever case ran, typed as the union of their return types.
- **Workaround:** As above.
- **Severity:** annoying
- **Found by:** Claude Code during build

### F-16: `getTaskHandler` and the guide are silent on how to keep `serve()` out of tests
- **Question:** testing, docs
- **What I tried:** Importing the Dag module from a test.
- **What happened:** The guide's examples put `await new Bundle(dag).serve()` at the bottom of `main.ts`.
  Importing that file from a test would start serving. I split it into `src/bundle.ts` (builds the bundle)
  and `src/main.ts` (one line: `await bundle.serve()`), and tests import `bundle.ts`.
- **What I expected / wanted to write:** The guide's quick start already in that shape, or `serve()` that does
  nothing when not started by the coordinator.
- **Workaround:** As above. Easy once you see it.
- **Severity:** papercut
- **Found by:** Claude Code during build

### F-17: A mapped stub task gets no arguments at all, and nothing says so
- **Question:** 5 missing feature, 1 wiring
- **What I tried:** Dag 3 (`dags/route_health_per_route.py`), the workaround the guide recommends for mapping:
  ```python
  @task.stub(queue="typescript")
  def score_route(route_id: str): ...

  publish_scores(score_route.expand(route_id=list_route_ids()))
  ```
  ```ts
  export async function scoreRoute({ routeId }: { routeId: string }) { ... }
  ```
- **What happened:** All five mapped instances failed with my own guard:
  ```
  [error] [ts-sdk.runtime] Task failed  error="Unknown route id undefined"  bound_args=[]
  ```
  `bound_args=[]` means Airflow 3.4.0 sent no argument bindings for the mapped task, so `routeId` was
  `undefined`. The guide says "A name the handler reads that the call did not pass is logged rather than
  raised", but no warning was logged: with no bindings the SDK hands over a plain empty object
  (`EMPTY_ARGS` in `dist/coordinator/arg-binding.js`) instead of the object that logs missing names.
  TypeScript cannot help either, since the handler type says `routeId: string`.
- **What I expected / wanted to write:** The code above, with `routeId` set to each route id in turn.
- **Workaround:** The handler takes `{ routeId?: string }`. When it is missing, it reads the
  `list_route_ids` XCom and picks the entry at `getContext().mapIndex`
  (`stubs/score-route.ts`). After that, the run succeeded: 5 mapped TypeScript tasks, then `publish_scores`
  wrote `output/route-scores.json` and the `route_health_scores` asset event was recorded. The task log
  shows `route_id was not passed to this mapped task; using entry 3 of list_route_ids: R104`.
  This only works because the mapped list is one upstream XCom; it would not work for `expand_kwargs` or
  a zip of two lists.
- **Severity:** blocker (without the workaround, the documented path for mapping does not work)
- **Found by:** Claude Code during build

### F-18: `airflow dags test` on a TypeScript Dag says the Dag does not exist
- **Question:** testing
- **What I tried:** `airflow dags test route_health_report` and `airflow tasks test route_health_report extract_trips`,
  while the Dag was listed by `airflow dags list` and had just run successfully.
- **What happened:** Both end with:
  ```
  airflow.sdk.exceptions.AirflowException: Dag 'route_health_report' could not be found; either it does not exist or it failed to parse.
  ```
  The guide says these commands "refuse" a TypeScript Dag, which is true, but the message sends you looking
  for a parse error that does not exist.
- **What I expected / wanted to write:** Either it works, or:
  `Dag 'route_health_report' is declared in TypeScript (route-health.min.mjs); 'dags test' does not support it yet.`
- **Workaround:** None from the CLI. Trigger a real run and read the logs.
- **Severity:** annoying
- **Found by:** Claude Code during build

### F-19: `airflow dags test` on the Python Dag fails every TypeScript stub task
- **Question:** testing, 5 missing feature
- **What I tried:** `airflow dags test route_health_per_route`
- **What happened:** The Python tasks run in process; every `score_route` instance fails:
  ```
  RuntimeError: @task.stub should not be executed directly -- we expected this to go to a remote worker. Check your pool and worker configs
  ```
  So the stub workaround cannot be tested with `dags test` either, and the error points at pools and workers,
  not at the `queue_to_coordinator` setting that would send it to Node.js. This command also records a real
  failed run in the database.
- **What I expected / wanted to write:** `dags test` routing stub tasks through `[sdk] queue_to_coordinator`,
  as the scheduler does.
- **Workaround:** None. Trigger a real run.
- **Severity:** annoying
- **Found by:** Claude Code during build

### F-20: Positive: two bundles and a Python file in one Dags folder just worked
- **Question:** 4 build/deploy
- **What I tried:** `dags/` holds `route-health.min.mjs` (two TypeScript Dags), `route-stubs.min.mjs` (only the
  stub handler), `ts-hello.min.mjs` and `route_health_per_route.py`. No `.airflowignore`, no
  `task_handler_bundle_name`.
- **What happened:** No import errors. The stub task found its handler in `route-stubs.min.mjs` with no
  configuration. The task log names what each bundle serves
  (`registered_tasks={'route_health_per_route': ['score_route']}`), which made it easy to confirm.
- **Severity:** positive
- **Found by:** Claude Code during build
