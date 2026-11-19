# Draft comment for apache/airflow#76370

Everything above the line is the comment. Everything below it is for checking, and does not get posted.

---

I built a small three-Dag trial on Airflow 3.4.0 with `@apache-airflow/ts-sdk` 1.0.0 to answer these
questions: https://github.com/JoelEmmanuelCloud/airflow-ts-sdk-trial. The `F-xx` numbers point to
`FRICTION.md` there, which has the exact errors.

**What worked well**

- Wiring by calling tasks reads like normal code. An 11-task Dag with a task group, `dag.if`, `dag.switch`,
  edge labels, `approval` and `triggerDagRun` type checked, packed and ran on the first deploy (F-12).
- A misspelled input gives a clear `tsc` error: `'delayz' does not exist ... Did you mean to write 'delays'?` (F-21).
- Retries plus the task state store worked first time: try 2 read back what try 1 saved.
- Two `.min.mjs` bundles and a Python file in one Dags folder needed no extra setup (F-20).

**1. Wiring.** Natural for chains and fan-in. The awkward spot is joining after `dag.switch`: only one case
runs, so I can't pass both as inputs. I needed `.after(...)`, `triggerRule: "none_failed_min_one_success"` and
`getXCom` by task id string, which brings back the string ids the rest of the API avoids (F-15). Something like
`writeReport({ draft: branch.result() })`, typed as the union of the cases, would fix it. An upstream value
also can't go into `triggerDagRun`'s `conf`.

**2. Options.** camelCase felt right. I never had to think about it. One issue: an unknown task option gives
`No overload matches this call ... not assignable to type 'Operator<void, unknown>'`, which blames the handler,
not the option. `new Dag` gives the clear message (F-11).

**3. Type safety.**
- `triggerRule` is a plain `string`. `"none_failed_min_one_sucess"` passes `tsc`, the build and Dag parsing,
  then the run fails with `Task deadlock (no runnable tasks)` and no mention of the rule (F-10). A union like
  `DagRunState` would catch it.
- `taskStateStore.set` and `setXCom` take `JsonValue`, so an `interface` is rejected
  (`Index signature for type 'string' is missing`), while the same type is fine as a task's return value.
  The `JsonCompatible<T>` helper in `dag.d.ts` would fix it (F-04).

**4. Build and deploy.** `airflow-ts-pack` was smooth. Wishes: type check by default (F-21), and source maps,
since stack traces point at `route-health.min.mjs:270:14599` (F-14). Yes to an `npm create` template. It would
have given me a tsconfig that also works with `node --test` (F-03), a `bundle.ts` / `main.ts` split so tests
don't call `serve()` (F-16), and a pinned TypeScript (npm gave me 7, the example uses 6) (F-02). Also, the guide
documents `getContext().conf`, but it is not in the 1.0.0 package (F-01).

**5. Missing features, by what I needed first**
1. **Dynamic task mapping.** The documented workaround did not work as written. With
   `score_route.expand(route_id=list_route_ids())` on a `@task.stub`, every mapped TypeScript task got no
   arguments (`bound_args=[]`), so `routeId` was `undefined`. No warning was logged, though the guide says
   missing arguments are (F-17). I worked around it by reading the upstream list at `getContext().mapIndex`.
   Happy to open a separate issue if this is a bug. What I wanted: `scoreRoute.expand({ routeId: listRouteIds() })`.
2. **Run-time inputs.** Dag `params`, run `conf` and the logical date are all out of reach from a task. I
   passed the report path from Dag 1 to Dag 2 through a Variable, which breaks if two runs overlap.
3. **Assets.** I wanted Dag 2 scheduled on Dag 1's output. The Python workaround handled the outlet fine,
   so this matters less than 1 and 2.

**Local testing** (on Ash's comment). Plain functions are fine. `bundle.getTaskHandler` only works for
handlers that never touch the runtime: even a pure `dag.if` decider throws
`getClient() is only available inside a task handler`, because the SDK's wrapper calls it to skip a branch
(F-07). To test handlers that use `getContext()` or `getClient()`, I put a fake scope into the SDK's private
`AsyncLocalStorage` through `Symbol.for("airflow.ts-sdk.task-scope")` (F-09). It works for 34 tests, retries
and branch skips included, but it relies on internals. `airflow dags test` says the TypeScript Dag
`could not be found; either it does not exist or it failed to parse` (F-18). On the Python Dag, every stub
fails with `@task.stub should not be executed directly` (F-19). What I'd want to write:

```ts
import { testTask } from "@apache-airflow/ts-sdk/testing";

const run = await testTask(bundle, "route_health_report", "check_freshness", {
  args: { batch },
  variables: { route_health_as_of: "2026-11-19T23:30:00-05:00" },
});
assert.equal(run.result, true);
assert.deepEqual(run.skipped, ["alert_stale"]);
```

Happy to help on the `triggerRule` type (a union, plus a check when the Dag is read), if that's useful.

---

## Checks before posting (not part of the comment)

| Claim | Friction entry | Check in `TESTING.md` |
|---|---|---|
| 11-task Dag ran on first deploy | F-12 | Steps 2, 6 |
| `tsc` catches the misspelled input, the build does not | F-21 | Step 2 |
| Retry reads back the state store | F-12 | Step 6.2 |
| Bundles and Python file share a folder | F-20 | Steps 4, 10 |
| Join after `dag.switch` needs `getXCom` by string | F-15 | Read `writeReport` in `src/dags/route-health-report.ts` |
| Unknown task option blames the handler | F-11 | Step 12 |
| Misspelled `triggerRule` fails with a deadlock | F-10 | Step 12, optional part |
| `interface` rejected by `taskStateStore.set` | F-04 | Change `type RouteDelay` back to an `interface`, run `npm run typecheck` |
| Stack traces point at the minified bundle | F-14 | Step 6.2 |
| `conf` documented but missing | F-01 | Step 12, probe `06-run-conf.ts` |
| Mapped stub gets no arguments | F-17 | Step 10 |
| Decider can't be called through `getTaskHandler` | F-07 | Test `fail even for a pure decider` in `test/handlers/handlers.test.ts` |
| `dags test` messages | F-18, F-19 | Step 11 |

Before posting:

- [ ] Push the repo, and confirm the link at the top works.
- [ ] Do the whole `TESTING.md` run. Change any claim that did not hold.
- [ ] Rewrite questions 1 to 4 in your own words after step 13 of `TESTING.md`. The views there are a starting point.
- [ ] Check it fits on one screen. If not, cut "What worked well" to two bullets first.
- [ ] Re-read #76370 for new comments since Nov 19, 2026, and don't repeat what someone already said.
