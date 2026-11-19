# Gap probes

Each file is the code a Dag author would want to write for a feature the TypeScript SDK 1.0.0 does not have.
None of them are meant to compile. `tsc-output.txt` is the exact output of:

```bash
npx tsc -p gap-probes
```

| File | Feature | What happens |
|---|---|---|
| `01-dynamic-task-mapping.ts` | `.expand()` / `.map()` over route ids | `Property 'expand' does not exist on type '(inputs: TaskInputs<{ routeId: string; }>) => TaskRef<number>'` |
| `02-dag-params.ts` | Dag `params`, read at run time | `'params' does not exist in type 'DagSpec'`, and `TaskContext` has no `params` |
| `03-callbacks.ts` | `onFailureCallback` on the Dag and on a task | Dag: `'onFailureCallback' does not exist in type 'DagSpec'`. Task: a confusing `No overload matches this call` that blames the handler (see F-11) |
| `04-assets.ts` | `Asset`, `outlets`, schedule on an asset | `Module '"@apache-airflow/ts-sdk"' has no exported member 'Asset'` |
| `05-trigger-rule.ts` | `triggerRule` with a typo | **Compiles and packs with no error.** See F-10 for what Airflow does with it |
| `06-run-conf.ts` | `getContext().conf` | `Property 'conf' does not exist on type 'TaskContext'` (documented, but not in 1.0.0; see F-01) |
| `07-trigger-conf-from-upstream.ts` | Pass an upstream value into `triggerDagRun` `conf` | `Type 'TaskRef<string>' is not assignable to type 'JsonValue'` |
| `08-logical-date.ts` | `logicalDate`, `dataIntervalStart`, `dataIntervalEnd` | `Property 'logicalDate' does not exist on type 'TaskContext'` |

`airflow dags test` on a TypeScript Dag is a runtime probe, not a file here. Its result is in `FRICTION.md`.
