# Project plan: Airflow TypeScript SDK field trial

**Owner:** Joel Emmanuel (GitHub: JoelEmmanuelCloud)
**Builder:** Claude Code (in VS Code), working from this file
**Repo:** a new public repo on Joel's GitHub, e.g. `JoelEmmanuelCloud/airflow-ts-sdk-trial`
**Timebox:** about 8–10 hours over 1–2 weeks. Feedback posted on apache/airflow#76370 by early December 2026.
**Priority rule:** apache/airflow#76410 (MLH executor-health work) comes first. This trial fits around it.

---

## 1. Why this project exists

Airflow's TypeScript SDK (`@apache-airflow/ts-sdk`) reached 1.0.0 on Nov 13, 2026. Pierre Jeambrun opened
[apache/airflow#76370](https://github.com/apache/airflow/issues/76370) asking for feedback, and it is on the
Airflow 3.5.0 milestone. So far it has one comment (Ash Berlin-Taylor, on local testing).

The goal is **not** to build a product. The goal is to use the SDK the way a real Dag author would, record
every point of friction, and turn that into precise feedback that answers Pierre's five questions:

1. **Wiring tasks:** does the way tasks are connected feel natural?
2. **Options:** do camelCase option names (`retryDelay`, `triggerRule`, ...) work, or would something more idiomatic be better?
3. **Type safety:** what else should the compiler catch?
4. **Build and deploy:** is bundling to one file with `airflow-ts-pack` and dropping it into a Dag bundle a good fit? Would an `npm create`-style template help?
5. **Missing features:** which unsupported features would users need first?

Plus Ash's point: **how do you test a TypeScript Dag locally?**

## 2. What we build (kept deliberately simple)

A **"Route Health Report"**: a small public-transit pipeline for Toronto over **local JSON fixtures**. No maps, no
ride-hailing, no external APIs, no real database. The domain logic stays trivial so all the effort goes into
exercising the SDK.

Fixture data: `fixtures/routes.json` (about 5 made-up bus routes in Toronto, Ontario; invented data, not real TTC data) and `fixtures/trips.json`
(about 50 trip records: route id, scheduled time, actual time, date).

### Dag 1: `route_health_report` (fully in TypeScript)

| Step | What it does | SDK feature exercised |
|---|---|---|
| `extract_trips` | Read `trips.json`, return today's trips | Basic task, XCom return value |
| `check_freshness` | Is the newest trip less than 24h old? | `dag.if(...).then().else()` branching |
| `alert_stale` | Log a "data is stale" alert (else-branch) | Skipped-branch behaviour |
| `transform` group: `compute_delays`, `score_routes` | Average delay per route; label each route ok / degraded / bad | `dag.taskGroup(...)`, typed inputs between tasks |
| `pick_report_type` | Return the "all good" or "incident" report task | `dag.switch(...).case().case()` |
| `write_report` | Write a markdown report to `output/` | Plain task, file output |
| `sign_off` | A person approves publishing | `approval(...)` from `@apache-airflow/ts-sdk/hitl` |
| `trigger_notify` | Trigger Dag 2 with the report path in `conf` | `triggerDagRun({...})` |

Also use: `retries`, `retryDelay`, `executionTimeout`, `tags`, `catchup`, edge labels
(`Label.of(...)`), `getContext()`, `getClient().getVariable(...)` (a variable holding the delay threshold), and
the `taskStateStore` (store a value, retry once, read it back).

### Dag 2: `notify_riders` (fully in TypeScript)

One or two tasks that read the `conf` passed by Dag 1 and log a "rider notification".

### Dag 3: `route_health_per_route` (Python Dag + TypeScript stub tasks)

The docs say dynamic task mapping, assets and custom timetables have no TypeScript form, and the workaround
is a Python Dag with `@task.stub(queue="typescript")` tasks implemented in TypeScript. Build that
workaround on purpose:

- Python declares a mapped task over the route ids (one task instance per route) and an asset outlet.
- TypeScript implements the per-route scoring handler (`TaskHandler` + `bundle.register`).

This shows how painful or pleasant the workaround is, which is direct evidence for question 5.

### Deliberate "gap probes"

For each feature that TypeScript can't express yet, write the code a user **would want to write** in
`gap-probes/` (it is fine that it doesn't compile), and record the compiler or runtime error:

- dynamic task mapping (`.map()` / `.expand()` over route ids)
- Dag params (choosing the city and date at trigger time)
- callbacks (`onFailure` alert)
- assets (Dag 2 scheduled on Dag 1's output)
- `trigger_rule` on a task (the docs don't list `triggerRule` as an option, so confirm whether it exists)
- `airflow dags test` on a TypeScript Dag (the docs say it is refused, so confirm and record the message)

## 3. Environment

- Python virtualenv with **Airflow 3.4.0** installed using the official constraints file for your Python
  version. Run locally (for example `airflow standalone`), and confirm which executor it uses.
  With `LocalExecutor`, tasks run on the scheduler, so Node must be available there.
- **Node.js 22+** on the same machine.
- Airflow config (in `airflow.cfg` or as `AIRFLOW__SDK__...` environment variables):

  ```ini
  [sdk]
  coordinators = {"ts": {"classpath": "airflow.sdk.coordinators.node.NodeCoordinator"}}
  queue_to_coordinator = {"typescript": "ts"}
  ```

- The TypeScript project, set up as the SDK guide describes:

  ```bash
  npm init -y && npm pkg set type=module
  npm install @apache-airflow/ts-sdk
  npm install --save-dev esbuild typescript @types/node
  ```

  `tsconfig.json`: `module`/`moduleResolution` `NodeNext`, `strict: true`, `noEmit: true`,
  `types: ["node"]`, `include: ["src"]`.
- Build: `npx tsc` (type check, since `airflow-ts-pack` doesn't do it), then
  `npx airflow-ts-pack src/main.ts --outdir dist`. Copy `dist/bundle.min.mjs` into the Dags folder.
- A `Makefile` or npm scripts for `typecheck`, `build`, `deploy` (copy the bundle), `test`, and `airflow:up`.

## 4. Repo layout

```
airflow-ts-sdk-trial/
  README.md            # what this is, how to run it, links to #76370
  PLAN.md              # this file
  FRICTION.md          # the friction log (most important file)
  FEEDBACK-DRAFT.md    # Joel's draft comment for #76370
  fixtures/            # routes.json, trips.json
  src/                 # main.ts (Dags 1 and 2), lib/ (pure helper functions)
  stubs/               # TypeScript handlers for Dag 3
  dags/                # route_health_per_route.py (Dag 3)
  gap-probes/          # code users would want to write but can't yet
  test/                # unit tests
  airflow/             # local airflow.cfg overrides, setup notes
  Makefile
```

## 5. Testing (this matters: it answers Ash's point)

Test in three layers, and record how each one feels in `FRICTION.md`:

1. **Pure logic:** keep delay maths and scoring in `src/lib/` as plain functions. Unit-test them with
   `node:test` (or Vitest). This is the baseline any TypeScript developer expects.
2. **Task handlers without Airflow:** the docs say nothing connects until `bundle.serve()`, and that
   `bundle.getTaskHandler(dagId, taskId)` returns a handler you can call. Try calling handlers directly in tests.
   Record what works, and what breaks when a handler uses `getContext()`, `getClient()` or XCom.
3. **The whole Dag in Airflow:** deploy the bundle, trigger it from the UI and the CLI, check task logs,
   XComs, the branch that was skipped, the HITL wait state, and the triggered Dag 2. Also run
   `airflow dags test route_health_report` and record what happens.

At the end, write down in plain words: "If I could test a TypeScript Dag locally, I'd want to write ___."
Include a code snippet. This is the most valuable single piece of feedback.

## 6. The friction log (`FRICTION.md`)

One entry per point of friction, logged **at the moment it happens**, never reconstructed afterwards:

```markdown
### F-07: <short title>
- **Question:** 1 wiring | 2 options | 3 type safety | 4 build/deploy | 5 missing feature | testing | docs
- **What I tried:** <code or command>
- **What happened:** <exact error or behaviour, copied verbatim>
- **What I expected / wanted to write:** <code snippet>
- **Workaround:** <if any>
- **Severity:** blocker | annoying | papercut
- **Found by:** Claude Code during build | Joel during manual run
```

Positive notes go in too ("worked first time and felt natural"). Feedback that is only complaints is less useful.

## 7. Who does what

| Task | Claude Code | Joel |
|---|---|---|
| Scaffold repo, configs, fixtures, Makefile | Builds | Reviews |
| Write Dags 1–3, stubs, gap probes | Builds | Reviews the code and decides what "natural" means |
| Log friction as it happens | Logs every error and workaround verbatim | Adds his own entries during manual runs |
| Unit tests (layers 1–2) | Writes and runs | Runs them himself once |
| Run the Dags in Airflow (layer 3) | Starts the environment, runs the CLI checks | **Clicks through the UI, approves the HITL task, checks logs, and judges the experience** |
| Answer Pierre's questions 1–4 (subjective) | Collects evidence | **Writes the judgement in his own words** |
| Commit and push | Makes commits per milestone | **Reviews and pushes to his own GitHub** |
| Post feedback on #76370 | Never posts anywhere | **Writes and posts it himself** |

Rules for Claude Code:

- Don't invent SDK APIs. Check the installed package's type definitions (`node_modules/@apache-airflow/ts-sdk`),
  the official guide and `ts-sdk/example/src/native.ts` in the Airflow repo. If something isn't there, it is a
  gap probe, not a guess.
- Don't modify Airflow's source, and don't open issues, PRs or comments on apache/airflow.
- Log friction honestly, including your own mistakes caused by unclear docs or types.
- Stop and ask Joel before anything that installs software system-wide or needs credentials.

## 8. Milestones

| # | Milestone | Done when | Commit message |
|---|---|---|---|
| M1 | Environment up | Airflow 3.4.0 + Node 22 running; the docs' `ts_hello` Dag runs green | `chore: local Airflow 3.4 + TS SDK setup` |
| M2 | Dag 1 core | extract → branch → task group → switch → report runs end to end | `feat: route_health_report core flow` |
| M3 | Dag 1 complete | HITL sign-off, triggerDagRun to Dag 2, retries, variable, state store | `feat: HITL, trigger, options` |
| M4 | Dag 3 stub workaround | Python mapped Dag with TypeScript stub handlers runs green | `feat: python + ts stub workaround` |
| M5 | Gap probes | Every probe written and its error recorded | `docs: gap probes` |
| M6 | Testing layers | Unit and handler tests pass; Airflow-level checks recorded | `test: three testing layers` |
| M7 | Joel's manual pass | Joel ran everything himself and added his entries | `docs: manual run notes` |
| M8 | Feedback draft | `FEEDBACK-DRAFT.md` written by Joel | `docs: feedback draft for #76370` |

## 9. The feedback comment (Joel writes this)

Structure for `FEEDBACK-DRAFT.md`, posted later on #76370:

1. One line of context: who you are, and that you built a small 3-Dag trial on Airflow 3.4 + ts-sdk 1.0, with a link to the repo.
2. **What worked well**: 2–3 bullets.
3. **Answers to questions 1–4**: a short paragraph each, with a snippet where it helps.
4. **Missing features, ranked**: top 3 by real need, each with the code you wanted to write and why the
   Python-stub workaround did or didn't cover it.
5. **Local testing**: what you tried in the three layers, and the snippet you wish worked. Reference Ash's comment.
6. An offer: "Happy to help on <one specific gap>, if that's useful."

Keep it tight: no more than one screen, with the details left in the repo. Write it in your own voice. If you mention
that you used AI tools to scaffold the trial, keep it to one honest line. The judgements and the experience
must be yours.

## 10. After posting

- Mention the comment once in `#sig-lang-sdks` on Airflow Slack, with the link and one sentence.
- If a maintainer agrees on a gap, ask which small piece you could take, then open a PR. That becomes the
  basis for a GSoC 2027 conversation in January–February.
