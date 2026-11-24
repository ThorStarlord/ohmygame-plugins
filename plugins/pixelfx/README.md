# Pixel Effects

Browse 244 pixel art effects, tune them and export sprite sheets.

Official OhMyGame plugin `ohmygame/pixelfx`, an optional Beta for OhMyGame
plugin API **2.38+**, ported from [pixelfx](https://github.com/rrenovation/pixelfx)
(MIT; see [NOTICE.md](NOTICE.md)). It is off until a project turns it on, and
isn't released yet: the package is `private` while the port is in progress.

## What it does

The **Pixel Effects** panel keeps the pixelfx gallery's look, with its four
colour themes and one that follows the app's colours, and shows the 244
built-in effects, each drawn by code frame by frame:

- pick an effect from the strip at the bottom, by category or by searching
  names in English or Chinese, tags and ids;
- play it on the stage over a backdrop, pause, replay, change the speed or
  scrub frame by frame (Space plays and pauses, ← → change the effect, and
  Shift+← → step a frame);
- change its backdrop, palette (or each colour), seed, frame rate, length,
  size, flip and actor, and the options its code declares;
- see it as a transparent sprite sheet, or read its source, a usage example
  and the sheet's JSON;
- export it: a transparent sprite sheet or a contact sheet goes to the
  Library, and a sprite sheet with Aseprite JSON, a GIF or single frames are
  saved to `pixelfx/exports/` in the project.

## Coming next

Effects of the project's own that the panel and the agent edit, a Skill, the
panel's assistant, sound effects, render and check tools for the agent, a
Library source and a Canvas node.

## Limits

- The built-in effects are read-only.
- Settings aren't kept when you change effects or close the panel; the
  colour theme and the last effect are.
