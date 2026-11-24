// Rendering and export for the panel, from pixelfx's gallery/export-utils.js
// (MIT, see lib/LICENSE): the top-down brick and checker backdrops,
// resampling to a chosen size, frame rate and length, the transparent sprite
// sheet with Aseprite-style JSON, the contact sheet and the GIF89a encoder.
// Downloads and the ZIP writer are left out: the panel adds to the Library
// or writes project files instead.

import {
  createFrame,
  clearFrame,
  createFx,
  createAct,
  actBounds,
  actTiming,
  composite,
  backdrop,
  drawActor,
  painterFor,
  stockActor,
  actorAlphaOf,
  rgb,
  rand,
} from "./lib/core/index.js";

/**
 * 生成俯视像素石砖地板（对应截图中的「俯视石砖」背景）
 */
export function topDownBricks(w, h) {
  const out = new Uint32Array(w * h);
  const BW = 16, BH = 6;
  const cx = w * 0.5, cy = h * 0.52;
  const maxD = Math.hypot(cx, cy) || 1;

  for (let y = 0; y < h; y++) {
    const row = (y / BH) | 0;
    const ly = y % BH;
    const off = (row & 1) ? (BW >> 1) : 0;
    for (let x = 0; x < w; x++) {
      const bx = x + off;
      const col = (bx / BW) | 0;
      const lx = bx % BW;

      // 砖缝砂浆线（底边 + 右边，偶发微缺口增加像素手工感）
      const seamH = ly === BH - 1;
      const seamV = lx === BW - 1;
      const vr = rand(col * 3 + 7, row * 5 + 11, 31);
      const pxr = rand(x, y, 73);

      // 轻微暗角聚光，突出中心特效高光
      const vig = 1 - 0.22 * Math.pow(Math.hypot(x - cx, y - cy) / maxD, 1.55);

      let r = 39, g = 36, b = 59; // 主体紫灰石砖基色 #27243b
      if (seamH || seamV) {
        r = 25; g = 23; b = 38; // 深色砖缝 #191726
        if (pxr > 0.92) { r += 4; g += 4; b += 6; }
      } else {
        // 每块石砖独立明暗与冷暖微差
        const delta = (vr - 0.5) * 11;
        r += delta * 0.85;
        g += delta * 0.82;
        b += delta * 1.1;

        // 顶部受光倒角 & 底部背光边
        if (ly === 0) {
          r += 7; g += 7; b += 10;
          if (lx === 0) { r += 3; g += 3; b += 4; }
        } else if (ly === BH - 2) {
          r -= 4; g -= 4; b -= 6;
        }
        if (lx === 0 && ly < BH - 2) {
          r += 3; g += 3; b += 5;
        }

        // 稀疏石面纹理颗粒与风化小裂点
        if (pxr > 0.965) {
          r -= 6; g -= 6; b -= 8;
        } else if (pxr < 0.025) {
          r += 5; g += 5; b += 7;
        }

        // 极少量地面碎石细节（类似截图石砖上的零星石屑）
        const detail = rand(col, row, 199);
        if (detail > 0.986 && ly >= 1 && ly <= 3 && lx >= 4 && lx <= 9) {
          if ((lx + ly) & 1) { r = 68; g = 65; b = 88; }
          else { r = 28; g = 26; b = 42; }
        }
      }

      out[y * w + x] = rgb(
        Math.max(0, Math.min(255, Math.round(r * vig))),
        Math.max(0, Math.min(255, Math.round(g * vig))),
        Math.max(0, Math.min(255, Math.round(b * vig))),
      );
    }
  }
  return out;
}

/**
 * 像素棋盘格背景（用于透明背景实时舞台预览）
 */
export function checkerBackdrop(w, h, cell = 6) {
  const out = new Uint32Array(w * h);
  const c0 = rgb(22, 20, 32);
  const c1 = rgb(33, 30, 47);
  for (let y = 0; y < h; y++) {
    const ry = (y / cell) | 0;
    for (let x = 0; x < w; x++) {
      out[y * w + x] = ((ry + ((x / cell) | 0)) & 1) ? c1 : c0;
    }
  }
  return out;
}

/**
 * 统一生成指定背景缓冲区
 */
export function buildBackdropBuffer(kind, w, h, groundY = h) {
  if (kind === "none") return null;
  if (kind === "topstone") return topDownBricks(w, h);
  if (kind === "checker") return checkerBackdrop(w, h, 6);
  return backdrop(kind, w, h, groundY);
}

/**
 * 最近邻重采样 RGBA 像素数组
 */
export function resampleNearestRGBA(src, sw, sh, dw, dh) {
  if (sw === dw && sh === dh) return src;
  const out = new Uint8ClampedArray(dw * dh * 4);
  const s32 = new Uint32Array(src.buffer, src.byteOffset, sw * sh);
  const d32 = new Uint32Array(out.buffer);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / dh));
    const rowOff = sy * sw;
    const dstOff = y * dw;
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor((x * sw) / dw));
      d32[dstOff + x] = s32[rowOff + sx];
    }
  }
  return out;
}

/**
 * 边缘柔化光效，避免透明图集切边硬框
 */
function edgeFadeLight(f, E = 6) {
  const { w, h, light: L } = f;
  if (w < 24 || h < 24) return;
  for (let y = 0; y < h; y++) {
    const ey = Math.min(y, h - 1 - y);
    for (let x = 0; x < w; x++) {
      const e = Math.min(ey, x, w - 1 - x);
      if (e >= E) {
        x = w - 1 - E;
        continue;
      }
      const i = y * w + x;
      const l = L[i];
      if (!(l & 0xffffff)) continue;
      const u = (e + 0.5) / E;
      const k = u * u * (3 - 2 * u);
      L[i] =
        (l & 0xff000000) |
        Math.round((l & 255) * k) |
        (Math.round(((l >>> 8) & 255) * k) << 8) |
        (Math.round(((l >>> 16) & 255) * k) << 16);
    }
  }
}

/**
 * 渲染当前参数下的完整帧序列（用于透明图集预览、导出 PNG+JSON、导出 GIF、单帧序列）
 */
export function renderExportFrames(fx, cfg, { includeBg = false } = {}) {
  const m = fx.meta;
  const [origW, origH] = m.size;
  const [origOX, origOY] = m.origin;

  const targetW = Math.max(16, Math.round(cfg.canvasW || origW));
  const targetH = Math.max(16, Math.round(cfg.canvasH || origH));
  const fps = Math.max(1, +(cfg.fps || m.fps));
  const duration = Math.max(0.05, +(cfg.duration || m.duration));
  const totalFrames = Math.max(1, Math.round(duration * fps) + (m.loop ? 0 : 1));
  const isScreen = origW >= 320 && Math.abs(origW / origH - 16 / 9) < 0.05;

  // 若开启「动画随画布缩放」，先按原始像素尺寸渲染，再最近邻重采样至目标画布尺寸；
  // 若关闭，则直接在目标尺寸画布中居中偏移原点渲染
  const useResample = !!cfg.scaleWithCanvas && (targetW !== origW || targetH !== origH);
  let simW = useResample ? origW : targetW;
  let simH = useResample ? origH : targetH;
  let ox = useResample ? origOX : Math.round(origOX + (targetW - origW) / 2);
  let oy = useResample ? origOY : Math.round(origOY + (targetH - origH) / 2);

  const actorMode = cfg.actorMode || "hide";
  const wantAct = !!fx.mod.act && actorMode !== "hide";

  if (wantAct && useResample) {
    const b = actBounds(fx.mod);
    const pad = 6;
    simW = b.x1 - b.x0 + pad * 2;
    simH = b.y1 - b.y0 + pad * 2;
    ox = pad - b.x0;
    oy = pad - b.y0;
  } else if (wantAct && !useResample) {
    const b = actBounds(fx.mod);
    const pad = 6;
    const bw = b.x1 - b.x0 + pad * 2;
    const bh = b.y1 - b.y0 + pad * 2;
    ox = Math.round(pad - b.x0 + (targetW - bw) / 2);
    oy = Math.round(pad - b.y0 + (targetH - bh) / 2);
  }

  const frame = createFrame(simW, simH);
  const bgBuf = includeBg ? buildBackdropBuffer(cfg.bg, simW, simH, oy) : null;

  const fxOpts = {
    ...cfg.extraOpts,
    ...(cfg.palette ? { palette: cfg.palette } : {}),
    ...(cfg.seed !== undefined ? { seed: cfg.seed } : {}),
    x: ox,
    y: oy,
    flip: !!cfg.flip,
  };

  const frames = [];
  if (wantAct) {
    const act = createAct(fx.mod, fxOpts);
    const spanFrom = act.t;
    const spanTo = m.loop ? m.duration : Math.max(m.duration, ...(fx.mod.act.poses?.map((k) => k[0]) ?? [m.duration]));
    const simTotal = Math.max(0.05, spanTo - spanFrom);
    const dtSim = totalFrames > 1 ? simTotal / (m.loop ? totalFrames : totalFrames - 1) : 0;

    for (let i = 0; i < totalFrames; i++) {
      if (i > 0) act.update(dtSim);
      clearFrame(frame);
      act.draw(frame, {
        body: actorMode === "full" || actorMode === "body",
        target: actorMode === "full" || actorMode === "target",
      });
      if (!isScreen && !includeBg) edgeFadeLight(frame);
      let rgba = composite(frame, new Uint8ClampedArray(simW * simH * 4), bgBuf);
      if (useResample && (simW !== targetW || simH !== targetH)) {
        rgba = resampleNearestRGBA(rgba, simW, simH, targetW, targetH);
      }
      frames.push({ index: i, t: +(i / fps).toFixed(4), rgba });
    }
  } else {
    const inst = createFx(fx.mod, fxOpts);
    const dtSim = (1 / fps) * (m.duration / duration);
    const showStandActor = m.actor && actorMode !== "hide";

    for (let i = 0; i < totalFrames; i++) {
      if (i > 0) inst.update(dtSim);
      clearFrame(frame);
      if (showStandActor) {
        inst.draw(frame, "back");
        const tt = m.loop ? inst.t % m.duration : Math.min(inst.t, m.duration);
        drawActor(
          painterFor(frame).place(ox, oy, !!cfg.flip),
          inst.options.actor ?? stockActor(),
          actorAlphaOf(fx.mod, tt, inst.options),
        );
        inst.draw(frame, "front");
      } else {
        inst.draw(frame);
      }
      if (!isScreen && !includeBg) edgeFadeLight(frame);
      let rgba = composite(frame, new Uint8ClampedArray(simW * simH * 4), bgBuf);
      if (useResample) {
        rgba = resampleNearestRGBA(rgba, simW, simH, targetW, targetH);
      }
      frames.push({ index: i, t: +(i / fps).toFixed(4), rgba });
    }
  }

  const pivotX = useResample ? Math.round((ox * targetW) / simW) : ox;
  const pivotY = useResample ? Math.round((oy * targetH) / simH) : oy;

  return {
    w: targetW,
    h: targetH,
    fps,
    duration,
    loop: !!m.loop,
    totalFrames,
    pivot: [pivotX, pivotY],
    frames,
  };
}

/** Columns and rows for `n` frames of `w`×`h`, so the sheet comes out about square. */
export function sheetLayout(n, w, h) {
  const cols = Math.min(n, Math.max(1, Math.ceil(Math.sqrt((n * h) / w))));
  return { cols, rows: Math.ceil(n / cols) };
}

/**
 * 构建透明图集 Canvas 与 Aseprite 兼容 JSON 数据
 */
export function buildSpriteSheet(fx, cfg, { exportActor = false } = {}) {
  const seqCfg = exportActor ? cfg : { ...cfg, actorMode: "hide" };
  const seq = renderExportFrames(fx, seqCfg, { includeBg: false });
  const { w, h, fps, loop, totalFrames: n, pivot, frames } = seq;
  const { cols, rows } = sheetLayout(n, w, h);

  const cv = document.createElement("canvas");
  cv.width = cols * w;
  cv.height = rows * h;
  const ctx = cv.getContext("2d");

  const shortName = fx.id.split("/")[1];
  const frameEntries = [];

  for (let i = 0; i < n; i++) {
    const x = (i % cols) * w;
    const y = Math.floor(i / cols) * h;
    const imgData = new ImageData(frames[i].rgba, w, h);
    ctx.putImageData(imgData, x, y);
    frameEntries.push({
      filename: `${shortName} ${i}`,
      frame: { x, y, w, h },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w, h },
      sourceSize: { w, h },
      duration: Math.max(1, Math.round(1000 / fps)),
    });
  }

  const json = {
    frames: frameEntries,
    meta: {
      app: "https://github.com/patch-gg/pixelfx",
      version: "1",
      image: `${shortName}.png`,
      format: "RGBA8888",
      size: { w: cols * w, h: rows * h },
      scale: "1",
      frameTags: [{ name: shortName, from: 0, to: n - 1, direction: "forward" }],
      pixelfx: {
        id: fx.id,
        name: cfg.displayName || fx.meta.name,
        fps,
        duration: +seq.duration.toFixed(4),
        loop,
        frames: n,
        frameSize: [w, h],
        pivot,
        columns: cols,
        rows,
        seed: cfg.seed,
        flip: !!cfg.flip,
        ...(fx.mod.act ? { act: actTiming(fx.mod) } : {}),
      },
    },
  };

  return { canvas: cv, json, cols, rows, w, h, n, fps, loop, shortName, seq };
}

/**
 * 构建带帧号与时间戳的分帧预览联系表 Canvas
 */
export function buildContactSheetCanvas(fx, cfg) {
  const seq = renderExportFrames(fx, cfg, { includeBg: true });
  const { w, h, frames, fps, totalFrames: n } = seq;
  const scale = Math.max(1, Math.min(4, Math.floor(260 / Math.max(w, h))));
  const cw = w * scale;
  const ch = h * scale;
  const cols = Math.min(n, Math.max(1, Math.min(6, Math.ceil(Math.sqrt(n)))));
  const rows = Math.ceil(n / cols);
  const pad = 12;
  const labelH = 20;
  const headH = 40;

  const cv = document.createElement("canvas");
  cv.width = pad + cols * (cw + pad);
  cv.height = headH + rows * (ch + labelH + pad) + pad;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#111019";
  ctx.fillRect(0, 0, cv.width, cv.height);

  ctx.fillStyle = "#e8e4f5";
  ctx.font = "600 14px system-ui, 'Microsoft YaHei', sans-serif";
  ctx.fillText(
    `${cfg.displayName || fx.meta.name} (${fx.id}) · ${w}×${h}px · ${n} frames @ ${fps}fps`,
    pad,
    25,
  );

  const tmp = document.createElement("canvas");
  tmp.width = w;
  tmp.height = h;
  const tctx = tmp.getContext("2d");

  ctx.imageSmoothingEnabled = false;
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = pad + col * (cw + pad);
    const y = headH + row * (ch + labelH + pad);

    ctx.fillStyle = "#9d96b8";
    ctx.font = "12px ui-monospace, Consolas, monospace";
    ctx.fillText(`#${i + 1} · ${frames[i].t.toFixed(2)}s`, x, y + 14);

    tctx.putImageData(new ImageData(frames[i].rgba, w, h), 0, 0);
    ctx.strokeStyle = "#2d2942";
    ctx.strokeRect(x - 0.5, y + labelH - 0.5, cw + 1, ch + 1);
    ctx.drawImage(tmp, 0, 0, w, h, x, y + labelH, cw, ch);
  }
  return cv;
}

/** A canvas as a PNG Blob; rejects when the canvas can't be encoded, such as when it is too big. */
export function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(`can't encode a ${canvas.width}×${canvas.height} PNG`))), "image/png");
  });
}

function quantizeFrame(rgba, pixelCount, transparent) {
  // 统计 15-bit 颜色频次，为像素艺术保留高饱和精确颜色
  const counts = new Map();
  for (let i = 0; i < pixelCount; i++) {
    const a = rgba[i * 4 + 3];
    if (transparent && a < 96) continue;
    const r = rgba[i * 4] >> 3;
    const g = rgba[i * 4 + 1] >> 3;
    const b = rgba[i * 4 + 2] >> 3;
    const key = (r << 10) | (g << 5) | b;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const maxColors = transparent ? 255 : 256;
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const pal = [];
  // 若颜色数超过 255，按多样性贪心采样 + 高频优先结合
  for (const [key] of sorted) {
    if (pal.length >= maxColors) break;
    const r = ((key >> 10) & 31) * 8 + 4;
    const g = ((key >> 5) & 31) * 8 + 4;
    const b = (key & 31) * 8 + 4;
    pal.push([r, g, b]);
  }
  while (pal.length < 256) pal.push([0, 0, 0]);
  const transIdx = transparent ? 255 : -1;
  if (transparent) pal[255] = [0, 0, 0];

  const lut = new Map();
  const indexed = new Uint8Array(pixelCount);
  const limit = transparent ? 255 : 256;

  for (let i = 0; i < pixelCount; i++) {
    const a = rgba[i * 4 + 3];
    if (transparent && a < 96) {
      indexed[i] = transIdx;
      continue;
    }
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const k15 = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let best = lut.get(k15);
    if (best === undefined) {
      best = 0;
      let bestDist = Infinity;
      for (let p = 0; p < limit; p++) {
        const dr = r - pal[p][0];
        const dg = g - pal[p][1];
        const db = b - pal[p][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestDist) {
          bestDist = d;
          best = p;
          if (d === 0) break;
        }
      }
      lut.set(k15, best);
    }
    indexed[i] = best;
  }

  const flatPal = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    flatPal[i * 3] = pal[i][0];
    flatPal[i * 3 + 1] = pal[i][1];
    flatPal[i * 3 + 2] = pal[i][2];
  }
  return { flatPal, indexed, transIdx };
}

function lzwEncode(indexed, minCodeSize = 8) {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  const out = [minCodeSize];

  let sub = new Uint8Array(255);
  let subLen = 0;
  let bitBuf = 0;
  let bitCount = 0;

  const flushSub = () => {
    if (subLen > 0) {
      out.push(subLen);
      for (let i = 0; i < subLen; i++) out.push(sub[i]);
      subLen = 0;
    }
  };
  const writeCode = (code, size) => {
    bitBuf |= code << bitCount;
    bitCount += size;
    while (bitCount >= 8) {
      sub[subLen++] = bitBuf & 0xff;
      if (subLen === 255) flushSub();
      bitBuf >>>= 8;
      bitCount -= 8;
    }
  };

  let codeSize = minCodeSize + 1;
  let nextCode = endCode + 1;
  // 使用定长连接表加速 LZW 字典查找 (4096 * 256)
  const dict = new Int32Array(4096 * 256).fill(-1);

  writeCode(clearCode, codeSize);
  let prefix = indexed[0];

  for (let i = 1; i < indexed.length; i++) {
    const k = indexed[i];
    const slot = (prefix << 8) | k;
    const hit = dict[slot];
    if (hit !== -1) {
      prefix = hit;
    } else {
      writeCode(prefix, codeSize);
      if (nextCode < 4096) {
        dict[slot] = nextCode++;
        if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
      } else {
        writeCode(clearCode, codeSize);
        dict.fill(-1);
        codeSize = minCodeSize + 1;
        nextCode = endCode + 1;
      }
      prefix = k;
    }
  }
  writeCode(prefix, codeSize);
  writeCode(endCode, codeSize);
  if (bitCount > 0) {
    sub[subLen++] = bitBuf & 0xff;
  }
  flushSub();
  out.push(0); // block terminator
  return new Uint8Array(out);
}

/**
 * 将帧序列编码为 GIF89a Blob（支持整数倍像素放大，默认 2× 让导出的 GIF 更清晰）
 */
export function buildGifBlob(fx, cfg) {
  const transparent = cfg.bg === "checker" || cfg.bg === "none";
  const seq = renderExportFrames(fx, cfg, { includeBg: !transparent });
  const scale = Math.max(1, Math.min(3, Math.floor(320 / Math.max(seq.w, seq.h))));
  const W = seq.w * scale;
  const H = seq.h * scale;
  const delayCs = Math.max(2, Math.round(100 / seq.fps));

  const chunks = [];
  const pushBytes = (...arr) => chunks.push(new Uint8Array(arr));
  const u16 = (v) => [v & 0xff, (v >> 8) & 0xff];

  // Header "GIF89a" + Logical Screen Descriptor (no global table; each frame uses local color table for crispness)
  pushBytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
  pushBytes(...u16(W), ...u16(H), 0x70, 0x00, 0x00);

  // Netscape 2.0 Loop Extension
  const loopCount = seq.loop ? 0 : 0; // GIF 预览默认循环播放便于查看
  pushBytes(
    0x21, 0xff, 0x0b,
    0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30,
    0x03, 0x01, ...u16(loopCount), 0x00,
  );

  for (const f of seq.frames) {
    const rgba = scale > 1 ? resampleNearestRGBA(f.rgba, seq.w, seq.h, W, H) : f.rgba;
    const { flatPal, indexed, transIdx } = quantizeFrame(rgba, W * H, transparent);

    // Graphic Control Extension
    const disp = transparent ? 2 : 1; // 2 = restore to bg (clear transparent frame), 1 = do not dispose
    const packedGce = (disp << 2) | (transparent ? 1 : 0);
    pushBytes(0x21, 0xf9, 0x04, packedGce, ...u16(delayCs), transparent ? transIdx : 0, 0x00);

    // Image Descriptor with Local Color Table (256 colors -> size 7)
    pushBytes(0x2c, 0x00, 0x00, 0x00, 0x00, ...u16(W), ...u16(H), 0x87);
    chunks.push(flatPal);
    chunks.push(lzwEncode(indexed, 8));
  }

  pushBytes(0x3b); // Trailer
  return new Blob(chunks, { type: "image/gif" });
}
