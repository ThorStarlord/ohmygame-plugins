# PixelLab (Beta)

An optional OhMyGame plugin for [PixelLab](https://www.pixellab.ai/) pixel art,
characters and skeleton animations. Requires OhMyGame plugin API **2.30**. It is
not preinstalled; add it from the plugin market.

## Connect

1. Create an API key in your PixelLab account.
2. Add the plugin and approve `api.pixellab.ai`.
3. Enter the key in plugin settings and turn on **Every project**.
4. Choose a PixelLab model in an Image node or the model settings.

The key stays in the app. The sandbox asks the host to authenticate requests,
including the GIF download, which PixelLab serves only to the key holder.

## Models

| Model | Input | Result |
|---|---|---|
| Pixen pixel art | Description; optional transparent background | 512×512 PNG |
| Character (8 directions) | Description; optional reference image | GIF turning through 8 directions |
| Skeleton animation | Motion description; one required reference image | South-facing animation GIF |

References larger than 256×256 are scaled down by the app with
nearest-neighbour sampling before they reach PixelLab. The canvas keeps the
original picture.

Every request is a paid PixelLab job, recorded with `host.submit`. After a
restart, retry checks the original job; a lost submission response is not
sent again. Stop ends local waiting only: PixelLab may still finish the job and
charge for it. Waiting is bounded at 30 minutes.

## Manual validation

1. Generate Pixen art with and without a transparent background.
2. Create a character with only a description, then with a large reference;
   check that the GIF downloads and plays on the canvas.
3. Try Skeleton animation without a reference (generation stays disabled), then
   with one character reference and a motion such as `walk in place`.
4. Quit while a character job runs, reopen, retry: PixelLab should show one job.
5. Check wrong-key, out-of-credit and failed-job messages.

## API sources

Reviewed 2026-11-15: [PixelLab API v2 OpenAPI](https://api.pixellab.ai/v2/openapi.json)
and [endpoint index](https://api.pixellab.ai/v2/llms.txt).
