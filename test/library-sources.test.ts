import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

// The Library sources' native code, run with a stand-in context and, for the
// online ones, a stand-in fetch. official.test.ts checks their packages.

type Command = (input: Record<string, unknown>) => Promise<any>;

const realFetch = globalThis.fetch;
const folders: string[] = [];

afterEach(async () => {
  globalThis.fetch = realFetch;
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function activate(plugin: string, configuration: Record<string, unknown> = {}, ...extra: unknown[]) {
  const dataFolder = await mkdtemp(path.join(tmpdir(), `ohmygame-${plugin}-`));
  folders.push(dataFolder);
  const module = await import(pathToFileURL(path.resolve("plugins", plugin, "native/index.mjs")).href);
  const commands: Record<string, Command> = {};
  module.activate({ dataFolder, configuration, registerCommand: (name: string, handler: Command) => (commands[name] = handler) }, ...extra);
  return { module, commands, dataFolder };
}

function stubFetch(answer: (url: string) => Response | Promise<Response>): string[] {
  const requests: string[] = [];
  globalThis.fetch = (async (url: string | URL) => {
    requests.push(String(url));
    return answer(String(url));
  }) as typeof fetch;
  return requests;
}

describe("game-icons", () => {
  const tree = {
    tree: ["lorc/broadsword.svg", "lorc/sword-clash.svg", "zeromancer/sword-wound.svg", "badges/sword.svg", "lorc", "license.txt", "delapouite/health-potion.svg"].map((file) => ({ path: file })),
  };
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M0 0h1v1z"/></svg>';

  it("lists icons once a week and finds the best matches first", async () => {
    const requests = stubFetch((url) => (url.startsWith("https://api.github.com/") ? Response.json(tree) : new Response(svg)));
    const { commands } = await activate("game-icons");
    const found = await commands.search!({ query: "sword" });
    assert.deepEqual(found.items.map((item: { id: string }) => item.id), ["lorc/sword-clash", "zeromancer/sword-wound", "lorc/broadsword"]);
    assert.deepEqual(found.items[1], {
      id: "zeromancer/sword-wound",
      name: "sword-wound.svg",
      mediaType: "image",
      thumbnail: "https://game-icons.net/icons/ffffff/000000/1x1/zeromancer/sword-wound.png",
      width: 512,
      height: 512,
      author: "Zeromancer",
      license: "CC0",
      url: "https://game-icons.net/1x1/zeromancer/sword-wound.html",
    });
    assert.deepEqual((await commands.search!({ query: "剑" })).items, []);
    assert.equal((await commands.search!({ query: "" })).items.length, 4);
    assert.equal(requests.filter((url) => url.startsWith("https://api.github.com/")).length, 1);
  });

  it("keeps an older list when GitHub can't be reached", async () => {
    stubFetch(() => Response.json(tree));
    const { commands, dataFolder } = await activate("game-icons");
    await commands.search!({ query: "potion" });
    const saved = JSON.parse(await readFile(path.join(dataFolder, "icons.json"), "utf8"));
    await writeFile(path.join(dataFolder, "icons.json"), JSON.stringify({ ...saved, fetchedAt: 0 }));
    stubFetch(() => new Response("", { status: 503 }));
    assert.deepEqual((await commands.search!({ query: "potion" })).items.map((item: { id: string }) => item.id), ["delapouite/health-potion"]);
  });

  it("downloads an icon as a black SVG with its author's credit", async () => {
    const requests = stubFetch(() => new Response(svg));
    const { commands, dataFolder } = await activate("game-icons");
    assert.deepEqual(await commands.fetch!({ id: "lorc/broadsword" }), {
      file: "icon.svg",
      name: "broadsword.svg",
      author: "Lorc",
      license: "CC BY 3.0",
      url: "https://game-icons.net/1x1/lorc/broadsword.html",
    });
    assert.equal(requests.at(-1), "https://game-icons.net/icons/000000/transparent/1x1/lorc/broadsword.svg");
    assert.equal(await readFile(path.join(dataFolder, "icon.svg"), "utf8"), svg);
    await assert.rejects(commands.fetch!({ id: "../lorc/broadsword" }), /isn't a game-icons.net icon/);
  });
});

describe("openverse", () => {
  const sound = {
    id: "135f2d4a-ad06-47bc-b426-f3a35fb1c604",
    title: "Castles / keep",
    creator: "Dan Falvey",
    license: "cc0",
    license_version: "1.0",
    foreign_landing_url: "https://freesound.org/s/1",
    url: "https://cdn.freesound.org/castles.mp3",
    thumbnail: null,
    duration: 1500,
    filetype: "mp3",
  };
  const track = { ...sound, id: "335f2d4a-ad06-47bc-b426-f3a35fb1c604", title: "Theme", license: "by", license_version: "3.0", thumbnail: "https://usercontent.jamendo.com/theme.jpg", filetype: null };
  const flac = { ...sound, id: "235f2d4a-ad06-47bc-b426-f3a35fb1c604", filetype: "flac" };
  const image = {
    id: "a65f8e51-ea32-46ac-af0e-b09af41f97da",
    title: "Castle",
    creator: "mbergisch",
    license: "by",
    license_version: "2.0",
    foreign_landing_url: "https://www.flickr.com/photos/1",
    url: "https://live.staticflickr.com/3218/2607516312_895f89ea5e_b.jpg",
    thumbnail: "https://api.openverse.org/v1/images/a65f8e51-ea32-46ac-af0e-b09af41f97da/thumb/",
    width: 1024,
    height: 768,
    filetype: null,
  };
  const tiff = { ...image, id: "b65f8e51-ea32-46ac-af0e-b09af41f97da", filetype: "tiff" };
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
  const MP3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0, 0, 0]);

  it("searches audio by collection, under licenses that allow commercial use and changes", async () => {
    const requests = stubFetch(() => Response.json({ page_count: 3, results: [track, sound, flac] }));
    const { commands } = await activate("openverse");
    assert.deepEqual(await commands.search!({ query: "castle", collection: "music" }), {
      items: [
        { id: track.id, name: "Theme", mediaType: "audio", thumbnail: track.thumbnail, duration: 1.5, preview: track.url, author: "Dan Falvey", license: "CC BY 3.0", url: "https://freesound.org/s/1" },
        { id: sound.id, name: "Castles / keep", mediaType: "audio", duration: 1.5, preview: sound.url, author: "Dan Falvey", license: "CC0 1.0", url: "https://freesound.org/s/1" },
      ],
      next: "2",
    });
    const asked = (url: string) => Object.fromEntries(new URL(url).searchParams);
    assert.equal(new URL(requests[0]!).pathname, "/v1/audio/");
    assert.deepEqual(asked(requests[0]!), { page: "1", page_size: "20", license: "cc0,pdm,by,by-sa", category: "music", q: "castle" });

    // Sound effects by Freesound, whose sounds have no category; All by nothing more.
    await commands.search!({ query: "", collection: "sfx", cursor: "2" });
    assert.deepEqual(asked(requests.at(-1)!), { page: "2", page_size: "20", license: "cc0,pdm,by,by-sa", source: "freesound" });
    // An older app sends no collection: the first, Music.
    await commands.search!({ query: "" });
    assert.equal(asked(requests.at(-1)!).category, "music");
  });

  it("searches every image and sound under All, half a page of each", async () => {
    const requests = stubFetch((url) =>
      url.includes("/images/?") ? Response.json({ page_count: 1, results: [image, tiff] }) : Response.json({ page_count: 4, results: [sound] }),
    );
    const { commands } = await activate("openverse");
    const found = await commands.search!({ query: "castle", collection: "all" });
    assert.deepEqual(found.items.map((item: { id: string; mediaType: string }) => [item.id, item.mediaType]), [[image.id, "image"], [sound.id, "audio"]]);
    assert.equal(found.next, "2");
    assert.deepEqual(
      requests.map((url) => [new URL(url).pathname, Object.fromEntries(new URL(url).searchParams)]),
      [
        ["/v1/images/", { page: "1", page_size: "10", license: "cc0,pdm,by,by-sa", q: "castle" }],
        ["/v1/audio/", { page: "1", page_size: "10", license: "cc0,pdm,by,by-sa", q: "castle" }],
      ],
    );
    // An image keeps its size, without anything to listen to, and its thumbnail comes from Flickr itself.
    assert.deepEqual(found.items[0], {
      id: image.id, name: "Castle", mediaType: "image", thumbnail: "https://live.staticflickr.com/3218/2607516312_895f89ea5e_z.jpg",
      width: 1024, height: 768, author: "mbergisch", license: "CC BY 2.0", url: "https://www.flickr.com/photos/1",
    });
  });

  it("takes image thumbnails from Flickr and Wikimedia Commons themselves, and Openverse's for other sites", async () => {
    const { module } = await activate("openverse");
    assert.equal(module.siteThumbnail("https://live.staticflickr.com/3218/2607516312_895f89ea5e.jpg"), "https://live.staticflickr.com/3218/2607516312_895f89ea5e_z.jpg");
    assert.equal(
      module.siteThumbnail("https://upload.wikimedia.org/wikipedia/commons/a/ab/Castle_(1).jpg"),
      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Castle_(1).jpg/500px-Castle_(1).jpg",
    );
    assert.equal(module.siteThumbnail("https://upload.wikimedia.org/wikipedia/commons/a/ab/Map.svg"), "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Map.svg/500px-Map.svg.png");
    assert.equal(module.siteThumbnail("https://example.org/castle.jpg"), undefined);
    assert.equal(module.item({ ...image, url: "https://example.org/castle.jpg" }, "image").thumbnail, image.thumbnail);
  });

  it("downloads an image under All and names it by its first bytes", async () => {
    stubFetch((url) => (url.endsWith(`/images/${image.id}/`) ? Response.json(image) : new Response(PNG)));
    const { commands, dataFolder } = await activate("openverse");
    assert.deepEqual(await commands.fetch!({ id: image.id, mediaType: "image" }), {
      file: "download.png", name: "Castle.png", author: "mbergisch", license: "CC BY 2.0", url: "https://www.flickr.com/photos/1",
    });
    assert.deepEqual(await readFile(path.join(dataFolder, "download.png")), PNG);
    await assert.rejects(commands.fetch!({ id: image.id, mediaType: "model" }), /isn't an Openverse model/);
  });

  it("downloads the original sound and names it by its first bytes", async () => {
    stubFetch((url) => (url.endsWith(`/audio/${sound.id}/`) ? Response.json(sound) : new Response(MP3)));
    const { commands, dataFolder } = await activate("openverse");
    assert.deepEqual(await commands.fetch!({ id: sound.id, mediaType: "audio" }), {
      file: "download.mp3",
      name: "Castles keep.mp3",
      author: "Dan Falvey",
      license: "CC0 1.0",
      url: "https://freesound.org/s/1",
    });
    assert.deepEqual(await readFile(path.join(dataFolder, "download.mp3")), MP3);
    await assert.rejects(commands.fetch!({ id: "../x", mediaType: "audio" }), /isn't an Openverse audio/);

    stubFetch((url) => (url.includes("/audio/") ? Response.json({ ...sound, title: "Notes" }) : new Response("fLaC")));
    await assert.rejects(commands.fetch!({ id: sound.id, mediaType: "audio" }), /Notes is in a format the Library doesn't take/);
  });

  it("searches as the application in Settings, with one token until it is refused", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    let tokens = 0;
    let refuse = false;
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), ...(init ? { init } : {}) });
      if (String(url).endsWith("/auth_tokens/token/")) return Response.json({ access_token: `token-${++tokens}`, expires_in: 36000, token_type: "Bearer" });
      const authorization = new Headers(init?.headers).get("Authorization");
      if (refuse && authorization === "Bearer token-1") return Response.json({ detail: "Invalid token." }, { status: 401 });
      return Response.json({ page_count: 1, results: [] });
    }) as typeof fetch;
    const { commands } = await activate("openverse", { clientId: " my-id ", clientSecret: "my-secret" });

    // Searches at once ask for one token, and later ones reuse it.
    await Promise.all([commands.search!({ query: "castle" }), commands.search!({ query: "castle", collection: "sfx" })]);
    const asked = calls.filter((call) => call.url.endsWith("/auth_tokens/token/"));
    assert.equal(asked.length, 1);
    assert.equal(asked[0]!.init?.method, "POST");
    assert.equal(new Headers(asked[0]!.init?.headers).get("Content-Type"), "application/x-www-form-urlencoded");
    assert.deepEqual(Object.fromEntries(new URLSearchParams(String(asked[0]!.init?.body))), { grant_type: "client_credentials", client_id: "my-id", client_secret: "my-secret" });
    const searches = calls.filter((call) => !call.url.endsWith("/auth_tokens/token/"));
    assert.deepEqual(searches.map((call) => new Headers(call.init?.headers).get("Authorization")), ["Bearer token-1", "Bearer token-1"]);

    // A refused token is asked for again, once, and the search goes on.
    refuse = true;
    await commands.search!({ query: "castle", collection: "all" });
    assert.equal(tokens, 2);
    assert.equal(new Headers(calls.at(-1)!.init?.headers).get("Authorization"), "Bearer token-2");
  });

  it("says when the application in Settings is refused, or only half filled in", async () => {
    stubFetch((url) => (url.endsWith("/auth_tokens/token/") ? Response.json({ error: "invalid_client" }, { status: 401 }) : Response.json({ page_count: 1, results: [] })));
    const wrong = await activate("openverse", { clientId: "my-id", clientSecret: "wrong" });
    await assert.rejects(wrong.commands.search!({ query: "castle" }), /didn't accept the client ID and secret in this plugin's Settings \(401: invalid_client\)/);
    const half = await activate("openverse", { clientId: "my-id" });
    await assert.rejects(half.commands.search!({ query: "castle" }), /Fill in both the Openverse client ID and secret/);
    // Without either, it searches without an account.
    const requests = stubFetch(() => Response.json({ page_count: 1, results: [] }));
    const anonymous = await activate("openverse", { clientId: "", clientSecret: "" });
    await anonymous.commands.search!({ query: "castle", collection: "sfx" });
    assert.deepEqual(requests.map((url) => new URL(url).pathname), ["/v1/audio/"]);
  });

  it("says when Openverse limits requests, and what else it refused", async () => {
    stubFetch(() => new Response("", { status: 429 }));
    const { commands } = await activate("openverse");
    await assert.rejects(commands.search!({ query: "castle" }), /200 a day\).*client ID and secret in this plugin's Settings/);
    stubFetch(() => Response.json({ detail: "page_size may not exceed 20 for anonymous requests" }, { status: 401 }));
    await assert.rejects(commands.search!({ query: "castle", collection: "music" }), /Openverse answered 401: page_size may not exceed 20/);
  });
});

describe("pixel-sprites", () => {
  const COMMIT = "9687c39d60881ba80208e671ba12ac216019b1d0";
  const gz = (bytes: ArrayLike<number> | string) => gzipSync(typeof bytes === "string" ? Buffer.from(bytes) : Buffer.from(bytes as ArrayLike<number>));
  // A page of three sprites: each one's colour count, its colours as palette tokens, then 256 indices per sprite.
  function page(): Buffer {
    const indices = Buffer.alloc(3 * 256);
    indices.fill(1, 0, 256); // sprite 0: all its second colour
    indices[256 + 17] = 1; // sprite 1: one pixel of its second colour at (1, 1)
    return Buffer.concat([Buffer.from([2, 2, 1]), Buffer.from(Uint16Array.from([0, 1, 0, 2, 0]).buffer), indices]);
  }
  const palette = Buffer.from([0, 0, 0, 255, 0, 0, 0, 0, 255]);
  const files: Record<string, Buffer> = {
    "manifest.json": Buffer.from(JSON.stringify({ dims: 4, catalog_sprites: 3 })),
    "subjects.txt.z": gz("apple\nsword"),
    "terms-a.txt.z": gz("apple\nred\nsword"),
    "vec-a.bin": Buffer.alloc(12),
    "freq-a.bin.z": gz([1, 1, 1]),
    "vec-s.bin": Buffer.alloc(8),
    "terms-b.txt.z": gz("fruit"),
    "vec-b.bin": Buffer.alloc(4),
    "catalog-subjects.bin.z": gz(new Uint8Array(Uint32Array.from([0, 1, 3]).buffer)),
    // Word counts, then the words' low bytes, then their high bytes.
    "catalog-captions.bin.z": gz([1, 2, 0, 0, 1, 2, 0, 0, 0]),
    "palette.bin.z": gz(palette),
  };

  it("reads captions from the search data, and a sprite's pixels from its page", async () => {
    const { module } = await activate("pixel-sprites");
    const atlas = module.loadAtlas((name: string) => files[name]);
    assert.equal(atlas.total, 3);
    // Before captions come, a sprite is named by its subject.
    assert.deepEqual([0, 1, 2].map((sprite) => atlas.caption(sprite)), ["apple", "sword", "sword"]);
    atlas.addCaptions(files["catalog-captions.bin.z"]);
    // A sprite without caption words keeps its subject.
    assert.deepEqual([0, 1, 2].map((sprite) => atlas.caption(sprite)), ["apple", "red sword", "sword"]);
    const red = module.spritePixels(page(), 3, 0, palette);
    assert.deepEqual([...red.subarray(0, 4)], [255, 0, 0, 255]);
    const dot = module.spritePixels(page(), 3, 1, palette);
    assert.deepEqual([...dot.subarray(17 * 4, 17 * 4 + 4)], [0, 0, 255, 255]);
    // Token 0 is transparent.
    assert.deepEqual([...dot.subarray(0, 4)], [0, 0, 0, 0]);
  });

  it("reads 32-bit numbers from a Buffer that is a view into a larger block", async () => {
    const { module } = await activate("pixel-sprites");
    // Node may hand out a Buffer at an offset into shared memory, where `.buffer` holds more than its bytes.
    const block = Buffer.alloc(64, 0xff);
    Buffer.from(Uint32Array.from([0, 1, 3]).buffer).copy(block, 5);
    assert.deepEqual([...module.uint32(block.subarray(5, 17))], [0, 1, 3]);
  });

  it("scales a sprite up with each pixel kept square, and names files by caption", async () => {
    const { module } = await activate("pixel-sprites");
    const dot = module.spritePixels(page(), 3, 1, palette);
    const png = module.spritePng(dot, 4);
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [64, 64]);
    assert.equal(module.fileName("Pointing down silver sword!", 42), "pointing-down-silver-sword-42.png");
    assert.equal(module.english("红色 剑"), "red sword");
    assert.equal(module.english("  Red Dragon "), "red dragon");
  });

  it("downloads the search data once from the pinned commit, and pages from the Space's site while it matches", async () => {
    const requests: string[] = [];
    let siteManifest = files["manifest.json"]!;
    const SITE = "https://cfahlgren1-pixel-search.static.hf.space/data/";
    const PINNED = `https://huggingface.co/spaces/cfahlgren1/pixel-search/resolve/${COMMIT}/static/data/`;
    stubFetch((url) => {
      requests.push(url);
      if (url === `${SITE}manifest.json`) return new Response(new Uint8Array(siteManifest));
      if (url.endsWith("/pages/0.bin.z")) return new Response(gz(page()));
      const name = url.startsWith(SITE) ? url.slice(SITE.length) : url.slice(PINNED.length);
      return files[name] ? new Response(new Uint8Array(files[name])) : new Response("", { status: 404 });
    });
    const captionsKept = async (folder: string) => {
      for (let tries = 0; tries < 100 && !(await readFile(path.join(folder, COMMIT, "catalog-captions.bin.z")).catch(() => undefined)); tries++)
        await new Promise((resolve) => setTimeout(resolve, 10));
      await new Promise((resolve) => setTimeout(resolve, 10));
    };
    const asked: string[] = [];
    const fake = (read: (name: string) => Buffer) => ({
      ...activateAtlas(read),
      engine: { search: (words: string, limit: number) => (asked.push(words), { sprites: Uint32Array.from([1, 0, 2].slice(0, limit)) }) },
    });
    let activateAtlas: (read: (name: string) => Buffer) => Record<string, unknown>;
    const first = await activate("pixel-sprites", { scale: "4" }, fake);
    activateAtlas = (read) => { const atlas = first.module.loadAtlas(read); return { total: atlas.total, palette: atlas.palette, caption: atlas.caption, addCaptions: atlas.addCaptions }; };

    // The first search needn't wait for captions: results are named by subject until they come.
    const early = await first.commands.search!({ query: "红色", collection: "weapon" });
    assert.deepEqual(asked, ["red weapon"]);
    assert.deepEqual(early.items.map((item: { id: string; name: string }) => [item.id, item.name]), [["1", "sword"], ["0", "apple"], ["2", "sword"]]);
    await captionsKept(first.dataFolder);
    const found = await first.commands.search!({ query: "红色", collection: "weapon" });
    assert.deepEqual(found.items.map((item: { id: string; name: string }) => [item.id, item.name]), [["1", "red sword"], ["0", "apple"], ["2", "sword"]]);
    assert.deepEqual(found.items[0], {
      id: "1", name: "red sword", mediaType: "image", thumbnail: found.items[0].thumbnail, width: 64, height: 64,
      author: "Angais (AI-generated)", license: "CC0 1.0", url: "https://huggingface.co/datasets/Angais/pixel-art-atlas-1.4m",
    });
    assert.ok(found.items[0].thumbnail.startsWith("data:image/png;base64,iVBORw0KGgo"));
    // The pinned manifest, then everything else from the faster site, which serves the same build.
    assert.deepEqual(requests.filter((url) => url.startsWith(PINNED)), [`${PINNED}manifest.json`]);
    assert.equal(requests.filter((url) => url.startsWith(SITE) && !url.includes("/pages/")).length, 11);
    assert.ok(requests.includes(`${SITE}pages/0.bin.z`));

    // Added at the size in Settings, named by its caption.
    assert.deepEqual(await first.commands.fetch!({ id: "1", mediaType: "image" }), {
      file: "sprite.png", name: "red-sword-1@4x.png", author: "Angais (AI-generated)", license: "CC0 1.0", url: "https://huggingface.co/datasets/Angais/pixel-art-atlas-1.4m",
    });
    assert.equal((await readFile(path.join(first.dataFolder, "sprite.png"))).readUInt32BE(16), 64);
    await assert.rejects(first.commands.fetch!({ id: "3", mediaType: "image" }), /isn't a Pixel Art Atlas sprite/);

    // Started again on the same folder, nothing is downloaded again.
    requests.length = 0;
    const second = await import(pathToFileURL(path.resolve("plugins/pixel-sprites/native/index.mjs")).href);
    const commands: Record<string, Command> = {};
    second.activate({ dataFolder: first.dataFolder, configuration: {}, registerCommand: (name: string, handler: Command) => (commands[name] = handler) }, fake);
    await commands.search!({ query: "sword" });
    await captionsKept(first.dataFolder);
    // Only the site's manifest is asked, to know where new pages would come from.
    assert.deepEqual(requests, [`${SITE}manifest.json`]);

    // A Space rebuilt since the pin serves pages from the pinned commit.
    siteManifest = Buffer.from(JSON.stringify({ dims: 4, catalog_sprites: 9 }));
    const fresh = await activate("pixel-sprites", {}, fake);
    requests.length = 0;
    await fresh.commands.search!({ query: "sword" });
    await captionsKept(fresh.dataFolder);
    assert.ok(requests.includes(`${PINNED}pages/0.bin.z`));
    assert.ok(requests.includes(`${PINNED}vec-a.bin`));
    assert.ok(!requests.some((url) => url.startsWith(SITE) && url !== `${SITE}manifest.json`));
  });
});
