# minecraft-js

A Minecraft-style voxel game that runs in the browser. Open `index.html` and play — no build
step, no server, no dependencies to install.

![status](https://img.shields.io/badge/status-playable-brightgreen)

## Play

1. Open `index.html` in a browser (double-click it, or `Start-Process index.html` on Windows).
2. Click the **Click to Play** overlay to lock the mouse.
3. Press **Esc** to release the mouse and get the pause screen back.

The only external dependency is Three.js r128, loaded from the cdnjs CDN. You need an internet
connection the first time you load the page. If the CDN is blocked, the game shows a readable
error in the overlay instead of a black screen.

## Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` | Move |
| `Space` | Jump |
| Mouse | Look around |
| Left-click | Break block |
| Right-click | Place block |
| `1`–`9` | Select block from the hotbar |
| `Shift` | Sprint |
| `Esc` | Pause / release the mouse |

## What's in it

- **Infinite-ish terrain** streamed in 16×16×64 chunks, generated from a sine-based heightmap
  with grass, dirt, stone, sand, water and bedrock layers.
- **Trees** placed pseudo-randomly per chunk, with a wood trunk and a leaf canopy.
- **Greedy-ish meshing** — only faces touching air or water are emitted, so the triangle count
  stays low.
- **First-person controls** with pointer lock, gravity, jumping, sprinting and per-axis AABB
  collision against the voxel grid.
- **Block breaking and placing** via a DDA voxel raycast with a 6-block reach.
- **HUD** with a crosshair, a 9-slot hotbar and a debug readout (FPS, position, held block).
- **Procedural textures** — every block texture is drawn pixel-by-pixel onto a 16×16 canvas at
  load time and uploaded as a `THREE.CanvasTexture` with `NearestFilter`, so there are no image
  assets in the repo.

## Project layout

```
minecraft-game/
├── index.html          # page shell, pause overlay, script tags
├── css/
│   └── style.css       # overlay, crosshair, hotbar, debug styling
├── js/
│   ├── engine.js       # constants, textures, materials, scene, render loop
│   ├── world.js        # chunk storage, terrain generation, meshing, raycast
│   ├── player.js       # pointer lock, movement, collision, break/place
│   └── ui.js           # hotbar, crosshair, debug readout
└── test/               # node-based tests (see below)
```

The four `js/` files are plain scripts loaded in order by `index.html` and communicate through
globals (`scene`, `camera`, `playerPos`, `selectedSlot`, `getBlock`, `setBlock`,
`raycastVoxel`, …). There is no bundler and no module system.

## Tests

The tests run under Node with a small DOM/WebGL stub, so they don't need a browser:

```
node test/world.test.js
node test/player.test.js
node test/engine-ui.test.js
```

## How this was made

This project was built by a team of AI agents working in parallel, then checked and fixed by a
second wave of agents. The whole thing was driven from a single prompt:

> make a minecraft style game runnable in .html. Make it as similar to minecraft as possible

### Phase 1 — four builders in parallel

The work was split into four independent parts, each owned by one agent, with the interfaces
agreed up front so the pieces could be written simultaneously:

1. **Core Engine** — `index.html` and `js/engine.js`. Owned the block-type table, the
   procedural texture generator, the materials, the scene/camera/renderer setup and the main
   render loop.
2. **World Generation** — `js/world.js`. Owned chunk storage, the heightmap, tree placement,
   face culling and the voxel raycast.
3. **Player Controls** — `js/player.js`. Owned pointer lock, WASD movement, gravity, AABB
   collision and block break/place.
4. **HUD and UI** — `js/ui.js` and `css/style.css`. Owned the crosshair, hotbar and debug
   readout.

The split worked because the contracts were narrow: `engine.js` calls `initWorld()`,
`initPlayer()` and `initUI()` if they exist and then calls `updateWorld(dt)`,
`updatePlayer(dt)` and `updateUI(dt)` every frame. Everything else is shared globals.

### Phase 2 — integration, testing, review, security, docs

Once the four parts landed, five more agents looked at the result:

- **Integration** checked that the pieces actually fit: that every function one file calls is
  defined in another, that the DOM ids match between `index.html`, `player.js` and `ui.js`, and
  that the data shapes line up. Verdict: **problems** — a duplicated block-id table in
  `world.js` that disagreed with `engine.js`, and two stale primitive globals in `player.js`.
- **Tester** wrote Node tests for the world, player and engine/UI layers. It hit a bug in its
  own harness (the IIFE in `world.js` means its `var`s never become globals) and reported that
  honestly rather than papering over it.
- **Reviewer** read the code for bugs and edge cases and found twelve issues, worst first. The
  top ones: the two conflicting block-id tables, collision snap math that broke sliding along
  the `-x`/`-z` walls, chunk streaming that missed chunks when you walked back into an area you
  had already visited, and no handling for a failed CDN load.
- **Security** audited for injection, secrets and unsafe input. Being a fully client-side static
  page with no network I/O, most categories didn't apply; the real findings were the missing
  Subresource Integrity hash on the CDN script and an `innerHTML` used to clear the hotbar.
- **Docs** was responsible for this README.

### Phase 3 — fixes

A final **fixer** agent worked through the reports:

- `world.js` now aliases `BLOCK_TYPES` from `engine.js` instead of keeping its own table, and
  `updateWorld` no longer skips the dirty-chunk rebuild when the player stays in one chunk.
- `player.js` snaps to the correct face on `-x`/`-z` collisions, exposes `onGround` and
  `selectedSlot` as live accessors instead of frozen copies, and notifies the HUD when the
  selection changes.
- `ui.js` dropped its duplicate `keydown` listener and clears the hotbar with `removeChild`
  instead of `innerHTML`.
- `engine.js` gained a `typeof THREE === 'undefined'` guard that shows a readable message if the
  CDN fails.
- `index.html` gained an `integrity` hash, `crossorigin` and `referrerpolicy` on the Three.js
  script tag.

### Phase 4 — the SRI hash bug

The `integrity` attribute added in phase 3 was wrong. It had been computed from a different
copy of the file, so the browser refused to execute Three.js and the game died with
`Could not load three.js` — the guard from phase 3 doing its job, but pointing at the wrong
culprit.

The fix was to download `three.min.js` from the CDN, hash the bytes locally with SHA-512, and
paste the real digest into `index.html`. The lesson: an SRI hash is only useful if it's
generated from the exact bytes the CDN serves, so compute it, don't transcribe it.

## Known limitations

- **No persistence.** Reload the page and the world regenerates from scratch; nothing you build
  is saved.
- **No mobs, crafting, inventory or day/night cycle.** It's terrain, movement and block
  editing.
- **Water is decorative.** You can walk through it; there's no swimming or drowning.
- **Three.js r128 is old.** Upgrading is a bigger change than it looks, since r128 predates the
  module-first API.
- **No CSP meta tag.** Adding one would need `'unsafe-inline'` for the inline fallback styles in
  `index.html`, or moving those styles into `css/style.css`.

## License

MIT. Not affiliated with Mojang or Microsoft; "Minecraft" is used descriptively.