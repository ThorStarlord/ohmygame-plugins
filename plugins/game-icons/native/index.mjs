// A Library source for game-icons.net: about 4,000 game icons as SVG, under
// CC BY 3.0 or CC0. The list of icons comes from the site's GitHub repository
// and is kept in the plugin's data folder for a week; the files and
// thumbnails come from game-icons.net.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const TREE =
  "https://api.github.com/repos/game-icons/icons/git/trees/master?recursive=1";
const SITE = "https://game-icons.net";
const HEADERS = { "User-Agent": "ohmygame-game-icons-plugin" };
const INDEX_FILE = "icons.json";
const INDEX_AGE = 7 * 24 * 60 * 60 * 1000;
const PAGE_SIZE = 60;
// Overlays for other icons, which the site doesn't serve by themselves.
const SKIPPED_FOLDERS = new Set(["badges"]);
// Folders whose icons are CC0, from the repository's license.txt.
const CC0_AUTHORS = new Set(["viscious-speed", "zeromancer"]);
const AUTHOR_NAMES = {
  "heavenly-dog": "HeavenlyDog",
  lucasms: "Lucas",
  "various-artists": "Various artists",
};
const ID = /^[a-z0-9-]+\/[a-z0-9-]+$/;

/** `lorc/broadsword.svg` paths from the repository's file list. */
export function iconsFromTree(tree) {
  if (!Array.isArray(tree?.tree))
    throw new Error("GitHub returned a list of icons this plugin can't read");
  return tree.tree
    .map((entry) => /^([a-z0-9-]+)\/([a-z0-9-]+)\.svg$/.exec(entry?.path ?? ""))
    .filter((match) => match && !SKIPPED_FOLDERS.has(match[1]))
    .map((match) => `${match[1]}/${match[2]}`);
}

/**
 * Icons whose names hold every word of the query, best matches first; every
 * icon for an empty query. Names are English, so a query without English
 * words finds none.
 */
export function match(icons, query) {
  const text = String(query ?? "")
    .trim()
    .toLowerCase();
  if (!text) return [...icons].sort(byName);
  const terms = text.split(/[^a-z0-9]+/).filter(Boolean);
  if (!terms.length) return [];
  const scored = [];
  for (const id of icons) {
    const words = id.split("/")[1].split("-");
    let score = 0;
    for (const term of terms) {
      if (words.includes(term)) score += 3;
      else if (words.some((word) => word.startsWith(term))) score += 2;
      else if (id.split("/")[1].includes(term)) score += 1;
      else {
        score = 0;
        break;
      }
    }
    if (score) scored.push({ id, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || byName(a.id, b.id))
    .map((item) => item.id);
}

function byName(a, b) {
  return a.split("/")[1].localeCompare(b.split("/")[1]) || a.localeCompare(b);
}

export function credit(id) {
  const [author, name] = id.split("/");
  return {
    author:
      AUTHOR_NAMES[author] ??
      author
        .split("-")
        .map((word) => word[0].toUpperCase() + word.slice(1))
        .join(" "),
    license: CC0_AUTHORS.has(author) ? "CC0" : "CC BY 3.0",
    url: `${SITE}/1x1/${author}/${name}.html`,
  };
}

export function item(id) {
  const [author, name] = id.split("/");
  return {
    id,
    name: `${name}.svg`,
    mediaType: "image",
    // White on black, so it shows on a light or dark page.
    thumbnail: `${SITE}/icons/ffffff/000000/1x1/${author}/${name}.png`,
    width: 512,
    height: 512,
    ...credit(id),
  };
}

export function activate(context) {
  const indexFile = path.join(context.dataFolder, INDEX_FILE);
  let loading;

  /** The icon list: kept for a week, and kept longer when GitHub can't be reached. */
  async function icons() {
    const saved = await readFile(indexFile, "utf8")
      .then(JSON.parse)
      .catch(() => undefined);
    if (saved && Date.now() - saved.fetchedAt < INDEX_AGE) return saved.icons;
    loading ??= (async () => {
      try {
        const response = await fetch(TREE, {
          headers: { ...HEADERS, Accept: "application/vnd.github+json" },
        });
        if (!response.ok)
          throw new Error(
            `GitHub answered ${response.status} for the list of icons`,
          );
        const list = iconsFromTree(await response.json());
        await writeFile(
          indexFile,
          JSON.stringify({ fetchedAt: Date.now(), icons: list }),
        );
        return list;
      } catch (error) {
        if (saved) return saved.icons;
        throw error;
      } finally {
        loading = undefined;
      }
    })();
    return loading;
  }

  context.registerCommand("search", async ({ query, cursor }) => {
    const found = match(await icons(), query);
    const start = Number(cursor ?? 0);
    const next = start + PAGE_SIZE;
    return {
      items: found.slice(start, next).map(item),
      ...(next < found.length ? { next: String(next) } : {}),
    };
  });

  context.registerCommand("fetch", async ({ id }) => {
    if (!ID.test(String(id)))
      throw new Error(`${id} isn't a game-icons.net icon`);
    const [author, name] = id.split("/");
    // Black on a transparent background, ready to recolor.
    const response = await fetch(
      `${SITE}/icons/000000/transparent/1x1/${author}/${name}.svg`,
      { headers: HEADERS },
    );
    if (!response.ok)
      throw new Error(`game-icons.net answered ${response.status} for ${id}`);
    await writeFile(
      path.join(context.dataFolder, "icon.svg"),
      Buffer.from(await response.arrayBuffer()),
    );
    return { file: "icon.svg", name: `${name}.svg`, ...credit(id) };
  });
}
