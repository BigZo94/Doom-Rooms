# THE BACKROOMS: DOOM EDITION

A self-contained, browser-based first-person horror game set in the Backrooms. You wander an endless, procedurally generated maze of mono-yellow rooms — damp wallpaper, moist office carpet, buzzing fluorescent lights — searching for the exit while your dread climbs and *something* paces the halls.

Built with React + Vite and a hand-written **textured software raycaster** (floor/ceiling casting, procedural textures, sprite billboarding) rendered to a single canvas. No game engine, no WebGL — just pixels.

> **Fully standalone.** No backend, no accounts, no API keys, no network calls. It runs entirely in the browser. (This was previously a Base44 app; all of that has been removed.)

## Run it

Requires [Node.js](https://nodejs.org/) 18+.

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually `http://localhost:5173`).

To build a static production bundle:

```bash
npm run build      # outputs to dist/
npm run preview    # serve the built bundle locally
```

The `dist/` folder is fully static — drop it on any static host (GitHub Pages, Netlify, S3, etc.).

## Controls

| Action | Keys |
| --- | --- |
| Move | `W` `A` `S` `D` |
| Turn | `Q` / `E`, arrow keys, or mouse (click the screen to capture the pointer) |
| Map | `M` |
| Flashlight | `F` |
| VHS / scanline filter | `C` |

Find the exit to descend to the next level. Don't let the dread meter fill. Don't let it catch you.

## Levels

Six hand-tuned levels, each with its own palette, maze size, dread rate, and entity behaviour:

0. **The Lobby** — the classic yellow
1. **Habitable Zone** — yellow-green concrete
2. **Pipe Dreams**
3. **Electrical Station**
4. **Abandoned Office**
5. **Terror Hotel**

## How it works

- **`src/lib/raycaster.js`** — the renderer, modelled on the canonical **Backrooms Level 0 ("The Lobby")**: near-uniform *mono-yellow* wallpaper with skirting boards and scattered electrical outlets, return vents, and water stains; moist low-pile commercial carpet; and a dropped acoustic-tile ceiling with long fluorescent troffers placed *inconsistently* (per the original lore). Per frame it casts textured floors and ceilings scanline-by-scanline, DDA-casts walls with a z-buffer, billboards the entity sprite, and applies distance fog, fluorescent flicker, a dread color-push, and an optional flashlight cone. Wall fixtures are chosen per map-cell from a deterministic hash, so outlets/vents/stains scatter across the space instead of tiling. All textures are generated procedurally and cached per level — nothing is loaded from disk.
- **`src/lib/mazeGenerator.js`** — an iterative backtracker that carves a perfect maze, then opens rooms and extra loops so the space reads like the Backrooms rather than a hedge maze. Every level is guaranteed solvable.
- **`src/lib/narrator.js`** — offline procedural narration. Level intros, ambient/entity/intrusive event lines, and death text are assembled from per-level fragment pools. (Originally these were LLM calls; they're now fully local so the game needs no network.)
- **`src/lib/audioEngine.js`** — generative ambient audio (hum, drips, footsteps) via the Web Audio API.
- **`src/components/game/`** — the React UI: title screen, HUD, dread bar, event overlays, transitions, and game-over screen.

## Project layout

```
src/
  App.jsx                 # mounts <Game/>
  main.jsx
  index.css               # CRT/scanline/vignette styling + animations
  pages/Game.jsx          # title screen <-> engine toggle
  components/game/        # HUD, overlays, title, game-over, transitions, engine
  lib/
    raycaster.js          # textured software renderer
    mazeGenerator.js      # maze + rooms
    narrator.js           # offline narration
    audioEngine.js        # Web Audio ambience
    levels.js             # the six level definitions
index.html
vite.config.js
tailwind.config.js
```

## License

Provided as-is for personal use.
