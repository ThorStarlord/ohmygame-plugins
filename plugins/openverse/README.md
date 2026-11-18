# Openverse Beta

A Library source for [Openverse](https://openverse.org): openly licensed music,
sound effects and images. Requires OhMyGame plugin API **2.5+**; its
collections, previews and one-hour cache need **2.35+**.

## Use

Turn the plugin on under Plugins. It adds an **Openverse** tab to the Library
page with three collections, in this order:

| Collection | What Openverse is asked for |
| --- | --- |
| **Music** (first) | Audio with `category=music`: tracks, mostly from Jamendo |
| **Sound effects** | Audio with `source=freesound`: Freesound's sounds carry no category, so they are asked for by source |
| **All** | Every image and every sound, from every source: 10 of each a page |

Scrolling loads the next page. A sound plays from its source site before you
add it. An added file keeps its author, license and original page, shown in
its details.

Most of Openverse's images are photos, maps and museum pieces from Flickr,
iNaturalist, Wikimedia Commons and museums, so they show only under All.

## Licenses

The plugin asks the [Openverse API](https://api.openverse.org/v1/) only for
licenses that allow commercial use and changes: CC0, the Public Domain Mark,
CC BY and CC BY-SA. Credit the author where you use a sound, and share changes
to CC BY-SA work under the same license. Openverse reports each license from
the source site; check the original page before relying on it.

## How it works

`native/index.mjs` searches `/v1/audio/`, and `/v1/images/` too for All, 20
results a page, the most Openverse gives without an account. Results in a
format the Library doesn't take, such as FLAC, MIDI or TIFF, are left out when
Openverse knows the type. Adding a result reads its details again and
downloads the original file from its site; the file's first bytes decide its
extension, and one the Library doesn't take is refused.

Openverse's image thumbnails fetch each image from its site every time and
often fail ("Thumbnail unavailable from provider"), so images on Flickr and
Wikimedia Commons, most of them, use those sites' own sizes instead (Flickr's
640-pixel `_z`, Commons' 500-pixel thumbnail); others keep Openverse's.

The manifest's `cacheSeconds: 3600` asks OhMyGame to show a browse of a
collection, without search words, again for an hour before asking Openverse;
searches with words, and **Refresh**, always ask.

Without an account, Openverse allows 20 requests a minute and 200 a day from
one address. A search uses one request, two under All, and each add one more.
When Openverse refuses, the tab says so.

## Your own Openverse application (optional)

Openverse's anonymous limits apply to each network address, so everyone behind
one office or school connection shares them. With an application of your own,
searches count against its limit instead:

1. Register it once, with a unique name and an email address you can read:

   ```sh
   curl -X POST -H "Content-Type: application/json" \
     -d '{"name": "<unique name>", "description": "OhMyGame Library", "email": "<your email>"}' \
     https://api.openverse.org/v1/auth_tokens/register/
   ```

   Keep the `client_id` and `client_secret` it answers with: Openverse can't
   show them again.
2. Click the link in the email Openverse sends. Until then the application has
   the anonymous limits.
3. In OhMyGame, open this plugin's Settings and fill in **Openverse client ID**
   and **Openverse client secret**. The secret is saved as a secret on this
   computer; turning the plugin on allows it to read it (`capabilities.secrets`).

The plugin then asks `/v1/auth_tokens/token/` for an access token, keeps it
until a minute before it expires, and asks again when Openverse refuses it.
Clear both fields to search without an account. Openverse doesn't publish the
registered limits; `/v1/rate_limit/` with the token reports yours.

## Local acceptance

- Add the folder under Plugins › Add plugin › This computer with Develop on,
  turn it on and open the Library: the tab opens on Music; switch to Sound
  effects and All (images and sounds), search `explosion`, and scroll to load
  more.
- Play a few results, add a track and a sound effect, and check their details
  show the author, license and page.
- Save a wrong client ID and secret: searching says Openverse didn't accept
  them. Save your registered ones: searching works, and Openverse's 429 no
  longer comes after 20 searches in a minute.
