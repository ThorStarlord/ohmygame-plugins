import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

// A project's own unit tests: the `test` script in its package.json, run as
// its package manager runs it, with the result shown beside the game tests.

/** Output a run keeps: its end, where test runners print what failed. */
export const UNIT_TEST_OUTPUT_CHARS = 64 * 1024;
/** Failing tests a run lists by name. */
export const UNIT_TEST_MAX_FAILURES = 50;
/** How long a run, or installing the dependencies it needs, may take before it is stopped. */
export const UNIT_TEST_TIMEOUT_MS = 5 * 60_000;

const MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;
export type PackageManager = (typeof MANAGERS)[number];

export interface UnitTestScript {
  /** How it is run, such as `npm run test`. */
  command: string;
  /** The script itself, such as `vitest run`. */
  script: string;
}

/** A failing test, as the test runner's output names it. */
export interface UnitTestFailure {
  name: string;
  message?: string;
}

export interface UnitTestRun {
  id: string;
  /** `error` when the tests couldn't be run at all, such as when installing failed. */
  status: "running" | "passed" | "failed" | "cancelled" | "error";
  /** While running: installing the project's dependencies first, or testing. */
  phase?: "installing" | "testing";
  startedAt: string;
  finishedAt?: string;
  command: string;
  exitCode?: number;
  /** Counts the test runner printed, when its summary is one this plugin reads. */
  passed?: number;
  failed?: number;
  failures?: UnitTestFailure[];
  /** Why the tests couldn't be run, or didn't finish. */
  error?: string;
  /** The end of what the tests printed, without colors. */
  output: string;
}

export interface UnitTestsState {
  /** Undefined when the project has no `test` script. */
  script?: UnitTestScript;
  run?: UnitTestRun;
}

export class UnitTestError extends Error {}

/** The script npm init writes, which only says there are no tests. */
const PLACEHOLDER = /no test specified/i;
const LOCKFILES: [string, PackageManager][] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["package-lock.json", "npm"],
];

const exists = (file: string) => access(file).then(() => true, () => false);

/** The package manager a project names in package.json, or its lockfile shows; npm otherwise. */
export async function packageManager(folder: string, manifest: { packageManager?: unknown }): Promise<PackageManager> {
  if (typeof manifest.packageManager === "string") {
    const name = manifest.packageManager.split("@")[0] as PackageManager;
    if (MANAGERS.includes(name)) return name;
  }
  for (const [file, manager] of LOCKFILES) if (await exists(path.join(folder, file))) return manager;
  return "npm";
}

interface Found extends UnitTestScript {
  folder: string;
  manager: PackageManager;
}

async function findScript(folder: string): Promise<Found | undefined> {
  let manifest: { scripts?: Record<string, unknown>; packageManager?: unknown };
  try {
    manifest = JSON.parse(await readFile(path.join(folder, "package.json"), "utf8"));
  } catch {
    return undefined;
  }
  const script = manifest.scripts?.test;
  if (typeof script !== "string" || !script.trim() || PLACEHOLDER.test(script)) return undefined;
  const manager = await packageManager(folder, manifest);
  return { command: `${manager} run test`, script: script.trim(), folder, manager };
}

// Color codes and cursor moves, which runners may print even when asked not to.
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/** Keeps the end of what a run printed, within the limit. */
class Output {
  #text = "";
  append(chunk: string): void {
    this.#text += chunk.replace(ANSI, "").replace(/\r\n?/g, "\n");
    if (this.#text.length > UNIT_TEST_OUTPUT_CHARS * 2) this.#text = this.#text.slice(-UNIT_TEST_OUTPUT_CHARS);
  }
  get text(): string {
    return this.#text.length > UNIT_TEST_OUTPUT_CHARS ? `…\n${this.#text.slice(-UNIT_TEST_OUTPUT_CHARS)}` : this.#text;
  }
}

/**
 * What a run's output says: the counts and failing tests of the runners this
 * plugin reads (Node's test runner as TAP or spec, Vitest, Jest and Bun).
 * Anything else leaves them out, and the exit code alone says how it went.
 */
export function readUnitTestOutput(output: string): Pick<UnitTestRun, "passed" | "failed" | "failures"> {
  const text = output.replace(ANSI, "");
  const number = (pattern: RegExp) => {
    const match = pattern.exec(text);
    return match ? Number(match[1]) : undefined;
  };
  let passed: number | undefined;
  let failed: number | undefined;
  const summary = /^\s*Tests\s+(.+?)\s*\(\d+\)\s*$/m.exec(text) ?? /^Tests:\s+(.+?),\s*\d+ total\s*$/m.exec(text);
  if (summary) {
    passed = Number(/(\d+) passed/.exec(summary[1]!)?.[1] ?? 0);
    failed = Number(/(\d+) failed/.exec(summary[1]!)?.[1] ?? 0);
  } else {
    passed = number(/^(?:#|ℹ) pass (\d+)\s*$/m) ?? number(/^\s*(\d+) pass\s*$/m);
    failed = number(/^(?:#|ℹ) fail (\d+)\s*$/m) ?? number(/^\s*(\d+) fail\s*$/m);
  }

  const failures = new Map<string, UnitTestFailure>();
  const add = (name: string, detail?: string) => {
    name = name.trim();
    if (!name || failures.has(name) || failures.size >= UNIT_TEST_MAX_FAILURES) return;
    failures.set(name, detail?.trim() ? { name, message: detail.trim() } : { name });
  };
  const lines = text.split("\n");
  const nextLine = (index: number) => lines.slice(index + 1).find((line) => line.trim())?.trim();
  const specFailures = lines.findIndex((line) => line.startsWith("✖ failing tests:"));
  lines.forEach((line, index) => {
    let match: RegExpExecArray | null;
    // Vitest: " FAIL  file.test.ts > group > name", then the error.
    if ((match = /^\s*FAIL\s+(\S.* > .+)$/.exec(line))) return add(match[1]!, nextLine(index));
    // Jest: "  ● group › name", then the error.
    if ((match = /^\s*● (.+ › .+)$/.exec(line))) return add(match[1]!, nextLine(index));
    // Bun: "(fail) group > name [1.00ms]".
    if ((match = /^\(fail\) (.+?)(?: \[[\d.]+m?s\])?$/.exec(line))) return add(match[1]!);
    // Node's spec reporter lists failing tests again at the end, without groups.
    if (specFailures >= 0 && index > specFailures && (match = /^✖ (.+?) \([\d.]+m?s\)$/.exec(line))) return add(match[1]!, nextLine(index));
    // Node's TAP reporter: "not ok 2 - name", then a YAML block with its error.
    if ((match = /^(\s*)not ok \d+ - (.+?)(?: # .*)?$/.exec(line))) {
      const block: string[] = [];
      for (const item of lines.slice(index + 1)) {
        if (item.trim() === "...") break;
        block.push(item);
      }
      // A group fails with its tests, which are listed on their own.
      if (block.some((item) => item.includes("failureType: 'subtestsFailed'"))) return;
      const at = block.findIndex((item) => /^\s*error: /.test(item));
      const value = at >= 0 ? block[at]!.replace(/^\s*error: /, "").trim() : undefined;
      const indent = at >= 0 ? /^\s*/.exec(block[at]!)![0].length : 0;
      // A message of several lines is a YAML block that starts on the next line.
      const continued = () => {
        const end = block.findIndex((item, row) => row > at && item.trim() && /^\s*/.exec(item)![0].length <= indent);
        return block.slice(at + 1, end < 0 ? undefined : end).map((item) => item.trim()).filter(Boolean).slice(0, 4).join(" ");
      };
      add(match[2]!, value && /^[|>][-+]?$/.test(value) ? continued() : value?.replace(/^(['"])(.*)\1$/, "$2"));
    }
  });
  return {
    ...(passed !== undefined ? { passed } : {}),
    ...(failed !== undefined ? { failed } : {}),
    ...(failures.size ? { failures: [...failures.values()] } : {}),
  };
}

class Cancelled extends Error {}

/** The plugin host's environment without the app's own settings, which aren't for project code. */
function environment(): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { ...process.env };
  for (const name of Object.keys(result)) if (name.toUpperCase().startsWith("OHMYGAME_")) delete result[name];
  // Runners that would watch for changes run once, and print plain text.
  return { ...result, CI: "1", NO_COLOR: "1", FORCE_COLOR: "0" };
}

/** Runs a command until it exits, stopping it and what it started when the signal aborts or time runs out. */
function runCommand(command: string, args: string[], cwd: string, output: Output, signal: AbortSignal, timeoutMs: number): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const windows = process.platform === "win32";
    const child = spawn(command, args, { cwd, env: environment(), stdio: ["ignore", "pipe", "pipe"], detached: !windows, shell: windows, windowsHide: true });
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => output.append(chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => output.append(chunk));
    let stopped: Error | undefined;
    const kill = () => {
      if (!child.pid) return;
      try {
        if (windows) spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
        else process.kill(-child.pid, "SIGKILL");
      } catch {}
    };
    const stop = (reason: Error) => {
      stopped ??= reason;
      kill();
    };
    const abort = () => stop(new Cancelled());
    const timer = setTimeout(() => stop(new UnitTestError(`The tests didn't finish within ${Math.round(timeoutMs / 60_000)} minutes, so they were stopped.`)), timeoutMs);
    if (signal.aborted) abort();
    signal.addEventListener("abort", abort, { once: true });
    child.once("error", (cause) => {
      stopped ??= cause;
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      // A test's own processes may outlive the runner.
      kill();
      if (stopped) reject(stopped);
      else resolve(code ?? undefined);
    });
  });
}

/** The project's unit tests and their latest run. One run at a time; a new one ends the last. */
export class UnitTests {
  #current: { run: UnitTestRun; controller: AbortController; done: Promise<UnitTestRun> } | undefined;

  constructor(
    private readonly folder: string,
    private readonly options: { timeoutMs?: number; onChange?: (run: UnitTestRun) => void } = {},
  ) {}

  async state(): Promise<UnitTestsState> {
    const found = await findScript(this.folder);
    const run = this.#current?.run;
    return { ...(found ? { script: { command: found.command, script: found.script } } : {}), ...(run ? { run: structuredClone(run) } : {}) };
  }

  /** Starts a run, ending the current one. The returned run finishes with `done`. */
  async start(): Promise<{ run: UnitTestRun; done: Promise<UnitTestRun> }> {
    const found = await findScript(this.folder);
    if (!found) throw new UnitTestError('This project has no unit tests: its package.json has no "test" script.');
    await this.cancel();
    const run: UnitTestRun = { id: randomUUID(), status: "running", phase: "testing", startedAt: new Date().toISOString(), command: found.command, output: "" };
    const controller = new AbortController();
    const current = { run, controller, done: Promise.resolve(run) };
    this.#current = current;
    const changed = () => {
      if (this.#current === current) this.options.onChange?.(structuredClone(run));
    };
    const output = new Output();
    const timeoutMs = this.options.timeoutMs ?? UNIT_TEST_TIMEOUT_MS;
    current.done = (async () => {
      try {
        // The preview usually installed them already; a project opened fresh may not have them yet.
        if (!(await exists(path.join(found.folder, "node_modules")))) {
          run.phase = "installing";
          changed();
          const code = await runCommand(found.manager, ["install"], found.folder, output, controller.signal, timeoutMs);
          if (code !== 0) throw new UnitTestError(`Installing the project's dependencies failed (exit code ${code ?? "unknown"}).`);
          run.phase = "testing";
          changed();
        }
        const code = await runCommand(found.manager, ["run", "test"], found.folder, output, controller.signal, timeoutMs);
        Object.assign(run, readUnitTestOutput(output.text), { exitCode: code, status: code === 0 ? "passed" : "failed" });
      } catch (cause) {
        if (controller.signal.aborted || cause instanceof Cancelled) run.status = "cancelled";
        else {
          run.status = "error";
          run.error = cause instanceof Error ? cause.message : String(cause);
        }
      }
      delete run.phase;
      run.output = output.text;
      run.finishedAt = new Date().toISOString();
      changed();
      return run;
    })();
    changed();
    return { run: structuredClone(run), done: current.done };
  }

  /** Runs the tests and waits for the result; aborting the signal ends the run. */
  async run(signal?: AbortSignal): Promise<UnitTestRun> {
    const { done } = await this.start();
    const current = this.#current;
    const cancel = () => current?.controller.abort();
    if (signal?.aborted) cancel();
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      return structuredClone(await done);
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
  }

  async cancel(): Promise<void> {
    const current = this.#current;
    if (!current || current.run.status !== "running") return;
    current.controller.abort();
    await current.done.catch(() => undefined);
  }

  dispose(): void {
    this.#current?.controller.abort();
  }
}
