import { connect } from "/_ohmygame/plugin-ui.js";
import {
  ADD_MORE_PROMPT,
  WRITE_PROMPT,
  WRITE_UNIT_PROMPT,
  fixFailurePrompt,
  fixFilePrompt,
  fixUnitPrompt,
  statusOf,
} from "./prompts.js";

const TEXT = {
  en: {
    title: "Tests",
    games: "Game tests",
    unit: "Unit tests",
    emptyTitle: "No tests yet",
    empty: "Tests replay steps in the game and check what happens, so a change that breaks something shows up. They are kept as files in tests/game/.",
    write: "Ask the AI to write tests",
    addMore: "Ask the AI to add more tests",
    runAll: "Run all",
    runOne: (name) => `Run ${name}`,
    stop: "Stop",
    running: (current, total) => `Running ${current} of ${total}…`,
    stopped: "Stopped",
    summary: (passed, failed) => `${passed} passed, ${failed} failed`,
    notRun: (count) => `${count} tests, not run yet`,
    step: (step) => `${step.setup ? "setup step" : "step"} ${step.index + 1}`,
    failedStep: (size, step) => `At ${size}, ${step} failed`,
    failedPlayerStep: (size, step, player) => `At ${size}, ${step} failed for player ${player}`,
    failedOpen: (size) => `At ${size}, the game couldn't be tested`,
    frame: (size) => `The game at ${size} when the test stopped`,
    logs: (count) => `Console (${count})`,
    fix: "Ask the AI to fix it",
    invalid: (file) => `${file} can't be run`,
    fixFile: "Ask the AI to fix the file",
    status: { passed: "Passed", failed: "Failed", running: "Running", waiting: "Waiting", cancelled: "Stopped", none: "Not run" },
    unitEmpty: 'Unit tests check rules that need no screen, such as which moves are allowed, from a "test" script in package.json. This project has none yet.',
    unitWrite: "Ask the AI to write unit tests",
    unitRun: "Run",
    unitNotRun: "Not run yet",
    unitInstalling: "Installing dependencies…",
    unitRunning: "Running…",
    unitError: "The tests couldn't run",
    unitPassed: "Passed",
    unitFailed: (code) => `Failed (exit code ${code})`,
    output: "Output",
  },
  "zh-CN": {
    title: "测试",
    games: "游戏测试",
    unit: "单元测试",
    emptyTitle: "还没有测试",
    empty: "测试会在游戏里重放一遍操作，并检查结果是否符合预期，改动弄坏了什么就能马上发现。测试以文件形式保存在 tests/game/。",
    write: "让 AI 写测试",
    addMore: "让 AI 补充测试",
    runAll: "全部运行",
    runOne: (name) => `运行${name}`,
    stop: "停止",
    running: (current, total) => `正在运行第 ${current} 个，共 ${total} 个…`,
    stopped: "已停止",
    summary: (passed, failed) => `${passed} 个通过，${failed} 个失败`,
    notRun: (count) => `共 ${count} 个测试，还没有运行`,
    step: (step) => `${step.setup ? "准备阶段" : ""}第 ${step.index + 1} 步`,
    failedStep: (size, step) => `在 ${size} 下，${step}失败`,
    failedPlayerStep: (size, step, player) => `在 ${size} 下，玩家 ${player} 的${step}失败`,
    failedOpen: (size) => `在 ${size} 下，游戏无法测试`,
    frame: (size) => `测试停止时 ${size} 下的游戏画面`,
    logs: (count) => `控制台（${count}）`,
    fix: "让 AI 修复",
    invalid: (file) => `${file} 无法运行`,
    fixFile: "让 AI 修复这个文件",
    status: { passed: "通过", failed: "失败", running: "运行中", waiting: "等待中", cancelled: "已停止", none: "未运行" },
    unitEmpty: "单元测试检查不需要画面的规则，比如哪些出法合法，由 package.json 里的 \"test\" 脚本运行。这个项目还没有单元测试。",
    unitWrite: "让 AI 写单元测试",
    unitRun: "运行",
    unitNotRun: "还没有运行",
    unitInstalling: "正在安装依赖…",
    unitRunning: "正在运行…",
    unitError: "测试无法运行",
    unitPassed: "通过",
    unitFailed: (code) => `失败（退出码 ${code}）`,
    output: "输出",
  },
};

const host = await connect();
const t = TEXT[host.locale] ?? TEXT.en;
document.documentElement.lang = host.locale;
const root = document.getElementById("tests");
root.setAttribute("heading", t.title);

const state = { game: undefined, unit: undefined, error: undefined, visible: true, frames: new Map() };

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "on") for (const [event, listener] of Object.entries(value)) node.addEventListener(event, listener);
    else if (value !== undefined && value !== false) node.setAttribute(key, value === true ? "" : String(value));
  }
  node.append(...children.flat().filter((value) => value !== undefined && value !== null && value !== false));
  return node;
}
const request = (command, input) => host.request("command.run", { command, ...(input ? { input } : {}) });
const ask = (text) => void host.request("composer.fill", { text }).catch(showError);
const button = (label, onClick, attrs = {}) => h("omg-button", { ...attrs, on: { click: onClick } }, label);

function showError(error) {
  state.error = error?.message || String(error);
  render();
}

async function refresh() {
  try {
    const next = await request("state");
    // An answer that left before a run started must not hide that run.
    for (const key of ["game", "unit"]) {
      const current = state[key]?.run;
      if (current && (!next[key].run || next[key].run.startedAt < current.startedAt)) next[key].run = current;
    }
    state.game = next.game;
    state.unit = next.unit;
  } catch (error) {
    state.error = error?.message || String(error);
  }
  render();
}

/** Starts a command that waits for its run, and follows the run while it goes. */
function start(command, input) {
  state.error = undefined;
  request(command, input).then(refresh, showError);
  setTimeout(refresh, 200);
}

const TONES = { passed: "good", failed: "bad", running: "busy", waiting: "neutral", cancelled: "neutral", none: "neutral" };
const statusBadge = (status) => h("omg-status", { tone: TONES[status] ?? "neutral" }, t.status[status] ?? t.status.none);

/** A frame the run kept, fetched once. */
function frame(runId, captureId, label) {
  const image = h("img", { class: "frame", alt: label });
  const key = `${runId}/${captureId}`;
  const show = (url) => {
    if (url) image.src = url;
  };
  if (state.frames.has(key)) show(state.frames.get(key));
  else {
    request("capture", { runId, captureId })
      .then((capture) => {
        if (!capture) return;
        const bytes = Uint8Array.from(atob(capture.data), (char) => char.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes], { type: capture.mediaType }));
        state.frames.set(key, url);
        show(url);
      })
      .catch(() => {});
  }
  return h("a", { class: "frame-link", href: "#", on: { click: (event) => event.preventDefault() } }, image);
}

function failure(run, scenario, viewport) {
  const step = viewport.steps.find((item) => item.status === "failed");
  const size = `${viewport.viewport.width}×${viewport.viewport.height}`;
  const captureId = step?.captureId ?? viewport.captureId;
  const title = step
    ? step.player
      ? t.failedPlayerStep(size, t.step(step), step.player)
      : t.failedStep(size, t.step(step))
    : t.failedOpen(size);
  return h(
    "div",
    { class: "failure" },
    h("p", { class: "failure-title" }, title),
    h("ul", { class: "reasons" }, (step?.failures ?? [viewport.error ?? ""]).map((reason) => h("li", {}, reason))),
    captureId ? frame(run.id, captureId, t.frame(size)) : null,
    viewport.logs?.length
      ? h("omg-disclosure", { heading: t.logs(viewport.logs.length) }, h("pre", { class: "log" }, viewport.logs.map((log) => `[${log.level}] ${log.message}`).join("\n")))
      : null,
    button(t.fix, () => ask(fixFailurePrompt(scenario, viewport)), { variant: "secondary" }),
  );
}

function gameSection() {
  const game = state.game;
  const section = h("omg-section", { heading: t.games });
  if (!game) return section;
  if (!game.files.length) {
    section.append(h("omg-empty", { heading: t.emptyTitle, description: t.empty }, button(t.write, () => ask(WRITE_PROMPT), { variant: "primary" })));
    return section;
  }
  const run = game.run;
  const running = run?.status === "running";
  const finished = run && !running ? run.scenarios : [];
  const passed = finished.filter((item) => item.status === "passed").length;
  const failed = finished.filter((item) => item.status === "failed").length;
  section.append(
    h(
      "div",
      { class: "row" },
      running ? button(t.stop, () => void request("cancel").then(refresh, showError)) : button(t.runAll, () => start("run"), { variant: "primary" }),
      h(
        "p",
        { class: "muted", role: "status" },
        running ? t.running(Math.max(1, run.scenarios.length), run.files.length) : run?.status === "cancelled" ? t.stopped : run ? t.summary(passed, failed) : t.notRun(game.files.length),
      ),
    ),
    h(
      "ul",
      { class: "tests" },
      game.files.map((file) => {
        const { status, result } = statusOf(file, run);
        const name = file.name ?? file.file;
        return h(
          "li",
          { class: "test" },
          h(
            "div",
            { class: "row" },
            statusBadge(file.error ? "failed" : status),
            h("span", { class: "name", title: `tests/game/${file.file}` }, name),
            file.error ? null : button("▶", () => start("run", { files: [file.file] }), { variant: "ghost", "aria-label": t.runOne(name), disabled: running }),
          ),
          file.error
            ? h(
                "div",
                { class: "failure" },
                h("p", { class: "failure-title" }, t.invalid(file.file)),
                h("ul", { class: "reasons" }, h("li", {}, file.error)),
                button(t.fixFile, () => ask(fixFilePrompt(file.file, file.error)), { variant: "secondary" }),
              )
            : null,
          result && run ? result.viewports.filter((viewport) => viewport.status === "failed").map((viewport) => failure(run, result, viewport)) : null,
        );
      }),
    ),
    button(t.addMore, () => ask(ADD_MORE_PROMPT), { variant: "ghost" }),
  );
  return section;
}

function unitSummary(run) {
  if (!run) return t.unitNotRun;
  if (run.status === "running") return run.phase === "installing" ? t.unitInstalling : t.unitRunning;
  if (run.status === "cancelled") return t.stopped;
  if (run.status === "error") return t.unitError;
  if (run.passed !== undefined && run.failed !== undefined) return t.summary(run.passed, run.failed);
  return run.status === "passed" ? t.unitPassed : t.unitFailed(run.exitCode ?? "?");
}

function unitSection() {
  const unit = state.unit;
  const section = h("omg-section", { heading: t.unit });
  if (!unit) return section;
  if (!unit.script) {
    section.append(h("p", { class: "muted" }, t.unitEmpty), button(t.unitWrite, () => ask(WRITE_UNIT_PROMPT), { variant: "secondary" }));
    return section;
  }
  const run = unit.run;
  const running = run?.status === "running";
  const finished = run && !running;
  const status = !run ? "none" : run.status === "error" ? "failed" : run.status;
  section.append(
    h(
      "div",
      { class: "row" },
      running ? button(t.stop, () => void request("unit-cancel").then(refresh, showError)) : button(t.unitRun, () => start("unit-run")),
      statusBadge(status),
      h("p", { class: "muted", role: "status" }, unitSummary(run)),
    ),
    h("code", { class: "command", title: unit.script.script }, unit.script.command),
    finished && run.error ? h("ul", { class: "reasons" }, h("li", {}, run.error)) : null,
    finished && run.failures?.length
      ? h("ul", { class: "reasons" }, run.failures.map((item) => h("li", {}, h("strong", {}, item.name), item.message ? h("span", { class: "muted" }, ` ${item.message}`) : null)))
      : null,
    finished && run.output
      ? h("omg-disclosure", { heading: t.output, open: run.status !== "passed" && !run.failures?.length && !run.error }, h("pre", { class: "log" }, run.output))
      : null,
    finished && (run.status === "failed" || run.status === "error") ? button(t.fix, () => ask(fixUnitPrompt(run)), { variant: "secondary" }) : null,
  );
  return section;
}

function render() {
  root.replaceChildren(
    state.error ? h("omg-banner", { tone: "bad" }, state.error) : null,
    gameSection(),
    h("omg-divider"),
    unitSection(),
  );
}

host.on("visibility", ({ visible }) => {
  state.visible = visible;
  if (visible) void refresh();
});
// After an agent's turn, or a file changes: the tests may be new.
host.on("files", () => void refresh());
// The agent's runs show here too, so a run going is followed wherever it started.
setInterval(() => {
  if (state.visible && (state.game?.run?.status === "running" || state.unit?.run?.status === "running")) void refresh();
}, 1000);
await refresh();
