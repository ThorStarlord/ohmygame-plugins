import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { it, type TestContext } from "node:test";
import type { PluginServices as Services } from "../app/src/daemon/plugin-services.js";
import type { PluginMediaProviders as Media } from "../app/src/daemon/plugin-media-providers.js";

const app = path.resolve(process.env.OHMYGAME_APP ?? "app");
const loadApp = (name: string) =>
  import(pathToFileURL(path.join(app, `src/daemon/${name}.ts`)).href);
// The app's own image library, which scales references before they are sent.
const sharp = createRequire(path.join(app, "package.json"))("sharp") as (input: Buffer | { create: object }) => {
  png(): { toBuffer(): Promise<Buffer> };
  metadata(): Promise<{ width?: number; height?: number }>;
};
const pluginRoot = fileURLToPath(
  new URL("../plugins/pixellab", import.meta.url),
);
const API = "https://api.pixellab.ai/v2";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const GIF = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(16)]);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
type Request = {
  url: string;
  method: string;
  headers: Headers;
  body?: Record<string, any>;
};
type Reply = (
  request: Request,
) => Response | undefined | Promise<Response | undefined>;

async function setup(t: TestContext, reply?: Reply) {
  const [
    { PluginServices },
    { PluginMediaProviders },
    { mediaTaskJournal, GenerationShutdown },
  ] = await Promise.all([
    loadApp("plugin-services"),
    loadApp("plugin-media-providers"),
    loadApp("media-task-journal"),
  ]);
  const root = await mkdtemp(path.join(tmpdir(), "ohmygame-pixellab-"));
  const services: Services = new PluginServices({
    directory: path.join(root, "store"),
  });
  t.after(async () => {
    await services.close();
    await rm(root, { recursive: true, force: true });
  });
  await services.installManaged(pluginRoot, { consent: false });
  const requests: Request[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request: Request = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      ...(typeof init?.body === "string"
        ? { body: JSON.parse(init.body) }
        : {}),
    };
    requests.push(request);
    const response = await reply?.(request);
    if (response) return response;
    const url = request.url;
    if (url === `${API}/create-image-pixen`)
      return json({
        image: {
          type: "base64",
          base64: `data:image/png;base64,${PNG.toString("base64")}`,
        },
      });
    if (url === `${API}/create-character-v3`)
      return json({ character_id: "c1", background_job_id: "job-c" });
    if (url === `${API}/animate-with-text-v3`)
      return json({ background_job_id: "job-f" });
    if (url === `${API}/characters/animations`)
      return json({
        animation_group_id: "g1",
        background_job_ids: ["job-a"],
        directions: ["south"],
      });
    if (url.startsWith(`${API}/background-jobs/`))
      return url.endsWith("job-f")
        ? json({ id: "job-f", status: "completed", last_response: { images: [
          { base64: `data:image/png;base64,${PNG.toString("base64")}` },
          { base64: `data:image/png;base64,${PNG.toString("base64")}` },
        ] } })
        : json({ id: "job", status: "completed" });
    if (url.startsWith(`${API}/characters/c1/gif`))
      return new Response(GIF, { headers: { "content-type": "image/gif" } });
    return json({ detail: "not found" }, 404);
  };
  const media: Media = new PluginMediaProviders(services, fetcher);
  await services.configure("ohmygame/pixellab", { apiKey: "pl-test-key" });
  await services.setEveryProject("ohmygame/pixellab", true);
  const [provider] = await media.imageProviders();
  assert.ok(provider, "PixelLab lists its image models once configured");
  const model = (id: string) => provider.models.find((m) => m.id === id)!;
  return {
    media,
    requests,
    model,
    restart: (): Media => new PluginMediaProviders(services, fetcher),
    journal: (id = "job-1") => mediaTaskJournal(path.join(root, "tasks"), id),
    GenerationShutdown,
  };
}

it("declares beta image models with their reference rules", async (t) => {
  const s = await setup(t);
  assert.deepEqual(
    ["pixen", "character", "skeleton-animation", "frame-animation"].map((id) => {
      const { maxReferenceImages, minReferenceImages, promptOptionalWithReference } = s.model(id);
      return { id, maxReferenceImages, minReferenceImages, promptOptionalWithReference };
    }),
    [
      { id: "pixen", maxReferenceImages: 0, minReferenceImages: undefined, promptOptionalWithReference: undefined },
      { id: "character", maxReferenceImages: 1, minReferenceImages: undefined, promptOptionalWithReference: true },
      { id: "skeleton-animation", maxReferenceImages: 1, minReferenceImages: 1, promptOptionalWithReference: undefined },
      { id: "frame-animation", maxReferenceImages: 1, minReferenceImages: 1, promptOptionalWithReference: undefined },
    ],
  );
});

it("makes Pixen art in one submitted request", async (t) => {
  const s = await setup(t);
  const image = await s.media.generateImage(
    s.model("pixen"),
    { prompt: "a mossy rock", transparentBackground: true },
    undefined,
    { journal: await s.journal() },
  );
  assert.deepEqual(image, { bytes: PNG, mediaType: "image/png" });
  assert.equal(s.requests.length, 1);
  assert.equal(s.requests[0]!.headers.get("authorization"), "Bearer pl-test-key");
  assert.deepEqual(s.requests[0]!.body, {
    description: "a mossy rock",
    image_size: { width: 512, height: 512 },
    no_background: true,
  });
});

it("uses a connected character reference when its description is empty", async (t) => {
  const s = await setup(t);
  const reference = await sharp({
    create: { width: 128, height: 128, channels: 4, background: "#336699" },
  })
    .png()
    .toBuffer();
  await s.media.generateImage(
    s.model("character"),
    { prompt: "", images: [{ mediaType: "image/png", data: reference.toString("base64") }] },
    undefined,
    { journal: await s.journal() },
  );
  assert.equal(
    s.requests.find((request) => request.url === `${API}/create-character-v3`)?.body?.description,
    "the character in the reference image",
  );
});

it("animates a scaled reference and downloads the GIF with the key", async (t) => {
  const s = await setup(t);
  const reference = await sharp({
    create: { width: 512, height: 384, channels: 4, background: "#336699" },
  })
    .png()
    .toBuffer();
  const image = await s.media.generateImage(
    s.model("skeleton-animation"),
    {
      prompt: "walk in place",
      images: [{ mediaType: "image/png", data: reference.toString("base64") }],
    },
    undefined,
    { journal: await s.journal() },
  );
  assert.deepEqual(image, { bytes: GIF, mediaType: "image/gif" });
  const posts = s.requests.filter((r) => r.method === "POST");
  assert.deepEqual(
    posts.map((r) => r.url),
    [`${API}/create-character-v3`, `${API}/characters/animations`],
  );
  const sent = posts[0]!.body!.reference_image.base64 as string;
  assert.match(sent, /^data:image\/png;base64,/);
  const { width, height } = await sharp(
    Buffer.from(sent.split(",")[1]!, "base64"),
  ).metadata();
  assert.deepEqual({ width, height }, { width: 256, height: 192 });
  assert.deepEqual(posts[1]!.body, {
    character_id: "c1",
    description: "the character in the reference image",
    action_description: "walk in place",
    mode: "skeleton-v3",
    directions: ["south"],
  });
  const download = s.requests.at(-1)!;
  assert.equal(
    download.url,
    `${API}/characters/c1/gif?animation_group_id=g1&direction=south`,
  );
  assert.equal(download.headers.get("authorization"), "Bearer pl-test-key");
});

it("generates ordinary frame animation from a reference and action", async (t) => {
  const s = await setup(t);
  const reference = await sharp({
    create: { width: 128, height: 128, channels: 4, background: "#336699" },
  }).png().toBuffer();
  const frames = await s.media.generateImage(
    s.model("frame-animation"),
    { prompt: "run in place", images: [{ mediaType: "image/png", data: reference.toString("base64") }] },
    undefined,
    { journal: await s.journal("frame-animation") },
  );
  assert.equal(frames.mediaType, "image/gif");
  assert.equal(frames.bytes.subarray(0, 6).toString("ascii"), "GIF89a");
  const request = s.requests.find((r) => r.url === `${API}/animate-with-text-v3`)!;
  assert.equal(request.headers.get("authorization"), "Bearer pl-test-key");
  assert.equal(request.body?.action, "run in place");
  assert.equal(request.body?.frame_count, 8);
});

it("resumes a character job after shutdown without paying again", async (t) => {
  let ready = false;
  const s = await setup(t, (r) =>
    r.url.startsWith(`${API}/background-jobs/`) && !ready
      ? json({ id: "job-c", status: "processing" })
      : undefined,
  );
  const stop = new AbortController();
  const first = s.media.generateImage(
    s.model("character"),
    { prompt: "a knight" },
    stop.signal,
    { journal: await s.journal() },
  );
  while (!s.requests.some((r) => r.url.startsWith(`${API}/background-jobs/`)))
    await new Promise((resolve) => setTimeout(resolve, 50));
  stop.abort(new s.GenerationShutdown());
  await assert.rejects(first);
  ready = true;
  const image = await s
    .restart()
    .generateImage(s.model("character"), { prompt: "a knight" }, undefined, {
      journal: await s.journal(),
      resuming: true,
    });
  assert.equal(image.mediaType, "image/gif");
  assert.equal(
    s.requests.filter((r) => r.method === "POST").length,
    1,
    "Only the original character request is paid",
  );
  assert.equal(s.requests.at(-1)!.url, `${API}/characters/c1/gif`);
});

it("shows PixelLab's error and refuses an animation without a reference", async (t) => {
  const s = await setup(t, (r) =>
    r.url.endsWith("/create-image-pixen")
      ? json({ detail: [{ msg: "Not enough credits" }] }, 402)
      : undefined,
  );
  await assert.rejects(
    s.media.generateImage(s.model("pixen"), { prompt: "x" }, undefined, {
      journal: await s.journal(),
    }),
    /PixelLab 402: Not enough credits/,
  );
  await assert.rejects(
    s.media.generateImage(
      s.model("skeleton-animation"),
      { prompt: "run" },
      undefined,
      { journal: await s.journal("no-reference") },
    ),
    /Skeleton animation needs one character reference image/,
  );
});
