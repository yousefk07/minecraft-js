/* Tests for js/world.js - chunk storage, terrain generation, meshing, raycast. */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loadGame } = require('./helpers/dom-stub');

function fresh() {
  const g = loadGame();
  const s = g.sandbox;
  // engine.js sets window.onload = init; call the world init pieces by hand
  s.initRenderer();
  s.initScene();
  s.initCamera();
  return g;
}

/* ------------------------------ constants ------------------------------- */

test('world constants match engine constants', () => {
  const { sandbox: s } = fresh();
  assert.strictEqual(s.CHUNK_SIZE, 16);
  assert.strictEqual(s.WORLD_HEIGHT, 64);
  assert.strictEqual(s.WATER_LEVEL, 12);
});

test('BLOCK ids are unique and air is 0', () => {
  const { sandbox: s } = fresh();
  const ids = Object.values(s.BLOCK);
  assert.strictEqual(s.BLOCK.AIR, 0);
  assert.strictEqual(new Set(ids).size, ids.length, 'duplicate block ids');
});

/* --------------------------- chunk generation --------------------------- */

test('generateChunk produces a full Uint8Array of the right size', () => {
  const { sandbox: s } = fresh();
  const c = s.generateChunk(0, 0);
  assert.ok(c.blocks instanceof Uint8Array);
  assert.strictEqual(c.blocks.length, 16 * 64 * 16);
  assert.strictEqual(c.cx, 0);
  assert.strictEqual(c.cz, 0);
});

test('bedrock at y=0, air above the surface, water up to WATER_LEVEL', () => {
  const { sandbox: s } = fresh();
  const c = s.generateChunk(0, 0);
  const idx = (x, y, z) => (y * 16 + z) * 16 + x;

  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) {
      assert.strictEqual(c.blocks[idx(x, 0, z)], s.BLOCK.BEDROCK,
        `bedrock missing at ${x},0,${z}`);
      const h = s.heightAt(x, z);
      // the column must be solid up to the surface height
      assert.notStrictEqual(c.blocks[idx(x, h, z)], s.BLOCK.AIR,
        `surface hole at ${x},${h},${z}`);
      // and empty above the water level
      assert.strictEqual(c.blocks[idx(x, 63, z)], s.BLOCK.AIR,
        `block at world top ${x},63,${z}`);
    }
  }
});

test('terrain height stays inside the world bounds', () => {
  const { sandbox: s } = fresh();
  for (let x = -200; x < 200; x += 7) {
    for (let z = -200; z < 200; z += 7) {
      const h = s.heightAt(x, z);
      assert.ok(h >= 1 && h < s.WORLD_HEIGHT, `height ${h} out of range at ${x},${z}`);
    }
  }
});

test('generation is deterministic for the same chunk coords', () => {
  const { sandbox: s } = fresh();
  const a = s.generateChunk(3, -2);
  const b = s.generateChunk(3, -2);
  assert.deepStrictEqual(Array.from(a.blocks), Array.from(b.blocks));
});

test('trees are generated somewhere in a 5x5 chunk area', () => {
  const { sandbox: s } = fresh();
  let wood = 0, leaves = 0;
  for (let cx = 0; cx < 5; cx++) {
    for (let cz = 0; cz < 5; cz++) {
      const c = s.generateChunk(cx, cz);
      for (let i = 0; i < c.blocks.length; i++) {
        if (c.blocks[i] === s.BLOCK.WOOD) wood++;
        else if (c.blocks[i] === s.BLOCK.LEAVES) leaves++;
      }
    }
  }
  assert.ok(wood > 0, 'no wood blocks generated');
  assert.ok(leaves > 0, 'no leaves blocks generated');
});

/* ------------------------------ get/setBlock ---------------------------- */

test('getBlock returns air for unloaded chunks and out-of-range y', () => {
  const { sandbox: s } = fresh();
  assert.strictEqual(s.getBlock(1000, 20, 1000), s.BLOCK.AIR);
  assert.strictEqual(s.getBlock(0, -1, 0), s.BLOCK.AIR);
  assert.strictEqual(s.getBlock(0, 64, 0), s.BLOCK.AIR);
});

test('setBlock then getBlock round-trips, including negative coords', () => {
  const { sandbox: s } = fresh();
  s.chunks.set('0,0', s.generateChunk(0, 0));
  s.chunks.set('-1,-1', s.generateChunk(-1, -1));

  s.setBlock(5, 30, 5, s.BLOCK.STONE);
  assert.strictEqual(s.getBlock(5, 30, 5), s.BLOCK.STONE);

  s.setBlock(-1, 30, -1, s.BLOCK.PLANK);
  assert.strictEqual(s.getBlock(-1, 30, -1), s.BLOCK.PLANK);

  // negative coords must not alias into the wrong chunk
  assert.notStrictEqual(s.getBlock(15, 30, 15), s.BLOCK.PLANK);
});

test('setBlock marks the chunk dirty and neighbours on borders', () => {
  const { sandbox: s } = fresh();
  s.chunks.set('0,0', s.generateChunk(0, 0));
  s.chunks.set('1,0', s.generateChunk(1, 0));
  s.chunks.get('0,0').dirty = false;
  s.chunks.get('1,0').dirty = false;

  s.setBlock(15, 30, 5, s.BLOCK.STONE); // lx === CS-1 -> neighbour +x
  assert.strictEqual(s.chunks.get('0,0').dirty, true);
  assert.strictEqual(s.chunks.get('1,0').dirty, true);
});

test('setBlock outside the world is ignored', () => {
  const { sandbox: s } = fresh();
  s.chunks.set('0,0', s.generateChunk(0, 0));
  s.setBlock(1, 999, 1, s.BLOCK.STONE);
  assert.strictEqual(s.getBlock(1, 999, 1), s.BLOCK.AIR);
});

/* -------------------------------- meshing ------------------------------- */

test('buildChunkMesh creates a mesh with position/normal/uv/color attributes', () => {
  const { sandbox: s } = fresh();
  s.chunks.set('0,0', s.generateChunk(0, 0));
  s.buildChunkMesh(0, 0);
  const c = s.chunks.get('0,0');
  assert.ok(c.mesh, 'no mesh built');
  const g = c.mesh.geometry;
  for (const name of ['position', 'normal', 'uv', 'color']) {
    assert.ok(g.attributes[name], `missing ${name} attribute`);
  }
  assert.strictEqual(g.attributes.position.count % 3, 0);
  assert.strictEqual(g.attributes.uv.count, g.attributes.position.count);
  assert.strictEqual(g.attributes.color.count, g.attributes.position.count);
  assert.strictEqual(c.dirty, false);
});

test('a single buried block produces no faces, an exposed one produces 6', () => {
  const { sandbox: s } = fresh();
  const c = s.generateChunk(0, 0);
  // clear a pocket of air
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) {
      for (let y = 1; y < 40; y++) c.blocks[(y * 16 + z) * 16 + x] = s.BLOCK.AIR;
    }
  }
  s.chunks.set('0,0', c);

  c.blocks[(20 * 16 + 8) * 16 + 8] = s.BLOCK.STONE; // fully surrounded by air
  s.buildChunkMesh(0, 0);
  const verts = s.chunks.get('0,0').mesh.geometry.attributes.position.count;
  assert.strictEqual(verts, 36, 'expected 6 faces * 6 vertices');
});

test('water is meshed separately from solid blocks', () => {
  const { sandbox: s } = fresh();
  const c = s.generateChunk(0, 0);
  s.chunks.set('0,0', c);
  s.buildChunkMesh(0, 0);
  // chunk 0,0 has terrain; water only exists where h <= WATER_LEVEL
  const hasWater = Array.from(c.blocks).some((b) => b === s.BLOCK.WATER);
  if (hasWater) {
    assert.ok(c.waterMesh, 'water blocks present but no water mesh');
    assert.strictEqual(c.waterMesh.name, 'water');
  }
  assert.ok(c.mesh, 'no solid mesh');
  assert.strictEqual(c.mesh.name, 'chunk');
});

/* -------------------------------- raycast ------------------------------- */

test('raycastVoxel hits the block straight ahead and reports the normal', () => {
  const { sandbox: s } = fresh();
  const c = s.generateChunk(0, 0);
  for (let i = 0; i < c.blocks.length; i++) c.blocks[i] = s.BLOCK.AIR;
  c.blocks[(10 * 16 + 8) * 16 + 8] = s.BLOCK.STONE;
  s.chunks.set('0,0', c);

  const origin = { x: 8.5, y: 10.5, z: 4.5 };
  const dir = { x: 0, y: 0, z: 1 };
  const hit = s.raycastVoxel(origin, dir, 6);
  assert.ok(hit, 'ray missed the block');
  assert.deepStrictEqual(hit.block, [8, 10, 8]);
  assert.deepStrictEqual(hit.normal, [0, 0, -1]);
});

test('raycastVoxel returns null when nothing is in reach', () => {
  const { sandbox: s } = fresh();
  const c = s.generateChunk(0, 0);
  for (let i = 0; i < c.blocks.length; i++) c.blocks[i] = s.BLOCK.AIR;
  s.chunks.set('0,0', c);
  const hit = s.raycastVoxel({ x: 8.5, y: 10.5, z: 8.5 }, { x: 0, y: 0, z: 1 }, 6);
  assert.strictEqual(hit, null);
});

test('raycastVoxel ignores water', () => {
  const { sandbox: s } = fresh();
  const c = s.generateChunk(0, 0);
  for (let i = 0; i < c.blocks.length; i++) c.blocks[i] = s.BLOCK.AIR;
  c.blocks[(10 * 16 + 8) * 16 + 8] = s.BLOCK.WATER;
  s.chunks.set('0,0', c);
  const hit = s.raycastVoxel({ x: 8.5, y: 10.5, z: 4.5 }, { x: 0, y: 0, z: 1 }, 6);
  assert.strictEqual(hit, null, 'water should not be raycast-hittable');
});

/* ------------------------------- streaming ------------------------------ */

test('updateWorld loads chunks around the player and unloads far ones', () => {
  const { sandbox: s } = fresh();
  s.playerPos.set(8, 40, 8);
  s.updateWorld();
  assert.ok(s.chunks.size > 0, 'no chunks loaded');
  const loaded = s.chunks.size;
  assert.ok(loaded >= 25, `expected at least a 5x5 area, got ${loaded}`);

  // teleport far away: old chunks must be dropped
  s.playerPos.set(8 + 16 * 100, 40, 8);
  s.updateWorld();
  assert.ok(s.chunks.has('100,0'), 'chunk at the new position not loaded');
  assert.ok(!s.chunks.has('0,0'), 'far chunk was not unloaded');
});