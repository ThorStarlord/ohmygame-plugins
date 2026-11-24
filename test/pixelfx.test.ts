import assert from "node:assert/strict";
import { describe, it } from "node:test";
// @ts-expect-error The panel is plain JavaScript.
import { effects } from "../plugins/pixelfx/panel/lib/fx/index.js";
// @ts-expect-error The panel is plain JavaScript.
import { buildGifBlob, renderExportFrames, sheetLayout } from "../plugins/pixelfx/panel/export.js";
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
