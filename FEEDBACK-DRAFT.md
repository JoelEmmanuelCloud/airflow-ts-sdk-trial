# Comment posted on apache/airflow#76370

Posted on Nov 25, 2026: https://github.com/apache/airflow/issues/76370#issuecomment-7158251383

Everything between the two lines is the comment as posted. Everything below the second line was for checking.

---

I built a small trial on Airflow 3.4.0 with ts-sdk 1.0.0, two TypeScript Dags and one Python Dag with a stub: https://github.com/JoelEmmanuelCloud/airflow-ts-sdk-trial. The F numbers below are entries in `FRICTION.md` there, with the exact errors.

An 11 task Dag with a task group, `dag.if`, `dag.switch`, `approval` and `triggerDagRun` ran on the first deploy, so the base is good.

What I missed most is what @ashb said, running and testing locally. Plain functions are easy to test, anything else is not:

- `bundle.getTaskHandler` gives back the SDK's wrapper, so even a `dag.if` decider that only compares two dates throws `getClient() is only available inside a task handler` (F-07)
- to test handlers that use `getContext()` or `getClient()` I had to put a fake scope in the SDK's private storage (F-09). It works, but any release could break it
- `airflow dags test` on a TypeScript Dag says it could not be found, while the same Dag runs fine (F-18)

I would like to write something like this:

```ts
import { testTask } from "@apache-airflow/ts-sdk/testing";

const run = await testTask(bundle, "route_health_report", "check_freshness", {
  args: { batch },
  variables: { route_health_as_of: "2026-11-19T23:30:00-05:00" },
});
assert.equal(run.result, true);
assert.deepEqual(run.skipped, ["alert_stale"]);
```

It's close to the single task step in the "A public testing package for Dag authors" thread on the dev list, but that one is Python. Is something like this wanted for TypeScript too? I'd like to help with it.

On the questions:

1. Wiring is fine for chains and fan-in. Joining after `dag.switch` is the awkward part. Only one case runs, so I ended up with `.after(...)`, `triggerRule: "none_failed_min_one_success"` and `getXCom` by task id string (F-15). `writeReport({ draft: branch.result() })` would fix it.
2. camelCase works for me. Same misleading error as @sreecharan-desu for an unknown option (F-11).
3. `taskStateStore.set` rejects an `interface` with `Index signature for type 'string' is missing`, though a task can return that same type (F-04). A misspelled `triggerRule` only shows up as `Task deadlock (no runnable tasks)` (F-10). #77392 handles that one, and a union type would also catch it in the editor.
4. Smooth. I'd want source maps, because stack traces point at `route-health.min.mjs:270:14599` (F-14), and an `npm create` template.
5. In the order I needed them: local testing, mapping, Dag params, assets. A mapped `@task.stub` gets no arguments in 1.0.0 and logs nothing (F-17). #71062 and #70570 cover that already.

I also found that `approval` logs a warning about an argument called `then` on its first run when it has inputs (F-13). Opened #77587 for it.

---

## Checks made before posting (not part of the comment)

| Claim | Friction entry | Last checked |
|---|---|---|
| Handlers tested through a fake scope | F-09 | Nov 25, rerun |
| Core flow, retry and state store | F-12 | Nov 25, rerun: incident, reject, all good and stale paths |
| `dags test` on a TypeScript Dag | F-18 | Nov 25, rerun |
| Mapped stub gets no arguments | F-17 | Nov 25: the workaround path ran 5 of 5 |
| Stack traces point at the minified bundle | F-14 | Nov 25, rerun |
| `then` warning | F-13 | Nov 25: seen in 1.0.0 and on main at 00954198c, gone with the fix |
| Misleading error for an unknown option | F-11 | Nov 25: 17 errors, same as `gap-probes/tsc-output.txt` |
| Decider throws through `getTaskHandler` | F-07 | Nov 25, covered by `npm test` |
| `interface` rejected by `taskStateStore.set` | F-04 | Nov 19; main still types it as `JsonValue` |
| Misspelled `triggerRule` | F-10 | Nov 19; compiler half checked Nov 25 |
| `dag.switch` join | F-15 | Nov 19 |
