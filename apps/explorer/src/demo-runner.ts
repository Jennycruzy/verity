import { spawn } from "node:child_process";

export interface DemoRunResult {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly events: readonly unknown[];
}

export interface DemoRunner {
  runHonestPurchase(): Promise<DemoRunResult>;
}

export interface ProcessDemoRunnerOptions {
  readonly projectRoot: string;
  readonly cooldownMs?: number;
  readonly timeoutMs?: number;
}

export class ProcessDemoRunner implements DemoRunner {
  private readonly cooldownMs: number;
  private readonly timeoutMs: number;
  private running: Promise<DemoRunResult> | undefined;
  private lastStartedAt = 0;

  constructor(private readonly options: ProcessDemoRunnerOptions) {
    this.cooldownMs = positiveInteger(options.cooldownMs ?? 30_000, "EXPLORER_DEMO_COOLDOWN_MS");
    this.timeoutMs = positiveInteger(options.timeoutMs ?? 80_000, "EXPLORER_DEMO_TIMEOUT_MS");
  }

  runHonestPurchase(): Promise<DemoRunResult> {
    if (this.running) throw new Error("VERITY_DEMO_BUSY: a live purchase is already running; wait for it to finish");
    const now = Date.now();
    const remaining = this.cooldownMs - (now - this.lastStartedAt);
    if (remaining > 0) throw new Error(`VERITY_DEMO_COOLDOWN: wait ${Math.ceil(remaining / 1_000)} seconds before another paid run`);
    this.lastStartedAt = now;
    const execution = this.execute();
    this.running = execution;
    void execution.finally(() => {
      if (this.running === execution) this.running = undefined;
    }).catch(() => undefined);
    return execution;
  }

  private execute(): Promise<DemoRunResult> {
    const startedAt = new Date().toISOString();
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", "scripts/demo.ts"], {
        cwd: this.options.projectRoot,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      let outputExceeded = false;
      const append = (current: string, chunk: Buffer): string => {
        const next = current + chunk.toString("utf8");
        if (Buffer.byteLength(next, "utf8") > 128_000) {
          outputExceeded = true;
          child.kill("SIGTERM");
          return current;
        }
        return next;
      };
      child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
      child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
      const timer = setTimeout(() => child.kill("SIGTERM"), this.timeoutMs);
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(new Error(`VERITY_DEMO_START_FAILED: ${error.message}`, { cause: error }));
      });
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        if (outputExceeded) {
          reject(new Error("VERITY_DEMO_OUTPUT_LIMIT: live purchase emitted too much output"));
          return;
        }
        if (code !== 0) {
          const detail = lastLine(stderr) || `process exited with ${signal ?? code}`;
          reject(new Error(`VERITY_DEMO_RUN_FAILED: ${detail}`));
          return;
        }
        const events = parseJsonEvents(stdout);
        if (events.length === 0) {
          reject(new Error("VERITY_DEMO_RESULT_MISSING: live purchase returned no structured evidence"));
          return;
        }
        resolve({ startedAt, finishedAt: new Date().toISOString(), events });
      });
    });
  }
}

function parseJsonEvents(output: string): readonly unknown[] {
  const events: unknown[] = [];
  const trimmed = output.trim();
  if (!trimmed) return events;
  let cursor = 0;
  while (cursor < trimmed.length) {
    const start = trimmed.indexOf("{", cursor);
    if (start < 0) break;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < trimmed.length; index += 1) {
      const character = trimmed[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === "{") depth += 1;
      else if (character === "}" && --depth === 0) {
        try { events.push(JSON.parse(trimmed.slice(start, index + 1))); } catch { /* continue scanning */ }
        cursor = index + 1;
        break;
      }
    }
    if (cursor <= start) break;
  }
  return events;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`VERITY_CONFIG_INVALID: ${name} must be a positive integer`);
  return value;
}

function lastLine(value: string): string {
  return value.trim().split("\n").filter(Boolean).at(-1)?.slice(0, 500) ?? "";
}
