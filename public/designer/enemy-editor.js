'use strict';

const editType = new URLSearchParams(window.location.search).get('edit');
if (!editType) {
  document.body.innerHTML = '<p style="padding:20px;color:#df7a7a">No ?edit=TYPE parameter specified. <a href="/design" style="color:#aaa">← Back</a></p>';
}

// ── State ──────────────────────────────────────────────────────────────────────
let def            = null;  // loaded EnemyDef
let originalType   = null;
let spriteImg      = null;  // original sprite Image
let newSpriteImg   = null;  // replacement uploaded by user
let uploadedDataURL = null;

// Hitbox drag state
let hitbox     = { x: 0, y: 0, width: 20, height: 20 };
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let canvasScale = 1;

// ── DOM ────────────────────────────────────────────────────────────────────────
const inpType        = document.getElementById('inp-type');
const inpLabel       = document.getElementById('inp-label');
const inpLevel       = document.getElementById('inp-level');
const inpHp          = document.getElementById('inp-hp');
const inpDamage      = document.getElementById('inp-damage');
const inpXp          = document.getElementById('inp-xp');
const inpGold        = document.getElementById('inp-gold');
const inpGoldChance  = document.getElementById('inp-gold-chance');
const inpAttackRange = document.getElementById('inp-attack-range');
const inpAttackCd    = document.getElementById('inp-attack-cd');
const inpSpeed       = document.getElementById('inp-speed');
const inpAggro       = document.getElementById('inp-aggro');
const inpRespawn     = document.getElementById('inp-respawn');
const renameWarn     = document.getElementById('ee-rename-warn');
const hitboxCanvas   = document.getElementById('ee-hitbox-canvas');
const hitboxInfo     = document.getElementById('ee-hitbox-info');
const hCtx           = hitboxCanvas ? hitboxCanvas.getContext('2d') : null;
const statusEl       = document.getElementById('ee-status');
const saveBtn        = document.getElementById('btn-save-enemy');
const dropEl         = document.getElementById('ee-upload-drop');
const fileInput      = document.getElementById('ee-file-input');
const uploadLabel    = document.getElementById('ee-upload-label');
const newPreview     = document.getElementById('ee-new-preview');

// ── Helpers ────────────────────────────────────────────────────────────────────
function setStatus(msg, cls) {
  statusEl.textContent = msg;
  statusEl.className   = cls || '';
}

function getActiveImg() {
  return newSpriteImg || spriteImg;
}

// ── Rename warning ─────────────────────────────────────────────────────────────
if (inpType) {
  inpType.addEventListener('input', () => {
    renameWarn.style.display = inpType.value.trim() !== originalType ? '' : 'none';
  });
}

// ── Asset upload ───────────────────────────────────────────────────────────────
if (dropEl) {
  dropEl.addEventListener('click', () => fileInput.click());
  dropEl.addEventListener('dragover', e => { e.preventDefault(); dropEl.classList.add('drag-over'); });
  dropEl.addEventListener('dragleave', () => dropEl.classList.remove('drag-over'));
  dropEl.addEventListener('drop', e => {
    e.preventDefault();
    dropEl.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
}

if (fileInput) {
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
  });
}

function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = ev => {
    uploadedDataURL = ev.target.result;
    newSpriteImg = new Image();
    newSpriteImg.onload = () => {
      newPreview.src            = uploadedDataURL;
      newPreview.style.display  = 'block';
      uploadLabel.textContent   = '✔ New sprite loaded — click to replace';
      drawCanvas();
    };
    newSpriteImg.src = uploadedDataURL;
  };
  reader.readAsDataURL(file);
}

// ── Load enemy definition ──────────────────────────────────────────────────────
async function loadDef() {
  setStatus('Loading…');
  let registry;
  try {
    const res = await fetch('/design/enemies');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    registry = await res.json();
  } catch (err) {
    setStatus('Failed to load enemy registry: ' + err.message, 'err');
    return;
  }

  def = registry[editType];
  if (!def) {
    setStatus(`Enemy type '${editType}' not found in registry`, 'err');
    return;
  }

  originalType = def.type;

  // Populate form fields
  inpType.value        = def.type;
  inpLabel.value       = def.label;
  inpLevel.value       = def.level;
  inpHp.value          = def.hp;
  inpDamage.value      = def.damage;
  inpXp.value          = def.xpReward;
  inpGold.value        = def.goldAmount;
  inpGoldChance.value  = def.goldChance;
  inpAttackRange.value = def.attackRange;
  inpAttackCd.value    = def.attackCooldownMs;
  inpSpeed.value       = def.speed;
  inpAggro.value       = def.aggroRange;
  inpRespawn.value     = def.defaultRespawnTime;

  hitbox = { ...def.hitbox };

  document.getElementById('page-title').textContent = `Enemy Editor — ${def.label}`;
  document.title = `Edit: ${def.label}`;

  spriteImg = new Image();
  spriteImg.onload  = () => { initCanvas(); saveBtn.disabled = false; setStatus(''); };
  spriteImg.onerror = () => {
    setStatus('Could not load sprite image', 'err');
    initCanvas();
    saveBtn.disabled = false;
  };
  spriteImg.src = def.spritePath;
}

// ── Canvas ─────────────────────────────────────────────────────────────────────
function initCanvas() {
  if (!def || !hitboxCanvas) return;
  const fw  = def.frameWidth;
  const fh  = def.frameHeight;
  const MAX = 420;
  canvasScale = Math.min(MAX / fw, MAX / fh, 4);
  if (canvasScale < 1) canvasScale = 1;
  hitboxCanvas.width  = Math.round(fw * canvasScale);
  hitboxCanvas.height = Math.round(fh * canvasScale);
  drawCanvas();
  updateHitboxInfo();
}

function drawCanvas() {
  if (!def || !hCtx) return;
  const fw = def.frameWidth;
  const fh = def.frameHeight;
  const cw = hitboxCanvas.width;
  const ch = hitboxCanvas.height;

  hCtx.clearRect(0, 0, cw, ch);
  hCtx.fillStyle = '#1a1a1a';
  hCtx.fillRect(0, 0, cw, ch);

  const img = getActiveImg();
  if (img && img.complete && img.naturalWidth > 0) {
    try {
      // Draw first idle frame (top-left of sprite sheet, sx=0, sy=0)
      hCtx.drawImage(img, 0, 0, fw, fh, 0, 0, cw, ch);
    } catch (_) {}
  }

  // Hitbox overlay
  const hx = hitbox.x      * canvasScale;
  const hy = hitbox.y      * canvasScale;
  const hw = hitbox.width  * canvasScale;
  const hh = hitbox.height * canvasScale;
  hCtx.fillStyle   = 'rgba(220, 40, 40, 0.25)';
  hCtx.strokeStyle = 'rgba(255, 80, 80, 0.9)';
  hCtx.lineWidth   = 1.5;
  hCtx.fillRect(hx, hy, hw, hh);
  hCtx.strokeRect(hx, hy, hw, hh);

  // Corner handles
  hCtx.fillStyle = '#ff5555';
  for (const [px, py] of [[hx, hy], [hx + hw, hy], [hx, hy + hh], [hx + hw, hy + hh]]) {
    hCtx.fillRect(px - 3, py - 3, 6, 6);
  }
}

function updateHitboxInfo() {
  hitboxInfo.innerHTML =
    `<strong>Hitbox</strong><br>` +
    `x: ${hitbox.x}<br>y: ${hitbox.y}<br>` +
    `width: ${hitbox.width}<br>height: ${hitbox.height}<br>` +
    `<br><em style="color:#666">Drag on the sprite to redefine</em>`;
}

// ── Hitbox drag ─────────────────────────────────────────────────────────────────
function canvasCoords(e) {
  const rect = hitboxCanvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(def.frameWidth,  Math.round((e.clientX - rect.left) / canvasScale))),
    y: Math.max(0, Math.min(def.frameHeight, Math.round((e.clientY - rect.top)  / canvasScale))),
  };
}

if (hitboxCanvas) {
  hitboxCanvas.addEventListener('mousedown', e => {
    if (e.button !== 0 || !def) return;
    const { x, y } = canvasCoords(e);
    isDragging = true;
    dragStartX = x;
    dragStartY = y;
    hitbox = { x, y, width: 0, height: 0 };
    e.preventDefault();
  });

  hitboxCanvas.addEventListener('mousemove', e => {
    if (!isDragging) return;
    const { x, y } = canvasCoords(e);
    hitbox = {
      x:      Math.min(dragStartX, x),
      y:      Math.min(dragStartY, y),
      width:  Math.abs(x - dragStartX),
      height: Math.abs(y - dragStartY),
    };
    drawCanvas();
    updateHitboxInfo();
  });
}

document.addEventListener('mouseup', () => {
  if (!isDragging) return;
  isDragging = false;
  // Revert if the drag was too small to be intentional
  if (hitbox.width < 2 || hitbox.height < 2) {
    hitbox = { ...def.hitbox };
    drawCanvas();
    updateHitboxInfo();
  }
});

// ── Save ───────────────────────────────────────────────────────────────────────
if (saveBtn) {
  saveBtn.addEventListener('click', async () => {
    const newType = inpType.value.trim();
    if (!newType || !/^[a-z0-9_]+$/.test(newType)) {
      setStatus('Type key must be lowercase alphanumeric / underscore only', 'err');
      return;
    }
    if (hitbox.width < 1 || hitbox.height < 1) {
      setStatus('Please define a valid hitbox by dragging on the canvas', 'err');
      return;
    }

    const body = {
      originalType,
      type:               newType,
      label:              inpLabel.value.trim() || newType,
      level:              Number(inpLevel.value),
      hp:                 Number(inpHp.value),
      damage:             Number(inpDamage.value),
      xpReward:           Number(inpXp.value),
      goldAmount:         Number(inpGold.value),
      goldChance:         Number(inpGoldChance.value),
      attackRange:        Number(inpAttackRange.value),
      attackCooldownMs:   Number(inpAttackCd.value),
      speed:              Number(inpSpeed.value),
      aggroRange:         Number(inpAggro.value),
      defaultRespawnTime: Number(inpRespawn.value),
      frameWidth:         def.frameWidth,
      frameHeight:        def.frameHeight,
      framesPerState:     def.framesPerState,
      hitbox,
      ...(uploadedDataURL ? { spriteBase64: uploadedDataURL } : {}),
    };

    setStatus('Saving…');
    saveBtn.disabled = true;

    try {
      const res  = await fetch('/design/update-enemy', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
      const json = await res.json();
      if (res.ok && json.ok) {
        setStatus('Saved! Redirecting…', 'ok');
        setTimeout(() => { window.location.href = '/design'; }, 1200);
      } else {
        setStatus('Error: ' + (json.error || res.statusText), 'err');
        saveBtn.disabled = false;
      }
    } catch (err) {
      setStatus('Network error: ' + err.message, 'err');
      saveBtn.disabled = false;
    }
  });
}

// ── Boot ───────────────────────────────────────────────────────────────────────
if (editType) loadDef();
