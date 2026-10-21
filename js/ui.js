/* =========================================================================
   ui.js - HUD: hotbar, crosshair and debug overlay.
   Loaded last (after engine.js / world.js / player.js).

   Exposes:
     initUI()   - called by engine.js init()
     updateUI() - called every frame from engine.js animate()
   ========================================================================= */

/* ------------------------------ Hotbar data ----------------------------- */

/* The 9 hotbar slots, in order. `type` is the BLOCK_TYPES id (from engine.js)
   and `cls` is the CSS class used for the little coloured icon. */
const HOTBAR_BLOCKS = [
  { type: 1,  name: 'grass',       cls: 'grass' },
  { type: 2,  name: 'dirt',        cls: 'dirt' },
  { type: 3,  name: 'stone',       cls: 'stone' },
  { type: 4,  name: 'wood',        cls: 'wood' },
  { type: 5,  name: 'leaves',      cls: 'leaves' },
  { type: 6,  name: 'sand',        cls: 'sand' },
  { type: 8,  name: 'cobblestone', cls: 'cobblestone' },
  { type: 9,  name: 'plank',       cls: 'plank' },
  { type: 10, name: 'bedrock',     cls: 'bedrock' }
];

/* ------------------------------- UI state ------------------------------- */

let _hotbarEl = null;
let _debugEl = null;
let _slotEls = [];          /* the 9 .hotbar-slot divs */
let _lastSelected = -1;     /* last slot we highlighted, to avoid DOM churn */

/* Smoothed FPS */
let _fps = 0;
let _frames = 0;
let _fpsTimer = 0;

/* =======================================================================
   Build
   ======================================================================= */

function _buildHotbar() {
  _hotbarEl = document.getElementById('hotbar');
  if (!_hotbarEl) {
    _hotbarEl = document.createElement('div');
    _hotbarEl.id = 'hotbar';
    document.body.appendChild(_hotbarEl);
  }

  /* Clear without innerHTML (no HTML sink, even for a constant string) */
  while (_hotbarEl.firstChild) _hotbarEl.removeChild(_hotbarEl.firstChild);
  _slotEls = [];

  for (let i = 0; i < HOTBAR_BLOCKS.length; i++) {
    const block = HOTBAR_BLOCKS[i];

    const slot = document.createElement('div');
    slot.className = 'hotbar-slot';
    slot.dataset.slot = String(i);
    slot.title = block.name;

    const icon = document.createElement('div');
    icon.className = 'block-icon ' + block.cls;
    slot.appendChild(icon);

    _hotbarEl.appendChild(slot);
    _slotEls.push(slot);
  }
}

function _buildCrosshair() {
  if (document.getElementById('crosshair')) return;
  const crosshair = document.createElement('div');
  crosshair.id = 'crosshair';
  document.body.appendChild(crosshair);
}

function _buildDebug() {
  _debugEl = document.getElementById('debug');
  if (!_debugEl) {
    _debugEl = document.createElement('div');
    _debugEl.id = 'debug';
    document.body.appendChild(_debugEl);
  }
}

/* =======================================================================
   Selection
   ======================================================================= */

/* Highlight the slot for `index` (0-8). Safe to call every frame. */
function setSelectedSlot(index) {
  if (typeof index !== 'number' || isNaN(index)) return;
  index = Math.max(0, Math.min(_slotEls.length - 1, index | 0));
  if (index === _lastSelected) return;

  if (_slotEls[_lastSelected]) {
    _slotEls[_lastSelected].classList.remove('selected');
  }
  if (_slotEls[index]) {
    _slotEls[index].classList.add('selected');
  }
  _lastSelected = index;
}

/* =======================================================================
   Debug text
   ======================================================================= */

function _formatDebug() {
  let posText = 'x: 0.0  y: 0.0  z: 0.0';

  if (typeof playerPos !== 'undefined' && playerPos) {
    posText = 'x: ' + playerPos.x.toFixed(1) +
              '  y: ' + playerPos.y.toFixed(1) +
              '  z: ' + playerPos.z.toFixed(1);
  }

  const slot = (_lastSelected >= 0 && _lastSelected < HOTBAR_BLOCKS.length)
    ? HOTBAR_BLOCKS[_lastSelected]
    : HOTBAR_BLOCKS[0];
  const blockName = slot ? slot.name : '';

  return 'FPS: ' + Math.round(_fps) +
         '\n' + posText +
         '\nHeld: ' + blockName;
}

/* =======================================================================
   Public API
   ======================================================================= */

function initUI() {
  _buildHotbar();
  _buildCrosshair();
  _buildDebug();

  /* No keydown listener here on purpose: player.js owns `selectedSlot`
     (exposed as a live global) and calls setSelectedSlot() itself, and
     updateUI() mirrors it every frame as a safety net. */
  setSelectedSlot(typeof selectedSlot === 'number' ? selectedSlot : 0);
  if (_debugEl) _debugEl.textContent = _formatDebug();
}

/* Called every frame from engine.js animate() */
function updateUI(dt) {
  /* --- smoothed FPS --- */
  _frames++;
  _fpsTimer += (typeof dt === 'number' && dt > 0) ? dt : 1 / 60;
  if (_fpsTimer >= 0.5) {
    _fps = _frames / _fpsTimer;
    _frames = 0;
    _fpsTimer = 0;
  }

  /* --- selection (player.js owns the global `selectedSlot`) --- */
  if (typeof selectedSlot === 'number') {
    setSelectedSlot(selectedSlot);
  }

  /* --- debug text --- */
  if (_debugEl) {
    _debugEl.textContent = _formatDebug();
  }
}

/* Expose for other modules / debugging */
window.initUI = initUI;
window.updateUI = updateUI;
window.setSelectedSlot = setSelectedSlot;
window.HOTBAR_BLOCKS = HOTBAR_BLOCKS;