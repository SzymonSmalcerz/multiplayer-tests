'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────
const TREE_KEYS = new Set(['tree1', 'tree2', 'tree3']);
const NPC_TYPES = ['trader'];

// Pixel size used to render NPC thumbnails / placements when no sprite found
const NPC_DISPLAY_W = 48;
const NPC_DISPLAY_H = 64;

// ── State ─────────────────────────────────────────────────────────────────────
let registry      = {};     // { [key]: { type, imageWidth, imageHeight, collision } }
let mobRegistry   = {};     // { [key]: { type, frameWidth, frameHeight, … } }
let enemyRegistry = {};     // { [key]: { type, label, defaultRespawnTime } }
const images      = {};     // { [key]: HTMLImageElement }

let mapWidth  = 2000;
let mapHeight = 2000;

let placedObjects = [];     // { type, x, y }[]
let placedNpcs    = [];     // { type, x, y }[]
let placedMobs    = [];     // { type, x, y, width, height, quantity }[]
let placedEnemies = [];     // { type, x, y, respawnTime }[]

let selectedType     = null;  // string | null
let selectedCategory = null;  // 'object' | 'npc' | 'mob' | 'enemy' | null

// Mob drag-to-draw state
let isDraggingMob  = false;
let mobDragStartWX = 0;
let mobDragStartWY = 0;

// Canvas transform
let zoom        = 0.3;
let panX        = 0;
let panY        = 0;

// Pan state
let isPanning    = false;
let panStartMX   = 0;
let panStartMY   = 0;
let panStartPanX = 0;
let panStartPanY = 0;
let spaceDown    = false;

// Cursor world position (for placement preview)
let cursorWX = 0;
let cursorWY = 0;
let cursorOnCanvas = false;

// ── DOM references ─────────────────────────────────────────────────────────────
const canvas        = document.getElementById('map-canvas');
const ctx           = canvas.getContext('2d');
const sidebar       = document.getElementById('sidebar');
const statusBar     = document.getElementById('status');
const mapNameInput  = document.getElementById('map-name');
const mapWidthInput = document.getElementById('map-width');
const mapHeightInput= document.getElementById('map-height');
const saveBtn       = document.getElementById('save-btn');
const loadBtn       = document.getElementById('load-btn');
const clearBtn      = document.getElementById('clear-btn');

// ── Coordinate transforms ──────────────────────────────────────────────────────
function worldToScreen(wx, wy) {
  return { x: (wx - panX) * zoom, y: (wy - panY) * zoom };
}

function screenToWorld(sx, sy) {
  return { x: sx / zoom + panX, y: sy / zoom + panY };
}

// ── Image helpers ──────────────────────────────────────────────────────────────
function imagePathForKey(key) {
  if (TREE_KEYS.has(key)) return `/assets/trees/${key}.png`;
  return `/assets/entities/${key}.png`;
}

function loadImage(key, src) {
  const img = new Image();
  img.src = src;
  images[key] = img;
  return img;
}

// Draw an image (or fallback rect) scaled to fit a destination rect on any canvas context
function drawImageFit(tc, img, def, dx, dy, dw, dh, fallbackLabel) {
  if (img && img.complete && img.naturalWidth > 0) {
    tc.drawImage(img, dx, dy, dw, dh);
  } else {
    tc.fillStyle = '#5a4a3a';
    tc.fillRect(dx, dy, dw, dh);
    if (fallbackLabel) {
      tc.fillStyle = '#ddd';
      tc.font = `${Math.max(8, Math.min(12, dw / 5))}px sans-serif`;
      tc.textAlign = 'center';
      tc.textBaseline = 'middle';
      tc.fillText(fallbackLabel.substring(0, 10), dx + dw / 2, dy + dh / 2);
    }
  }
}

// ── Sidebar ────────────────────────────────────────────────────────────────────
function buildSidebar() {
  sidebar.innerHTML = '';

  const treeKeys = Object.keys(registry).filter(k => TREE_KEYS.has(k)).sort();
  const otherKeys = Object.keys(registry).filter(k => !TREE_KEYS.has(k)).sort();

  addSection('Trees', treeKeys, 'object');
  addObjectSection(otherKeys);
  addNpcSection();
  addMobSection();
  addEnemySection();
}

function addSection(title, keys, category) {
  if (keys.length === 0) return;

  const heading = document.createElement('div');
  heading.className = 'sidebar-heading';
  heading.textContent = title;
  sidebar.appendChild(heading);

  keys.forEach(key => {
    const item  = createSidebarItem(key, key, category);
    sidebar.appendChild(item);
  });
}

function addObjectSection(keys) {
  const heading = document.createElement('div');
  heading.className = 'sidebar-heading';
  heading.textContent = 'Objects';
  sidebar.appendChild(heading);

  keys.forEach(key => {
    const item = createSidebarItem(key, key, 'object');
    sidebar.appendChild(item);
  });

  const addBtn = document.createElement('a');
  addBtn.href      = '/design/object-builder';
  addBtn.className = 'sidebar-add-btn';
  addBtn.textContent = '+ Add new object';
  sidebar.appendChild(addBtn);
}

function addNpcSection() {
  const heading = document.createElement('div');
  heading.className = 'sidebar-heading';
  heading.textContent = 'NPCs';
  sidebar.appendChild(heading);

  NPC_TYPES.forEach(key => {
    const item = createSidebarItem('npc_' + key, key, 'npc');
    // Relabel
    item.querySelector('.sidebar-label').textContent = key + ' (NPC)';
    sidebar.appendChild(item);
  });
}

function addMobSection() {
  const keys = Object.keys(mobRegistry).sort();
  if (keys.length === 0) return;

  const heading = document.createElement('div');
  heading.className = 'sidebar-heading';
  heading.textContent = 'Mobs (drag to place)';
  sidebar.appendChild(heading);

  keys.forEach(key => {
    const def = mobRegistry[key];
    const item = document.createElement('div');
    item.className = 'sidebar-item';
    item.dataset.type = key;
    item.dataset.category = 'mob';

    const thumb = document.createElement('canvas');
    thumb.width  = 48;
    thumb.height = 48;
    thumb.className = 'sidebar-thumb';
    item.appendChild(thumb);

    const label = document.createElement('div');
    label.className = 'sidebar-label';
    label.textContent = key;
    item.appendChild(label);

    item.addEventListener('click', () => selectType(key, 'mob'));
    sidebar.appendChild(item);

    // Draw the first "goDown" frame (row 3, col 0) as thumbnail
    const img = images['mob_' + key];
    function drawMobThumb() {
      const tc = thumb.getContext('2d');
      tc.clearRect(0, 0, 48, 48);
      if (img && img.complete && img.naturalWidth > 0) {
        const cols = img.naturalWidth / def.frameWidth;
        const goDownFirstFrame = 3 * cols; // row 3, col 0
        const sx = (goDownFirstFrame % cols) * def.frameWidth;
        const sy = Math.floor(goDownFirstFrame / cols) * def.frameHeight;
        const scale = Math.min(48 / def.frameWidth, 48 / def.frameHeight);
        const dw = def.frameWidth  * scale;
        const dh = def.frameHeight * scale;
        try {
          tc.drawImage(img, sx, sy, def.frameWidth, def.frameHeight,
                       (48 - dw) / 2, (48 - dh) / 2, dw, dh);
        } catch (_) {}
      } else {
        tc.fillStyle = '#2a5a3a';
        tc.fillRect(4, 4, 40, 40);
        tc.fillStyle = '#ccc';
        tc.font = '9px sans-serif';
        tc.textAlign = 'center';
        tc.textBaseline = 'middle';
        tc.fillText(key, 24, 24);
      }
    }
    if (!img || img.complete) drawMobThumb();
    else { img.addEventListener('load', drawMobThumb); img.addEventListener('error', drawMobThumb); }
  });
}

function addEnemySection() {
  const heading = document.createElement('div');
  heading.className = 'sidebar-heading';
  heading.textContent = 'Enemies (click to place)';
  sidebar.appendChild(heading);

  const keys = Object.keys(enemyRegistry).sort();
  keys.forEach(key => {
    const def  = enemyRegistry[key];
    const item = document.createElement('div');
    item.className        = 'sidebar-item';
    item.dataset.type     = key;
    item.dataset.category = 'enemy';

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'sidebar-thumb-wrap';
    item.appendChild(thumbWrap);

    const thumb = document.createElement('canvas');
    thumb.width = thumb.height = 48;
    thumb.className = 'sidebar-thumb';
    thumbWrap.appendChild(thumb);

    const editBtn = document.createElement('a');
    editBtn.href      = `/design/enemy-editor?edit=${encodeURIComponent(key)}`;
    editBtn.className = 'sidebar-edit-btn';
    editBtn.title     = 'Edit enemy';
    editBtn.textContent = '✏';
    editBtn.addEventListener('click', e => e.stopPropagation());
    thumbWrap.appendChild(editBtn);

    const label = document.createElement('div');
    label.className = 'sidebar-label';
    label.textContent = def.label + ` (${def.defaultRespawnTime}s)`;
    item.appendChild(label);

    item.addEventListener('click', () => selectType(key, 'enemy'));
    sidebar.appendChild(item);

    const img = images['enemy_' + key];
    function drawThumb() {
      const tc = thumb.getContext('2d');
      tc.clearRect(0, 0, 48, 48);
      drawEnemyFrame(tc, img, def, 24, 24, 40);
    }
    if (!img || img.complete) drawThumb();
    else { img.addEventListener('load', drawThumb); img.addEventListener('error', drawThumb); }
  });

  const addBtn = document.createElement('a');
  addBtn.href      = '/design/enemy-builder';
  addBtn.className = 'sidebar-add-btn';
  addBtn.textContent = '+ Add new enemy';
  sidebar.appendChild(addBtn);
}

/**
 * Draw the enemy idle frame centred at (cx, cy) fitting within a square of `size` px.
 * Falls back to the red X marker if the image isn't loaded yet.
 */
function drawEnemyFrame(tc, img, def, cx, cy, size) {
  if (img && img.complete && img.naturalWidth > 0) {
    // The assembled spritesheet always has idle row at y=0; first idle frame is at (0,0).
    const sx    = 0;
    const sy    = 0;
    const scale = size / Math.max(def.frameWidth, def.frameHeight);
    const dw    = def.frameWidth  * scale;
    const dh    = def.frameHeight * scale;
    try {
      tc.drawImage(img, sx, sy, def.frameWidth, def.frameHeight,
                   cx - dw / 2, cy - dh / 2, dw, dh);
    } catch (_) {}
  } else {
    // Fallback: red circle with X
    const r = size / 2;
    tc.beginPath();
    tc.arc(cx, cy, r, 0, Math.PI * 2);
    tc.fillStyle = 'rgba(200,40,40,0.85)';
    tc.fill();
    tc.strokeStyle = '#ff8888';
    tc.lineWidth = 1.5;
    tc.stroke();
    const d = r * 0.5;
    tc.strokeStyle = '#fff';
    tc.lineWidth = 2;
    tc.beginPath(); tc.moveTo(cx - d, cy - d); tc.lineTo(cx + d, cy + d); tc.stroke();
    tc.beginPath(); tc.moveTo(cx + d, cy - d); tc.lineTo(cx - d, cy + d); tc.stroke();
  }
}

function renderEnemyMarker(enemy, alpha) {
  const def = enemyRegistry[enemy.type];
  const img = def ? images['enemy_' + enemy.type] : null;
  const { x: sx, y: sy } = worldToScreen(enemy.x, enemy.y);
  ctx.globalAlpha = alpha;

  // Sprite display size matches game (32 px frame upscaled to 48 px)
  const displaySize = Math.max(12, 48 * zoom);
  drawEnemyFrame(ctx, img, def, sx, sy, displaySize);

  ctx.fillStyle = '#ffaaaa';
  const fontSize = Math.max(9, Math.min(13, 11 * zoom));
  ctx.font = `${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(`${enemy.type} ${enemy.respawnTime}s`, sx, sy + displaySize / 2 + 2);

  ctx.globalAlpha = 1;
}

function createSidebarItem(imageKey, type, category) {
  const item = document.createElement('div');
  item.className = 'sidebar-item';
  item.dataset.type = type;
  item.dataset.category = category;

  // Thumbnail + edit-icon wrapper
  const thumbWrap = document.createElement('div');
  thumbWrap.className = 'sidebar-thumb-wrap';
  item.appendChild(thumbWrap);

  // Thumbnail canvas
  const thumb = document.createElement('canvas');
  thumb.width  = 48;
  thumb.height = 48;
  thumb.className = 'sidebar-thumb';
  thumbWrap.appendChild(thumb);

  // Edit icon (objects only)
  if (category === 'object') {
    const editBtn = document.createElement('a');
    editBtn.href      = `/design/object-builder?edit=${encodeURIComponent(type)}`;
    editBtn.className = 'sidebar-edit-btn';
    editBtn.title     = 'Edit object';
    editBtn.textContent = '✏';
    editBtn.addEventListener('click', e => e.stopPropagation());
    thumbWrap.appendChild(editBtn);
  }

  const label = document.createElement('div');
  label.className = 'sidebar-label';
  label.textContent = type;
  item.appendChild(label);

  item.addEventListener('click', () => selectType(type, category));
  sidebar.appendChild(item);

  // Schedule thumbnail draw
  const img = images[imageKey];
  const def = registry[type];

  function drawThumb() {
    const tc = thumb.getContext('2d');
    tc.clearRect(0, 0, 48, 48);

    if (img && img.complete && img.naturalWidth > 0) {
      const imgW = def ? def.imageWidth  : img.naturalWidth;
      const imgH = def ? def.imageHeight : img.naturalHeight;
      const scale = Math.min(48 / imgW, 48 / imgH);
      const dw = imgW * scale;
      const dh = imgH * scale;
      const dx = (48 - dw) / 2;
      const dy = (48 - dh) / 2;
      try { tc.drawImage(img, dx, dy, dw, dh); } catch (_) {}
    } else {
      // Placeholder
      tc.fillStyle = category === 'npc' ? '#2a4a7a' : '#5a4a3a';
      tc.fillRect(4, 4, 40, 40);
      tc.fillStyle = '#ccc';
      tc.font = '9px sans-serif';
      tc.textAlign = 'center';
      tc.textBaseline = 'middle';
      tc.fillText(type.substring(0, 12), 24, 24);
    }
  }

  if (!img || img.complete) {
    drawThumb();
  } else {
    img.addEventListener('load', drawThumb);
    img.addEventListener('error', drawThumb);
  }

  return item;
}

function selectType(type, category) {
  selectedType     = type;
  selectedCategory = category;

  document.querySelectorAll('.sidebar-item').forEach(el => {
    el.classList.toggle(
      'selected',
      el.dataset.type === type && el.dataset.category === category
    );
  });

  updateStatus();
}

// ── Canvas resize ──────────────────────────────────────────────────────────────
function resizeCanvas() {
  const container = canvas.parentElement;
  canvas.width  = container.clientWidth;
  canvas.height = container.clientHeight;
}

// Fit the full map into the canvas with a 5% margin on each side
function fitMap() {
  zoom = Math.min(canvas.width / mapWidth, canvas.height / mapHeight) * 0.9;
  // Centre the map
  panX = -(canvas.width  / zoom - mapWidth)  / 2;
  panY = -(canvas.height / zoom - mapHeight) / 2;
}

// ── Render loop ────────────────────────────────────────────────────────────────
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Outer void
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Map background (grass)
  const tl = worldToScreen(0, 0);
  const br = worldToScreen(mapWidth, mapHeight);
  const mw = br.x - tl.x;
  const mh = br.y - tl.y;

  ctx.fillStyle = '#4a6a3a';
  ctx.fillRect(tl.x, tl.y, mw, mh);

  // Grid
  drawGrid(tl, br);

  // Placed static objects
  placedObjects.forEach(obj => renderObject(obj.type, obj.x, obj.y, 'object', 1.0));

  // Placed NPCs
  placedNpcs.forEach(obj => renderObject(obj.type, obj.x, obj.y, 'npc', 1.0));

  // Placed mob zones
  placedMobs.forEach(mob => renderMobZone(mob, 1.0));

  // Placed enemies
  placedEnemies.forEach(e => renderEnemyMarker(e, 1.0));

  // Mob drag preview
  if (isDraggingMob && selectedType && cursorOnCanvas) {
    const x  = Math.min(mobDragStartWX, cursorWX);
    const y  = Math.min(mobDragStartWY, cursorWY);
    const w  = Math.abs(cursorWX - mobDragStartWX) || 50;
    const h  = Math.abs(cursorWY - mobDragStartWY) || 50;
    renderMobZone({ type: selectedType, x, y, width: w, height: h, quantity: 1 }, 0.5);
  }

  // Enemy placement preview
  if (selectedCategory === 'enemy' && selectedType && cursorOnCanvas) {
    const def = enemyRegistry[selectedType];
    renderEnemyMarker(
      { type: selectedType, x: cursorWX, y: cursorWY,
        respawnTime: def ? def.defaultRespawnTime : 10 },
      0.45
    );
  }

  // Object/NPC placement preview under cursor (only when not dragging a mob or enemy)
  if (selectedType && cursorOnCanvas && selectedCategory !== 'mob' && selectedCategory !== 'enemy') {
    renderObject(selectedType, cursorWX, cursorWY, selectedCategory, 0.45);
  }

  // Map border
  ctx.strokeStyle = '#aaa';
  ctx.lineWidth = Math.max(1, zoom);
  ctx.strokeRect(tl.x, tl.y, mw, mh);

  requestAnimationFrame(render);
}

function drawGrid(tl, br) {
  const spacing = 100; // world units
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 0.5;

  // Visible world range
  const wx0 = Math.max(0, Math.floor(panX / spacing) * spacing);
  const wy0 = Math.max(0, Math.floor(panY / spacing) * spacing);
  const wx1 = Math.min(mapWidth,  panX + canvas.width  / zoom);
  const wy1 = Math.min(mapHeight, panY + canvas.height / zoom);

  for (let wx = wx0; wx <= wx1; wx += spacing) {
    const sx = worldToScreen(wx, 0).x;
    ctx.beginPath();
    ctx.moveTo(sx, Math.max(tl.y, 0));
    ctx.lineTo(sx, Math.min(br.y, canvas.height));
    ctx.stroke();
  }
  for (let wy = wy0; wy <= wy1; wy += spacing) {
    const sy = worldToScreen(0, wy).y;
    ctx.beginPath();
    ctx.moveTo(Math.max(tl.x, 0), sy);
    ctx.lineTo(Math.min(br.x, canvas.width), sy);
    ctx.stroke();
  }
}

function renderObject(type, wx, wy, category, alpha) {
  const { x: sx, y: sy } = worldToScreen(wx, wy);
  ctx.globalAlpha = alpha;

  if (category === 'npc') {
    const img = images['npc_' + type];
    const loaded = img && img.complete && img.naturalWidth > 0;
    // Use the image's own dimensions so any NPC sprite renders at its natural size
    const dw = (loaded ? img.naturalWidth  : NPC_DISPLAY_W) * zoom;
    const dh = (loaded ? img.naturalHeight : NPC_DISPLAY_H) * zoom;
    if (loaded) {
      ctx.drawImage(img, sx, sy, dw, dh);
    } else {
      ctx.fillStyle = '#2a5a9a';
      ctx.fillRect(sx, sy, dw, dh);
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.max(8, 10 * zoom)}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(type, sx + 2, sy + 2);
    }
  } else {
    const def = registry[type];
    if (!def) { ctx.globalAlpha = 1; return; }
    const img = images[type];
    const dw = def.imageWidth  * zoom;
    const dh = def.imageHeight * zoom;
    drawImageFit(ctx, img, def, sx, sy, dw, dh, type);
  }

  ctx.globalAlpha = 1;
}

function renderMobZone(mob, alpha) {
  const def = mobRegistry[mob.type];
  if (!def) return;

  const tl = worldToScreen(mob.x, mob.y);
  const br = worldToScreen(mob.x + mob.width, mob.y + mob.height);
  const zw = br.x - tl.x;
  const zh = br.y - tl.y;
  if (zw < 1 || zh < 1) return;

  ctx.globalAlpha = alpha;

  // Zone fill
  ctx.fillStyle = 'rgba(40,110,40,0.18)';
  ctx.fillRect(tl.x, tl.y, zw, zh);

  // Dashed border
  ctx.strokeStyle = '#6add6a';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(tl.x, tl.y, zw, zh);
  ctx.setLineDash([]);

  // Mob sprite (first goDown frame) centred in zone
  const img = images['mob_' + mob.type];
  if (img && img.complete && img.naturalWidth > 0) {
    const cols = img.naturalWidth / def.frameWidth;
    const row3col0 = 3 * cols;
    const sx = (row3col0 % cols) * def.frameWidth;
    const sy = Math.floor(row3col0 / cols) * def.frameHeight;
    const scale = Math.min((zw * 0.45) / def.frameWidth, (zh * 0.45) / def.frameHeight, 2);
    const dw = def.frameWidth  * scale;
    const dh = def.frameHeight * scale;
    try {
      ctx.drawImage(img, sx, sy, def.frameWidth, def.frameHeight,
                    tl.x + zw / 2 - dw / 2, tl.y + zh / 2 - dh / 2, dw, dh);
    } catch (_) {}
  }

  // Label
  ctx.fillStyle = '#aeffae';
  const fontSize = Math.max(10, Math.min(14, zw / 8));
  ctx.font = `${fontSize}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(mob.type, tl.x + zw / 2, tl.y + 3);

  ctx.globalAlpha = 1;
}

// ── Coordinate helpers ─────────────────────────────────────────────────────────
function objectDisplaySize(type, category) {
  if (category === 'npc') return { w: NPC_DISPLAY_W, h: NPC_DISPLAY_H };
  const def = registry[type];
  return def ? { w: def.imageWidth, h: def.imageHeight } : { w: 32, h: 32 };
}

// ── Hit test — returns index into array or -1 ──────────────────────────────────
function hitTest(arr, category, wx, wy) {
  for (let i = arr.length - 1; i >= 0; i--) {
    const obj = arr[i];
    const { w, h } = objectDisplaySize(obj.type, category);
    if (wx >= obj.x && wx <= obj.x + w && wy >= obj.y && wy <= obj.y + h) {
      return i;
    }
  }
  return -1;
}

// ── Canvas events ──────────────────────────────────────────────────────────────
canvas.addEventListener('mousemove', e => {
  const rect  = canvas.getBoundingClientRect();
  const sx    = e.clientX - rect.left;
  const sy    = e.clientY - rect.top;
  const world = screenToWorld(sx, sy);
  cursorWX = Math.round(world.x);
  cursorWY = Math.round(world.y);
  cursorOnCanvas = true;

  if (isPanning) {
    panX = panStartPanX + (panStartMX - sx) / zoom;
    panY = panStartPanY + (panStartMY - sy) / zoom;
  }

  updateStatus();
});

canvas.addEventListener('mouseleave', () => {
  cursorOnCanvas = false;
  if (!isPanning) updateStatus();
});

canvas.addEventListener('mouseenter', () => {
  cursorOnCanvas = true;
});

canvas.addEventListener('mousedown', e => {
  const rect = canvas.getBoundingClientRect();
  const sx   = e.clientX - rect.left;
  const sy   = e.clientY - rect.top;

  // Pan: middle button OR Space + left button
  if (e.button === 1 || (e.button === 0 && spaceDown)) {
    isPanning    = true;
    panStartMX   = sx;
    panStartMY   = sy;
    panStartPanX = panX;
    panStartPanY = panY;
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
    return;
  }

  // Left click: start mob drag OR place object/NPC
  if (e.button === 0 && selectedType) {
    const world = screenToWorld(sx, sy);
    const wx = Math.round(world.x);
    const wy = Math.round(world.y);

    if (selectedCategory === 'mob') {
      // Begin drag to define spawn rectangle
      isDraggingMob  = true;
      mobDragStartWX = wx;
      mobDragStartWY = wy;
      canvas.style.cursor = 'crosshair';
      e.preventDefault();
      return;
    }

    if (wx < 0 || wy < 0 || wx > mapWidth || wy > mapHeight) return;

    if (selectedCategory === 'enemy') {
      const def = enemyRegistry[selectedType];
      placedEnemies.push({
        type:        selectedType,
        x:           wx,
        y:           wy,
        respawnTime: def ? def.defaultRespawnTime : 10,
      });
      updateStatus();
      return;
    }

    if (selectedCategory === 'npc') {
      placedNpcs.push({ type: selectedType, x: wx, y: wy });
    } else {
      placedObjects.push({ type: selectedType, x: wx, y: wy });
    }
    updateStatus();
  }
});

// Stop panning / finalise mob rect on mouseup anywhere in the document
document.addEventListener('mouseup', e => {
  if (isDraggingMob) {
    isDraggingMob = false;
    if (selectedType) {
      const def = mobRegistry[selectedType];
      const x = Math.min(mobDragStartWX, cursorWX);
      const y = Math.min(mobDragStartWY, cursorWY);
      const w = Math.max(50, Math.abs(cursorWX - mobDragStartWX));
      const h = Math.max(50, Math.abs(cursorWY - mobDragStartWY));
      placedMobs.push({
        type:                       selectedType,
        x, y, width: w, height: h,
        speed:                      def.defaultSpeed,
        changeTime:                 def.defaultChangeTime,
        specialTime:                def.defaultSpecialTime,
        chanceOfDoingSpecialAction: def.defaultChanceOfSpecialAction,
        howManyAnimationsPerSec:    def.defaultFrameRate,
      });
      updateStatus();
    }
    canvas.style.cursor = 'crosshair';
    return;
  }
  if (isPanning) {
    isPanning = false;
    canvas.style.cursor = spaceDown ? 'grab' : 'crosshair';
  }
});

canvas.addEventListener('contextmenu', e => {
  e.preventDefault();
  const rect  = canvas.getBoundingClientRect();
  const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  const wx    = world.x;
  const wy    = world.y;

  // Try enemies first (point markers, ±12 px square hit area)
  for (let i = placedEnemies.length - 1; i >= 0; i--) {
    const e = placedEnemies[i];
    if (Math.abs(wx - e.x) <= 12 && Math.abs(wy - e.y) <= 12) {
      placedEnemies.splice(i, 1);
      updateStatus();
      return;
    }
  }

  // Try NPCs first (they appear on top)
  const npcIdx = hitTest(placedNpcs, 'npc', wx, wy);
  if (npcIdx !== -1) {
    placedNpcs.splice(npcIdx, 1);
    updateStatus();
    return;
  }

  // Then static objects
  const objIdx = hitTest(placedObjects, 'object', wx, wy);
  if (objIdx !== -1) {
    placedObjects.splice(objIdx, 1);
    updateStatus();
    return;
  }

  // Then mob zones (click anywhere inside the rectangle)
  for (let i = placedMobs.length - 1; i >= 0; i--) {
    const m = placedMobs[i];
    if (wx >= m.x && wx <= m.x + m.width && wy >= m.y && wy <= m.y + m.height) {
      placedMobs.splice(i, 1);
      updateStatus();
      return;
    }
  }
});

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const mx   = e.clientX - rect.left;
  const my   = e.clientY - rect.top;

  // Zoom toward the cursor position
  const worldBefore = screenToWorld(mx, my);
  const factor = e.deltaY < 0 ? 1.12 : 0.9;
  zoom = Math.max(0.04, Math.min(5, zoom * factor));
  const worldAfter = screenToWorld(mx, my);
  panX += worldBefore.x - worldAfter.x;
  panY += worldBefore.y - worldAfter.y;
}, { passive: false });

// Space key for pan mode
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && document.activeElement === document.body) {
    e.preventDefault();
    if (!spaceDown) {
      spaceDown = true;
      canvas.style.cursor = 'grab';
    }
  }
  // Delete/Backspace: remove the last placed item in the active category
  if ((e.code === 'Delete' || e.code === 'Backspace') && document.activeElement === document.body) {
    if (selectedCategory === 'enemy' && placedEnemies.length > 0) {
      placedEnemies.pop();
    } else if (selectedCategory === 'mob' && placedMobs.length > 0) {
      placedMobs.pop();
    } else if (selectedCategory === 'npc' && placedNpcs.length > 0) {
      placedNpcs.pop();
    } else if (placedObjects.length > 0) {
      placedObjects.pop();
    } else if (placedMobs.length > 0) {
      placedMobs.pop();
    } else if (placedNpcs.length > 0) {
      placedNpcs.pop();
    } else if (placedEnemies.length > 0) {
      placedEnemies.pop();
    }
    updateStatus();
  }
  // Escape: deselect
  if (e.code === 'Escape') {
    selectedType = selectedCategory = null;
    document.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('selected'));
    updateStatus();
  }
});

document.addEventListener('keyup', e => {
  if (e.code === 'Space') {
    spaceDown = false;
    if (!isPanning) canvas.style.cursor = 'crosshair';
  }
});

window.addEventListener('resize', () => {
  resizeCanvas();
});

// ── Map size inputs ────────────────────────────────────────────────────────────
mapWidthInput.addEventListener('change', () => {
  mapWidth = Math.max(100, parseInt(mapWidthInput.value) || 2000);
  mapWidthInput.value = mapWidth;
});

mapHeightInput.addEventListener('change', () => {
  mapHeight = Math.max(100, parseInt(mapHeightInput.value) || 2000);
  mapHeightInput.value = mapHeight;
});

// ── Save ───────────────────────────────────────────────────────────────────────
saveBtn.addEventListener('click', async () => {
  const name = mapNameInput.value.trim();
  if (!name) {
    alert('Enter a map name first.');
    return;
  }

  const data = { objects: placedObjects, npcs: placedNpcs, mobs: placedMobs, enemies: placedEnemies };

  statusBar.textContent = `Saving ${name}.json…`;
  try {
    const res  = await fetch('/design/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, data }),
    });
    const json = await res.json();
    if (json.ok) {
      statusBar.textContent = `Saved → public/assets/maps/placement/${name}.json  (${placedObjects.length} objects, ${placedNpcs.length} NPCs, ${placedMobs.length} mob zones, ${placedEnemies.length} enemies)`;
    } else {
      statusBar.textContent = `Save failed: ${json.error}`;
    }
  } catch (err) {
    statusBar.textContent = `Save error: ${err.message}`;
  }
});

// ── Load ───────────────────────────────────────────────────────────────────────
loadBtn.addEventListener('click', async () => {
  const name = mapNameInput.value.trim();
  if (!name) {
    alert('Enter the map name to load.');
    return;
  }

  statusBar.textContent = `Loading ${name}.json…`;
  try {
    const res = await fetch(`/assets/maps/placement/${name}.json`);
    if (!res.ok) {
      statusBar.textContent = `Load failed: ${res.status} ${res.statusText}`;
      return;
    }
    const data = await res.json();
    placedObjects  = Array.isArray(data.objects)  ? data.objects  : [];
    placedNpcs     = Array.isArray(data.npcs)     ? data.npcs     : [];
    placedMobs     = Array.isArray(data.mobs)     ? data.mobs     : [];
    placedEnemies  = Array.isArray(data.enemies)  ? data.enemies  : [];
    statusBar.textContent = `Loaded ${name}.json — ${placedObjects.length} objects, ${placedNpcs.length} NPCs, ${placedMobs.length} mob zones, ${placedEnemies.length} enemies`;
  } catch (err) {
    statusBar.textContent = `Load error: ${err.message}`;
  }
});

// ── Clear ──────────────────────────────────────────────────────────────────────
clearBtn.addEventListener('click', () => {
  const total = placedObjects.length + placedNpcs.length + placedMobs.length + placedEnemies.length;
  if (total === 0) return;
  if (confirm(`Clear all ${total} placed items?`)) {
    placedObjects  = [];
    placedNpcs     = [];
    placedMobs     = [];
    placedEnemies  = [];
    updateStatus();
  }
});

// ── Status helper ──────────────────────────────────────────────────────────────
function updateStatus() {
  const sel    = selectedType ? `Selected: ${selectedType}` : 'No selection';
  const coords = cursorOnCanvas ? `  Cursor: (${cursorWX}, ${cursorWY})` : '';
  const count  = `  Objects: ${placedObjects.length}  NPCs: ${placedNpcs.length}  Mob zones: ${placedMobs.length}  Enemies: ${placedEnemies.length}`;
  const hint   = selectedCategory === 'mob' ? '  — drag to draw spawn rect' : '';
  statusBar.textContent = sel + hint + coords + count;
}

// ── Init ───────────────────────────────────────────────────────────────────────
async function init() {
  resizeCanvas();

  // Fetch all registries in parallel
  const [objectsRes, mobsRes, enemiesRes] = await Promise.allSettled([
    fetch('/design/objects'),
    fetch('/design/mobs'),
    fetch('/design/enemies'),
  ]);

  if (objectsRes.status === 'fulfilled' && objectsRes.value.ok) {
    registry = await objectsRes.value.json();
  } else {
    statusBar.textContent = 'Failed to load object registry';
  }

  if (mobsRes.status === 'fulfilled' && mobsRes.value.ok) {
    mobRegistry = await mobsRes.value.json();
  } else {
    statusBar.textContent = 'Failed to load mob registry';
  }

  if (enemiesRes.status === 'fulfilled' && enemiesRes.value.ok) {
    enemyRegistry = await enemiesRes.value.json();
  } else {
    statusBar.textContent = 'Failed to load enemy registry';
  }

  // Load images for all static objects (use spritePath from registry when available)
  for (const key of Object.keys(registry)) {
    const src = (registry[key] && registry[key].spritePath) ? registry[key].spritePath : imagePathForKey(key);
    loadImage(key, src);
  }

  // Load NPC sprite images
  for (const npcType of NPC_TYPES) {
    const img = new Image();
    img.src = `/assets/npcs/${npcType}.png`;
    images['npc_' + npcType] = img;
  }

  // Load mob sprite sheets
  for (const key of Object.keys(mobRegistry)) {
    loadImage('mob_' + key, `/assets/mobs/${key}.png`);
  }

  // Load enemy sprite sheets
  for (const key of Object.keys(enemyRegistry)) {
    loadImage('enemy_' + key, enemyRegistry[key].spritePath);
  }

  // Fit map to viewport and start render loop
  fitMap();
  buildSidebar();
  canvas.style.cursor = 'crosshair';
  updateStatus();
  requestAnimationFrame(render);
}

init();
