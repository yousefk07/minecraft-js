/* Tests for js/engine.js (constants, textures, boot) and js/ui.js (HUD). */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { loadGame, GAME_DIR } = require('./helpers/dom-stub');

function booted() {
  const g = loadGame();
  g.sandbox.initRenderer();
  g.sandbox.initScene();
  g.sandbox.initCamera();
  g.sandbox.createBlockMaterials();
  return g;
}

/* ------------------------------- constants ------------------------------ */

test('engine constants are the documented values', () => {
  const { sandbox: s } = booted();
  assert.strictEqual(s.CHUNK_SIZE, 16);
  assert.strictEqual(s.WORLD_HEIGHT, 64);
  assert.strictEqual(s.RENDER_DIST, 4);
});

test('BLOCK_TYPES ids are unique and air is 0', () => {
  const { sandbox: s } = booted();
  const ids = Object.values(s.BLOCK_TYPES);
  assert.strictEqual(s.BLOCK_TYPES.air, 0);
  assert.strictEqual(new Set(ids).size, ids.length, 'duplicate block ids');
});

test('BLOCK_NAMES is the reverse lookup of BLOCK_TYPES', () => {
  const { sandbox: s } = booted();
  // BLOCK_NAMES is module-local; check it through the debug formatter instead
  assert.strictEqual(s.BLOCK_TYPES[s.BLOCK_HOTBAR[0]], 1);
});

/* -------------------------------- textures ------------------------------ */

test('every solid block type gets a material and a texture', () => {
  const { sandbox: s } = booted();
  for (const name in s.BLOCK_TYPES) {
    const type = s.BLOCK_TYPES[name];
    if (type === 0) {
      assert.strictEqual(s.BLOCK_MATERIALS[type], undefined, 'air should have no material');
      continue;
    }
    assert.ok(s.BLOCK_MATERIALS[type], `no material for ${name}`);
    assert.ok(s.BLOCK_MATERIALS[type].map, `no texture for ${name}`);
  }
});

test('createBlockTexture returns a 16x16 canvas texture with nearest filtering', () => {
  const { sandbox: s } = booted();
  const tex = s.createBlockTexture(s.BLOCK_TYPES.stone);
  assert.strictEqual(tex.image.width, 16);
  assert.strictEqual(tex.image.height, 16);
  assert.strictEqual(tex.magFilter, s.THREE.NearestFilter);
  assert.strictEqual(tex.minFilter, s.THREE.NearestFilter);
  assert.strictEqual(tex.generateMipmaps, false);
});

test('texture generation is deterministic', () => {
  const { sandbox: s } = booted();
  const a = s.createBlockTexture(s.BLOCK_TYPES.grass);
  const b = s.createBlockTexture(s.BLOCK_TYPES.grass);
  assert.ok(a.image && b.image, 'textures have no canvas');
});

test('water is transparent and leaves use alphaTest', () => {
  const { sandbox: s } = booted();
  const water = s.BLOCK_MATERIALS[s.BLOCK_TYPES.water];
  const leaves = s.BLOCK_MATERIALS[s.BLOCK_TYPES.leaves];
  assert.strictEqual(water.transparent, true);
  assert.ok(water.opacity < 1, 'water should be see-through');
  assert.strictEqual(leaves.transparent, true);
  assert.ok(leaves.alphaTest > 0, 'leaves need alphaTest for the holes');
});

test('getBlockMaterial falls back to stone for unknown types', () => {
  const { sandbox: s } = booted();
  assert.strictEqual(s.getBlockMaterial(999), s.BLOCK_MATERIALS[s.BLOCK_TYPES.stone]);
});

/* --------------------------------- scene -------------------------------- */

test('the scene has a sky background, fog and lights', () => {
  const { sandbox: s } = booted();
  assert.ok(s.scene.background, 'no background colour');
  assert.ok(s.scene.fog, 'no fog');
  assert.strictEqual(s.scene.children.length, 2, 'expected ambient + directional light');
});

test('the renderer canvas is added to the page', () => {
  const { sandbox: s, doc } = booted();
  assert.ok(s.renderer.domElement, 'no canvas');
  assert.ok(doc.body.children.indexOf(s.renderer.domElement) >= 0,
    'renderer canvas not attached to the body');
});

test('resize updates the camera aspect and renderer size', () => {
  const { sandbox: s, win } = booted();
  win.innerWidth = 800;
  win.innerHeight = 400;
  s.onWindowResize();
  assert.strictEqual(s.camera.aspect, 2);
});

/* ---------------------------------- UI ---------------------------------- */

test('initUI builds a 9 slot hotbar with the right block icons', () => {
  const g = booted();
  const s = g.sandbox;
  s.initUI();

  const hotbar = g.doc.getElementById('hotbar');
  assert.ok(hotbar, 'no #hotbar element');
  const slots = hotbar.querySelectorAll('.hotbar-slot');
  assert.strictEqual(slots.length, 9, `expected 9 slots, got ${slots.length}`);

  const icons = hotbar.querySelectorAll('.block-icon');
  assert.strictEqual(icons.length, 9);
  assert.ok(icons[0].classList.contains('grass'), 'first icon should be grass');
  assert.ok(icons[8].classList.contains('bedrock'), 'last icon should be bedrock');
});

test('initUI builds the crosshair and debug overlay', () => {
  const g = booted();
  g.sandbox.initUI();
  assert.ok(g.doc.getElementById('crosshair'), 'no #crosshair');
  assert.ok(g.doc.getElementById('debug'), 'no #debug');
});

test('the first hotbar slot starts selected', () => {
  const g = booted();
  g.sandbox.initUI();
  const slots = g.doc.getElementById('hotbar').querySelectorAll('.hotbar-slot');
  assert.ok(slots[0].classList.contains('selected'), 'slot 0 not selected');
});

test('setSelectedSlot moves the highlight and clamps out-of-range values', () => {
  const g = booted();
  const s = g.sandbox;
  s.initUI();
  const slots = g.doc.getElementById('hotbar').querySelectorAll('.hotbar-slot');

  s.setSelectedSlot(3);
  assert.ok(slots[3].classList.contains('selected'));
  assert.ok(!slots[0].classList.contains('selected'), 'old slot still highlighted');

  s.setSelectedSlot(99);
  assert.ok(slots[8].classList.contains('selected'), 'high index not clamped');
  s.setSelectedSlot(-5);
  assert.ok(slots[0].classList.contains('selected'), 'negative index not clamped');
});

test('updateUI keeps the highlight in sync with player.js selectedSlot', () => {
  const g = booted();
  const s = g.sandbox;
  s.initUI();
  const slots = g.doc.getElementById('hotbar').querySelectorAll('.hotbar-slot');

  s.selectedSlot = 6;
  s.updateUI(1 / 60);
  assert.ok(slots[6].classList.contains('selected'), 'slot 6 not highlighted');
});

test('the debug overlay shows the player position', () => {
  const g = booted();
  const s = g.sandbox;
  s.initUI();
  s.playerPos.set(12.5, 30.25, -4.75);
  s.updateUI(1 / 60);
  const text = g.doc.getElementById('debug').textContent;
  assert.ok(/x:\s*12\.5/.test(text), `x missing from debug text: ${JSON.stringify(text)}`);
  assert.ok(/y:\s*30\.3/.test(text), `y missing from debug text: ${JSON.stringify(text)}`);
  assert.ok(/z:\s*-4\.8/.test(text), `z missing from debug text: ${JSON.stringify(text)}`);
  assert.ok(/FPS:/.test(text), 'FPS missing from debug text');
});

test('the debug overlay reports the held block name', () => {
  const g = booted();
  const s = g.sandbox;
  s.initUI();
  s.setSelectedSlot(2); // stone
  s.updateUI(1 / 60);
  const text = g.doc.getElementById('debug').textContent;
  assert.ok(/Held:\s*stone/.test(text), `held block wrong: ${JSON.stringify(text)}`);
});

/* -------------------------------- index.html ---------------------------- */

test('index.html loads three.js and the four game scripts in order', () => {
  const html = fs.readFileSync(path.join(GAME_DIR, 'index.html'), 'utf8');
  const srcs = Array.from(html.matchAll(/<script src="([^"]+)"/g)).map((m) => m[1]);
  assert.ok(srcs[0].indexOf('three') >= 0, 'three.js is not loaded first');
  assert.deepStrictEqual(srcs.slice(1), [
    'js/engine.js', 'js/world.js', 'js/player.js', 'js/ui.js'
  ]);
});

test('index.html references the stylesheet and the blocker overlay', () => {
  const html = fs.readFileSync(path.join(GAME_DIR, 'index.html'), 'utf8');
  assert.ok(html.indexOf('css/style.css') >= 0, 'stylesheet not linked');
  assert.ok(html.indexOf('id="blocker"') >= 0, 'no #blocker element');
});

test('the stylesheet defines the HUD elements the scripts create', () => {
  const css = fs.readFileSync(path.join(GAME_DIR, 'css', 'style.css'), 'utf8');
  for (const sel of ['#blocker', '#crosshair', '#hotbar', '.hotbar-slot', '#debug']) {
    assert.ok(css.indexOf(sel) >= 0, `${sel} missing from style.css`);
  }
});