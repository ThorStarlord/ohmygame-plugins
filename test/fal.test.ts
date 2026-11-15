import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { it, type TestContext } from "node:test";
import type { PluginServices as Services } from "../app/src/daemon/plugin-services.js";
import type { PluginMediaProviders as Media } from "../app/src/daemon/plugin-media-providers.js";

const loadApp = (name: string) =>
  import(
    pathToFileURL(
      path.resolve(process.env.OHMYGAME_APP ?? "app", `src/daemon/${name}.ts`),
    ).href
  );
const pluginRoot = fileURLToPath(new URL("../plugins/fal", import.meta.url));
const model = { provider: "plugin.ohmygame.fal.fal", id: "fal-ai/birefnet" };
const queue = "https://queue.fal.run/fal-ai/birefnet/requests/paid";
const json = (body: unknown, status = 200) => Response.json(body, { status });
type Request = {
  url: string;
  method: string;
  headers: Headers;
  body?: Record<string, unknown>;
};

async function setup(
  t: TestContext,
  reply?: (
    request: Request,
  ) => Response | undefined | Promise<Response | undefined>,
) {
  const [
    { PluginServices },
    { PluginMediaProviders },
    { mediaTaskJournal, GenerationShutdown },
    { default: sharp },
  ] = await Promise.all([
    loadApp("plugin-services"),
    loadApp("plugin-media-providers"),
    loadApp("media-task-journal"),
    import(
      pathToFileURL(
        createRequire(
          path.resolve(process.env.OHMYGAME_APP ?? "app", "package.json"),
        ).resolve("sharp"),
      ).href
    ),
  ]);
  const root = await mkdtemp(path.join(tmpdir(), "ohmygame-fal-cutout-"));
  const services: Services = new PluginServices({
    directory: path.join(root, "store"),
  });
  const instances: Media[] = [];
  t.after(async () => {
    for (const media of instances) await media.close();
    await services.close();
    await rm(root, { recursive: true, force: true });
  });
  await services.installManaged(pluginRoot, { consent: false });
  await services.configure("ohmygame/fal", { apiKey: "test-fal-key" });
  const source = await sharp(
    Buffer.from([
      255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 255, 255, 255, 255,
    ]),
    { raw: { width: 2, height: 2, channels: 4 } },
  )
    .png()
    .toBuffer();
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
    if (request.method === "POST")
      return json({
        request_id: "paid",
        status_url: queue + "/status",
        response_url: queue,
        cancel_url: queue + "/cancel",
      });
    if (request.url.endsWith("/status")) return json({ status: "COMPLETED" });
    if (request.url === queue)
      return json({ image: { url: "https://v3.fal.media/result.png" } });
    if (request.url === "https://v3.fal.media/result.png")
      return new Response(source, { headers: { "content-type": "image/png" } });
    throw new Error(`Unexpected request: ${request.method} ${request.url}`);
  };
  const restart = (): Media => {
    const media = new PluginMediaProviders(
      services,
      fetcher,
      undefined,
      undefined,
      root,
    );
    instances.push(media);
    return media;
  };
  const media = restart();
  assert.deepEqual(await media.backgroundRemovalModels(), []);
  await services.setEveryProject("ohmygame/fal", true);
  return {
    root,
    services,
    media,
    restart,
    source,
    requests,
    sharp,
    GenerationShutdown,
    journal: () => mediaTaskJournal(path.join(root, "tasks"), "cutout"),
  };
}

it("uses a dedicated queue and original-sized alpha without changing generation choices or grants", async (t) => {
  const s = await setup(t);
  assert.deepEqual(await s.media.backgroundRemovalModels(), [
    { ...model, name: "BiRefNet", providerName: "fal.ai" },
  ]);
  assert.deepEqual(
    (await s.media.imageProviders())[0]!.models.map((m) => m.id),
    ["fal-ai/flux/schnell"],
  );
  const result = await s.media.removeBackground(
    model,
    s.source,
    undefined,
    await s.journal(),
  );
  const submission = s.requests.find((r) => r.method === "POST")!;
  assert.equal(submission.url, "https://queue.fal.run/fal-ai/birefnet");
  assert.deepEqual(
    { ...submission.body, image_url: "snapshot" },
    {
      image_url: "snapshot",
      output_format: "png",
      sync_mode: false,
      refine_foreground: false,
      model: "General Use (Light)",
      operating_resolution: "1024x1024",
    },
  );
  assert.match(String(submission.body!.image_url), /^data:image\/png;base64,/);
  assert.equal(submission.headers.get("authorization"), "Key test-fal-key");
  assert.equal(s.requests.at(-1)!.headers.get("authorization"), null);
  const decoded = await s
    .sharp(result.bytes)
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(decoded.info.width, 2);
  assert.equal(decoded.info.height, 2);
  assert.deepEqual(
    [...decoded.data],
    [255, 0, 0, 255, 0, 255, 0, 64, 0, 0, 255, 0, 255, 255, 255, 255],
  );
  assert.equal(s.services.index.get("ohmygame/fal")!.manifest.beta, true);
  assert.equal(
    s.services.index.get("ohmygame/fal")!.manifest.icon,
    "./assets/icon.svg",
  );
  assert.deepEqual(
    s.services.index.get("ohmygame/fal")!.manifest.capabilities!.network,
    [
      "queue.fal.run",
      "api.fal.ai",
      "fal.media",
      "v2.fal.media",
      "v3.fal.media",
      "v3b.fal.media",
    ],
  );
});

it("retains an interrupted download and resumes the original result after restart", async (t) => {
  let offline = true;
  const s = await setup(t, (r) => {
    if (offline && r.url.endsWith("result.png")) throw new Error("offline");
    return undefined;
  });
  await assert.rejects(
    s.media.removeBackground(model, s.source, undefined, await s.journal()),
    /downloaded/,
  );
  offline = false;
  await s
    .restart()
    .removeBackground(model, s.source, undefined, await s.journal());
  assert.equal(s.requests.filter((r) => r.method === "POST").length, 1);
});

it("stops locally without cancelling the paid task and resumes its status", async (t) => {
  const controller = new AbortController();
  let stop = true;
  const s = await setup(t, (r) => {
    if (stop && r.url.endsWith("/status")) {
      controller.abort();
      return json({ status: "IN_PROGRESS" });
    }
  });
  await assert.rejects(
    s.media.removeBackground(
      model,
      s.source,
      controller.signal,
      await s.journal(),
    ),
  );
  assert.equal(s.requests.filter((r) => r.method === "PUT").length, 0);
  stop = false;
  await s
    .restart()
    .removeBackground(model, s.source, undefined, await s.journal());
  assert.equal(s.requests.filter((r) => r.method === "POST").length, 1);
});

it("does not replace a submission whose response was lost", async (t) => {
  const s = await setup(t, (r) => {
    if (r.method === "POST") throw new Error("lost response");
    return undefined;
  });
  await assert.rejects(
    s.media.removeBackground(model, s.source, undefined, await s.journal()),
  );
  await assert.rejects(
    s.restart().removeBackground(model, s.source, undefined, await s.journal()),
    /may have started.*answer was lost/i,
  );
  assert.equal(s.requests.filter((r) => r.method === "POST").length, 1);
});
