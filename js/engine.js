/* =========================================================================
   engine.js - Core engine: constants, renderer/scene/camera setup,
   procedural pixel-art texture atlas, materials and the main game loop.
   Loaded after three.js, before world.js / player.js / ui.js
   ========================================================================= */

/* ----------------------------- Constants ------------------------------- */

const BLOCK_TYPES = {
  air: 0,
  grass: 1,
  dirt: 2,
  stone: 3,
  wood: 4,
  leaves: 5,
  sand: 6,
  water: 7,
  cobblestone: 8,
  plank: 9,
  bedrock: 10
};

const CHUNK_SIZE = 16;
const WORLD_HEIGHT = 64;
const RENDER_DIST = 4;

/* Reverse lookup: id -> name (handy for debugging / UI) */
const BLOCK_NAMES = {};
for (const name in BLOCK_TYPES) {
  BLOCK_NAMES[BLOCK_TYPES[name]] = name;
}

/* Blocks that are fully transparent and should not be rendered */
const TRANSPARENT_BLOCKS = [BLOCK_TYPES.air];

/* --------------------------- Global objects ---------------------------- */

let scene = null;
let camera = null;
let renderer = null;
let clock = null;

/* Texture / material caches */
const BLOCK_TEXTURES = {};
const BLOCK_MATERIALS = {};

/* Loop bookkeeping */
let _running = false;
let _lastTime = 0;

/* =======================================================================
   Pixel-art texture generation
   Each texture is drawn on a 16x16 canvas and scaled up with
   imageSmoothingEnabled = false so it keeps the crisp Minecraft look.
   ======================================================================= */

const TEX_SIZE = 16;

/* Small deterministic pseudo random so textures look the same every run */
function _makeRandom(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* Create a fresh 16x16 canvas context */
function _newCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_SIZE;
  canvas.height = TEX_SIZE;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return { canvas: canvas, ctx: ctx };
}

/* Fill the whole canvas with one colour */
function _fill(ctx, color) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
}

/* Fill a single pixel */
function _px(ctx, x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
}

/* Sprinkle random noise pixels over the whole texture */
function _noise(ctx, colors, seed, amount) {
  const rnd = _makeRandom(seed);
  for (let y = 0; y < TEX_SIZE; y++) {
    for (let x = 0; x < TEX_SIZE; x++) {
      if (rnd() < amount) {
        _px(ctx, x, y, colors[Math.floor(rnd() * colors.length)]);
      }
    }
  }
}

/* Draw a horizontal band of noise (used for grass side / dirt layers) */
function _noiseBand(ctx, y0, y1, colors, seed, amount) {
  const rnd = _makeRandom(seed);
  for (let y = y0; y < y1; y++) {
    for (let x = 0; x < TEX_SIZE; x++) {
      if (rnd() < amount) {
        _px(ctx, x, y, colors[Math.floor(rnd() * colors.length)]);
      }
    }
  }
}

/* ------------------------- individual textures ------------------------- */

function _texGrassTop(ctx) {
  _fill(ctx, '#5d9c3c');
  _noise(ctx, ['#6cb04a', '#4f8a33', '#77bb55', '#568f38'], 11, 0.55);
}

function _texGrassSide(ctx) {
  /* dirt body */
  _fill(ctx, '#8b5a2b');
  _noise(ctx, ['#7a4d24', '#9c6a35', '#6f4520'], 22, 0.5);
  /* green grass overhang on top ~4 rows, ragged edge */
  const rnd = _makeRandom(33);
  for (let x = 0; x < TEX_SIZE; x++) {
    const h = 3 + Math.floor(rnd() * 2);
    for (let y = 0; y < h; y++) {
      _px(ctx, x, y, rnd() < 0.5 ? '#5d9c3c' : '#4f8a33');
    }
  }
}

function _texDirt(ctx) {
  _fill(ctx, '#8b5a2b');
  _noise(ctx, ['#7a4d24', '#9c6a35', '#6f4520', '#a0703a'], 44, 0.6);
}

function _texStone(ctx) {
  _fill(ctx, '#8a8a8a');
  _noise(ctx, ['#7d7d7d', '#969696', '#727272', '#a0a0a0'], 55, 0.6);
}

function _texWood(ctx) {
  /* bark: vertical streaks */
  _fill(ctx, '#6b4a24');
  const rnd = _makeRandom(66);
  for (let x = 0; x < TEX_SIZE; x++) {
    const shade = rnd();
    const color = shade < 0.33 ? '#5a3d1c' : (shade < 0.66 ? '#7a5529' : '#4d3418');
    for (let y = 0; y < TEX_SIZE; y++) {
      if (rnd() < 0.75) _px(ctx, x, y, color);
    }
  }
  /* a couple of darker knots */
  _px(ctx, 4, 5, '#3d2913');
  _px(ctx, 5, 5, '#3d2913');
  _px(ctx, 11, 11, '#3d2913');
}

function _texLeaves(ctx) {
  _fill(ctx, '#3f7a2a');
  const rnd = _makeRandom(77);
  for (let y = 0; y < TEX_SIZE; y++) {
    for (let x = 0; x < TEX_SIZE; x++) {
      const r = rnd();
      if (r < 0.18) {
        /* holes: fully transparent */
        ctx.clearRect(x, y, 1, 1);
      } else if (r < 0.6) {
        _px(ctx, x, y, r < 0.4 ? '#4c8f33' : '#356b23');
      } else if (r < 0.75) {
        _px(ctx, x, y, '#5aa03c');
      }
    }
  }
}

function _texSand(ctx) {
  _fill(ctx, '#e0d3a0');
  _noise(ctx, ['#d6c78f', '#ece0b0', '#cbbd85'], 88, 0.5);
}

function _texWater(ctx) {
  _fill(ctx, '#2f6fd0');
  _noise(ctx, ['#3a7fe0', '#2a63bb', '#4a8ff0'], 99, 0.45);
  /* semi transparent so you can see through it */
  ctx.globalAlpha = 1.0;
}

function _texCobblestone(ctx) {
  _fill(ctx, '#7f7f7f');
  const rnd = _makeRandom(111);
  /* irregular cobbles */
  for (let i = 0; i < 22; i++) {
    const x = Math.floor(rnd() * TEX_SIZE);
    const y = Math.floor(rnd() * TEX_SIZE);
    const w = 2 + Math.floor(rnd() * 3);
    const h = 2 + Math.floor(rnd() * 3);
    const shade = rnd();
    ctx.fillStyle = shade < 0.33 ? '#6e6e6e' : (shade < 0.66 ? '#8f8f8f' : '#9c9c9c');
    ctx.fillRect(x, y, w, h);
  }
  /* dark mortar speckles */
  _noise(ctx, ['#5c5c5c', '#4f4f4f'], 122, 0.22);
}

function _texPlank(ctx) {
  _fill(ctx, '#b58b4c');
  /* horizontal plank lines */
  for (let y = 0; y < TEX_SIZE; y++) {
    if (y % 4 === 3) {
      for (let x = 0; x < TEX_SIZE; x++) _px(ctx, x, y, '#8a6533');
    }
  }
  /* vertical seams, offset per plank row */
  for (let row = 0; row < 4; row++) {
    const seamX = (row % 2 === 0) ? 7 : 3;
    for (let y = row * 4; y < row * 4 + 3; y++) {
      _px(ctx, seamX, y, '#8a6533');
    }
  }
  _noise(ctx, ['#c39a5c', '#a87f42'], 133, 0.25);
}

function _texBedrock(ctx) {
  _fill(ctx, '#3a3a3a');
  _noise(ctx, ['#2b2b2b', '#4a4a4a', '#1f1f1f', '#555555'], 144, 0.7);
}

/* --------------------------- texture dispatch -------------------------- */

/* Returns the 16x16 canvas for a block type (or null for air) */
function createBlockCanvas(type) {
  const c = _newCanvas();
  const ctx = c.ctx;

  switch (type) {
    case BLOCK_TYPES.grass:       _texGrassTop(ctx); break;
    case BLOCK_TYPES.dirt:        _texDirt(ctx); break;
    case BLOCK_TYPES.stone:       _texStone(ctx); break;
    case BLOCK_TYPES.wood:        _texWood(ctx); break;
    case BLOCK_TYPES.leaves:      _texLeaves(ctx); break;
    case BLOCK_TYPES.sand:        _texSand(ctx); break;
    case BLOCK_TYPES.water:       _texWater(ctx); break;
    case BLOCK_TYPES.cobblestone: _texCobblestone(ctx); break;
    case BLOCK_TYPES.plank:       _texPlank(ctx); break;
    case BLOCK_TYPES.bedrock:     _texBedrock(ctx); break;
    default:                      _texStone(ctx); break;
  }

  return c.canvas;
}

/* Returns a THREE.CanvasTexture with NearestFilter (crisp pixels) */
function createBlockTexture(type) {
  const canvas = createBlockCanvas(type);
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/* Build the material for every solid block type */
function createBlockMaterials() {
  for (const name in BLOCK_TYPES) {
    const type = BLOCK_TYPES[name];
    if (type === BLOCK_TYPES.air) continue;

    const texture = createBlockTexture(type);
    BLOCK_TEXTURES[type] = texture;

    const material = new THREE.MeshLambertMaterial({
      map: texture,
      transparent: (type === BLOCK_TYPES.water || type === BLOCK_TYPES.leaves),
      opacity: (type === BLOCK_TYPES.water) ? 0.75 : 1.0,
      alphaTest: (type === BLOCK_TYPES.leaves) ? 0.5 : 0
    });

    BLOCK_MATERIALS[type] = material;
  }
}

/* Convenience accessor used by world.js */
function getBlockMaterial(type) {
  return BLOCK_MATERIALS[type] || BLOCK_MATERIALS[BLOCK_TYPES.stone];
}
/* =======================================================================
   Renderer / scene / camera setup
   ======================================================================= */

function initRenderer() {
  renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x87CEEB, 1);
  renderer.shadowMap.enabled = false;
  document.body.appendChild(renderer.domElement);
}

function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87CEEB);
  /* fog hides the edge of the loaded chunks */
  scene.fog = new THREE.Fog(0x87CEEB, CHUNK_SIZE * (RENDER_DIST - 1), CHUNK_SIZE * (RENDER_DIST + 1));

  const ambient = new THREE.AmbientLight(0x606060);
  scene.add(ambient);

  const directional = new THREE.DirectionalLight(0xffffff, 0.8);
  directional.position.set(1, 1, 0.5);
  scene.add(directional);
}

function initCamera() {
  camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(8, 40, 8);
  camera.lookAt(8, 40, 0);
}

function onWindowResize() {
  if (!camera || !renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

/* =======================================================================
   Main loop
   ======================================================================= */

function animate() {
  if (!_running) return;
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.1); /* clamp big tab-switch spikes */

  if (typeof updateWorld === 'function') updateWorld(dt);
  if (typeof updatePlayer === 'function') updatePlayer(dt);
  if (typeof updateUI === 'function') updateUI(dt);

  renderer.render(scene, camera);
}

function startLoop() {
  if (_running) return;
  _running = true;
  clock = new THREE.Clock();
  clock.start();
  animate();
}

function stopLoop() {
  _running = false;
}

/* =======================================================================
   Boot
   ======================================================================= */

/* Show a readable message in #blocker when something fatal happens at boot
   (most likely: three.js failed to load from the CDN). */
function showFatalError(message) {
  const blocker = document.getElementById('blocker');
  if (!blocker) return;
  blocker.classList.remove('hidden');
  blocker.textContent = '';
  const h1 = document.createElement('h1');
  h1.textContent = 'Minecraft';
  const p = document.createElement('p');
  p.textContent = message;
  blocker.appendChild(h1);
  blocker.appendChild(p);
}

function init() {
  if (typeof THREE === 'undefined') {
    showFatalError('Could not load three.js. Check your internet connection and reload the page.');
    return;
  }
  initRenderer();
  initScene();
  initCamera();
  createBlockMaterials();

  window.addEventListener('resize', onWindowResize, false);

  /* world.js / player.js / ui.js expose their own init hooks */
  if (typeof initWorld === 'function') initWorld();
  if (typeof initPlayer === 'function') initPlayer();
  if (typeof initUI === 'function') initUI();

  startLoop();
}

window.onload = function () {
  init();
};

/* Expose a few helpers globally for the other modules */
window.BLOCK_TYPES = BLOCK_TYPES;
window.BLOCK_MATERIALS = BLOCK_MATERIALS;
window.CHUNK_SIZE = CHUNK_SIZE;
window.WORLD_HEIGHT = WORLD_HEIGHT;
window.RENDER_DIST = RENDER_DIST;
window.getBlockMaterial = getBlockMaterial;
window.createBlockTexture = createBlockTexture;