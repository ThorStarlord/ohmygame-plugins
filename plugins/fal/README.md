# fal.ai

Adds fal.ai to OhMyGame's Settings → Providers, with your own API key, for
pictures, videos, audio and 3D models. It has no chat models.

- API key: From fal.ai → Dashboard → Keys.

| Kind | Model | What it takes |
| --- | --- | --- |
| Image | FLUX.1 [schnell] (`fal-ai/flux/schnell`) | A prompt, in 1:1, 4:3, 3:4, 16:9 or 9:16 |
| Background removal | BiRefNet (`fal-ai/birefnet`) | One still PNG, JPEG or WebP; preserves dimensions and colors |
| Video | Kling O3 (`fal-ai/kling-video/o3/standard/image-to-video`) | A first frame, an optional last frame, and 3, 5, 10 or 15 seconds |
| Speech | MiniMax Speech-02 HD (`fal-ai/minimax/speech-02-hd`) | Up to 5,000 characters, in one of MiniMax's voices, as MP3 |
| Sound effects, music | Stable Audio (`fal-ai/stable-audio`) | A description and up to 47 seconds, as WAV |
| 3D | TRELLIS (`fal-ai/trellis`) | One picture of the object, as GLB |

Generation models are on from the start. Background removal has its own processing picker and does not change the default image model. To use more of fal.ai's models, open the fal.ai
provider in Settings → Providers and choose **Load models** under a kind: the
plugin reads fal.ai's most used models of that kind and what each one takes
(aspect ratios, lengths, voices, how many pictures), and you turn on the ones
you want. A model that asks for something OhMyGame doesn't send, such as a
mask or a sound clip, isn't listed.

Every request goes through fal.ai's queue, in
[`media/adapter.js`](media/adapter.js). OhMyGame runs that script in a sandbox:
it reaches only `queue.fal.run`, `api.fal.ai` (to list models) and the hosts
fal.ai's files are on, and OhMyGame adds the key to its requests. A video,
audio file or 3D model a restart cut off is checked again on **Retry**, not
paid for twice. fal.ai bills each request to your account.

Needs OhMyGame with plugin API 2.27.0 or later. Version 0.3.0 remains Beta.

Published as `@ohmygame/fal` from [ohmygame-plugins](https://github.com/WhiteTowerAI/ohmygame-plugins).

## Background removal

On an image's canvas toolbar, choose **Image tools → Remove background**
(中文：**图片工具 → 去除背景**), choose **BiRefNet**, then generate. Creation alone
does not send a paid request. The existing **AI image cutout** remains a prompted
redraw using an image generation model.

The plugin uses the [official BiRefNet queue API](https://fal.ai/models/fal-ai/birefnet/api),
General Use (Light), its default 1024×1024 operating resolution, PNG output,
`sync_mode: false` to retain request history and `refine_foreground: false`.
Operating resolution is internal to the model; the returned alpha must match the
source dimensions. OhMyGame applies that alpha to the normalized source RGB and
existing alpha, rejects resized/opaque/empty outputs and never substitutes a new
paid request after an uncertain failure. The source is limited to a still
PNG/JPEG/WebP up to 20 MiB and 64 million pixels; EXIF orientation and sRGB
normalization happen before submission. Edge quality still needs inspection on
your own artwork, especially hair, small sprites and existing transparency.

Closing the app or stopping locally keeps the queued task; **Retry** resumes it.
A failed result download or import keeps its receipt too. Do not create a second
node to recover an uncertain submission. Inputs are sent to fal.ai using the
existing key and approved hosts; no additional permissions or callback setup
are needed. An output on a host outside the existing allowlist fails explicitly;
report the hostname instead of granting a wildcard.

### Local acceptance

- Upgrade with the current app; confirm the existing key, provider switch,
  image default and model visibility are retained.
- Process a non-square JPG, a detailed PNG and a WebP; inspect foreground edges,
  dimensions, source colors and transparent PNG export. Try an already
  transparent source and confirm its existing alpha remains respected.
- Stop a queued cutout, then Retry; also quit/reopen during a queued job and
  Retry. Confirm in fal.ai request history that the same request is resumed.
- Disconnect before downloading the result, reconnect and Retry; no second
  submission should appear. Check explicit failure for invalid/opaque results.
- Confirm ordinary image generation and existing video/audio/3D selections
  still work. BiRefNet must not appear among image generation defaults.
