# Game icons Beta

A Library source for [game-icons.net](https://game-icons.net): about 4,000
game icons as SVG. Requires OhMyGame plugin API **2.5+**.

## Use

Turn the plugin on under Plugins. It adds a **Game icons** tab to the Library
page. Search in English (`sword`, `health potion`, `shield`): icons whose names
hold every word come first, then names that start with them or contain them.
An empty search lists every icon by name; a search without English words finds
nothing. Scrolling loads 60 more at a time.

An added icon is a black SVG on a transparent background, ready to recolor.
Its author, license and game-icons.net page stay with it in the Library.

## Licenses

Most icons are under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/):
credit the author, as the site asks with "Icons made by {author}". The
`viscious-speed` and `zeromancer` folders are CC0. See [NOTICE.md](NOTICE.md).

## How it works

`native/index.mjs` reads the list of icons from the
[game-icons/icons](https://github.com/game-icons/icons) repository with
GitHub's tree API once a week and keeps it in the plugin's data folder. When
GitHub can't be reached, an older list is used. It leaves out the `badges`
folder, overlays the site doesn't serve on their own. Thumbnails (white on
black PNG) and added files come from game-icons.net.

GitHub allows 60 unauthenticated API requests an hour from one address; the
plugin makes one a week.

## Local acceptance

- Add the folder under Plugins › Add plugin › This computer with Develop on,
  turn it on and open the Library: the first search loads the list, later
  searches answer at once.
- Add an icon; check its details show the author, license and page, and that
  it renders on a light and a dark background.
