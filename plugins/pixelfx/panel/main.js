// The Pixel Effects panel: pixelfx's gallery in OhMyGame. It browses the
// built-in effects, plays one on the stage with the inspector's settings,
// shows it as a sprite sheet or as code, and exports it to the Library or
// the project. Ported from pixelfx's gallery/app.js (MIT, see lib/LICENSE);
// the stage is in stage.js, rendering for export in export.js.
import { connect } from "/_ohmygame/plugin-ui.js";
import { effects, categories } from "./lib/fx/index.js";
import { actTiming, PAL } from "./lib/core/index.js";
import { ZH_BACKDROPS, ZH_CATEGORIES, ZH_FX, ZH_OPTION_KEYS, ZH_PALETTES } from "./lib/zh-data.js";
import {
  buildContactSheetCanvas,
  buildGifBlob,
  buildSpriteSheet,
  canvasToPngBlob,
  exportBudget,
  framesMeta,
  renderExportFrames,
  sheetJson,
  sheetLayout,
} from "./export.js";
import { defaultConfig, effectOptions, fullMeta, isColorRamp, normHex } from "./options.js";
import { drawThumbnail, StageRunner } from "./stage.js";
import { TEXT } from "./i18n.js";

const host = await connect();
const zh = host.locale === "zh-CN";
const t = TEXT[host.locale] ?? TEXT.en;
document.documentElement.lang = host.locale;
document.title = t.title;

const THEMES = ["amber", "aseprite", "cyber", "crt", "app"];
const EXPORT_DIR = "pixelfx/exports";
const LIBRARY_FORMATS = new Set(["sheet-png", "contact"]);

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function el(tag, props = {}, kids = []) {
  const node = Object.assign(document.createElement(tag), props);
  for (const kid of [].concat(kids)) if (kid != null) node.append(kid);
  return node;
}

function toast(message, tone = "default") {
  void host.request("ui.toast", { message: String(message).slice(0, 500), tone }).catch(() => {});
}

const errorText = (error) => (error instanceof Error ? error.message : String(error));

// ---------------------------------------------------------------------------
// The built-in effects and their names in the panel's language.

const LIBRARY = Object.entries(effects).map(([id, mod]) => {
  const meta = fullMeta(mod.meta);
  return { id, cat: id.split("/")[0], mod: { ...mod, meta }, meta };
});

const nameOf = (fx) => (zh && ZH_FX[fx.id]?.[0]) || fx.meta.name || fx.id.split("/")[1];
const descOf = (fx) => (zh && ZH_FX[fx.id]?.[1]) || fx.meta.desc || "";
const catName = (id) => (zh ? ZH_CATEGORIES[id]?.name : categories.find((c) => c.id === id)?.name) || id;
const backdropName = (key) => (zh ? ZH_BACKDROPS[key] : t.backdrops[key]) || key;
const paletteName = (key) => (zh ? ZH_PALETTES[key] : key[0].toUpperCase() + key.slice(1)) || key;
const optionName = (key) => (zh && ZH_OPTION_KEYS[key]) || key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
const fpsText = (fps) => (Number.isInteger(fps) ? String(fps) : fps.toFixed(1));

const state = {
  cat: "all",
  query: "",
  filtered: LIBRARY,
  fx: undefined,
  view: "live",
  codeMode: "source",
  playing: true,
  speed: 1,
  visible: true,
  sheetZoom: "fit",
  sheetGrid: true,
  sheetActor: false,
  sheet: undefined,
  sources: new Map(),
  exporting: false,
  cfg: undefined,
};

// ---------------------------------------------------------------------------
// The page, as the upstream gallery lays it out, without its workspace,
// sound and AI parts, which come in later stages.

const pixelIcon = () => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "px-icon");
  svg.setAttribute("viewBox", "0 0 8 8");
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = '<rect x="1" y="1" width="6" height="6" fill="currentColor"/><rect x="0" y="0" width="3" height="3" fill="var(--pri)"/>';
  return svg;
};

function option(value, text) {
  return el("option", { value, textContent: text });
}

function dotButton(id, label, pressed) {
  const button = el("button", { type: "button", className: "dot-btn", ...(id ? { id } : {}) }, [el("span", { textContent: label }), el("i", { className: "status-dot" })]);
  button.setAttribute("aria-pressed", String(pressed));
  return button;
}

function pillSwitch(id, label) {
  return el("button", { type: "button", className: "pill-switch", id }, [
    el("span", { textContent: label }),
    el("span", { className: "sw-track" }, [el("i", { className: "sw-knob" })]),
  ]);
}

function labelFor(target, text, className = "row-label") {
  return el("label", { className, htmlFor: target, textContent: text });
}

function numberInput(id, className, props) {
  return el("input", { type: "number", id, className: `ctrl-input ${className}`, ...props });
}

function buildPage() {
  const viewTabs = Object.entries(t.views).map(([view, text]) => {
    const tab = el("button", { type: "button", className: "wb-tab", textContent: text, role: "tab" });
    tab.dataset.view = view;
    return tab;
  });
  const header = el("header", { className: "wb-header px-panel" }, [
    el("div", { className: "wb-title-group" }, [
      el("div", { className: "space-bar" }, [el("div", { className: "brand-tag" }, [pixelIcon(), el("span", { textContent: "PIXELFX" })])]),
      el("div", { className: "wb-title-line" }, [
        el("h1", { id: "fx-name" }),
        el("span", { className: "px-badge cat-badge", id: "fx-cat-badge" }),
        el("span", { className: "px-badge source-badge readonly", textContent: t.builtIn }),
        el("span", { className: "wb-id", id: "fx-id" }),
      ]),
      el("nav", { className: "wb-tabs", role: "tablist", ariaLabel: t.title }, viewTabs),
    ]),
    el("div", { className: "wb-actions" }, [
      el("div", { className: "quick-filter" }, [
        el(
          "select",
          { id: "sel-ui-theme", className: "ctrl-select theme-select", ariaLabel: t.theme, title: t.theme },
          THEMES.map((key) => option(key, t.themes[key])),
        ),
        el("select", { id: "sel-category", className: "ctrl-select", ariaLabel: t.category }),
        el("input", { id: "inp-search", className: "ctrl-input search-input", type: "search", placeholder: t.search, autocomplete: "off", ariaLabel: t.search }),
      ]),
    ]),
  ]);

  const live = el("div", { className: "view-pane", id: "pane-live" }, [
    el("div", { className: "stage-viewport px-sunken", id: "stage-viewport", title: t.replayHint }, [
      ...["tl", "tr", "bl", "br"].map((corner) => el("span", { className: `corner-mark ${corner}` })),
      el("canvas", { id: "stage-canvas" }),
      el("div", { className: "stage-error-overlay", id: "stage-error", hidden: true }),
    ]),
    el("div", { className: "timeline-bar" }, [
      el("div", { className: "scrub-wrap" }, [el("input", { type: "range", id: "scrub-range", min: 0, max: 10, step: 1, value: 0, ariaLabel: t.frameScrub })]),
      el("div", { className: "playback-row" }, [
        el("div", { className: "playback-left" }, [
          el("button", { type: "button", className: "ctrl-btn", id: "btn-play", textContent: t.pause }),
          el("button", { type: "button", className: "ctrl-btn", id: "btn-replay", textContent: t.replay }),
          labelFor("sel-speed", t.speed, "inline-label"),
          el(
            "select",
            { id: "sel-speed", className: "ctrl-select speed-select" },
            ["0.25", "0.5", "0.75", "1", "1.5", "2"].map((speed) => option(speed, `${speed.includes(".") ? speed : `${speed}.0`}x`)),
          ),
        ]),
        el("div", { className: "frame-counter", id: "frame-counter" }),
      ]),
    ]),
  ]);

  const sheet = el("div", { className: "view-pane", id: "pane-sheet", hidden: true }, [
    el("div", { className: "sub-toolbar" }, [
      el("div", { className: "sub-toolbar-left" }, [el("span", { className: "sheet-summary", id: "sheet-summary" })]),
      el("div", { className: "sub-toolbar-right" }, [
        labelFor("sel-sheet-zoom", t.zoom, "inline-label"),
        el("select", { id: "sel-sheet-zoom", className: "ctrl-select" }, [option("fit", t.zoomFit), ...[1, 2, 3, 4].map((z) => option(z, `${z}x`))]),
        dotButton("tog-sheet-grid", t.grid, true),
        dotButton("tog-sheet-actor", t.withActor, false),
        el("button", { type: "button", className: "ctrl-btn", id: "btn-sheet-library", textContent: t.addToLibrary }),
        el("button", { type: "button", className: "ctrl-btn", id: "btn-sheet-project", textContent: t.saveToProject }),
      ]),
    ]),
    el("div", { className: "sheet-scroll px-sunken", id: "sheet-scroll" }, [
      el("div", { className: "sheet-canvas-wrap" }, [el("canvas", { id: "sheet-canvas" })]),
    ]),
  ]);

  const codeTabs = Object.entries(t.codeTabs).map(([mode, text]) => {
    const tab = el("button", { type: "button", className: "wb-tab", textContent: text });
    tab.dataset.code = mode;
    return tab;
  });
  const code = el("div", { className: "view-pane", id: "pane-code", hidden: true }, [
    el("div", { className: "sub-toolbar" }, [
      el("div", { className: "code-subtabs" }, codeTabs),
      el("div", { className: "sub-toolbar-right" }, [el("span", { className: "code-path", id: "code-path" })]),
    ]),
    el("pre", { className: "code-box px-sunken", id: "code-box" }, [el("code", { id: "code-content" })]),
  ]);

  const carousel = el("div", { className: "carousel-bar" }, [
    el("button", { type: "button", className: "carousel-step ctrl-btn", id: "btn-prev", textContent: `< ${t.prev}` }),
    el("div", { className: "carousel-strip", id: "carousel-strip", role: "listbox", ariaLabel: t.effects }),
    el("button", { type: "button", className: "carousel-step ctrl-btn", id: "btn-next", textContent: `${t.next} >` }),
  ]);

  const inspector = el("aside", { className: "wb-inspector px-panel" }, [
    el("div", { className: "insp-section" }, [
      el("div", { className: "sec-title-bar" }, [el("h2", { className: "insp-heading", textContent: t.look })]),
      el("p", { className: "insp-desc", id: "insp-desc" }),
      el("div", { className: "insp-meta px-sunken" }, [el("div", { id: "meta-row-1" }), el("div", { id: "meta-row-2" }), el("div", { id: "meta-row-3" })]),
      el("div", { className: "form-grid" }, [
        el("div", { className: "form-row" }, [
          labelFor("sel-bg", t.backdrop),
          el("select", { id: "sel-bg", className: "ctrl-select row-fill" }, Object.keys(ZH_BACKDROPS).map((key) => option(key, backdropName(key)))),
        ]),
        el("div", { className: "form-row", id: "row-pal" }, [
          labelFor("sel-pal", t.palette),
          el("select", { id: "sel-pal", className: "ctrl-select row-fill" }, [
            option("", t.paletteOriginal),
            ...Object.keys(PAL).map((key) => option(key, paletteName(key))),
            option("__custom", t.paletteCustom),
          ]),
        ]),
        el("div", { className: "swatch-bar", id: "swatch-bar", title: t.swatchHint }),
        el("div", { className: "form-row compact-row" }, [
          labelFor("inp-seed", t.seed, "inline-label"),
          numberInput("inp-seed", "num-seed", { step: 1 }),
          el("button", { type: "button", className: "ctrl-btn", id: "btn-rand-seed", textContent: t.randomSeed }),
          labelFor("inp-fps", t.fps, "inline-label ml-auto"),
          numberInput("inp-fps", "num-fps", { min: 1, max: 120, step: 0.5 }),
          el("span", { className: "unit-text", textContent: "FPS" }),
        ]),
        el("div", { className: "form-row compact-row" }, [
          labelFor("inp-duration", t.duration),
          numberInput("inp-duration", "row-fill", { min: 0.05, max: 60, step: 0.05 }),
          el("span", { className: "unit-text", textContent: t.seconds }),
          el("span", { className: "scale-readout", id: "dur-scale" }),
        ]),
        el("div", { className: "form-row compact-row" }, [
          labelFor("inp-w", t.size),
          numberInput("inp-w", "num-dim", { min: 16, max: 1024, step: 1 }),
          el("span", { className: "unit-text", textContent: "x" }),
          numberInput("inp-h", "num-dim", { min: 16, max: 1024, step: 1, ariaLabel: t.size }),
          el("span", { className: "unit-text", textContent: "PX" }),
        ]),
        el("div", { className: "form-row switches-row" }, [pillSwitch("tog-aspect", t.lockAspect), pillSwitch("tog-scale-canvas", t.scaleWithCanvas)]),
        el("div", { className: "form-row compact-row" }, [
          dotButton("tog-flip", t.flip, false),
          labelFor("sel-actor", t.actor, "inline-label"),
          el("select", { id: "sel-actor", className: "ctrl-select row-fill" }, Object.entries(t.actorModes).map(([mode, text]) => option(mode, text))),
          el("button", { type: "button", className: "ctrl-btn", id: "btn-reset", textContent: t.reset }),
        ]),
      ]),
    ]),
    el("div", { className: "insp-divider" }),
    el("div", { className: "insp-section" }, [
      el("div", { className: "sec-title-bar" }, [el("h2", { className: "insp-heading", textContent: t.export })]),
      el("div", { className: "export-row" }, [
        el(
          "select",
          { id: "sel-export-fmt", className: "ctrl-select row-fill", ariaLabel: t.export },
          Object.entries(t.exportFormats).map(([format, text]) => option(format, text)),
        ),
        el("button", { type: "button", className: "primary-btn", id: "btn-export" }),
      ]),
      el("p", { className: "export-hint", id: "export-hint" }),
    ]),
    el("details", { className: "extra-accordion", id: "extra-accordion" }, [
      el("summary", {}, [el("span", { textContent: t.extraOptions }), el("i", { className: "status-dot", id: "extra-indicator" })]),
      el("div", { className: "extra-body", id: "extra-body" }),
    ]),
  ]);

  document.body.replaceChildren(
    el("div", { className: "workbench" }, [
      header,
      el("div", { className: "wb-body" }, [el("section", { className: "wb-left px-panel" }, [live, sheet, code, carousel]), inspector]),
    ]),
  );
}

buildPage();

const stage = new StageRunner($("#stage-canvas"), $("#stage-viewport"), state, {
  onFrame: updateTimeline,
  onError(error) {
    const overlay = $("#stage-error");
    overlay.hidden = !error;
    overlay.textContent = error ? t.stageError(errorText(error)) : "";
    if (error) setPlaying(false);
  },
});

// ---------------------------------------------------------------------------
// Choosing an effect and showing its settings.

function selectEffect(fx) {
  if (!fx) return;
  state.fx = fx;
  state.cfg = defaultConfig(fx);
  void host.request("storage.set", { key: "effect", value: fx.id }).catch(() => {});
  syncInspector();
  buildExtraOptions();
  setPlaying(true);
  stage.setup(fx, true);
  highlightCarousel();
  if (state.view === "sheet") refreshSheet();
  if (state.view === "code") void refreshCode();
}

function syncInspector() {
  const fx = state.fx;
  const m = fx.meta;
  const cfg = state.cfg;

  $("#fx-name").textContent = nameOf(fx);
  $("#fx-cat-badge").textContent = catName(fx.cat);
  $("#fx-id").textContent = fx.id;
  $("#insp-desc").textContent = descOf(fx);

  const frames = Math.max(1, Math.round(m.duration * m.fps) + (m.loop ? 0 : 1));
  $("#meta-row-1").textContent = t.meta.original(m.size[0], m.size[1], frames, m.fps.toFixed(1));
  $("#meta-row-2").textContent = t.meta.timing(+m.duration.toFixed(2), m.loop, m.origin[0], m.origin[1]);
  const timing = fx.mod.act ? actTiming(fx.mod) : null;
  $("#meta-row-3").textContent = timing ? t.meta.act(timing.windup.toFixed(2), timing.recovery.toFixed(2), timing.hits.length) : t.meta.noAct(m.loop);

  $("#sel-bg").value = cfg.bg;
  $("#sel-pal").value = cfg.paletteKey;
  renderSwatches();

  $("#inp-seed").value = cfg.seed;
  $("#inp-fps").value = cfg.fps;
  $("#inp-duration").value = +Number(cfg.duration).toFixed(2);
  updateDurationScale();
  $("#inp-w").value = cfg.canvasW;
  $("#inp-h").value = cfg.canvasH;
  $("#tog-aspect").setAttribute("aria-pressed", String(cfg.lockAspect));
  $("#tog-scale-canvas").setAttribute("aria-pressed", String(cfg.scaleWithCanvas));
  $("#tog-flip").setAttribute("aria-pressed", String(cfg.flip));

  const hasAct = !!fx.mod.act;
  const hasActor = hasAct || !!m.actor;
  const actor = $("#sel-actor");
  actor.disabled = !hasActor;
  $('option[value="body"]', actor).hidden = !hasAct;
  $('option[value="target"]', actor).hidden = !hasAct;
  actor.value = hasActor ? cfg.actorMode : "hide";
}

function updateDurationScale() {
  const ratio = state.cfg.duration / Math.max(0.01, state.fx.meta.duration);
  $("#dur-scale").textContent = `${ratio.toFixed(2)}×`;
}

function renderSwatches() {
  // Only an effect whose options have a colour ramp as `palette` takes one; the others ignore it.
  const own = state.fx.meta.options.palette;
  const takesPalette = isColorRamp(own);
  $("#row-pal").hidden = !takesPalette;
  $("#swatch-bar").hidden = !takesPalette;
  if (!takesPalette) return $("#swatch-bar").replaceChildren();
  const colors = (state.cfg.palette ?? own).map(normHex);
  $("#swatch-bar").replaceChildren(
    ...colors.map((color, index) => {
      const picker = el("input", { type: "color", value: color, ariaLabel: t.swatch(index + 1) });
      const chip = el("label", { className: "swatch-chip", title: color }, [picker]);
      chip.style.background = color;
      picker.addEventListener("input", () => {
        const next = [...colors];
        next[index] = picker.value;
        colors[index] = picker.value;
        state.cfg.palette = next;
        state.cfg.paletteKey = "__custom";
        $("#sel-pal").value = "__custom";
        chip.style.background = picker.value;
        applyChange();
      });
      return chip;
    }),
  );
}

function swatchRow(colors, onPick) {
  return el(
    "div",
    { className: "swatch-bar" },
    colors.map((color, index) => {
      const picker = el("input", { type: "color", value: color });
      const chip = el("label", { className: "swatch-chip", title: color }, [picker]);
      chip.style.background = color;
      picker.addEventListener("input", () => {
        chip.style.background = picker.value;
        onPick(index, picker.value);
      });
      return chip;
    }),
  );
}

function buildExtraOptions() {
  const fx = state.fx;
  const extra = state.cfg.extraOpts;
  const list = effectOptions(fx.meta);
  $("#extra-indicator").classList.toggle("on", list.length > 0);
  if (!list.length) {
    $("#extra-body").replaceChildren(el("div", { className: "extra-empty", textContent: t.noExtraOptions }));
    return;
  }
  const rows = list.map(({ key, value, control }) => {
    const label = optionName(key);
    // The code's own name beside the label, when the label says it differently.
    const head = el("div", { className: "extra-item-head" }, [
      el("span", { textContent: label }),
      label === key ? null : el("span", { className: "extra-item-key", textContent: key }),
    ]);
    const set = (next) => {
      extra[key] = next;
      applyChange();
    };
    let body;
    if (control.kind === "number") {
      const current = extra[key] ?? value;
      const slider = el("input", { type: "range", min: control.min, max: control.max, step: control.step, value: current, ariaLabel: key });
      const input = el("input", { type: "number", className: "ctrl-input", step: control.step, value: current, ariaLabel: key });
      const sync = (raw) => {
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) return;
        slider.value = parsed;
        input.value = parsed;
        set(parsed);
      };
      slider.addEventListener("input", () => sync(slider.value));
      input.addEventListener("change", () => sync(input.value));
      body = el("div", { className: "extra-num-row" }, [slider, input]);
    } else if (control.kind === "toggle") {
      const current = extra[key] ?? value;
      body = dotButton("", current ? t.on : t.off, current);
      body.addEventListener("click", () => {
        const next = !(extra[key] ?? value);
        body.setAttribute("aria-pressed", String(next));
        body.firstChild.textContent = next ? t.on : t.off;
        set(next);
      });
    } else if (control.kind === "color") {
      body = swatchRow([normHex(extra[key] ?? value)], (_, color) => set(color));
    } else if (control.kind === "ramp") {
      body = swatchRow((extra[key] ?? value).map(normHex), (index, color) => {
        const next = (extra[key] ?? value).map(normHex);
        next[index] = color;
        set(next);
      });
    } else if (control.kind === "text") {
      body = el("input", { type: "text", className: "ctrl-input", value: extra[key] ?? value, ariaLabel: key });
      body.addEventListener("input", () => set(body.value || value));
    } else {
      const current = extra[key] ?? [...value];
      const x = el("input", { type: "number", className: "ctrl-input num-dim", value: current[0], ariaLabel: `${key} x` });
      const y = el("input", { type: "number", className: "ctrl-input num-dim", value: current[1], ariaLabel: `${key} y` });
      const onPoint = () => set([Number(x.value) || 0, Number(y.value) || 0]);
      x.addEventListener("change", onPoint);
      y.addEventListener("change", onPoint);
      body = el("div", { className: "form-row compact-row" }, [el("span", { className: "unit-text", textContent: "X" }), x, el("span", { className: "unit-text", textContent: "Y" }), y]);
    }
    return el("div", { className: "extra-item" }, [head, body]);
  });
  $("#extra-body").replaceChildren(...rows);
}

let viewTimer;
function applyChange(resetClock = false) {
  stage.setup(state.fx, resetClock);
  // The sheet and its JSON draw every frame, so they wait for a pause in the changes, such as a dragged slider.
  clearTimeout(viewTimer);
  viewTimer = setTimeout(() => {
    if (state.view === "sheet") refreshSheet();
    if (state.view === "code" && state.codeMode !== "source") void refreshCode();
  }, 250);
}

function updateTimeline() {
  const slider = $("#scrub-range");
  const last = Math.max(0, stage.totalFrames - 1);
  slider.max = last;
  slider.value = stage.frameIdx;
  slider.style.setProperty("--prog", `${(last > 0 ? (stage.frameIdx / last) * 100 : 100).toFixed(1)}%`);
  $("#frame-counter").textContent = t.frameCounter(stage.frameIdx + 1, stage.totalFrames, fpsText(state.cfg.fps));
}

function setPlaying(playing) {
  state.playing = playing;
  $("#btn-play").textContent = playing ? t.pause : t.play;
}

// ---------------------------------------------------------------------------
// The sprite sheet and code views.

function exportConfig() {
  return { ...state.cfg, displayName: nameOf(state.fx) };
}

/** Why an export of the current settings is too big to render, or undefined when it isn't. */
function tooBig(options) {
  const budget = exportBudget(state.fx, state.cfg, options);
  return budget.ok ? undefined : t.tooBig(budget.frames, budget.w, budget.h);
}

function refreshSheet() {
  const big = tooBig();
  if (big) {
    state.sheet = undefined;
    $("#sheet-summary").textContent = big;
    const canvas = $("#sheet-canvas");
    canvas.width = canvas.height = 0;
    canvas.style.width = canvas.style.height = "0";
    return;
  }
  let sheet;
  try {
    sheet = buildSpriteSheet(state.fx, exportConfig(), { exportActor: state.sheetActor });
  } catch (error) {
    state.sheet = undefined;
    $("#sheet-summary").textContent = t.stageError(errorText(error));
    return;
  }
  state.sheet = sheet;
  $("#sheet-summary").textContent = t.sheetSummary(sheet);
  const canvas = $("#sheet-canvas");
  canvas.width = sheet.canvas.width;
  canvas.height = sheet.canvas.height;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(sheet.canvas, 0, 0);
  if (state.sheetGrid) {
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--pri").trim() || "#f59e0b";
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 1;
    for (let i = 0; i < sheet.n; i++) {
      ctx.strokeRect((i % sheet.cols) * sheet.w + 0.5, Math.floor(i / sheet.cols) * sheet.h + 0.5, sheet.w - 1, sheet.h - 1);
    }
    ctx.globalAlpha = 1;
  }
  applySheetZoom();
}

function applySheetZoom() {
  const sheet = state.sheet;
  if (!sheet) return;
  let zoom = Number(state.sheetZoom) || 1;
  if (state.sheetZoom === "fit") {
    const box = $("#sheet-scroll").getBoundingClientRect();
    const width = Math.max(200, box.width - 40);
    const height = Math.max(180, box.height - 40);
    // Unlike the upstream gallery, which stops at half size, a long sheet shrinks until it fits.
    zoom = Math.min(4, Math.max(0.05, Math.min(width / sheet.canvas.width, height / sheet.canvas.height)));
    if (zoom >= 1) zoom = Math.floor(zoom * 2) / 2;
  }
  const canvas = $("#sheet-canvas");
  canvas.style.width = `${Math.round(sheet.canvas.width * zoom)}px`;
  canvas.style.height = `${Math.round(sheet.canvas.height * zoom)}px`;
}

function usageCode(fx) {
  const cfg = state.cfg;
  const name = fx.id.split("/")[1].replace(/-(\w)/g, (_, c) => c.toUpperCase());
  const acted = !!fx.mod.act && cfg.actorMode !== "hide";
  const create = acted ? "createAct" : "createFx";
  const options = {
    x: Math.round(cfg.canvasW / 2),
    y: Math.round(cfg.canvasH * 0.75),
    ...(cfg.seed !== (fx.meta.options?.seed ?? 1) ? { seed: cfg.seed } : {}),
    ...(cfg.flip ? { flip: true } : {}),
    ...(cfg.palette ? { palette: cfg.palette } : {}),
    ...cfg.extraOpts,
  };
  return [
    t.usageComment(nameOf(fx), fx.id),
    `import { createFrame, clearFrame, ${create}, composite } from "pixelfx";`,
    `import * as ${name} from "pixelfx/fx/${fx.id}";`,
    "",
    `const W = ${Math.max(320, cfg.canvasW)}, H = ${Math.max(180, cfg.canvasH)};`,
    "const frame = createFrame(W, H);",
    "const imgData = ctx.createImageData(W, H);",
    `const fx = ${create}(${name}, ${JSON.stringify(options, null, 2)});`,
    "",
    "function updateAndDraw(dt) {",
    "  fx.update(dt);",
    "  clearFrame(frame);",
    "  fx.draw(frame);",
    "  composite(frame, imgData.data, null);",
    acted ? "  const [sx, sy] = fx.shake;\n  ctx.putImageData(imgData, sx, sy);" : "  ctx.putImageData(imgData, 0, 0);",
    "}",
  ].join("\n");
}

async function refreshCode() {
  const fx = state.fx;
  const content = $("#code-content");
  $$(".code-subtabs .wb-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.code === state.codeMode));
  if (state.codeMode === "usage") {
    $("#code-path").textContent = "";
    content.textContent = usageCode(fx);
    return;
  }
  if (state.codeMode === "json") {
    $("#code-path").textContent = `${fx.id.split("/")[1]}.json`;
    const big = tooBig();
    if (big) {
      content.textContent = `// ${big}`;
      return;
    }
    try {
      content.textContent = JSON.stringify(buildSpriteSheet(fx, exportConfig(), { exportActor: state.sheetActor }).json, null, 2);
    } catch (error) {
      content.textContent = `// ${errorText(error)}`;
    }
    return;
  }
  $("#code-path").textContent = `fx/${fx.id}.js`;
  const cached = state.sources.get(fx.id);
  if (cached !== undefined) {
    content.textContent = cached;
    return;
  }
  content.textContent = t.loadingSource;
  let text = t.sourceFailed;
  try {
    const response = await fetch(new URL(`./lib/fx/${fx.id}.js`, import.meta.url));
    if (response.ok) {
      text = await response.text();
      state.sources.set(fx.id, text);
    }
  } catch {
    // Shown as the failure text.
  }
  if (state.fx === fx && state.view === "code" && state.codeMode === "source") content.textContent = text;
}

function showView(view) {
  state.view = view;
  $$(".wb-tabs .wb-tab").forEach((tab) => {
    const on = tab.dataset.view === view;
    tab.classList.toggle("active", on);
    tab.setAttribute("aria-selected", String(on));
  });
  $("#pane-live").hidden = view !== "live";
  $("#pane-sheet").hidden = view !== "sheet";
  $("#pane-code").hidden = view !== "code";
  if (view === "sheet") refreshSheet();
  else if (view === "code") void refreshCode();
  else stage.setup(state.fx, false);
}

// ---------------------------------------------------------------------------
// The carousel of effects, filtered by category and search.

const thumbObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const canvas = $("canvas", entry.target);
      if (!canvas || canvas.dataset.rendered) continue;
      canvas.dataset.rendered = "1";
      const fx = LIBRARY.find((item) => item.id === entry.target.dataset.id);
      if (fx) drawThumbnail(canvas, fx);
    }
  },
  { root: $("#carousel-strip"), rootMargin: "160px" },
);

function rebuildCategories() {
  $("#sel-category").replaceChildren(
    option("all", t.allCategories(LIBRARY.length)),
    ...categories.map((c) => option(c.id, `${catName(c.id)} (${LIBRARY.filter((fx) => fx.cat === c.id).length})`)),
  );
  $("#sel-category").value = state.cat;
}

function applyFilter() {
  const query = state.query.trim().toLowerCase();
  state.filtered = LIBRARY.filter((fx) => {
    if (state.cat !== "all" && fx.cat !== state.cat) return false;
    if (!query) return true;
    // Both languages' names match, so an English search works in Chinese and the other way round.
    const words = [fx.id, fx.meta.name, fx.meta.desc, ZH_FX[fx.id]?.[0], ZH_FX[fx.id]?.[1], catName(fx.cat), ...fx.meta.tags];
    return words.join(" ").toLowerCase().includes(query);
  });
  buildCarousel();
}

function buildCarousel() {
  const strip = $("#carousel-strip");
  thumbObserver.disconnect();
  if (!state.filtered.length) {
    strip.replaceChildren(el("div", { className: "extra-empty carousel-empty", textContent: t.noMatches }));
    return;
  }
  strip.replaceChildren(
    ...state.filtered.map((fx) => {
      const card = el("div", { className: "thumb-card", role: "option", tabIndex: 0, title: fx.id }, [
        el("canvas", { className: "thumb-stage" }),
        el("div", { className: "thumb-foot" }, [el("span", { className: "thumb-title", textContent: nameOf(fx) })]),
      ]);
      card.dataset.id = fx.id;
      card.addEventListener("click", () => selectEffect(fx));
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter") selectEffect(fx);
      });
      thumbObserver.observe(card);
      return card;
    }),
  );
  highlightCarousel(true);
}

function highlightCarousel(instant = false) {
  for (const card of $$(".thumb-card", $("#carousel-strip"))) {
    const on = card.dataset.id === state.fx?.id;
    card.classList.toggle("active", on);
    card.setAttribute("aria-selected", String(on));
    if (on) card.scrollIntoView({ behavior: instant ? "instant" : "smooth", inline: "center", block: "nearest" });
  }
}

function step(delta) {
  const list = state.filtered.length ? state.filtered : LIBRARY;
  const index = list.findIndex((fx) => fx.id === state.fx?.id);
  selectEffect(list[index < 0 ? 0 : (index + delta + list.length) % list.length]);
}

// ---------------------------------------------------------------------------
// Export: images the Library takes go there; the rest are project files.

function updateExportButton() {
  const format = $("#sel-export-fmt").value;
  const button = $("#btn-export");
  button.disabled = state.exporting;
  button.textContent = state.exporting ? t.working : LIBRARY_FORMATS.has(format) ? t.addToLibrary : t.saveToProject;
  $("#export-hint").textContent = t.exportHints[format](`${EXPORT_DIR}/`);
  for (const id of ["#btn-sheet-library", "#btn-sheet-project"]) $(id).disabled = state.exporting;
}

async function addToLibrary(blob, name) {
  try {
    await host.library.add(blob, { name, prompt: `pixelfx ${state.fx.id}` });
  } catch (error) {
    if (!state.visible) throw new Error(t.libraryHidden);
    throw error;
  }
}

/** Saves one PNG per frame, then deletes the frames a longer export left in the same folder. */
async function exportFrames(fx, cfg, name, write) {
  const seq = renderExportFrames(fx, state.sheetActor ? cfg : { ...cfg, actorMode: "hide" });
  const n = seq.totalFrames;
  const digits = Math.max(3, String(n - 1).length);
  const folder = `${EXPORT_DIR}/${name}-frames`;
  const canvas = el("canvas", { width: seq.w, height: seq.h });
  const ctx = canvas.getContext("2d");
  const files = [];
  for (let i = 0; i < n; i++) {
    ctx.clearRect(0, 0, seq.w, seq.h);
    ctx.putImageData(new ImageData(seq.frames[i].rgba, seq.w, seq.h), 0, 0);
    const file = `${name}_${String(i).padStart(digits, "0")}.png`;
    await write(`${folder}/${file}`, await canvasToPngBlob(canvas));
    files.push(file);
  }
  const { cols, rows } = sheetLayout(n, seq.w, seq.h);
  await write(`${folder}/${name}_meta.json`, `${JSON.stringify(framesMeta(sheetJson(fx, cfg, seq, cols, rows).meta, files), null, 2)}\n`);
  const kept = new Set(files.map((file) => `${folder}/${file}`));
  const prefix = `${folder}/${name}_`;
  const leftover = (path) => path.startsWith(prefix) && /^\d+\.png$/.test(path.slice(prefix.length)) && !kept.has(path);
  const { entries } = await host.files.list(folder);
  for (const entry of entries) if (entry.kind === "file" && leftover(entry.path)) await host.files.delete(entry.path);
}

async function exportAs(format) {
  if (state.exporting || !state.fx) return;
  const big = tooBig({ contact: format === "contact" });
  if (big) return toast(big, "danger");
  const fx = state.fx;
  const cfg = exportConfig();
  const name = fx.id.split("/")[1];
  state.exporting = true;
  updateExportButton();
  // Lets the button show it is working before the frames are drawn.
  await new Promise((resolve) => setTimeout(resolve, 20));
  const saved = [];
  const write = async (path, contents) => saved.push(await host.files.write(path, contents));
  try {
    if (format === "sheet-both" || format === "sheet-png") {
      const sheet = buildSpriteSheet(fx, cfg, { exportActor: state.sheetActor });
      const png = await canvasToPngBlob(sheet.canvas);
      if (format === "sheet-png") await addToLibrary(png, `${name}.png`);
      else {
        await write(`${EXPORT_DIR}/${name}.png`, png);
        await write(`${EXPORT_DIR}/${name}.json`, `${JSON.stringify(sheet.json, null, 2)}\n`);
      }
    } else if (format === "contact") {
      await addToLibrary(await canvasToPngBlob(buildContactSheetCanvas(fx, cfg)), `${name}-contact.png`);
    } else if (format === "gif") {
      await write(`${EXPORT_DIR}/${name}.gif`, buildGifBlob(fx, cfg));
    } else if (format === "frames") {
      await exportFrames(fx, cfg, name, write);
    }
    // The app announces what reaches the Library itself.
    if (saved.length) toast(t.savedFiles(saved), "success");
  } catch (error) {
    toast(saved.length ? t.exportFailedAfter(errorText(error), saved) : t.exportFailed(errorText(error)), "danger");
  } finally {
    state.exporting = false;
    updateExportButton();
  }
}

// ---------------------------------------------------------------------------
// Controls.

function setTheme(theme) {
  const value = THEMES.includes(theme) ? theme : "amber";
  document.documentElement.dataset.theme = value;
  $("#sel-ui-theme").value = value;
}

$("#sel-ui-theme").addEventListener("change", (event) => {
  setTheme(event.target.value);
  void host.request("storage.set", { key: "theme", value: event.target.value }).catch(() => {});
  if (state.view === "sheet") refreshSheet();
});

$("#sel-category").addEventListener("change", (event) => {
  state.cat = event.target.value;
  applyFilter();
  if (state.filtered.length && !state.filtered.includes(state.fx)) selectEffect(state.filtered[0]);
});

$("#inp-search").addEventListener("input", (event) => {
  state.query = event.target.value;
  applyFilter();
});

for (const tab of $$(".wb-tabs .wb-tab")) tab.addEventListener("click", () => showView(tab.dataset.view));
for (const tab of $$(".code-subtabs .wb-tab")) {
  tab.addEventListener("click", () => {
    state.codeMode = tab.dataset.code;
    void refreshCode();
  });
}

$("#sel-bg").addEventListener("change", (event) => {
  state.cfg.bg = event.target.value;
  stage.setup(state.fx, false);
});

$("#sel-pal").addEventListener("change", (event) => {
  const key = event.target.value;
  state.cfg.paletteKey = key;
  if (!key) state.cfg.palette = null;
  else if (key !== "__custom" && PAL[key]) state.cfg.palette = PAL[key].map(normHex);
  renderSwatches();
  applyChange();
});

$("#stage-viewport").addEventListener("click", () => {
  setPlaying(true);
  stage.restart();
});
$("#btn-play").addEventListener("click", () => setPlaying(!state.playing));
$("#btn-replay").addEventListener("click", () => {
  setPlaying(true);
  stage.restart();
});
$("#sel-speed").value = "1";
$("#sel-speed").addEventListener("change", (event) => {
  state.speed = Number(event.target.value) || 1;
});
$("#scrub-range").addEventListener("input", (event) => {
  setPlaying(false);
  stage.seekFrame(Number(event.target.value));
});

$("#inp-seed").addEventListener("change", (event) => {
  const seed = Math.round(Number(event.target.value));
  state.cfg.seed = Number.isFinite(seed) ? seed : 1;
  event.target.value = state.cfg.seed;
  applyChange(true);
});
$("#btn-rand-seed").addEventListener("click", () => {
  state.cfg.seed = 1 + Math.floor(Math.random() * 999);
  $("#inp-seed").value = state.cfg.seed;
  applyChange(true);
});
$("#inp-fps").addEventListener("change", (event) => {
  state.cfg.fps = Math.max(1, Math.min(120, Number(event.target.value) || state.fx.meta.fps));
  event.target.value = state.cfg.fps;
  applyChange();
});
$("#inp-duration").addEventListener("change", (event) => {
  state.cfg.duration = Math.max(0.05, Math.min(60, Number(event.target.value) || state.fx.meta.duration));
  event.target.value = state.cfg.duration;
  updateDurationScale();
  applyChange();
});

function setSize(axis, raw) {
  const [w0, h0] = state.fx.meta.size;
  const cfg = state.cfg;
  const clamp = (value, fallback) => Math.max(16, Math.min(1024, Math.round(Number(value) || fallback)));
  if (axis === "w") {
    cfg.canvasW = clamp(raw, w0);
    if (cfg.lockAspect) cfg.canvasH = clamp((cfg.canvasW * h0) / w0, h0);
  } else {
    cfg.canvasH = clamp(raw, h0);
    if (cfg.lockAspect) cfg.canvasW = clamp((cfg.canvasH * w0) / h0, w0);
  }
  $("#inp-w").value = cfg.canvasW;
  $("#inp-h").value = cfg.canvasH;
  applyChange();
}
$("#inp-w").addEventListener("change", (event) => setSize("w", event.target.value));
$("#inp-h").addEventListener("change", (event) => setSize("h", event.target.value));

$("#tog-aspect").addEventListener("click", () => {
  state.cfg.lockAspect = !state.cfg.lockAspect;
  $("#tog-aspect").setAttribute("aria-pressed", String(state.cfg.lockAspect));
  if (state.cfg.lockAspect) setSize("w", state.cfg.canvasW);
});
$("#tog-scale-canvas").addEventListener("click", () => {
  state.cfg.scaleWithCanvas = !state.cfg.scaleWithCanvas;
  $("#tog-scale-canvas").setAttribute("aria-pressed", String(state.cfg.scaleWithCanvas));
  applyChange();
});
$("#tog-flip").addEventListener("click", () => {
  state.cfg.flip = !state.cfg.flip;
  $("#tog-flip").setAttribute("aria-pressed", String(state.cfg.flip));
  applyChange();
});
$("#sel-actor").addEventListener("change", (event) => {
  state.cfg.actorMode = event.target.value;
  applyChange(true);
});
$("#btn-reset").addEventListener("click", () => {
  state.cfg = defaultConfig(state.fx);
  syncInspector();
  buildExtraOptions();
  stage.setup(state.fx, true);
  if (state.view === "sheet") refreshSheet();
  if (state.view === "code") void refreshCode();
  toast(t.resetDone);
});

$("#sel-sheet-zoom").addEventListener("change", (event) => {
  state.sheetZoom = event.target.value;
  applySheetZoom();
});
$("#tog-sheet-grid").addEventListener("click", () => {
  state.sheetGrid = !state.sheetGrid;
  $("#tog-sheet-grid").setAttribute("aria-pressed", String(state.sheetGrid));
  refreshSheet();
});
$("#tog-sheet-actor").addEventListener("click", () => {
  state.sheetActor = !state.sheetActor;
  $("#tog-sheet-actor").setAttribute("aria-pressed", String(state.sheetActor));
  refreshSheet();
});
$("#btn-sheet-library").addEventListener("click", () => void exportAs("sheet-png"));
$("#btn-sheet-project").addEventListener("click", () => void exportAs("sheet-both"));

$("#sel-export-fmt").addEventListener("change", updateExportButton);
$("#btn-export").addEventListener("click", () => void exportAs($("#sel-export-fmt").value));
$("#btn-prev").addEventListener("click", () => step(-1));
$("#btn-next").addEventListener("click", () => step(1));

window.addEventListener("keydown", (event) => {
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.code === "Space" && tag !== "BUTTON") {
    event.preventDefault();
    setPlaying(!state.playing);
  } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    const delta = event.key === "ArrowLeft" ? -1 : 1;
    if (event.shiftKey) {
      setPlaying(false);
      stage.seekFrame(stage.frameIdx + delta);
    } else step(delta);
  }
});

let resizeTimer;
new ResizeObserver(() => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (state.view === "live" && state.fx) stage.setup(state.fx, false);
    else if (state.view === "sheet") applySheetZoom();
  }, 100);
}).observe($("#stage-viewport").parentElement);

host.on("visibility", ({ visible }) => {
  state.visible = visible;
});

/** Opens the effect a command or another page asks for, as `{ effect: "fire/torch" }`. */
function openState(value) {
  const id = value && typeof value === "object" ? value.effect : undefined;
  const fx = typeof id === "string" ? LIBRARY.find((item) => item.id === id) : undefined;
  if (!fx) return false;
  if (!state.filtered.includes(fx)) {
    state.cat = "all";
    state.query = "";
    $("#sel-category").value = "all";
    $("#inp-search").value = "";
    applyFilter();
  }
  selectEffect(fx);
  return true;
}
host.on("open", ({ state: value }) => void openState(value));

// ---------------------------------------------------------------------------
// Start.

const [theme, lastEffect] = await Promise.all([
  host.request("storage.get", { key: "theme" }).catch(() => undefined),
  host.request("storage.get", { key: "effect" }).catch(() => undefined),
]);
setTheme(theme);
rebuildCategories();
applyFilter();
showView("live");
updateExportButton();
// An `open` heard while the panel was starting has already chosen the effect.
if (!openState(host.opened) && !state.fx) selectEffect(LIBRARY.find((fx) => fx.id === lastEffect) ?? LIBRARY.find((fx) => fx.id === "water/geyser") ?? LIBRARY[0]);

let lastTick = performance.now();
function loop(now) {
  const dt = Math.min(0.1, (now - lastTick) / 1000);
  lastTick = now;
  if (state.view === "live" && state.visible) stage.tick(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
