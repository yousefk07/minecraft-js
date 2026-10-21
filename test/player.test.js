/* Tests for js/player.js - movement, gravity, collision, break/place. */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadGame } = require('./helpers/dom-stub');

/* Build a world that is completely empty except for a floor at y = 9,
   so the player starts standing on solid ground at y = 10. */
function flatWorld() {
  const g = loadGame();
  const s = g.sandbox;
  s.initRenderer();
  s.initScene();
  s.initCamera();

  const c = s.generateChunk(0, 0);
  for (let i = 0; i < c.blocks.length; i++) c.blocks[i] = s.BLOCK.AIR;
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) {
      c.blocks[(9 * 16 + z) * 16 + x] = s.BLOCK.STONE;
    }
  }
  s.chunks.set('0,0', c);

  s.playerPos.set(8, 10, 8);
  s.playerVelocity.set(0, 0, 0);
  return g;
}

function press(s, code) { s.document.dispatch('keydown', { code, key: code, preventDefault() {} }); }
function release(s, code) { s.document.dispatch('keyup', { code, key: code }); }

/* ------------------------------- constants ------------------------------ */

test('player constants are the documented Minecraft-like values', () => {
  const { sandbox: s } = flatWorld();
  assert.strictEqual(s.PLAYER_HEIGHT, 1.8);
  assert.strictEqual(s.PLAYER_WIDTH, 0.6);
  assert.strictEqual(s.GRAVITY, -25);
  assert.strictEqual(s.JUMP_SPEED, 9);
  assert.strictEqual(s.WALK_SPEED, 5);
  assert.strictEqual(s.SPRINT_SPEED, 8);
});

test('hotbar has 9 slots and every name maps to a real block type', () => {
  const { sandbox: s } = flatWorld();
  assert.strictEqual(s.BLOCK_HOTBAR.length, 9);
  for (const name of s.BLOCK_HOTBAR) {
    assert.notStrictEqual(s.BLOCK_TYPES[name], undefined, `unknown block "${name}"`);
  }
});

/* -------------------------------- gravity ------------------------------- */

test('gravity pulls the player down and they land on the floor', () => {
  const { sandbox: s } = flatWorld();
  s.playerPos.set(8, 20, 8);
  for (let i = 0; i < 200; i++) s.updatePlayer(1 / 60);
  assert.ok(Math.abs(s.playerPos.y - 10) < 0.05,
    `expected to rest at y=10, got ${s.playerPos.y}`);
  assert.strictEqual(s.onGround, true);
});

test('the player never falls through the floor', () => {
  const { sandbox: s } = flatWorld();
  s.playerPos.set(8, 30, 8);
  for (let i = 0; i < 600; i++) {
    s.updatePlayer(1 / 60);
    assert.ok(s.playerPos.y >= 9.9, `fell through the floor to y=${s.playerPos.y}`);
  }
});

test('jumping only works while on the ground', () => {
  const { sandbox: s } = flatWorld();
  for (let i = 0; i < 60; i++) s.updatePlayer(1 / 60); // settle
  assert.strictEqual(s.onGround, true);

  press(s, 'Space');
  s.updatePlayer(1 / 60);
  assert.ok(s.playerVelocity.y > 0, 'jump did not apply upward velocity');
  assert.strictEqual(s.onGround, false);

  // in mid-air a second jump must not add speed
  const vy = s.playerVelocity.y;
  s.updatePlayer(1 / 60);
  assert.ok(s.playerVelocity.y < vy, 'double jump in mid-air');
  release(s, 'Space');
});

/* ------------------------------- movement ------------------------------- */

test('W moves the player forward along -Z when yaw is 0', () => {
  const { sandbox: s } = flatWorld();
  const z0 = s.playerPos.z;
  press(s, 'KeyW');
  for (let i = 0; i < 30; i++) s.updatePlayer(1 / 60);
  release(s, 'KeyW');
  assert.ok(s.playerPos.z < z0 - 1, `expected to move -Z, z went ${z0} -> ${s.playerPos.z}`);
  assert.ok(Math.abs(s.playerPos.x - 8) < 0.01, 'drifted sideways');
});

test('S moves backwards, D strafes right', () => {
  const { sandbox: s } = flatWorld();
  const z0 = s.playerPos.z;
  press(s, 'KeyS');
  for (let i = 0; i < 30; i++) s.updatePlayer(1 / 60);
  release(s, 'KeyS');
  assert.ok(s.playerPos.z > z0 + 1, 'S did not move backwards');

  const x0 = s.playerPos.x;
  press(s, 'KeyD');
  for (let i = 0; i < 30; i++) s.updatePlayer(1 / 60);
  release(s, 'KeyD');
  assert.ok(s.playerPos.x > x0 + 1, 'D did not strafe right');
});

test('sprinting is faster than walking', () => {
  const walk = flatWorld();
  press(walk.sandbox, 'KeyW');
  for (let i = 0; i < 30; i++) walk.sandbox.updatePlayer(1 / 60);
  const walkDist = Math.abs(walk.sandbox.playerPos.z - 8);

  const run = flatWorld();
  press(run.sandbox, 'KeyW');
  press(run.sandbox, 'ShiftLeft');
  for (let i = 0; i < 30; i++) run.sandbox.updatePlayer(1 / 60);
  const runDist = Math.abs(run.sandbox.playerPos.z - 8);

  assert.ok(runDist > walkDist * 1.3,
    `sprint (${runDist.toFixed(2)}) not clearly faster than walk (${walkDist.toFixed(2)})`);
});

test('movement direction follows the yaw angle', () => {
  const { sandbox: s } = flatWorld();
  s.yaw = Math.PI / 2; // looking along -X
  const x0 = s.playerPos.x;
  press(s, 'KeyW');
  for (let i = 0; i < 30; i++) s.updatePlayer(1 / 60);
  release(s, 'KeyW');
  assert.ok(s.playerPos.x < x0 - 1, `expected to move -X, x went ${x0} -> ${s.playerPos.x}`);
});

/* ------------------------------- collision ------------------------------ */

test('the player is stopped by a wall', () => {
  const { sandbox: s } = flatWorld();
  const c = s.chunks.get('0,0');
  for (let y = 10; y < 13; y++) {
    for (let z = 0; z < 16; z++) c.blocks[(y * 16 + z) * 16 + 4] = s.BLOCK.STONE;
  }
  s.playerPos.set(8, 10, 8);
  s.yaw = Math.PI / 2; // walk towards -X, into the wall at x=4

  press(s, 'KeyW');
  for (let i = 0; i < 300; i++) s.updatePlayer(1 / 60);
  release(s, 'KeyW');

  assert.ok(s.playerPos.x > 5, `walked through the wall, x=${s.playerPos.x}`);
  assert.ok(s.playerPos.x < 5.5, `stopped too far from the wall, x=${s.playerPos.x}`);
});

test('the player cannot walk into a block at head height', () => {
  const { sandbox: s } = flatWorld();
  const c = s.chunks.get('0,0');
  c.blocks[(11 * 16 + 8) * 16 + 6] = s.BLOCK.STONE; // y=11, x=6
  s.playerPos.set(8, 10, 8);
  s.yaw = Math.PI / 2;
  press(s, 'KeyW');
  for (let i = 0; i < 300; i++) s.updatePlayer(1 / 60);
  release(s, 'KeyW');
  assert.ok(s.playerPos.x > 6, `head-height block ignored, x=${s.playerPos.x}`);
});

test('water does not block the player', () => {
  const { sandbox: s } = flatWorld();
  const c = s.chunks.get('0,0');
  for (let y = 10; y < 12; y++) {
    for (let z = 0; z < 16; z++) c.blocks[(y * 16 + z) * 16 + 4] = s.BLOCK.WATER;
  }
  s.playerPos.set(8, 10, 8);
  s.yaw = Math.PI / 2;
  press(s, 'KeyW');
  for (let i = 0; i < 120; i++) s.updatePlayer(1 / 60);
  release(s, 'KeyW');
  assert.ok(s.playerPos.x < 5, `water blocked the player, x=${s.playerPos.x}`);
});

/* ------------------------------ camera sync ----------------------------- */

test('the camera sits at eye height above the player', () => {
  const { sandbox: s } = flatWorld();
  s.updatePlayer(1 / 60);
  assert.ok(Math.abs(s.camera.position.x - s.playerPos.x) < 1e-9);
  assert.ok(Math.abs(s.camera.position.z - s.playerPos.z) < 1e-9);
  assert.ok(Math.abs(s.camera.position.y - (s.playerPos.y + 1.6)) < 1e-9);
  assert.strictEqual(s.camera.rotation.order, 'YXZ');
});

/* ------------------------------ block edits ----------------------------- */

test('left click breaks the block being looked at', () => {
  const { sandbox: s } = flatWorld();
  const c = s.chunks.get('0,0');
  c.blocks[(10 * 16 + 8) * 16 + 6] = s.BLOCK.STONE; // 2 blocks in front (-X)
  s.playerPos.set(8, 10, 8);
  s.yaw = Math.PI / 2;
  s.pitch = 0;
  s.updatePlayer(1 / 60); // sync the camera

  s.document.pointerLockElement = s.document.body;
  s.document.dispatch('mousedown', { button: 0 });

  assert.strictEqual(s.getBlock(6, 10, 8), s.BLOCK.AIR, 'block was not broken');
});

test('right click places the selected block next to the target', () => {
  const { sandbox: s } = flatWorld();
  const c = s.chunks.get('0,0');
  c.blocks[(10 * 16 + 8) * 16 + 6] = s.BLOCK.STONE;
  s.playerPos.set(8, 10, 8);
  s.yaw = Math.PI / 2;
  s.pitch = 0;
  s.selectedSlot = 2; // stone
  s.updatePlayer(1 / 60);

  s.document.pointerLockElement = s.document.body;
  s.document.dispatch('mousedown', { button: 2 });

  assert.strictEqual(s.getBlock(7, 10, 8), s.BLOCK_TYPES.stone,
    'block was not placed in front of the target');
});

test('blocks are not placed inside the player', () => {
  const { sandbox: s } = flatWorld();
  const c = s.chunks.get('0,0');
  c.blocks[(10 * 16 + 8) * 16 + 7] = s.BLOCK.STONE; // right next to the player
  s.playerPos.set(8, 10, 8);
  s.yaw = Math.PI / 2;
  s.pitch = 0;
  s.updatePlayer(1 / 60);

  s.document.pointerLockElement = s.document.body;
  s.document.dispatch('mousedown', { button: 2 });

  // the block would land at x=8, which is where the player stands
  assert.strictEqual(s.getBlock(8, 10, 8), s.BLOCK.AIR,
    'a block was placed inside the player');
});

test('mouse clicks are ignored without pointer lock', () => {
  const { sandbox: s } = flatWorld();
  const c = s.chunks.get('0,0');
  c.blocks[(10 * 16 + 8) * 16 + 6] = s.BLOCK.STONE;
  s.playerPos.set(8, 10, 8);
  s.yaw = Math.PI / 2;
  s.updatePlayer(1 / 60);

  s.document.pointerLockElement = null;
  s.document.dispatch('mousedown', { button: 0 });
  assert.strictEqual(s.getBlock(6, 10, 8), s.BLOCK.STONE, 'broke a block while paused');
});

/* ------------------------------- hotbar keys ---------------------------- */

test('number keys 1-9 select the hotbar slot', () => {
  const { sandbox: s } = flatWorld();
  press(s, 'Digit5');
  assert.strictEqual(s.selectedSlot, 4);
  press(s, 'Digit1');
  assert.strictEqual(s.selectedSlot, 0);
  press(s, 'Digit9');
  assert.strictEqual(s.selectedSlot, 8);
  assert.strictEqual(s.getSelectedBlockType(), s.BLOCK_TYPES.bedrock);
});

/* ------------------------------ mouse look ------------------------------ */

test('mouse movement changes yaw and pitch, clamped at the poles', () => {
  const { sandbox: s } = flatWorld();
  s.document.pointerLockElement = s.document.body;
  const y0 = s.yaw;
  s.document.dispatch('mousemove', { movementX: 100, movementY: 0 });
  assert.ok(s.yaw < y0, 'yaw did not change');

  s.document.dispatch('mousemove', { movementX: 0, movementY: -100000 });
  assert.ok(s.pitch <= Math.PI / 2, `pitch not clamped: ${s.pitch}`);
  s.document.dispatch('mousemove', { movementX: 0, movementY: 100000 });
  assert.ok(s.pitch >= -Math.PI / 2, `pitch not clamped: ${s.pitch}`);
});

test('mouse look is ignored without pointer lock', () => {
  const { sandbox: s } = flatWorld();
  s.document.pointerLockElement = null;
  const y0 = s.yaw;
  s.document.dispatch('mousemove', { movementX: 100, movementY: 50 });
  assert.strictEqual(s.yaw, y0);
});

/* ------------------------------ initPlayer ------------------------------ */

test('initPlayer puts the player above the terrain surface', () => {
  const g = loadGame();
  const s = g.sandbox;
  s.initRenderer();
  s.initScene();
  s.initCamera();
  s.chunks.set('0,0', s.generateChunk(0, 0));
  s.playerPos.set(8, 40, 8);
  s.initPlayer();
  const h = s.heightAt(8, 8);
  assert.strictEqual(s.playerPos.y, h + 2);
  assert.strictEqual(s.playerVelocity.y, 0);
});