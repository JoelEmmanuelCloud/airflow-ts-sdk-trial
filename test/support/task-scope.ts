import { AsyncLocalStorage } from "node:async_hooks";
import type {
  ConnectionResult,
  GetXComOpts,
  JsonValue,
  SetXComOpts,
  TaskClient,
  TaskContext,
  TaskStateStore,
  TaskStateStoreSetOpts,
} from "@apache-airflow/ts-sdk";
import { ConnectionNotFoundError, VariableNotFoundError } from "@apache-airflow/ts-sdk";

const SCOPE_STORAGE = Symbol.for("airflow.ts-sdk.task-scope");

type ScopeHolder = { [SCOPE_STORAGE]?: AsyncLocalStorage<unknown> };

function scopeStorage(): AsyncLocalStorage<unknown> {
  const holder = globalThis as ScopeHolder;
  return (holder[SCOPE_STORAGE] ??= new AsyncLocalStorage());
}

export type XComRecord = { dagId: string; runId: string; taskId: string; key: string; value: JsonValue };

class MemoryStateStore implements TaskStateStore {
  readonly values = new Map<string, JsonValue>();

  async get<T = unknown>(key: string): Promise<T | null> {
    return this.values.has(key) ? (structuredClone(this.values.get(key)) as T) : null;
  }

  async set(key: string, value: NonNullable<JsonValue>, _opts?: TaskStateStoreSetOpts): Promise<void> {
    this.values.set(key, structuredClone(value));
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  async clear(): Promise<void> {
    this.values.clear();
  }
}

export class FakeTaskClient implements TaskClient {
  readonly variables = new Map<string, string>();
  readonly connections = new Map<string, ConnectionResult>();
  readonly xcoms: XComRecord[] = [];
  readonly skipped: string[] = [];
  readonly taskStateStore = new MemoryStateStore();
  context: TaskContext;

  constructor(context: TaskContext, variables: Record<string, string> = {}) {
    this.context = context;
    for (const [key, value] of Object.entries(variables)) {
      this.variables.set(key, value);
    }
  }

  async getVariable(key: string): Promise<string | null> {
    return this.variables.get(key) ?? null;
  }

  async getVariableOrThrow(key: string): Promise<string> {
    const value = this.variables.get(key);
    if (value === undefined) {
      throw new VariableNotFoundError(key);
    }
    return value;
  }

  async setVariable(key: string, value: string): Promise<void> {
    this.variables.set(key, value);
  }

  async deleteVariable(key: string): Promise<void> {
    this.variables.delete(key);
  }

  async getConnection(connId: string): Promise<ConnectionResult | null> {
    return this.connections.get(connId) ?? null;
  }

  async getConnectionOrThrow(connId: string): Promise<ConnectionResult> {
    const connection = this.connections.get(connId);
    if (connection === undefined) {
      throw new ConnectionNotFoundError(connId);
    }
    return connection;
  }

  async getXCom<T = unknown>(opts: GetXComOpts): Promise<T | null> {
    const dagId = opts.dagId ?? this.context.dagId;
    const runId = opts.runId ?? this.context.runId;
    const taskId = opts.taskId ?? this.context.taskId;
    for (let i = this.xcoms.length - 1; i >= 0; i--) {
      const x = this.xcoms[i]!;
      if (x.dagId === dagId && x.runId === runId && x.taskId === taskId && x.key === opts.key) {
        return structuredClone(x.value) as T;
      }
    }
    return null;
  }

  async setXCom(opts: SetXComOpts): Promise<void> {
    this.xcoms.push({
      dagId: opts.dagId ?? this.context.dagId,
      runId: opts.runId ?? this.context.runId,
      taskId: opts.taskId ?? this.context.taskId,
      key: opts.key,
      value: structuredClone(opts.value),
    });
  }

  async skipDownstreamTasks(taskIds: readonly string[]): Promise<void> {
    this.skipped.push(...taskIds);
  }
}

export function taskContext(overrides: Partial<Omit<TaskContext, "signal">> = {}): TaskContext {
  return {
    dagId: "test_dag",
    taskId: "test_task",
    runId: "manual__2026-11-19T00:00:00+00:00",
    tryNumber: 1,
    mapIndex: -1,
    signal: new AbortController().signal,
    ...overrides,
  };
}

export async function runTask<T>(client: FakeTaskClient, fn: () => T | Promise<T>): Promise<T> {
  return await scopeStorage().run({ ctx: client.context, client }, fn);
}
