/* =========================================================================
   dom-stub.js - Minimal browser + THREE.js stubs so the game's browser
   scripts (engine.js / world.js / player.js / ui.js) can be loaded and
   exercised under `node --test`.

   This file is TEST-ONLY. It never touches the game's own source.
   ========================================================================= */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const GAME_DIR = path.resolve(__dirname, '..', '..');

/* ------------------------------ THREE stub ------------------------------ */

class Vector3 {
  constructor(x, y, z) { this.x = x || 0; this.y = y || 0; this.z = z || 0; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  addScaledVector(v, s) {
    this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this;
  }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  length() { return Math.sqrt(this.lengthSq()); }
  normalize() {
    const l = this.length();
    if (l > 0) this.multiplyScalar(1 / l);
    return this;
  }
  applyEuler(e) {
    // YXZ order, matching camera.rotation.order = 'YXZ'
    const cy = Math.cos(e.y || 0), sy = Math.sin(e.y || 0);
    const cx = Math.cos(e.x || 0), sx = Math.sin(e.x || 0);
    const cz = Math.cos(e.z || 0), sz = Math.sin(e.z || 0);
    let x = this.x, y = this.y, z = this.z;
    // X
    let y1 = y * cx - z * sx;
    let z1 = y * sx + z * cx;
    // Y
    let x2 = x * cy + z1 * sy;
    let z2 = -x * sy + z1 * cy;
    // Z
    let x3 = x2 * cz - y1 * sz;
    let y3 = x2 * sz + y1 * cz;
    this.x = x3; this.y = y3; this.z = z2;
    return this;
  }
}

class Euler {
  constructor() { this.x = 0; this.y = 0; this.z = 0; this.order = 'XYZ'; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
}

class Object3D {
  constructor() {
    this.position = new Vector3();
    this.rotation = new Euler();
    this.children = [];
    this.name = '';
    this.parent = null;
  }
  add(o) { this.children.push(o); o.parent = this; return this; }
  remove(o) {
    const i = this.children.indexOf(o);
    if (i >= 0) this.children.splice(i, 1);
    o.parent = null;
    return this;
  }
  lookAt() { return this; }
  updateProjectionMatrix() { return this; }
}

class Scene extends Object3D {
  constructor() { super(); this.background = null; this.fog = null; }
}

class PerspectiveCamera extends Object3D {
  constructor(fov, aspect, near, far) {
    super();
    this.fov = fov; this.aspect = aspect; this.near = near; this.far = far;
  }
}

class BufferGeometry {
  constructor() { this.attributes = {}; this.boundingSphere = null; this.disposed = false; }
  setAttribute(name, attr) { this.attributes[name] = attr; return this; }
  computeBoundingSphere() { this.boundingSphere = { radius: 1 }; return this; }
  dispose() { this.disposed = true; }
}

class Float32BufferAttribute {
  constructor(array, itemSize) {
    this.array = array;
    this.itemSize = itemSize;
    this.count = array.length / itemSize;
  }
}

class Material {
  constructor(params) {
    Object.assign(this, params || {});
    this.disposed = false;
  }
  dispose() { this.disposed = true; }
}

class Mesh extends Object3D {
  constructor(geometry, material) {
    super();
    this.geometry = geometry;
    this.material = material;
  }
}

class Color {
  constructor(hex) { this.hex = hex; }
}

class Clock {
  constructor() { this._t = 0; }
  start() { this._t = Date.now(); return this; }
  getDelta() { return 1 / 60; }
}

/* ------------------------------ DOM stub -------------------------------- */

class ClassList {
  constructor() { this._set = new Set(); }
  add(...c) { c.forEach((x) => this._set.add(x)); }
  remove(...c) { c.forEach((x) => this._set.delete(x)); }
  contains(c) { return this._set.has(c); }
  toggle(c) { this._set.has(c) ? this._set.delete(c) : this._set.add(c); }
  toString() { return Array.from(this._set).join(' '); }
}

class Element {
  constructor(tag) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.classList = new ClassList();
    this.style = {};
    this.dataset = {};
    this._listeners = {};
    this._text = '';
    this._html = '';
    this.id = '';
    this.className = '';
    this.title = '';
  }
  get textContent() {
    return this._text || this.children.map((c) => c.textContent).join('');
  }
  set textContent(v) { this._text = String(v); this.children = []; }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.children = []; }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const i = this.children.indexOf(child);
    if (i >= 0) this.children.splice(i, 1);
    child.parentNode = null;
    return child;
  }
  addEventListener(type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  }
  removeEventListener(type, fn) {
    const l = this._listeners[type];
    if (!l) return;
    const i = l.indexOf(fn);
    if (i >= 0) l.splice(i, 1);
  }
  dispatch(type, event) {
    (this._listeners[type] || []).forEach((fn) => fn(event || {}));
  }
  getContext() { return makeCanvasContext(); }
  /* query helpers used by the tests */
  querySelectorAll(sel) {
    const cls = sel.replace(/^\./, '');
    const out = [];
    const walk = (n) => {
      n.children.forEach((c) => {
        if (c.classList.contains(cls)) out.push(c);
        walk(c);
      });
    };
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}

function makeCanvasContext() {
  const ctx = {
    imageSmoothingEnabled: true,
    globalAlpha: 1,
    fillStyle: '#000',
    calls: [],
    fillRect(x, y, w, h) { this.calls.push(['fillRect', x, y, w, h]); },
    clearRect(x, y, w, h) { this.calls.push(['clearRect', x, y, w, h]); },
    drawImage() {},
    getImageData(x, y, w, h) {
      return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
    }
  };
  return ctx;
}

function makeDocument() {
  const doc = new Element('html');
  doc.body = new Element('body');
  doc.documentElement = doc;
  doc.appendChild(doc.body);
  doc.pointerLockElement = null;
  doc.createElement = (tag) => new Element(tag);
  doc.getElementById = (id) => {
    let found = null;
    const walk = (n) => {
      if (found) return;
      if (n.id === id) { found = n; return; }
      n.children.forEach(walk);
    };
    walk(doc);
    return found;
  };
  return doc;
}

/* --------------------------- Environment build -------------------------- */

function makeWindow(doc) {
  const win = {
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    _listeners: {},
    addEventListener(type, fn) {
      (this._listeners[type] = this._listeners[type] || []).push(fn);
    },
    removeEventListener(type, fn) {
      const l = this._listeners[type];
      if (!l) return;
      const i = l.indexOf(fn);
      if (i >= 0) l.splice(i, 1);
    },
    dispatch(type, event) {
      (this._listeners[type] || []).forEach((fn) => fn(event || {}));
    },
    requestAnimationFrame() { return 0; },
    document: doc
  };
  win.window = win;
  return win;
}

function makeTHREE() {
  return {
    Vector3,
    Euler,
    Object3D,
    Scene,
    PerspectiveCamera,
    BufferGeometry,
    Float32BufferAttribute,
    MeshLambertMaterial: Material,
    MeshBasicMaterial: Material,
    CanvasTexture: class { constructor(c) { this.image = c; this.needsUpdate = false; } },
    Color,
    Clock,
    Fog: class { constructor(c, n, f) { this.color = c; this.near = n; this.far = f; } },
    AmbientLight: class extends Object3D {},
    DirectionalLight: class extends Object3D {},
    WebGLRenderer: class {
      constructor() { this.domElement = new Element('canvas'); this.shadowMap = {}; }
      setPixelRatio() {}
      setSize() {}
      setClearColor() {}
      render() {}
    },
    NearestFilter: 1003,
    LinearFilter: 1006,
    ClampToEdgeWrapping: 1001,
    RepeatWrapping: 1000
  };
}

/* Load the four game scripts into a fresh sandbox. */
function loadGame() {
  const doc = makeDocument();
  const win = makeWindow(doc);
  const sandbox = {
    console,
    document: doc,
    window: win,
    THREE: makeTHREE(),
    requestAnimationFrame: win.requestAnimationFrame,
    setTimeout,
    clearTimeout,
    Math,
    Date,
    JSON,
    Set,
    Map,
    Uint8Array,
    Uint8ClampedArray,
    Float32Array,
    isFinite,
    isNaN,
    parseInt,
    parseFloat
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  const files = ['js/engine.js', 'js/world.js', 'js/player.js', 'js/ui.js'];
  const parts = files.map((f) => {
    const code = fs.readFileSync(path.join(GAME_DIR, f), 'utf8');
    return '/* ==== ' + f + ' ==== */\n' + code;
  });

  /* The four scripts share one global scope in the browser, so run them as a
     single script. A trailing block copies the top-level declarations onto the
     sandbox object so the tests can reach them. */
  const EXPOSE = [
    'BLOCK_TYPES', 'CHUNK_SIZE', 'WORLD_HEIGHT', 'RENDER_DIST', 'BLOCK_NAMES',
    'scene', 'camera', 'renderer', 'clock',
    'BLOCK_TEXTURES', 'BLOCK_MATERIALS',
    'createBlockCanvas', 'createBlockTexture', 'createBlockMaterials',
    'getBlockMaterial', 'initRenderer', 'initScene', 'initCamera',
    'onWindowResize', 'animate', 'startLoop', 'stopLoop', 'init',
    'playerPos', 'playerVelocity', 'onGround', 'yaw', 'pitch', 'selectedSlot',
    'PLAYER_HEIGHT', 'PLAYER_WIDTH', 'EYE_HEIGHT', 'GRAVITY', 'JUMP_SPEED',
    'WALK_SPEED', 'SPRINT_SPEED', 'REACH', 'BLOCK_HOTBAR',
    'updatePlayer', 'initPlayer', 'getSelectedBlockType', 'collidesAt',
    'isSolidBlock', 'isSolidAt', 'moveAxis',
    'HOTBAR_BLOCKS', 'initUI', 'updateUI', 'setSelectedSlot'
  ];
  /* world.js is wrapped in an IIFE, so its `var`s are function-scoped and only
     reach the page through `window.x = ...`. Read from `window` first, then
     fall back to the bare identifier for engine.js's top-level `const`s. */
  const exposeCode = '\n;(function () {\n' +
    EXPOSE.map((n) =>
      '  try { __sandbox.' + n + ' = (typeof window !== "undefined" && window.' + n +
      ' !== undefined) ? window.' + n + ' : ' + n + '; } catch (e) {}'
    ).join('\n') +
    '\n})();\n';

  sandbox.__sandbox = sandbox;
  vm.runInContext(parts.join('\n') + exposeCode, sandbox, { filename: 'game-bundle.js' });
  return { sandbox, doc, win };
}

module.exports = { loadGame, GAME_DIR, Vector3, Element };