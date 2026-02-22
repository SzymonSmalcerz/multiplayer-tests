'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────
const TREE_KEYS = new Set(['tree1', 'tree2', 'tree3']);
const NPC_TYPES = ['trader'];

// Pixel size used to render NPC thumbnails / placements when no sprite found
const NPC_DISPLAY_W = 48;
const NPC_DISPLAY_H = 64;

// ── State ─────────────────────────────────────────────────────────────────────
let registry = {};          // { [key]: { type, imageWidth, imageHeight, collision } }
const images = {};          // { [key]: HTMLImageElement }

let mapWidth = 2000;
let mapHeight = 2000;

let placedObjects = [];     // { type, x, y }[]
let placedNpcs    = [];     // { type, x, y }[]

let selectedType     = null;  // string | null
let selectedCategory = null;  // 'object' | 'npc' | null

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
  addSection('Objects', otherKeys, 'object');
  addNpcSection();
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

function createSidebarItem(imageKey, type, category) {
  const item = document.createElement('div');
  item.className = 'sidebar-item';
  item.dataset.type = type;
  item.dataset.category = category;

  // Thumbnail canvas
  const thumb = document.createElement('canvas');
  thumb.width  = 48;
  thumb.height = 48;
  thumb.className = 'sidebar-thumb';
  item.appendChild(thumb);

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

  // Placement preview under cursor
  if (selectedType && cursorOnCanvas) {
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
    const dw = NPC_DISPLAY_W * zoom;
    const dh = NPC_DISPLAY_H * zoom;
    if (img && img.complete && img.naturalWidth > 0) {
      // Draw just the first "walk-down" frame (row 0, col 0) — sprite sheet is 576×256, 9 cols × 4 rows
      const frameW = img.naturalWidth  / 9;
      const frameH = img.naturalHeight / 4;
      ctx.drawImage(img, 0, 0, frameW, frameH, sx, sy, dw, dh);
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

  // Left click: place selected object
  if (e.button === 0 && selectedType) {
    const world = screenToWorld(sx, sy);
    const wx = Math.round(world.x);
    const wy = Math.round(world.y);
    if (wx < 0 || wy < 0 || wx > mapWidth || wy > mapHeight) return;

    if (selectedCategory === 'npc') {
      placedNpcs.push({ type: selectedType, x: wx, y: wy });
    } else {
      placedObjects.push({ type: selectedType, x: wx, y: wy });
    }
    updateStatus();
  }
});

// Stop panning on mouseup anywhere in the document
document.addEventListener('mouseup', e => {
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
  // Delete/Backspace: remove last placed object
  if ((e.code === 'Delete' || e.code === 'Backspace') && document.activeElement === document.body) {
    if (placedNpcs.length > 0 || placedObjects.length > 0) {
      // Remove whichever was placed last by comparing array lengths
      // Simple heuristic: remove from whichever category was used last
      if (placedObjects.length > 0) {
        placedObjects.pop();
      } else {
        placedNpcs.pop();
      }
      updateStatus();
    }
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

  const data = { objects: placedObjects, npcs: placedNpcs };

  statusBar.textContent = `Saving ${name}.json…`;
  try {
    const res  = await fetch('/design/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, data }),
    });
    const json = await res.json();
    if (json.ok) {
      statusBar.textContent = `Saved → public/assets/maps/placement/${name}.json  (${placedObjects.length} objects, ${placedNpcs.length} NPCs)`;
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
    placedObjects = Array.isArray(data.objects) ? data.objects : [];
    placedNpcs    = Array.isArray(data.npcs)    ? data.npcs    : [];
    statusBar.textContent = `Loaded ${name}.json — ${placedObjects.length} objects, ${placedNpcs.length} NPCs`;
  } catch (err) {
    statusBar.textContent = `Load error: ${err.message}`;
  }
});

// ── Clear ──────────────────────────────────────────────────────────────────────
clearBtn.addEventListener('click', () => {
  if (placedObjects.length === 0 && placedNpcs.length === 0) return;
  if (confirm(`Clear all ${placedObjects.length + placedNpcs.length} placed items?`)) {
    placedObjects = [];
    placedNpcs    = [];
    updateStatus();
  }
});

// ── Status helper ──────────────────────────────────────────────────────────────
function updateStatus() {
  const sel    = selectedType ? `Selected: ${selectedType}` : 'No selection';
  const coords = cursorOnCanvas ? `  Cursor: (${cursorWX}, ${cursorWY})` : '';
  const count  = `  Objects: ${placedObjects.length}  NPCs: ${placedNpcs.length}`;
  statusBar.textContent = sel + coords + count;
}

// ── Init ───────────────────────────────────────────────────────────────────────
async function init() {
  resizeCanvas();

  // Try to fetch registry from server
  let rawRegistry = {};
  try {
    const res = await fetch('/design/objects');
    rawRegistry = await res.json();
  } catch (err) {
    statusBar.textContent = `Failed to load object registry: ${err.message}`;
  }

  registry = rawRegistry;

  // Load images for all static objects
  for (const key of Object.keys(registry)) {
    loadImage(key, imagePathForKey(key));
  }

  // Load NPC sprite images (the player skin sheets serve as stand-ins)
  // Trader uses the first male skin as a placeholder if no dedicated sprite exists
  for (const npcType of NPC_TYPES) {
    const img = new Image();
    // Try a dedicated NPC sprite first; fall back gracefully (no onerror needed)
    img.src = `/assets/npcs/${npcType}.png`;
    images['npc_' + npcType] = img;
  }

  // Fit map to viewport and start render loop
  fitMap();
  buildSidebar();
  canvas.style.cursor = 'crosshair';
  updateStatus();
  requestAnimationFrame(render);
}

init();
