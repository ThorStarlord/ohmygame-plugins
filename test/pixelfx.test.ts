import assert from "node:assert/strict";
import { describe, it } from "node:test";
// @ts-expect-error The panel is plain JavaScript.
import { effects } from "../plugins/pixelfx/panel/lib/fx/index.js";
// @ts-expect-error The panel is plain JavaScript.
import { buildGifBlob, exportBudget, framesMeta, gifDelays, renderExportFrames, sheetLayout } from "../plugins/pixelfx/panel/export.js";
// @ts-expect-error The panel is plain JavaScript.
import { actFrameStep, actLength, actStepper, flippedActBounds, flippedOrigin } from "../plugins/pixelfx/panel/timing.js";
// @ts-expect-error The panel is plain JavaScript.
import { actBounds, createAct } from "../plugins/pixelfx/panel/lib/core/index.js";
// @ts-expect-error The panel is plain JavaScript.
import { defaultConfig, effectOptions, fullMeta, isScreenFx, optionControl } from "../plugins/pixelfx/panel/options.js";
// @ts-expect-error The panel is plain JavaScript.
import { StageRunner } from "../plugins/pixelfx/panel/stage.js";
// @ts-expect-error The panel is plain JavaScript.
import { TEXT } from "../plugins/pixelfx/panel/i18n.js";

// The Pixel Effects panel's parts that need no page: what the inspector
// offers for an effect's options, the sheet layout, export rendering and the
// GIF encoder, over every built-in effect pixelfx ships.

type Effect = { id: string; mod: { meta: any; act?: unknown }; meta: any };
const LIBRARY: Effect[] = Object.entries(effects as Record<string, any>).map(([id, mod]) => {
  const meta = fullMeta(mod.meta);
  return { id, mod: { ...mod, meta }, meta };
});
const byId = (id: string) => LIBRARY.find((fx) => fx.id === id)!;

describe("pixelfx options", () => {
  it("offers a control for each kind of default", () => {
    assert.deepEqual(optionControl(12), { kind: "number", step: 1, min: 0, max: 36 });
    assert.deepEqual(optionControl(0.4), { kind: "number", step: 0.02, min: 0, max: 2 });
    assert.deepEqual(optionControl(-3), { kind: "number", step: 1, min: -6, max: 12 });
    assert.equal(optionControl(true)?.kind, "toggle");
    assert.equal(optionControl("#ff8800")?.kind, "color");
    assert.equal(optionControl([0xff0000, "#00ff00"])?.kind, "ramp");
    assert.equal(optionControl("spiral")?.kind, "text");
    assert.equal(optionControl([4, -8])?.kind, "point");
    assert.equal(optionControl({ a: 1 }), undefined);
    assert.equal(optionControl([1, 2, 3]), undefined);
  });

  it("lists an effect's own options without palette and seed", () => {
    const options = effectOptions({ options: { palette: [0xff0000, 0x00ff00], seed: 3, radius: 18, glow: true, shape: { a: 1 } } });
    assert.deepEqual(
      options.map((option: { key: string }) => option.key),
      ["radius", "glow"],
    );
  });

  it("starts from the effect's own settings", () => {
    const fx = LIBRARY.find((item) => !isScreenFx(item.meta) && !item.mod.act && !item.meta.actor && item.meta.bg !== "sky")!;
    const cfg = defaultConfig(fx);
    assert.equal(cfg.bg, "topstone");
    assert.equal(cfg.actorMode, "hide");
    assert.deepEqual([cfg.canvasW, cfg.canvasH, cfg.fps, cfg.duration], [fx.meta.size[0], fx.meta.size[1], fx.meta.fps, fx.meta.duration]);
    const moves = LIBRARY.find((item) => item.mod.act)!;
    assert.equal(defaultConfig(moves).actorMode, "full");
  });
});

describe("pixelfx export", () => {
  it("lays sheets out about square", () => {
    assert.deepEqual(sheetLayout(1, 64, 64), { cols: 1, rows: 1 });
    assert.deepEqual(sheetLayout(16, 64, 64), { cols: 4, rows: 4 });
    assert.deepEqual(sheetLayout(10, 64, 64), { cols: 4, rows: 3 });
    assert.deepEqual(sheetLayout(9, 128, 32), { cols: 2, rows: 5 });
  });

  it("renders every built-in effect", () => {
    assert.ok(LIBRARY.length >= 244, `${LIBRARY.length} effects`);
    const drawn = (rgba: Uint8ClampedArray) => {
      for (let i = 3; i < rgba.length; i += 4) if (rgba[i]) return true;
      return false;
    };
    for (const fx of LIBRARY) {
      // Its own settings at a few frames a second, which keeps the test quick.
      const seq = renderExportFrames(fx, { ...defaultConfig(fx), fps: 4 });
      assert.equal(seq.frames.length, seq.totalFrames, fx.id);
      assert.equal(seq.frames[0].rgba.length, seq.w * seq.h * 4, fx.id);
      assert.ok(seq.frames.some((frame: { rgba: Uint8ClampedArray }) => drawn(frame.rgba)), `${fx.id} draws nothing`);
    }
  });

  it("scales to a chosen size and frame rate", () => {
    const fx = byId("fire/campfire");
    const cfg = { ...defaultConfig(fx), canvasW: 40, canvasH: 50, fps: 6, duration: 0.5 };
    const seq = renderExportFrames(fx, cfg);
    assert.deepEqual([seq.w, seq.h, seq.fps], [40, 50, 6]);
    assert.equal(seq.totalFrames, fx.meta.loop ? 3 : 4);
  });

  it("encodes a GIF", async () => {
    const fx = LIBRARY.find((item) => !item.mod.act)!;
    const blob = buildGifBlob(fx, { ...defaultConfig(fx), fps: 8, duration: 0.25 });
    assert.equal(blob.type, "image/gif");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    assert.equal(new TextDecoder().decode(bytes.slice(0, 6)), "GIF89a");
    assert.equal(bytes.at(-1), 0x3b);
  });
});

describe("pixelfx limits and timing", () => {
  it("refuses exports too big to hold or draw", () => {
    const fx = byId("fire/campfire");
    assert.equal(exportBudget(fx, defaultConfig(fx)).ok, true);
    const huge = { ...defaultConfig(fx), canvasW: 1024, canvasH: 1024, fps: 120, duration: 60 };
    assert.deepEqual(exportBudget(fx, huge), { ok: false, frames: 7200, w: 1024, h: 1024 });
    // Small frames fit in memory and in a sheet, but a contact sheet of 7,200 of them is taller than a canvas can be.
    const many = { ...defaultConfig(fx), canvasW: 16, canvasH: 16, fps: 120, duration: 60 };
    assert.equal(exportBudget(fx, many).ok, true);
    assert.equal(exportBudget(fx, many, { contact: true }).ok, false);
  });

  it("gives GIF frames delays that add up to the length", () => {
    for (const [n, fps] of [[31, 30], [13, 12], [25, 24], [50, 50], [7, 7.5]]) {
      const delays = gifDelays(n, fps);
      assert.equal(delays.length, n);
      assert.equal(delays.reduce((a: number, b: number) => a + b, 0), Math.round((n * 100) / fps), `${n} at ${fps}`);
      assert.ok(delays.every((d: number) => d >= 2));
    }
  });

  it("draws GIFs faster than 50 fps at 50 fps", async () => {
    const fx = byId("fire/campfire");
    const bytes = new Uint8Array(await buildGifBlob(fx, { ...defaultConfig(fx), fps: 100, duration: 0.5 }).arrayBuffer());
    // Each frame starts with a graphic control extension, 21 F9 04.
    let frames = 0;
    for (let i = 0; i + 2 < bytes.length; i++) if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 0x04) frames++;
    assert.equal(frames, 25);
  });

  it("plays an act to its last pose, hit-stops included", () => {
    const fx = byId("moves/sword-combo");
    const { end, seconds, from } = actLength(fx.mod);
    assert.ok(seconds > end - from, "sword combo has hit-stops");
    for (const frames of [12, 31, 90]) {
      const act = createAct(fx.mod, { x: 100, y: 100 });
      const step = actStepper(act, fx.mod);
      const dt = actFrameStep(fx.mod, frames);
      for (let i = 1; i < frames; i++) step(dt);
      assert.ok(Math.abs(act.t - end) < 1e-6, `${frames} frames end at ${act.t}, not ${end}`);
    }
  });

  it("mirrors a flipped act's box and an effect's origin", () => {
    const fx = byId("moves/sword-combo");
    const b = actBounds(fx.mod);
    assert.deepEqual(flippedActBounds(fx.mod, true), { ...b, x0: -b.x1, x1: -b.x0 });
    assert.deepEqual(flippedOrigin({ size: [128, 96], origin: [40, 80] }, true), [88, 80]);
    assert.deepEqual(flippedOrigin({ size: [128, 96], origin: [40, 80] }, false), [40, 80]);
  });

  it("keeps a flipped export as whole as the unflipped one", () => {
    const opaque = (seq: { frames: { rgba: Uint8ClampedArray }[] }) => {
      let n = 0;
      for (const frame of seq.frames) for (let i = 3; i < frame.rgba.length; i += 4) if (frame.rgba[i]) n++;
      return n;
    };
    for (const id of ["moves/sword-combo", "moves/arrow-shot", "fire/fire-breath"]) {
      const fx = byId(id);
      const cfg = { ...defaultConfig(fx), fps: 6 };
      const plain = opaque(renderExportFrames(fx, cfg));
      const flipped = opaque(renderExportFrames(fx, { ...cfg, flip: true }));
      assert.ok(Math.abs(flipped - plain) / plain < 0.03, `${id}: ${flipped} pixels flipped, ${plain} not`);
    }
  });

  it("describes frames saved one by one without the sheet's layout", () => {
    const meta = { app: "x", image: "a.png", size: { w: 1, h: 1 }, frameTags: [], pixelfx: { id: "a/b", fps: 12, columns: 4, rows: 3, frames: 2 } };
    assert.deepEqual(framesMeta(meta, ["b_000.png", "b_001.png"]), {
      app: "x",
      frameTags: [],
      pixelfx: { id: "a/b", fps: 12, frames: 2 },
      files: ["b_000.png", "b_001.png"],
    });
  });
});

describe("pixelfx stage", () => {
  /** A canvas that keeps the last image put on it. */
  const fakeCanvas = () => {
    const canvas = {
      width: 0,
      height: 0,
      last: undefined as { data: Uint8ClampedArray } | undefined,
      getContext: () => ({
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
        putImageData: (image: { data: Uint8ClampedArray }) => {
          canvas.last = image;
        },
        fillRect() {},
      }),
    };
    return canvas;
  };
  const viewport = { getBoundingClientRect: () => ({ width: 800, height: 450 }) };

  it("keeps playing below 4 fps", () => {
    const fx = byId("fire/campfire");
    const state = { cfg: { ...defaultConfig(fx), fps: 2 }, playing: true, speed: 1 };
    const stage = new StageRunner(fakeCanvas(), viewport, state, { onFrame() {}, onError() {} });
    stage.setup(fx);
    for (let i = 0; i < 12; i++) stage.tick(0.1);
    assert.equal(stage.frameIdx, 2);
  });

  it("ends an act on its last pose and reports a broken setup", () => {
    const fx = byId("moves/sword-combo");
    const state = { cfg: defaultConfig(fx), playing: true, speed: 1 };
    const errors: unknown[] = [];
    const stage = new StageRunner(fakeCanvas(), viewport, state, { onFrame() {}, onError: (error: unknown) => error && errors.push(error) });
    stage.setup(fx);
    stage.seekFrame(stage.totalFrames - 1);
    assert.ok(Math.abs(stage.inst.t - actLength(fx.mod).end) < 1e-6);
    const broken = { ...fx, mod: { ...fx.mod, act: { poses: "not poses" } } };
    stage.setup(broken);
    assert.equal(errors.length, 1);
  });

  it("plays every built-in effect, and some scaled or flipped", () => {
    for (const [index, fx] of LIBRARY.entries()) {
      // Every effect as it comes, with its act or actor if it has one; every
      // eighth also drawn at twice its size, and flipped without its actor.
      const changes = index % 8 ? [{}] : [{}, { canvasW: fx.meta.size[0] * 2, canvasH: fx.meta.size[1] * 2 }, { actorMode: "hide", flip: true }];
      for (const change of changes) {
        const errors: unknown[] = [];
        const canvas = fakeCanvas();
        const state = { cfg: { ...defaultConfig(fx), fps: 4, ...change }, playing: true, speed: 1 };
        const stage = new StageRunner(canvas, viewport, state, { onFrame() {}, onError: (error: unknown) => error && errors.push(error) });
        stage.setup(fx);
        for (let i = 0; i < 6; i++) stage.tick(0.3);
        stage.seekFrame(stage.totalFrames - 1);
        assert.deepEqual(errors, [], `${fx.id} ${JSON.stringify(change)}`);
        assert.equal(canvas.last?.data.length, canvas.width * canvas.height * 4, fx.id);
        assert.ok(stage.frameIdx === stage.totalFrames - 1, fx.id);
      }
    }
  });
});

describe("pixelfx text", () => {
  it("has the same text in English and Chinese", () => {
    const shape = (value: unknown): unknown =>
      value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shape(item)])) : typeof value;
    const { backdrops: _en, ...en } = TEXT.en;
    const { backdrops: _zh, ...zh } = TEXT["zh-CN"];
    assert.deepEqual(shape(zh), shape(en));
  });
});
