---
name: pixellab-assets
description: Choose and prompt PixelLab models for pixel art, eight-direction characters, frame animations and skeleton animations. Use when a game asset is made with the PixelLab provider; not for other image providers.
---

# PixelLab assets

PixelLab models appear in the ordinary image catalog under the PixelLab
provider. Use them only when the person has the provider configured.

## Models

- **Pixen pixel art** (`pixen`): one 512×512 pixel-art PNG from a description.
  It takes no reference image.
- **Character (8 directions)** (`character`): a PixelLab character, returned as
  a GIF that turns through its eight directions. Describe the character. One
  south-facing reference image is optional.
- **Skeleton animation** (`skeleton-animation`): needs exactly one character
  reference image. The prompt is the motion only, such as `walk in place`,
  `sword slash` or `fall backward`. Returns the south-facing animation as a GIF.
- **Frame animation** (`frame-animation`): needs exactly one reference image and
  a motion prompt such as `run in place` or `swing a sword`. Returns PixelLab's
  individual generated frames; the app does not rebuild them into a sprite sheet.

## Results and references

Show the returned PNG or GIF as it is. Do not describe it as a sprite sheet,
separate frames or pose data; the app does not split or rebuild it.

A reference works best as one complete character on a transparent background.
The app scales references larger than 256×256 down with hard pixel edges
before sending them; the canvas keeps the original. A GIF used as a reference,
such as a Character result, is sent as its first frame, so prefer a still,
south-facing picture of the character for Skeleton animation.

Each generation is a paid PixelLab job. After a failure, use the saved job's
Retry instead of generating again, so the original job is checked.
