# Draft comment for apache/airflow#76370

Everything between the two lines is the comment. Everything below the second line is for checking, and does
not get posted.

---

I built a small three-Dag trial on Airflow 3.4.0 with `@apache-airflow/ts-sdk` 1.0.0:
https://github.com/JoelEmmanuelCloud/airflow-ts-sdk-trial. The `F-xx` numbers point to `FRICTION.md` there,
which has the exact errors.

**Worked well:** an 11-task Dag with a task group, `dag.if`, `dag.switch`, `approval` and `triggerDagRun` packed
and ran on the first deploy (F-12). Retries plus the task state store worked first time.

**Local testing** (on @ashb's comment). This is what I would want first. Plain functions are easy to test. The rest is not:

- `bundle.getTaskHandler` returns the SDK's wrapper. Even a `dag.if` decider that only compares two dates throws
  `getClient() is only available inside a task handler` (F-07).
- To test handlers that use `getContext()` or `getClient()`, I had to put a fake scope in the SDK's private storage
  through `Symbol.for("airflow.ts-sdk.task-scope")` (F-09). My 34 tests pass, but any release could break them.
- `airflow dags test` on a TypeScript Dag says it `could not be found; either it does not exist or it failed to parse`,
  while the same Dag runs fine (F-18). On a Python Dag, stub tasks usually fail with
  `@task.stub should not be executed directly` (F-19).

What I would like to write:

```ts
import { testTask } from "@apache-airflow/ts-sdk/testing";

const run = await testTask(bundle, "route_health_report", "check_freshness", {
  args: { batch },
  variables: { route_health_as_of: "2026-11-19T23:30:00-05:00" },
});
assert.equal(run.result, true);
assert.deepEqual(run.skipped, ["alert_stale"]);
```

It is close to the single task step in the dev list thread "A public testing package for Dag authors", which is
about Python. Is something like this wanted for TypeScript too?

**1. Wiring.** Natural for chains and fan-in. The awkward spot is joining after `dag.switch`. Only one case runs, so I
needed `.after(...)`, `triggerRule: "none_failed_min_one_success"` and `getXCom` by task id string (F-15).
`writeReport({ draft: branch.result() })`, typed as the union of the cases, would fix it.

**2. Options.** camelCase felt right. +1 to @sreecharan-desu on the misleading error for an unknown option (F-11).

**3. Type safety.** `taskStateStore.set` rejects an `interface` with `Index signature for type 'string' is missing`,
though a task can return the same type (F-04). The `JsonCompatible<T>` helper in `dag.ts` looks like the fix.
A misspelled `triggerRule` ends in `Task deadlock (no runnable tasks)` (F-10). #77392 rejects it when the task is defined.
A union type would also catch it in the editor.

**4. Build and deploy.** Smooth. I would like source maps, since stack traces point at
`route-health.min.mjs:270:14599` (F-14). +1 to type checking in `airflow-ts-pack` (F-21) and to an `npm create`
template, ideally with a tsconfig that also works for `node --test` (F-03).

**5. Missing features, in the order I needed them.** Local testing, then mapping, then Dag params, then assets.
On mapping, a mapped `@task.stub` in 1.0.0 gets no arguments and logs no warning (F-17). I see #71062 and #70570
cover this, so this is one more report from 1.0.0.

One bug: `approval` logs `Task argument not bound by this task's call` with `requested="then"` on every run (F-13).
The arguments proxy is returned from an async function, so JavaScript reads `.then` on it. I have a small fix with a
test and can open a PR.

---

## Checks before posting (not part of the comment)

| Claim | Friction entry | Last checked |
|---|---|---|
| 34 tests pass | F-09 | Nov 25, rerun |
| Core flow, retry and state store | F-12 | Nov 25, rerun: incident, reject, all good and stale paths |
| `dags test` on a TypeScript Dag | F-18 | Nov 25, rerun |
| `dags test` on the Python Dag | F-19 | Nov 25: failed 2 of 3, passed once, cause not proven |
| Mapped stub gets no arguments | F-17 | Nov 25: the workaround path ran 5 of 5 |
| Stack traces point at the minified bundle | F-14 | Nov 25, rerun |
| `then` warning | F-13 | Nov 25: seen in 1.0.0 and on main at 00954198c, gone with the fix |
| Probe compiler errors | F-01, F-11 | Nov 25: 17 errors, same as `gap-probes/tsc-output.txt` |
| Decider throws through `getTaskHandler` | F-07 | Nov 25, covered by `npm test` |
| `interface` rejected by `taskStateStore.set` | F-04 | Nov 19; main still types it as `JsonValue` |
| Misspelled `triggerRule` | F-10 | Nov 19; compiler half checked Nov 25 |
| `dag.switch` join, pack ships a typo, tsconfig | F-15, F-21, F-03 | Nov 19 |

Before posting:

- [ ] Push the repo, and confirm the link at the top works.
- [ ] Do the screen checks in `TESTING.md`, steps 5 to 7.
- [ ] Rewrite questions 1 to 5 in your own words. The views and the order in question 5 are a starting point.
- [x] Update F-09, F-13 and F-19 in `FRICTION.md` so they match the comment.
- [ ] Re-read #76370 for comments newer than Nov 19, 2026 (rodneyg), and check #77392, #71062 and #70570 are still open.
- [ ] Decide on the AI tool line: `PLAN.md` section 9 allows one honest line, and Airflow requires it on the PR.
