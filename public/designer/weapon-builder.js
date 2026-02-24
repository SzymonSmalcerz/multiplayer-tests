'use strict';

// ── Edit-mode detection ────────────────────────────────────────────────────────
const editType   = new URLSearchParams(window.location.search).get('edit');
const isEditMode = !!editType;
let   originalType = null;
let   existingSpritePath = null;

// ── Wizard state ───────────────────────────────────────────────────────────────
const STEP_COUNT  = 4;
const STEP_LABELS = ['Upload', 'Identifier', 'Stats', 'Review'];

let currentStep     = 1;
let uploadedDataURL = null;  // newly uploaded image; null = keep existing in edit mode
let naturalW        = 0;
let naturalH        = 0;
let typeKey         = '';
let weaponLabel     = '';
let damage          = 50;
let cost            = 0;
let hitRadius       = 33;

let existingTypes   = new Set();

// ── DOM ────────────────────────────────────────────────────────────────────────
const statusEl = document.getElementById('eb-status');
const btnPrev  = document.getElementById('btn-prev');
const btnNext  = document.getElementById('btn-next');
const btnSave  = document.getElementById('btn-save');

// ── Image source helper ────────────────────────────────────────────────────────
function getActiveImageSrc() {
  return uploadedDataURL ?? existingSpritePath;
}

// ── Step management ────────────────────────────────────────────────────────────
function buildIndicator() {
  const ind = document.getElementById('step-indicator');
  STEP_LABELS.forEach((lbl, i) => {
    const dot = document.createElement('span');
    dot.className = 'step-dot';
    dot.title = `Step ${i + 1}: ${lbl}`;
    ind.appendChild(dot);
  });
}

function updateIndicator() {
  document.querySelectorAll('.step-dot').forEach((d, i) => {
    d.classList.remove('done', 'active');
    if (i + 1 < currentStep)  d.classList.add('done');
    if (i + 1 === currentStep) d.classList.add('active');
  });
}

const STEP_IDS = ['step-upload', 'step-identifier', 'step-stats', 'step-review'];

function showStep(n) {
  document.querySelectorAll('.eb-step').forEach(el => el.classList.remove('active'));
  document.getElementById(STEP_IDS[n - 1]).classList.add('active');

  btnPrev.disabled      = (n === 1);
  btnNext.style.display = (n < STEP_COUNT) ? '' : 'none';
  btnSave.style.display = (n === STEP_COUNT) ? '' : 'none';
  btnSave.disabled      = false;

  updateIndicator();
  clearStatus();

  if (n === 3) onEnterStatsStep();
  if (n === 4) renderReview();
}

function goNext() {
  if (!validateStep(currentStep)) return;
  currentStep++;
  showStep(currentStep);
}

function goPrev() {
  currentStep--;
  showStep(currentStep);
}

function setStatus(msg, isErr = false) {
  statusEl.textContent = msg;
  statusEl.className   = isErr ? 'err' : 'ok';
}

function clearStatus() {
  statusEl.textContent = '';
  statusEl.className   = '';
}

// ── Validation ─────────────────────────────────────────────────────────────────
function validateStep(n) {
  if (n === 1) {
    if (!getActiveImageSrc()) { setStatus('Please upload a weapon image first.', true); return false; }
    return true;
  }
  if (n === 2) {
    const val = document.getElementById('type-key-input').value.trim().toLowerCase();
    if (!val) { setStatus('Please enter a type identifier.', true); return false; }
    if (!/^[a-z0-9_]+$/.test(val)) {
      setStatus('Type must be lowercase letters, digits, or underscores only.', true);
      return false;
    }
    const isUnchanged = isEditMode && val === originalType;
    if (!isUnchanged && existingTypes.has(val)) {
      setStatus(`'${val}' already exists. Choose a different identifier.`, true);
      return false;
    }
    typeKey = val;

    const lbl = document.getElementById('label-input').value.trim();
    if (!lbl) { setStatus('Please enter a display label.', true); return false; }
    weaponLabel = lbl;
    return true;
  }
  if (n === 3) {
    damage    = Number(document.getElementById('damage-input').value)   || 0;
    cost      = Number(document.getElementById('cost-input').value)     || 0;
    hitRadius = Number(document.getElementById('radius-input').value)   || 33;
    if (damage < 0)    { setStatus('Damage must be ≥ 0.',    true); return false; }
    if (cost < 0)      { setStatus('Cost must be ≥ 0.',      true); return false; }
    if (hitRadius < 1) { setStatus('Hit radius must be ≥ 1.', true); return false; }
    return true;
  }
  return true;
}

// ── Edit-mode data loading ─────────────────────────────────────────────────────
async function loadEditData(type) {
  try {
    const res = await fetch('/design/weapons');
    if (!res.ok) throw new Error('Failed to fetch weapons registry');
    const registry = await res.json();
    const def = registry[type];
    if (!def) { setStatus(`Weapon '${type}' not found in registry.`, true); return false; }

    originalType       = type;
    typeKey            = type;
    weaponLabel        = def.label;
    damage             = def.damage;
    cost               = def.cost;
    hitRadius          = def.hitRadius;
    existingSpritePath = def.spritePath || `/assets/weapons/${type}.png`;

    await new Promise(resolve => {
      const img = new Image();
      img.onload  = () => { naturalW = img.naturalWidth; naturalH = img.naturalHeight; resolve(); };
      img.onerror = resolve;
      img.src = existingSpritePath;
    });

    return true;
  } catch (err) {
    setStatus(`Failed to load weapon data: ${err.message}`, true);
    return false;
  }
}

// ── Step 1: Upload ─────────────────────────────────────────────────────────────
function buildUploadStep() {
  const el = document.getElementById('step-upload');
  const editNote = isEditMode
    ? '<p style="color:#7adf7a;font-size:12px;margin-top:4px">Edit mode — upload a replacement image, or skip to keep the current sprite.</p>'
    : '';
  el.innerHTML = `
    <h2>Step 1 — ${isEditMode ? 'Replace Image (optional)' : 'Upload Weapon Image'}</h2>
    <p>Upload a PNG for your weapon. This image is used both in the shop and during combat.</p>
    ${editNote}
    <div id="upload-drop">
      <input type="file" id="upload-file-input" accept=".png,image/png">
      <div id="upload-drop-label">${isEditMode ? 'Click or drag to upload a replacement PNG' : 'Click or drag-and-drop a PNG here'}</div>
    </div>
    <img id="upload-preview">
    <div id="upload-info" style="font-size:12px;color:#888;margin-top:6px"></div>
  `;

  const dropEl    = document.getElementById('upload-drop');
  const fileInput = document.getElementById('upload-file-input');
  const preview   = document.getElementById('upload-preview');
  const infoEl    = document.getElementById('upload-info');

  if (isEditMode && existingSpritePath) {
    preview.src = existingSpritePath;
    preview.style.display = '';
    infoEl.textContent = `Current: ${existingSpritePath}`;
  }

  function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const dataURL = ev.target.result;
      const img = new Image();
      img.onload = () => {
        uploadedDataURL = dataURL;
        naturalW = img.naturalWidth;
        naturalH = img.naturalHeight;
        preview.src = dataURL;
        preview.style.display = '';
        infoEl.textContent = `${naturalW} × ${naturalH} px`;
        clearStatus();
      };
      img.src = dataURL;
    };
    reader.readAsDataURL(file);
  }

  dropEl.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', e => handleFile(e.target.files[0]));
  dropEl.addEventListener('dragover', e => { e.preventDefault(); dropEl.classList.add('drag-over'); });
  dropEl.addEventListener('dragleave', () => dropEl.classList.remove('drag-over'));
  dropEl.addEventListener('drop', e => {
    e.preventDefault();
    dropEl.classList.remove('drag-over');
    handleFile(e.dataTransfer.files[0]);
  });
}

// ── Step 2: Identifier & Label ─────────────────────────────────────────────────
function buildIdentifierStep() {
  const el = document.getElementById('step-identifier');
  const renameNote = isEditMode
    ? '<p style="color:#dfaa7a;font-size:12px;margin-top:4px">⚠ Renaming will not update existing map/save files that reference this type.</p>'
    : '';
  el.innerHTML = `
    <h2>Step 2 — ${isEditMode ? 'Identifier & Label (rename optional)' : 'Weapon Identifier & Label'}</h2>
    <p>The type key is used internally. The label is shown in the shop.</p>
    ${renameNote}
    <div class="wb-form" style="margin-top:12px">
      <label for="type-key-input">Type key</label>
      <input id="type-key-input" type="text" placeholder="e.g. fire_sword" autocomplete="off" spellcheck="false"
             value="${isEditMode ? typeKey : ''}">
      <label for="label-input">Display label</label>
      <input id="label-input" type="text" placeholder="e.g. Fire Sword"
             value="${isEditMode ? weaponLabel : ''}">
    </div>
    <div id="type-check-hint" style="font-size:12px;margin-top:10px;color:#888"></div>
  `;

  const input = document.getElementById('type-key-input');
  const hint  = document.getElementById('type-check-hint');

  function updateHint() {
    const v = input.value.trim().toLowerCase();
    if (!v) { hint.textContent = ''; return; }
    if (!/^[a-z0-9_]+$/.test(v)) {
      hint.style.color = '#df7a7a';
      hint.textContent = 'Only lowercase letters, digits, and underscores allowed.';
    } else if (isEditMode && v === originalType) {
      hint.style.color = '#888';
      hint.textContent = `'${v}' — current identifier (unchanged).`;
    } else if (existingTypes.has(v)) {
      hint.style.color = '#df7a7a';
      hint.textContent = `'${v}' is already taken.`;
    } else {
      hint.style.color = '#7adf7a';
      hint.textContent = `'${v}' is available.`;
    }
  }
  input.addEventListener('input', updateHint);
  if (isEditMode) updateHint();
}

// ── Step 3: Stats + hit radius ─────────────────────────────────────────────────
function buildStatsStep() {
  const el = document.getElementById('step-stats');
  el.innerHTML = `
    <h2>Step 3 — Stats & Hit Radius</h2>
    <p>Set the weapon's combat properties. The hit radius is the circle around the orbiting weapon sprite that triggers damage. Adjust the preview to see how large the hit area looks on the sprite.</p>
    <div style="display:flex;gap:28px;flex-wrap:wrap;margin-top:8px">
      <div class="wb-form">
        <label for="damage-input">Damage</label>
        <input id="damage-input" type="number" min="0" value="${damage}">
        <label for="cost-input">Cost (gold)</label>
        <input id="cost-input"  type="number" min="0" value="${cost}">
        <label for="radius-input">Hit radius (px)</label>
        <input id="radius-input" type="number" min="1" max="200" value="${hitRadius}">
        <label style="color:#666;font-size:11px">0 = free / default</label>
        <div style="font-size:11px;color:#888">Set cost to 0 to make this the default weapon (not sold in shop)</div>
      </div>
      <div>
        <div style="font-size:12px;color:#888;margin-bottom:8px">Hit radius preview (red circle)</div>
        <canvas id="radius-canvas"></canvas>
      </div>
    </div>
  `;
}

function onEnterStatsStep() {
  const radiusInput = document.getElementById('radius-input');
  radiusInput.addEventListener('input', drawRadiusPreview);
  drawRadiusPreview();
}

function drawRadiusPreview() {
  const cvs = document.getElementById('radius-canvas');
  if (!cvs) return;
  const r   = Math.max(1, Number(document.getElementById('radius-input').value) || hitRadius);
  const src = getActiveImageSrc();
  if (!src) {
    cvs.width = cvs.height = 0;
    return;
  }

  const img = new Image();
  img.onload = () => {
    const MAX   = 240;
    const scale = Math.min(MAX / img.naturalWidth, MAX / img.naturalHeight, 4);
    const dw    = Math.round(img.naturalWidth  * scale);
    const dh    = Math.round(img.naturalHeight * scale);
    const pad   = Math.round(r * scale) + 4;
    cvs.width   = dw + pad * 2;
    cvs.height  = dh + pad * 2;

    const tc = cvs.getContext('2d');
    tc.imageSmoothingEnabled = false;
    tc.clearRect(0, 0, cvs.width, cvs.height);
    tc.fillStyle = '#1a1a1a';
    tc.fillRect(0, 0, cvs.width, cvs.height);

    tc.drawImage(img, pad, pad, dw, dh);

    // Draw hit radius circle centred on sprite
    const cx = pad + dw / 2;
    const cy = pad + dh / 2;
    tc.beginPath();
    tc.arc(cx, cy, r * scale, 0, Math.PI * 2);
    tc.strokeStyle = 'rgba(255, 80, 80, 0.85)';
    tc.lineWidth   = 2;
    tc.stroke();
    tc.fillStyle   = 'rgba(255, 80, 80, 0.12)';
    tc.fill();
  };
  img.src = src;
}

// ── Step 4: Review ─────────────────────────────────────────────────────────────
function renderReview() {
  const el = document.getElementById('step-review');
  const inShop = cost > 0 ? `Yes — ${cost} gold` : 'No (cost 0 = default/free weapon)';

  el.innerHTML = `
    <h2>Step 4 — Review & ${isEditMode ? 'Update' : 'Save'}</h2>
    <div id="review-wrap">
      <div id="review-summary">
        <strong>Action:</strong> ${isEditMode
          ? `Update '${originalType}'${typeKey !== originalType ? ` → rename to '${typeKey}'` : ''}`
          : `Create '${typeKey}'`}<br>
        <strong>Type:</strong> ${typeKey}<br>
        <strong>Label:</strong> ${weaponLabel}<br>
        <strong>Damage:</strong> ${damage}<br>
        <strong>In shop:</strong> ${inShop}<br>
        <strong>Hit radius:</strong> ${hitRadius} px<br>
        ${isEditMode && !uploadedDataURL ? '<strong>Image:</strong> keeping existing sprite<br>' : ''}
      </div>
      <div id="review-preview-wrap">
        <canvas id="review-canvas"></canvas>
        <div id="review-label">Weapon preview (hit radius in red)</div>
      </div>
    </div>
  `;

  const src = getActiveImageSrc();
  if (!src) return;
  const cvs = document.getElementById('review-canvas');
  const img = new Image();
  img.onload = () => {
    const MAX   = 200;
    const scale = Math.min(MAX / img.naturalWidth, MAX / img.naturalHeight, 4);
    const dw    = Math.round(img.naturalWidth  * scale);
    const dh    = Math.round(img.naturalHeight * scale);
    const pad   = Math.round(hitRadius * scale) + 4;
    cvs.width   = dw + pad * 2;
    cvs.height  = dh + pad * 2;

    const tc = cvs.getContext('2d');
    tc.imageSmoothingEnabled = false;
    tc.fillStyle = '#1a1a1a';
    tc.fillRect(0, 0, cvs.width, cvs.height);
    tc.drawImage(img, pad, pad, dw, dh);

    const cx = pad + dw / 2;
    const cy = pad + dh / 2;
    tc.beginPath();
    tc.arc(cx, cy, hitRadius * scale, 0, Math.PI * 2);
    tc.strokeStyle = 'rgba(255, 80, 80, 0.85)';
    tc.lineWidth   = 2;
    tc.stroke();
    tc.fillStyle   = 'rgba(255, 80, 80, 0.12)';
    tc.fill();
  };
  img.src = src;
}

// ── Save / Update ──────────────────────────────────────────────────────────────
async function saveWeapon() {
  btnSave.disabled = true;
  setStatus(isEditMode ? 'Updating…' : 'Saving…');

  const body = {
    type:        typeKey,
    label:       weaponLabel,
    damage,
    cost,
    hitRadius,
    orbitRadius: Math.round(naturalH / 2 + 10),
    ...(uploadedDataURL ? { imageBase64: uploadedDataURL } : {}),
    ...(isEditMode ? { originalType } : {}),
  };

  const endpoint = isEditMode ? '/design/update-weapon' : '/design/save-weapon';

  try {
    const res  = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const json = await res.json();
    if (json.ok) {
      setStatus(isEditMode
        ? `Updated! '${typeKey}' has been saved.`
        : `Saved! '${typeKey}' is now available in the trader shop.`
      );
    } else {
      setStatus(`Error: ${json.error}`, true);
      btnSave.disabled = false;
    }
  } catch (err) {
    setStatus(`Network error: ${err.message}`, true);
    btnSave.disabled = false;
  }
}

// ── Init ───────────────────────────────────────────────────────────────────────
async function init() {
  // Fetch existing type keys for uniqueness validation
  try {
    const res = await fetch('/design/weapons');
    if (res.ok) existingTypes = new Set(Object.keys(await res.json()));
  } catch (_) {}

  if (isEditMode) {
    document.getElementById('wb-title').textContent = `Weapon Builder — Edit: ${editType}`;
    document.title = `Edit weapon: ${editType}`;
    const ok = await loadEditData(editType);
    if (!ok) return;
  }

  buildIndicator();
  buildUploadStep();
  buildIdentifierStep();
  buildStatsStep();

  btnPrev.addEventListener('click', goPrev);
  btnNext.addEventListener('click', goNext);
  btnSave.addEventListener('click', saveWeapon);

  showStep(1);
}

init();
