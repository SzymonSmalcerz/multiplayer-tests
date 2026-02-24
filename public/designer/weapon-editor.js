'use strict';

const editType = new URLSearchParams(window.location.search).get('edit');
if (!editType) {
  document.body.innerHTML = '<p style="padding:20px;color:#df7a7a">No ?edit=TYPE parameter specified. <a href="/design" style="color:#aaa">← Back</a></p>';
}

// ── State ──────────────────────────────────────────────────────────────────────
let def            = null;
let originalType   = null;
let spriteImg      = null;   // original sprite Image
let newSpriteImg   = null;   // uploaded replacement
let uploadedDataURL = null;

// ── DOM ────────────────────────────────────────────────────────────────────────
const inpType    = document.getElementById('inp-type');
const inpLabel   = document.getElementById('inp-label');
const inpDamage  = document.getElementById('inp-damage');
const inpRadius  = document.getElementById('inp-radius');
const inpCost    = document.getElementById('inp-cost');
const renameWarn = document.getElementById('we-rename-warn');
const radiusCvs  = document.getElementById('we-radius-canvas');
const rCtx       = radiusCvs ? radiusCvs.getContext('2d') : null;
const statusEl   = document.getElementById('we-status');
const saveBtn    = document.getElementById('btn-save-weapon');
const dropEl     = document.getElementById('we-upload-drop');
const fileInput  = document.getElementById('we-file-input');
const uploadLbl  = document.getElementById('we-upload-label');
const newPreview = document.getElementById('we-new-preview');

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

// ── Radius preview ─────────────────────────────────────────────────────────────
function drawRadiusPreview() {
  if (!radiusCvs || !rCtx) return;
  const img = getActiveImg();
  if (!img || !img.complete || !img.naturalWidth) {
    radiusCvs.width = radiusCvs.height = 0;
    return;
  }

  const r     = Math.max(1, Number(inpRadius.value) || 33);
  const MAX   = 280;
  const scale = Math.min(MAX / img.naturalWidth, MAX / img.naturalHeight, 4);
  const dw    = Math.round(img.naturalWidth  * scale);
  const dh    = Math.round(img.naturalHeight * scale);
  const pad   = Math.round(r * scale) + 4;

  radiusCvs.width  = dw + pad * 2;
  radiusCvs.height = dh + pad * 2;

  rCtx.imageSmoothingEnabled = false;
  rCtx.fillStyle = '#1a1a1a';
  rCtx.fillRect(0, 0, radiusCvs.width, radiusCvs.height);
  try { rCtx.drawImage(img, pad, pad, dw, dh); } catch (_) {}

  const cx = pad + dw / 2;
  const cy = pad + dh / 2;
  rCtx.beginPath();
  rCtx.arc(cx, cy, r * scale, 0, Math.PI * 2);
  rCtx.strokeStyle = 'rgba(255, 80, 80, 0.85)';
  rCtx.lineWidth   = 2;
  rCtx.stroke();
  rCtx.fillStyle   = 'rgba(255, 80, 80, 0.12)';
  rCtx.fill();
}

if (inpRadius) inpRadius.addEventListener('input', drawRadiusPreview);

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
      newPreview.src           = uploadedDataURL;
      newPreview.style.display = 'block';
      uploadLbl.textContent    = '✔ New sprite loaded — click to replace';
      drawRadiusPreview();
    };
    newSpriteImg.src = uploadedDataURL;
  };
  reader.readAsDataURL(file);
}

// ── Load weapon definition ─────────────────────────────────────────────────────
async function loadDef() {
  setStatus('Loading…');
  let registry;
  try {
    const res = await fetch('/design/weapons');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    registry = await res.json();
  } catch (err) {
    setStatus('Failed to load weapon registry: ' + err.message, 'err');
    return;
  }

  def = registry[editType];
  if (!def) {
    setStatus(`Weapon type '${editType}' not found in registry`, 'err');
    return;
  }

  originalType = def.type;

  inpType.value   = def.type;
  inpLabel.value  = def.label;
  inpDamage.value = def.damage;
  inpRadius.value = def.hitRadius;
  inpCost.value   = def.cost;

  document.getElementById('page-title').textContent = `Weapon Editor — ${def.label}`;
  document.title = `Edit: ${def.label}`;

  spriteImg = new Image();
  spriteImg.onload  = () => { drawRadiusPreview(); saveBtn.disabled = false; setStatus(''); };
  spriteImg.onerror = () => { setStatus('Could not load sprite image', 'err'); saveBtn.disabled = false; };
  spriteImg.src = def.spritePath;
}

// ── Save ───────────────────────────────────────────────────────────────────────
if (saveBtn) {
  saveBtn.addEventListener('click', async () => {
    const newType = inpType.value.trim();
    if (!newType || !/^[a-z0-9_]+$/.test(newType)) {
      setStatus('Type key must be lowercase alphanumeric / underscore only', 'err');
      return;
    }

    const activeImg  = getActiveImg();
    const imgH       = activeImg?.naturalHeight ?? 0;
    const body = {
      originalType,
      type:        newType,
      label:       inpLabel.value.trim() || newType,
      damage:      Number(inpDamage.value),
      cost:        Number(inpCost.value),
      hitRadius:   Number(inpRadius.value),
      orbitRadius: Math.round(imgH / 2 + 10),
      ...(uploadedDataURL ? { imageBase64: uploadedDataURL } : {}),
    };

    setStatus('Saving…');
    saveBtn.disabled = true;

    try {
      const res  = await fetch('/design/update-weapon', {
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
