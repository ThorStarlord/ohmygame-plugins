// A Library source for Openverse (openverse.org): openly licensed media from
// Freesound, Jamendo, Flickr, Wikimedia and other sites. Its collections are
// Music and Sound effects, the audio a game can use most, and All: every
// image and sound Openverse has. It searches only licenses that allow
// commercial use and changes: CC0, the Public Domain Mark, CC BY and CC BY-SA.
import { writeFile } from "node:fs/promises";
import path from "node:path";

const API = "https://api.openverse.org/v1";
const HEADERS = { "User-Agent": "ohmygame-openverse-plugin" };
const LICENSES = "cc0,pdm,by,by-sa";
// Openverse refuses more than 20 a page without an account.
const PAGE_SIZE = 20;
const ENDPOINTS = { image: "images", audio: "audio" };
/**
 * Each collection of the tab, in the manifest's order: the kinds of media it
 * asks for and Openverse's filters for them.
 */
export const COLLECTIONS = {
  music: { kinds: ["audio"], filters: { category: "music" } },
  // Freesound's sounds carry no category, so they are asked for by source.
  sfx: { kinds: ["audio"], filters: { source: "freesound" } },
  all: { kinds: ["image", "audio"], filters: {} },
};
// Formats the Library doesn't take, left out of results when Openverse knows a file's type.
const UNSUPPORTED = new Set([
  "aif",
  "aiff",
  "bmp",
  "flac",
  "mid",
  "midi",
  "tif",
  "tiff",
  "wma",
]);
const LICENSE_NAMES = {
  cc0: "CC0",
  pdm: "Public Domain Mark",
  by: "CC BY",
  "by-sa": "CC BY-SA",
};

export function licenseName(result) {
  const name =
    LICENSE_NAMES[result.license] ??
    `CC ${String(result.license ?? "").toUpperCase()}`;
  return result.license_version ? `${name} ${result.license_version}` : name;
}

const text = (value, max) =>
  typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : undefined;
const https = (value) =>
  typeof value === "string" &&
  value.startsWith("https://") &&
  value.length <= 2000
    ? value
    : undefined;
/** Who made it, its license and its page, as the Library keeps them with an asset. */
export function credit(result) {
  const author = text(result.creator, 200);
  const url = https(result.foreign_landing_url);
  return {
    ...(author ? { author } : {}),
    license: licenseName(result),
    ...(url ? { url } : {}),
  };
}

/**
 * A small picture straight from the site an image is on, where its address
 * says how to ask for one: Openverse's own thumbnails fetch the image from
 * that site each time and often fail. Flickr's `_z` is 640 pixels on the
 * longest side, and 500 pixels is one of the widths Wikimedia Commons keeps
 * ready; a drawing or TIFF comes back from Commons as PNG. Others keep
 * Openverse's.
 */
export function siteThumbnail(url) {
  const flickr =
    /^(https:\/\/live\.staticflickr\.com\/\d+\/\d+_[0-9a-f]+)(?:_[a-z0-9]+)?\.jpg$/.exec(
      String(url ?? ""),
    );
  if (flickr) return `${flickr[1]}_z.jpg`;
  const commons =
    /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/([0-9a-f])\/([0-9a-f]{2})\/([^/?#]+)$/.exec(
      String(url ?? ""),
    );
  if (commons) {
    const [, first, pair, file] = commons;
    const png = /\.(?:svg|tiff?)$/i.test(file) ? ".png" : "";
    return `https://upload.wikimedia.org/wikipedia/commons/thumb/${first}/${pair}/${file}/500px-${file}${png}`;
  }
  return undefined;
}

const size = (value) =>
  Number.isInteger(value) && value > 0 ? value : undefined;

/** One Openverse image or sound as a Library item. */
export function item(result, mediaType) {
  const thumbnail =
    (mediaType === "image" ? siteThumbnail(result.url) : undefined) ??
    https(result.thumbnail);
  // A sound plays from its source site before it is added (OhMyGame API 2.35).
  const preview = mediaType === "audio" ? https(result.url) : undefined;
  const duration =
    typeof result.duration === "number" && result.duration > 0
      ? result.duration / 1000
      : undefined;
  return {
    id: result.id,
    name: text(result.title, 200) ?? "Untitled",
    mediaType,
    ...(thumbnail ? { thumbnail } : {}),
    ...(size(result.width) ? { width: result.width } : {}),
    ...(size(result.height) ? { height: result.height } : {}),
    ...(duration ? { duration } : {}),
    ...(preview ? { preview } : {}),
    ...credit(result),
  };
}

/** The file's kind from its first bytes, as the extension the Library expects. */
export function extensionOf(bytes, mediaType) {
  const ascii = (start, end) => bytes.subarray(start, end).toString("latin1");
  if (mediaType === "image") {
    if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "png";
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
      return "jpg";
    if (/^GIF8[79]a$/.test(ascii(0, 6))) return "gif";
    if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
    return undefined;
  }
  if (
    ascii(0, 3) === "ID3" ||
    (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  )
    return "mp3";
  if (ascii(0, 4) === "OggS") return "ogg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "wav";
  if (ascii(4, 8) === "ftyp") return "m4a";
  return undefined;
}

/** A file name from the title, without characters a file name can't hold. */
export function fileName(title, extension) {
  const base = String(title ?? "")
    .replace(/[\p{Cc}/\\:*?"<>|]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/, "")
    .slice(0, 120);
  return `${base || "openverse"}.${extension}`;
}

/**
 * What Openverse said it refused: `detail`, such as a page size over its
 * limit, or OAuth's `error`, such as `invalid_client`.
 */
async function detailOf(response) {
  return response
    .json()
    .then((body) => {
      const said = body?.detail ?? body?.error_description ?? body?.error;
      return typeof said === "string" ? said.slice(0, 300) : undefined;
    })
    .catch(() => undefined);
}

/**
 * Asks Openverse, without an account or as the application whose client ID
 * and secret the person saved in Settings. Openverse limits requests without
 * one by address (20 a minute, 200 a day); a registered, verified application
 * gets its own, higher limit. Its token is asked for once and again when it
 * expires or is refused.
 */
export function openverse({ clientId, clientSecret } = {}) {
  const id = typeof clientId === "string" ? clientId.trim() : "";
  const secret = typeof clientSecret === "string" ? clientSecret.trim() : "";
  const signedIn = Boolean(id && secret);
  let token;
  let asking;

  // Searches of images and audio run together: they share one request for a
  // token, and one for a new token when Openverse refuses the one they sent.
  function bearer(refused) {
    if (token && token.value !== refused && token.expires > Date.now())
      return Promise.resolve(token.value);
    if (asking) return asking;
    token = undefined;
    asking = requestToken().finally(() => {
      asking = undefined;
    });
    return asking;
  }

  async function requestToken() {
    const response = await fetch(`${API}/auth_tokens/token/`, {
      method: "POST",
      headers: {
        ...HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: id,
        client_secret: secret,
      }),
    });
    if (!response.ok) {
      const detail = await detailOf(response);
      throw new Error(
        `Openverse didn't accept the client ID and secret in this plugin's Settings (${response.status}${detail ? `: ${detail}` : ""}). Check them, or clear both to search without an account.`,
      );
    }
    const body = await response.json();
    if (typeof body?.access_token !== "string" || !body.access_token)
      throw new Error("Openverse answered without an access token");
    const seconds = Number.isFinite(body.expires_in) ? body.expires_in : 3600;
    // Renewed a minute early, so a search doesn't start with one about to expire.
    token = {
      value: body.access_token,
      expires: Date.now() + Math.max(0, seconds - 60) * 1000,
    };
    return token.value;
  }

  /** The response, and the token it was sent with. */
  async function ask(url, refused) {
    if (!signedIn) return { response: await fetch(url, { headers: HEADERS }) };
    const value = await bearer(refused);
    const response = await fetch(url, {
      headers: { ...HEADERS, Authorization: `Bearer ${value}` },
    });
    return { response, value };
  }

  return {
    signedIn,
    async call(url) {
      if (Boolean(id) !== Boolean(secret))
        throw new Error(
          "Fill in both the Openverse client ID and secret in this plugin's Settings, or clear both.",
        );
      let { response, value } = await ask(url);
      // A token Openverse no longer takes is asked for again, once.
      if (signedIn && response.status === 401)
        ({ response } = await ask(url, value));
      if (response.status === 429)
        throw new Error(
          signedIn
            ? "Openverse is limiting requests for the application in this plugin's Settings. Try again later."
            : "Openverse is limiting requests without an account (20 a minute, 200 a day). Try again later, or add an Openverse client ID and secret in this plugin's Settings for a higher limit.",
        );
      if (!response.ok) {
        const detail = await detailOf(response);
        throw new Error(
          `Openverse answered ${response.status}${detail ? `: ${detail}` : ""}`,
        );
      }
      return response.json();
    },
  };
}

export function activate(context) {
  const { call } = openverse(context.configuration);
  context.registerCommand("search", async ({ query, cursor, collection }) => {
    // An older app sends no collection: the first, Music.
    const { kinds, filters } = COLLECTIONS[collection] ?? COLLECTIONS.music;
    const page = Number(cursor ?? 1);
    const pages = await Promise.all(
      kinds.map(async (kind) => {
        const params = new URLSearchParams({
          page: String(page),
          // All shares one page between images and sounds.
          page_size: String(PAGE_SIZE / kinds.length),
          license: LICENSES,
          ...filters,
        });
        if (String(query ?? "").trim()) params.set("q", String(query).trim());
        return {
          kind,
          ...(await call(`${API}/${ENDPOINTS[kind]}/?${params}`)),
        };
      }),
    );
    const items = pages.flatMap(({ kind, results }) =>
      (Array.isArray(results) ? results : [])
        .filter(
          (result) =>
            typeof result?.id === "string" &&
            !UNSUPPORTED.has(String(result.filetype ?? "").toLowerCase()),
        )
        .map((result) => item(result, kind)),
    );
    const more = pages.some((result) => Number(result.page_count) > page);
    return { items, ...(more ? { next: String(page + 1) } : {}) };
  });

  context.registerCommand("fetch", async ({ id, mediaType }) => {
    if (!/^[0-9a-f-]{36}$/.test(String(id)) || !ENDPOINTS[mediaType])
      throw new Error(`${id} isn't an Openverse ${mediaType}`);
    const result = await call(`${API}/${ENDPOINTS[mediaType]}/${id}/`);
    const source = https(result.url);
    if (!source) throw new Error(`Openverse has no file to download for ${id}`);
    const response = await fetch(source, { headers: HEADERS });
    if (!response.ok)
      throw new Error(
        `${new URL(source).host} answered ${response.status} for ${id}`,
      );
    const bytes = Buffer.from(await response.arrayBuffer());
    const extension = extensionOf(bytes, mediaType);
    if (!extension)
      throw new Error(
        `${text(result.title, 200) ?? id} is in a format the Library doesn't take`,
      );
    // Adds run one at a time, so every download can be saved under one name.
    const file = `download.${extension}`;
    await writeFile(path.join(context.dataFolder, file), bytes);
    return { file, name: fileName(result.title, extension), ...credit(result) };
  });
}
