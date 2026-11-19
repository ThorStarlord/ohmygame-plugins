// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The panel's page against a stand-in for the app's bridge: what it shows
// for the state its native side gives, and what it asks the app for.

type Listener = (value: unknown) => void;
const bridge = vi.hoisted(() => ({
  state: undefined as unknown,
  requests: [] as [string, unknown][],
  listeners: new Map<string, Listener>(),
}));
vi.mock("./plugin-ui.ts", () => ({
  connect: async () => ({
    locale: "en",
    on: (event: string, listener: Listener) => bridge.listeners.set(event, listener),
    request: async (name: string, value: { command?: string; input?: unknown }) => {
      bridge.requests.push([name === "command.run" ? value.command! : name, name === "command.run" ? value.input : value]);
      if (name === "command.run" && value.command === "state") return structuredClone(bridge.state);
      if (name === "command.run" && value.command === "capture") return { mediaType: "image/jpeg", data: btoa("frame") };
      return null;
    },
  }),
}));

const failedRun = {
  id: "run-1", status: "failed", source: "agent", startedAt: "2026-11-18T08:00:00.000Z", finishedAt: "2026-11-18T08:00:05.000Z",
  files: ["score.json"],
  scenarios: [{
    file: "score.json", name: "Score", status: "failed",
    viewports: [{ viewport: { width: 390, height: 844 }, status: "failed", steps: [{ index: 0, status: "failed", failures: ["state score is 0, expected 10"], captureId: "frame-1", durationMs: 5 }], logs: [{ level: "error", message: "Uncaught TypeError", timestamp: "" }] }],
  }],
};

async function show(state: unknown) {
  bridge.state = state;
  document.body.innerHTML = '<omg-page id="tests"></omg-page>';
  vi.resetModules();
  // @ts-expect-error The panel's page is plain JavaScript.
  await import("../../plugins/game-tests/panel/main.js");
  await vi.waitFor(() => expect(bridge.requests.some(([name]) => name === "state")).toBe(true));
  await new Promise((resolve) => setTimeout(resolve, 0));
  return document.getElementById("tests")!;
}
const click = (root: Element, label: string) =>
  ([...root.querySelectorAll("omg-button")].find((item) => item.textContent === label || item.getAttribute("aria-label") === label) as HTMLElement).click();

beforeEach(() => {
  bridge.requests = [];
  bridge.listeners.clear();
  globalThis.URL.createObjectURL = vi.fn(() => "blob:frame");
});
afterEach(() => vi.useRealTimers());

describe("the Tests panel page", () => {
  it("offers to have tests written when there are none", async () => {
    const root = await show({ game: { files: [] }, unit: {} });
    expect(root.textContent).toContain("Ask the AI to write tests");
    expect(root.textContent).toContain("This project has none yet.");
    click(root, "Ask the AI to write tests");
    expect(bridge.requests.at(-1)).toEqual(["composer.fill", { text: "Write game tests for this game in tests/game/ as the game-tests skill says, then run them." }]);
  });

  it("shows where a test failed, with its frame, and runs one", async () => {
    const root = await show({
      game: { files: [{ file: "score.json", name: "Score", steps: 1, viewports: [{ width: 390, height: 844 }] }, { file: "broken.json", error: "It isn't valid JSON" }], run: failedRun },
      unit: { script: { command: "npm run test", script: "vitest run" }, run: { id: "u", status: "failed", startedAt: "", command: "npm run test", exitCode: 1, passed: 3, failed: 1, failures: [{ name: "a bomb beats a pair", message: "1 == 2" }], output: "…" } },
    });
    expect(root.textContent).toContain("0 passed, 1 failed");
    expect(root.textContent).toContain("At 390×844, step 1 failed");
    expect(root.textContent).toContain("state score is 0, expected 10");
    expect(root.textContent).toContain("broken.json can't be run");
    expect(root.textContent).toContain("3 passed, 1 failed");
    expect(root.textContent).toContain("a bomb beats a pair");
    await vi.waitFor(() => expect(root.querySelector("img")?.getAttribute("src")).toBe("blob:frame"));
    expect(bridge.requests).toContainEqual(["capture", { runId: "run-1", captureId: "frame-1" }]);
    click(root, "Run Score");
    expect(bridge.requests).toContainEqual(["run", { files: ["score.json"] }]);
  });

  it("follows a run while it goes", async () => {
    const running = { ...failedRun, status: "running", finishedAt: undefined, scenarios: [] };
    const root = await show({ game: { files: [{ file: "score.json", name: "Score", steps: 1 }], run: running }, unit: {} });
    expect(root.textContent).toContain("Running 1 of 1…");
    click(root, "Stop");
    expect(bridge.requests.at(-1)).toEqual(["cancel", undefined]);
    const before = bridge.requests.filter(([name]) => name === "state").length;
    await vi.waitFor(() => expect(bridge.requests.filter(([name]) => name === "state").length).toBeGreaterThan(before), { timeout: 3000 });
  });
});
