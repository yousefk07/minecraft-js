// world.js - Minecraft-like voxel world: chunks, terrain generation, meshing, raycasting.
// Depends on globals from engine.js: CHUNK_SIZE, WORLD_HEIGHT, scene, THREE.
// Exposes globals: chunks, getBlock, setBlock, buildChunkMesh, updateWorld, raycastVoxel, ...

(function () {
  'use strict';

  // ---- Constants (fall back if engine.js hasn't defined them) ----
  var CS = (typeof CHUNK_SIZE !== 'undefined') ? CHUNK_SIZE : 16;
  var WH = (typeof WORLD_HEIGHT !== 'undefined') ? WORLD_HEIGHT : 64;
  var RENDER_DIST = (typeof window.RENDER_DIST !== 'undefined') ? window.RENDER_DIST : 4;
  var WATER_LEVEL = 12;

  // Block ids - single source of truth is BLOCK_TYPES in engine.js.
  // (This used to be a second, conflicting table where BEDROCK was 8.)
  var BLOCK = (typeof BLOCK_TYPES !== 'undefined') ? BLOCK_TYPES : {
    air: 0, grass: 1, dirt: 2, stone: 3, wood: 4, leaves: 5,
    sand: 6, water: 7, cobblestone: 8, plank: 9, bedrock: 10
  };
  // Uppercase aliases so the rest of this file keeps reading naturally.
  var AIR = BLOCK.air, GRASS = BLOCK.grass, DIRT = BLOCK.dirt, STONE = BLOCK.stone,
      WOOD = BLOCK.wood, LEAVES = BLOCK.leaves, SAND = BLOCK.sand, WATER = BLOCK.water,
      COBBLESTONE = BLOCK.cobblestone, PLANK = BLOCK.plank, BEDROCK = BLOCK.bedrock;

  // Face definitions: [normal, 4 corner offsets (CCW seen from outside)]
  var FACES = [
    { // +X
      dir: [1, 0, 0],
      corners: [[1, 1, 1], [1, 0, 1], [1, 0, 0], [1, 1, 0]]
    },
    { // -X
      dir: [-1, 0, 0],
      corners: [[0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1]]
    },
    { // +Y
      dir: [0, 1, 0],
      corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]]
    },
    { // -Y
      dir: [0, -1, 0],
      corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]
    },
    { // +Z
      dir: [0, 0, 1],
      corners: [[0, 1, 1], [0, 0, 1], [1, 0, 1], [1, 1, 1]]
    },
    { // -Z
      dir: [0, 0, -1],
      corners: [[1, 1, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0]]
    }
  ];

  // ---- Chunk storage ----
  // chunks: Map<'cx,cz', {cx, cz, blocks: Uint8Array, mesh, waterMesh, dirty}>
  var chunks = new Map();

  function chunkKey(cx, cz) { return cx + ',' + cz; }

  function idx(x, y, z) { return (y * CS + z) * CS + x; }

  function createChunk(cx, cz) {
    return {
      cx: cx,
      cz: cz,
      blocks: new Uint8Array(CS * WH * CS),
      mesh: null,
      waterMesh: null,
      dirty: false
    };
  }

  function getChunk(cx, cz) { return chunks.get(chunkKey(cx, cz)) || null; }

  function getBlock(x, y, z) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y < 0 || y >= WH) return AIR;
    var cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    var c = chunks.get(chunkKey(cx, cz));
    if (!c) return AIR;
    var lx = x - cx * CS, lz = z - cz * CS;
    return c.blocks[idx(lx, y, lz)];
  }

  function setBlock(x, y, z, type) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (y < 0 || y >= WH) return;
    var cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    var c = chunks.get(chunkKey(cx, cz));
    if (!c) return;
    var lx = x - cx * CS, lz = z - cz * CS;
    c.blocks[idx(lx, y, lz)] = type;
    c.dirty = true;
    // mark neighbours dirty if we touched a border block
    if (lx === 0) markDirty(cx - 1, cz);
    if (lx === CS - 1) markDirty(cx + 1, cz);
    if (lz === 0) markDirty(cx, cz - 1);
    if (lz === CS - 1) markDirty(cx, cz + 1);
  }

  function markDirty(cx, cz) {
    var c = chunks.get(chunkKey(cx, cz));
    if (c) c.dirty = true;
  }

  // ---- Terrain generation ----
  function heightAt(x, z) {
    var h = 20
      + 8 * Math.sin(x * 0.05) * Math.cos(z * 0.05)
      + 4 * Math.sin(x * 0.11 + 3) * Math.cos(z * 0.13 + 7)
      + 2 * Math.sin(x * 0.23) * Math.sin(z * 0.19);
    return Math.floor(h);
  }

  // Deterministic pseudo-random from chunk coords
  function hash2(a, b) {
    var n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453123;
    return n - Math.floor(n);
  }

  function generateChunk(cx, cz) {
    var c = createChunk(cx, cz);
    var blocks = c.blocks;
    var baseX = cx * CS, baseZ = cz * CS;

    for (var lx = 0; lx < CS; lx++) {
      for (var lz = 0; lz < CS; lz++) {
        var wx = baseX + lx, wz = baseZ + lz;
        var h = heightAt(wx, wz);
        if (h < 1) h = 1;
        if (h > WH - 1) h = WH - 1;

        for (var y = 0; y <= h; y++) {
          var t = AIR;
          if (y === 0) {
            t = BEDROCK;
          } else if (y < h - 4) {
            t = STONE;
          } else if (y < h) {
            t = DIRT;
          } else {
            // surface block
            if (h <= WATER_LEVEL + 1) t = SAND;
            else t = GRASS;
          }
          blocks[idx(lx, y, lz)] = t;
        }
        // water fills up to WATER_LEVEL
        for (var wy = h + 1; wy <= WATER_LEVEL; wy++) {
          blocks[idx(lx, wy, lz)] = WATER;
        }
      }
    }

    // Trees
    var treeCount = 4 + Math.floor(hash2(cx * 3.7 + 1.3, cz * 5.1 + 2.9) * 3); // 4..6
    for (var i = 0; i < treeCount; i++) {
      var rx = Math.floor(hash2(cx * 12.9898 + i * 78.233, cz * 4.1414 + i * 3.17) * CS);
      var rz = Math.floor(hash2(cx * 39.3468 + i * 11.135, cz * 93.9898 + i * 7.71) * CS);
      if (rx < 2 || rx > CS - 3 || rz < 2 || rz > CS - 3) continue;
      var wx2 = baseX + rx, wz2 = baseZ + rz;
      var hh = heightAt(wx2, wz2);
      if (hh <= WATER_LEVEL + 1) continue; // no trees in water/sand
      if (blocks[idx(rx, hh, rz)] !== GRASS) continue;
      placeTree(blocks, rx, hh + 1, rz);
    }

    return c;
  }

  function placeTree(blocks, lx, y0, lz) {
    var trunkH = 4 + Math.floor(hash2(lx * 1.7 + 0.5, lz * 2.3 + 0.9) * 3); // 4..6
    var top = y0 + trunkH - 1;
    var i, j, k, yy;
    // trunk
    for (yy = y0; yy <= top; yy++) {
      if (yy < WH) blocks[idx(lx, yy, lz)] = WOOD;
    }
    // canopy: 3x3x2 leaves
    for (var layer = 0; layer < 2; layer++) {
      yy = top + 1 + layer;
      if (yy >= WH) break;
      for (i = -1; i <= 1; i++) {
        for (k = -1; k <= 1; k++) {
          var nx = lx + i, nz = lz + k;
          if (nx < 0 || nx >= CS || nz < 0 || nz >= CS) continue;
          if (i === 0 && k === 0 && layer === 0) continue; // trunk continues
          if (blocks[idx(nx, yy, nz)] === AIR) blocks[idx(nx, yy, nz)] = LEAVES;
        }
      }
    }
    // cap
    if (top + 3 < WH) blocks[idx(lx, top + 3, lz)] = LEAVES;
  }

  // ---- Face colours (vertex tint) ----
  function faceColor(type, faceIndex, lx, ly, lz) {
    var shade = 1.0;
    if (faceIndex === 2) shade = 1.0;        // top
    else if (faceIndex === 3) shade = 0.55;  // bottom
    else if (faceIndex === 0 || faceIndex === 1) shade = 0.78; // sides X
    else shade = 0.88;                       // sides Z

    var r = 1, g = 1, b = 1;
    switch (type) {
      case GRASS:
        if (faceIndex === 2) { r = 0.36; g = 0.72; b = 0.28; }        // green top
        else if (faceIndex === 3) { r = 0.45; g = 0.32; b = 0.20; }   // dirt bottom
        else { r = 0.52; g = 0.38; b = 0.24; }                        // dirt-brown sides
        break;
      case DIRT: r = 0.52; g = 0.38; b = 0.24; break;
      case STONE: r = 0.55; g = 0.55; b = 0.57; break;
      case SAND: r = 0.86; g = 0.80; b = 0.55; break;
      case WOOD: r = 0.42; g = 0.30; b = 0.17; break;
      case LEAVES: r = 0.22; g = 0.52; b = 0.18; break;
      case BEDROCK: r = 0.20; g = 0.20; b = 0.22; break;
      case WATER: r = 0.20; g = 0.42; b = 0.85; break;
      default: r = 1; g = 0; b = 1; break;
    }
    return [r * shade, g * shade, b * shade];
  }

  function isTransparent(t) { return t === AIR || t === WATER; }

  // ---- Meshing ----
  function buildChunkMesh(cx, cz) {
    var c = chunks.get(chunkKey(cx, cz));
    if (!c) return;

    var positions = [], normals = [], uvs = [], colors = [];
    var wPositions = [], wNormals = [], wUvs = [], wColors = [];
    var baseX = cx * CS, baseZ = cz * CS;

    for (var y = 0; y < WH; y++) {
      for (var lz = 0; lz < CS; lz++) {
        for (var lx = 0; lx < CS; lx++) {
          var type = c.blocks[idx(lx, y, lz)];
          if (type === AIR) continue;
          var wx = baseX + lx, wz = baseZ + lz;
          var isWater = (type === WATER);

          for (var f = 0; f < 6; f++) {
            var face = FACES[f];
            var nx = wx + face.dir[0], ny = y + face.dir[1], nz = wz + face.dir[2];
            var nb = getBlock(nx, ny, nz);
            if (isWater) {
              // water only renders against air (and above water surface)
              if (nb !== AIR) continue;
            } else {
              if (!isTransparent(nb)) continue;
            }

            var col = faceColor(type, f, lx, y, lz);
            var P = isWater ? wPositions : positions;
            var N = isWater ? wNormals : normals;
            var U = isWater ? wUvs : uvs;
            var C = isWater ? wColors : colors;

            var quad = face.corners;
            var order = [0, 1, 2, 0, 2, 3];
            var uvSet = [[0, 1], [0, 0], [1, 0], [1, 1]];
            for (var q = 0; q < 6; q++) {
              var ci = order[q];
              var corner = quad[ci];
              P.push(wx + corner[0], y + corner[1], wz + corner[2]);
              N.push(face.dir[0], face.dir[1], face.dir[2]);
              U.push(uvSet[ci][0], uvSet[ci][1]);
              C.push(col[0], col[1], col[2]);
            }
          }
        }
      }
    }

    // dispose old geometry
    disposeMesh(c.mesh);
    disposeMesh(c.waterMesh);
    c.mesh = null;
    c.waterMesh = null;

    if (positions.length > 0) {
      c.mesh = makeMesh(positions, normals, uvs, colors, false);
    }
    if (wPositions.length > 0) {
      c.waterMesh = makeMesh(wPositions, wNormals, wUvs, wColors, true);
    }
    c.dirty = false;
  }

  function makeMesh(positions, normals, uvs, colors, isWater) {
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeBoundingSphere();

    var mat;
    if (isWater) {
      mat = new THREE.MeshLambertMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.65,
        depthWrite: false
      });
    } else {
      mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    }
    var mesh = new THREE.Mesh(geo, mat);
    mesh.name = isWater ? 'water' : 'chunk';
    if (typeof scene !== 'undefined' && scene) scene.add(mesh);
    return mesh;
  }

  function disposeMesh(mesh) {
    if (!mesh) return;
    if (typeof scene !== 'undefined' && scene) scene.remove(mesh);
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) mesh.material.dispose();
  }

  // ---- World streaming ----
  var lastCX = null, lastCZ = null;

  function updateWorld() {
    var pos = (typeof playerPos !== 'undefined' && playerPos) ? playerPos : null;
    if (!pos) return;
    var pcx = Math.floor(pos.x / CS);
    var pcz = Math.floor(pos.z / CS);

    // Only stream when the player actually crossed into another chunk.
    // (The old code returned early here, so chunks unloaded on the way out
    // were never regenerated when the player walked back in.)
    if (pcx !== lastCX || pcz !== lastCZ) {
      lastCX = pcx; lastCZ = pcz;

      var wanted = new Set();
      for (var dx = -RENDER_DIST; dx <= RENDER_DIST; dx++) {
        for (var dz = -RENDER_DIST; dz <= RENDER_DIST; dz++) {
          var cx = pcx + dx, cz = pcz + dz;
          var key = chunkKey(cx, cz);
          wanted.add(key);
          if (!chunks.has(key)) {
            chunks.set(key, generateChunk(cx, cz));
            buildChunkMesh(cx, cz);
          }
        }
      }

      // unload far chunks
      chunks.forEach(function (c, key) {
        if (!wanted.has(key)) {
          disposeMesh(c.mesh);
          disposeMesh(c.waterMesh);
          chunks.delete(key);
        }
      });
    }

    rebuildDirty();
  }

  function rebuildDirty() {
    chunks.forEach(function (c) {
      if (c.dirty) buildChunkMesh(c.cx, c.cz);
    });
  }

  // ---- Voxel raycast (DDA) ----
  function raycastVoxel(origin, dir, maxDist) {
    if (maxDist === undefined) maxDist = 6;
    var ox = origin.x, oy = origin.y, oz = origin.z;
    var dx = dir.x, dy = dir.y, dz = dir.z;
    var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len === 0) return null;
    dx /= len; dy /= len; dz /= len;

    var x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    var stepX = dx > 0 ? 1 : -1;
    var stepY = dy > 0 ? 1 : -1;
    var stepZ = dz > 0 ? 1 : -1;

    var tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    var tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    var tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;

    var tMaxX = dx !== 0 ? ((dx > 0 ? (x + 1 - ox) : (ox - x)) * tDeltaX) : Infinity;
    var tMaxY = dy !== 0 ? ((dy > 0 ? (y + 1 - oy) : (oy - y)) * tDeltaY) : Infinity;
    var tMaxZ = dz !== 0 ? ((dz > 0 ? (z + 1 - oz) : (oz - z)) * tDeltaZ) : Infinity;

    var normal = [0, 0, 0];
    var t = 0;

    // check starting voxel
    var startBlock = getBlock(x, y, z);
    if (startBlock !== AIR && startBlock !== WATER) {
      return { block: [x, y, z], normal: [0, 0, 0] };
    }

    while (t <= maxDist) {
      if (tMaxX < tMaxY && tMaxX < tMaxZ) {
        x += stepX; t = tMaxX; tMaxX += tDeltaX;
        normal = [-stepX, 0, 0];
      } else if (tMaxY < tMaxZ) {
        y += stepY; t = tMaxY; tMaxY += tDeltaY;
        normal = [0, -stepY, 0];
      } else {
        z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ;
        normal = [0, 0, -stepZ];
      }
      if (t > maxDist) break;
      if (y < 0 || y >= WH) {
        if (y < 0) break;
        continue;
      }
      var b = getBlock(x, y, z);
      if (b !== AIR && b !== WATER) {
        return { block: [x, y, z], normal: normal };
      }
    }
    return null;
  }

  // ---- Expose globals ----
  window.BLOCK = BLOCK;
  window.BLOCK_IDS = BLOCK;
  window.chunks = chunks;
  window.CHUNK_SIZE = CS;
  window.WORLD_HEIGHT = WH;
  window.RENDER_DIST = RENDER_DIST;
  window.WATER_LEVEL = WATER_LEVEL;
  window.getBlock = getBlock;
  window.setBlock = setBlock;
  window.getChunk = getChunk;
  window.generateChunk = generateChunk;
  window.heightAt = heightAt;
  window.buildChunkMesh = buildChunkMesh;
  window.updateWorld = updateWorld;
  window.raycastVoxel = raycastVoxel;
  window.disposeMesh = disposeMesh;
})();