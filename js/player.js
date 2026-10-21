/* =========================================================================
   player.js - First-person Minecraft-style player: pointer lock, WASD
   movement, gravity, AABB voxel collision and block breaking / placing.
   Loaded after engine.js and world.js, before ui.js.

   Globals used from engine.js : camera, scene, BLOCK_TYPES, CHUNK_SIZE
   Globals used from world.js  : getBlock, setBlock, buildChunkMesh,
                                 raycastVoxel, chunks
   Globals exposed here        : playerPos, playerVelocity, onGround,
                                 updatePlayer, initPlayer, selectedSlot,
                                 BLOCK_HOTBAR, yaw, pitch
   ========================================================================= */

/* ----------------------------- Constants ------------------------------- */

var PLAYER_HEIGHT = 1.8;   /* full height of the player box            */
var PLAYER_WIDTH = 0.6;    /* full width / depth of the player box     */
var PLAYER_RADIUS = PLAYER_WIDTH / 2;
var EYE_HEIGHT = 1.6;      /* camera height above the player's feet    */
var GRAVITY = -25;         /* blocks / second^2                        */
var JUMP_SPEED = 9;        /* upward speed of a jump                   */
var WALK_SPEED = 5;        /* blocks / second                          */
var SPRINT_SPEED = 8;      /* blocks / second while holding Shift      */
var MOUSE_SENSITIVITY = 0.002;
var REACH = 6;             /* how far the player can break / place     */
var MAX_PITCH = Math.PI / 2 - 0.001;

/* Hotbar: 9 slots, keys 1-9. Ids come from BLOCK_TYPES in engine.js. */
var BLOCK_HOTBAR = ['grass', 'dirt', 'stone', 'wood', 'leaves',
                    'sand', 'cobblestone', 'plank', 'bedrock'];

/* --------------------------- Player state ------------------------------ */

var playerPos = new THREE.Vector3(8, 40, 8);   /* feet position */
var playerVelocity = new THREE.Vector3(0, 0, 0);
var onGround = false;
var yaw = 0;                                   /* look left / right */
var pitch = 0;                                 /* look up / down    */
var selectedSlot = 0;                          /* 0..8              */

/* Held keys, filled by the keyboard listeners */
var _keys = {};

/* Scratch vectors (reused every frame so we don't allocate) */
var _forward = new THREE.Vector3();
var _right = new THREE.Vector3();
var _wish = new THREE.Vector3();
var _dir = new THREE.Vector3();

/* =======================================================================
   Small helpers
   ======================================================================= */

/* Block id for a hotbar slot (0-8), falling back to grass */
function getSelectedBlockType() {
  var name = BLOCK_HOTBAR[selectedSlot] || 'grass';
  if (typeof BLOCK_TYPES !== 'undefined' && BLOCK_TYPES[name] !== undefined) {
    return BLOCK_TYPES[name];
  }
  return 1;
}

/* Is this block id solid (i.e. does it stop the player)? */
function isSolidBlock(type) {
  if (type === 0) return false;                       /* air */
  if (typeof BLOCK_TYPES !== 'undefined' && type === BLOCK_TYPES.water) return false;
  return true;
}

/* Is the block at (x, y, z) solid? */
function isSolidAt(x, y, z) {
  if (typeof getBlock !== 'function') return false;
  return isSolidBlock(getBlock(x, y, z));
}

/* =======================================================================
   Collision - AABB vs voxel grid, resolved one axis at a time
   ======================================================================= */

/* Does the player box centred on (px, py, pz) overlap any solid block?
   py is the position of the player's feet. */
function collidesAt(px, py, pz) {
  var minX = Math.floor(px - PLAYER_RADIUS);
  var maxX = Math.floor(px + PLAYER_RADIUS);
  var minY = Math.floor(py);
  var maxY = Math.floor(py + PLAYER_HEIGHT);
  var minZ = Math.floor(pz - PLAYER_RADIUS);
  var maxZ = Math.floor(pz + PLAYER_RADIUS);

  for (var x = minX; x <= maxX; x++) {
    for (var y = minY; y <= maxY; y++) {
      for (var z = minZ; z <= maxZ; z++) {
        if (isSolidAt(x, y, z)) return true;
      }
    }
  }
  return false;
}

/* Move along one axis and push the player back out of whatever it hit.
   Returns true when the move was blocked. */
function moveAxis(axis, amount) {
  if (amount === 0) return false;

  var before = playerPos[axis];
  playerPos[axis] = before + amount;

  if (!collidesAt(playerPos.x, playerPos.y, playerPos.z)) return false;

  /* Blocked: snap flush against the block face we ran into. */
  var half = (axis === 'y') ? 0 : PLAYER_RADIUS;
  if (amount > 0) {
    /* moving in +: the leading face is at pos + half, snap it to the cell boundary */
    playerPos[axis] = Math.floor(playerPos[axis] + half) - half - 1e-4;
  } else {
    /* moving in -: the trailing face is at pos - half, snap it to the cell boundary */
    playerPos[axis] = Math.floor(playerPos[axis] - half) + 1 + half + 1e-4;
  }

  /* Safety net: if the snap still overlaps (odd corner case), undo. */
  if (collidesAt(playerPos.x, playerPos.y, playerPos.z)) {
    playerPos[axis] = before;
  }
  return true;
}

/* =======================================================================
   Per-frame update
   ======================================================================= */

function updatePlayer(dt) {
  if (typeof dt !== 'number' || !isFinite(dt) || dt <= 0) return;
  if (dt > 0.1) dt = 0.1;                 /* never tunnel through blocks */

  /* ---- Horizontal input, relative to where we are looking ---- */
  var forwardInput = 0;
  var strafeInput = 0;
  if (_keys['KeyW'] || _keys['ArrowUp']) forwardInput += 1;
  if (_keys['KeyS'] || _keys['ArrowDown']) forwardInput -= 1;
  if (_keys['KeyD'] || _keys['ArrowRight']) strafeInput += 1;
  if (_keys['KeyA'] || _keys['ArrowLeft']) strafeInput -= 1;

  var speed = (_keys['ShiftLeft'] || _keys['ShiftRight']) ? SPRINT_SPEED : WALK_SPEED;

  /* forward = (-sin yaw, 0, -cos yaw), right = (cos yaw, 0, -sin yaw) */
  _forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  _right.set(Math.cos(yaw), 0, -Math.sin(yaw));

  _wish.set(0, 0, 0);
  _wish.addScaledVector(_forward, forwardInput);
  _wish.addScaledVector(_right, strafeInput);
  if (_wish.lengthSq() > 0) _wish.normalize().multiplyScalar(speed);

  playerVelocity.x = _wish.x;
  playerVelocity.z = _wish.z;

  /* ---- Jump ---- */
  if ((_keys['Space'] || _keys['KeyE']) && onGround) {
    playerVelocity.y = JUMP_SPEED;
    onGround = false;
  }

  /* ---- Gravity ---- */
  playerVelocity.y += GRAVITY * dt;
  if (playerVelocity.y < -60) playerVelocity.y = -60;

  /* ---- Move, one axis at a time, resolving collisions ---- */
  moveAxis('x', playerVelocity.x * dt);
  moveAxis('z', playerVelocity.z * dt);

  onGround = false;
  if (moveAxis('y', playerVelocity.y * dt)) {
    if (playerVelocity.y <= 0) onGround = true;   /* landed on something */
    playerVelocity.y = 0;
  }

  /* ---- Never fall out of the world ---- */
  if (playerPos.y < -20) {
    playerPos.set(8, 40, 8);
    playerVelocity.set(0, 0, 0);
  }

  /* ---- Camera follows the player's eyes ---- */
  if (typeof camera !== 'undefined' && camera) {
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
    camera.rotation.z = 0;
    camera.position.set(playerPos.x, playerPos.y + EYE_HEIGHT, playerPos.z);
  }
}

/* =======================================================================
   Pointer lock + mouse look
   ======================================================================= */

function _blockerEl() {
  return document.getElementById('blocker');
}

function _hideBlocker() {
  var el = _blockerEl();
  if (el) el.classList.add('hidden');
}

function _showBlocker() {
  var el = _blockerEl();
  if (el) el.classList.remove('hidden');
}

function _requestLock() {
  var el = document.body;
  if (el.requestPointerLock) el.requestPointerLock();
}

function _onMouseMove(event) {
  if (document.pointerLockElement !== document.body) return;
  yaw -= event.movementX * MOUSE_SENSITIVITY;
  pitch -= event.movementY * MOUSE_SENSITIVITY;
  if (pitch > MAX_PITCH) pitch = MAX_PITCH;
  if (pitch < -MAX_PITCH) pitch = -MAX_PITCH;
}

/* =======================================================================
   Block interaction
   ======================================================================= */

/* Rebuild the chunk the block lives in (and neighbours if it was on a border) */
function _rebuildChunkAt(x, y, z) {
  if (typeof buildChunkMesh !== 'function') return;
  var cs = (typeof CHUNK_SIZE !== 'undefined') ? CHUNK_SIZE : 16;
  var cx = Math.floor(x / cs);
  var cz = Math.floor(z / cs);
  buildChunkMesh(cx, cz);

  var lx = x - cx * cs;
  var lz = z - cz * cs;
  if (lx === 0) buildChunkMesh(cx - 1, cz);
  if (lx === cs - 1) buildChunkMesh(cx + 1, cz);
  if (lz === 0) buildChunkMesh(cx, cz - 1);
  if (lz === cs - 1) buildChunkMesh(cx, cz + 1);
}

/* Where is the player looking, and what does it hit? */
function _lookRay() {
  if (typeof camera === 'undefined' || !camera) return null;
  _dir.set(0, 0, -1).applyEuler(camera.rotation).normalize();
  if (typeof raycastVoxel !== 'function') return null;
  var hit = raycastVoxel(camera.position, _dir, REACH);
  if (!hit) return null;
  return { hit: hit, dir: _dir.clone() };
}

/* Would a block at (x, y, z) intersect the player's box? */
function _blockIntersectsPlayer(x, y, z) {
  var minX = playerPos.x - PLAYER_RADIUS;
  var maxX = playerPos.x + PLAYER_RADIUS;
  var minY = playerPos.y;
  var maxY = playerPos.y + PLAYER_HEIGHT;
  var minZ = playerPos.z - PLAYER_RADIUS;
  var maxZ = playerPos.z + PLAYER_RADIUS;
  return (x + 1 > minX && x < maxX &&
          y + 1 > minY && y < maxY &&
          z + 1 > minZ && z < maxZ);
}

function _breakBlock() {
  var look = _lookRay();
  if (!look) return;
  var b = look.hit.block;
  if (typeof getBlock === 'function' && getBlock(b[0], b[1], b[2]) === 0) return;
  if (typeof setBlock !== 'function') return;
  setBlock(b[0], b[1], b[2], 0);          /* 0 = air */
  _rebuildChunkAt(b[0], b[1], b[2]);
}

function _placeBlock() {
  var look = _lookRay();
  if (!look) return;
  var b = look.hit.block;
  var n = look.hit.normal;
  var x = b[0] + n[0];
  var y = b[1] + n[1];
  var z = b[2] + n[2];

  /* Don't place inside the player */
  if (_blockIntersectsPlayer(x, y, z)) return;

  /* Only replace air (or water) */
  if (typeof getBlock === 'function') {
    var existing = getBlock(x, y, z);
    var water = (typeof BLOCK_TYPES !== 'undefined') ? BLOCK_TYPES.water : 7;
    if (existing !== 0 && existing !== water) return;
  }
  if (typeof setBlock !== 'function') return;
  setBlock(x, y, z, getSelectedBlockType());
  _rebuildChunkAt(x, y, z);
}

function _onMouseDown(event) {
  if (document.pointerLockElement !== document.body) return;
  if (event.button === 0) {
    _breakBlock();
  } else if (event.button === 2) {
    _placeBlock();
  }
}

/* =======================================================================
   Keyboard
   ======================================================================= */

function _onKeyDown(event) {
  _keys[event.code] = true;

  /* 1-9 select the hotbar slot (Digit1..Digit9, plus the numpad) */
  if (event.code && event.code.indexOf('Digit') === 0) {
    var n = parseInt(event.code.slice(5), 10);
    if (n >= 1 && n <= 9) selectedSlot = n - 1;
  } else if (event.code && event.code.indexOf('Numpad') === 0) {
    var m = parseInt(event.code.slice(6), 10);
    if (m >= 1 && m <= 9) selectedSlot = m - 1;
  }

  /* Keep the HUD highlight in sync (ui.js owns the DOM, we own the state) */
  if (typeof setSelectedSlot === 'function') setSelectedSlot(selectedSlot);

  /* Space scrolls the page by default - stop that while playing */
  if (event.code === 'Space') event.preventDefault();
}

function _onKeyUp(event) {
  _keys[event.code] = false;
}

/* =======================================================================
   Init
   ======================================================================= */

function initPlayer() {
  /* Start the player on top of the terrain instead of inside it */
  if (typeof heightAt === 'function') {
    var h = heightAt(Math.floor(playerPos.x), Math.floor(playerPos.z));
    if (isFinite(h)) playerPos.y = h + 2;
  }
  playerVelocity.set(0, 0, 0);
  onGround = false;

  if (typeof camera !== 'undefined' && camera) {
    camera.rotation.order = 'YXZ';
    camera.position.set(playerPos.x, playerPos.y + EYE_HEIGHT, playerPos.z);
  }

  var blocker = _blockerEl();
  if (blocker) {
    blocker.addEventListener('click', _requestLock, false);
  }

  document.addEventListener('pointerlockchange', function () {
    if (document.pointerLockElement === document.body) {
      _hideBlocker();
    } else {
      _showBlocker();
      _keys = {};                 /* drop held keys so we don't run away */
    }
  }, false);

  document.addEventListener('mousemove', _onMouseMove, false);
  document.addEventListener('mousedown', _onMouseDown, false);
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); }, false);
  document.addEventListener('keydown', _onKeyDown, false);
  document.addEventListener('keyup', _onKeyUp, false);
  window.addEventListener('blur', function () { _keys = {}; }, false);
}

/* --------------------------- Expose globals ---------------------------- */

window.playerPos = playerPos;
window.playerVelocity = playerVelocity;
window.updatePlayer = updatePlayer;
window.initPlayer = initPlayer;
window.BLOCK_HOTBAR = BLOCK_HOTBAR;

/* `onGround` and `selectedSlot` are primitives, so a plain `window.x = x`
   would freeze a copy at load time. Expose them as live accessors instead. */
Object.defineProperty(window, 'onGround', {
  get: function () { return onGround; },
  configurable: true
});
Object.defineProperty(window, 'selectedSlot', {
  get: function () { return selectedSlot; },
  set: function (v) { selectedSlot = v | 0; },
  configurable: true
});
window.PLAYER_HEIGHT = PLAYER_HEIGHT;
window.PLAYER_WIDTH = PLAYER_WIDTH;
window.GRAVITY = GRAVITY;
window.JUMP_SPEED = JUMP_SPEED;
window.WALK_SPEED = WALK_SPEED;
window.SPRINT_SPEED = SPRINT_SPEED;
window.getSelectedBlockType = getSelectedBlockType;