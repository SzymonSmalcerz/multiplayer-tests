'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
const STEP_COUNT  = 5;
const STEP_LABELS = ['Upload', 'Identifier', 'Animation', 'Collision', 'Review'];

// Edit-mode state (set during init if ?edit= param is present)
const editType         = new URLSearchParams(window.location.search).get('edit');
const isEditMode       = !!editType;
let   originalType     = null;   // the type being edited (before potential rename)
let   existingSpritePath = null; // URL to current sprite on server

// Wizard state
let currentStep     = 1;
let uploadedDataURL = null;   // data URL of a newly uploaded replacement image; null = keep existing
let naturalW        = 0;
let naturalH        = 0;
let typeKey         = '';
let isAnimated      = false;
let frameCount      = 1;
let frameRate       = 8;
let frameWidth      = 0;
let noCollision     = false;
let collision       = null;   // { x0, y0, x1, y1 } in frame-local pixels

let existingTypes   = new Set();

// Collision canvas helpers
let colImg          = null;
let colImgSrc       = null;
let colDragging     = false;
let colDragStartImgX = 0;
let colDragStartImgY = 0;
let colDisplayScale  = 1;

// ── DOM references ─────────────────────────────────────────────────────────────
const statusEl = document.getElementById('eb-status');
const btnPrev  = document.getElementById('btn-prev');
const btnNext  = document.getElementById('btn-next');
const btnSave  = document.getElementById('btn-save');

// ── Image source helper ────────────────────────────────────────────────────────
// In edit mode, fall back to the existing server-side sprite if no new file was uploaded.
function getActiveImageSrc() {
  return uploadedDataURL ?? existingSpritePath;
}

// ── Step management ────────────────────────────────────────────────────────────

function buildIndicator() {
  const ind = document.getElementById('step-indicator');
  STEP_LABELS.forEach((label, i) => {
    const dot = document.createElement('span');
    dot.className = 'step-dot';
    dot.title = `Step ${i + 1}: ${label}`;
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

const STEP_IDS = ['step-upload', 'step-identifier', 'step-animation', 'step-collision', 'step-review'];

function showStep(n) {
  document.querySelectorAll('.eb-step').forEach(el => el.classList.remove('active'));
  document.getElementById(STEP_IDS[n - 1]).classList.add('active');

  btnPrev.disabled      = (n === 1);
  btnNext.style.display = (n < STEP_COUNT) ? '' : 'none';
  btnSave.style.display = (n === STEP_COUNT) ? '' : 'none';
  btnSave.disabled      = false;

  updateIndicator();
  clearStatus();

  if (n === 3) onEnterAnimationStep();
  if (n === 4) onEnterCollisionStep();
  if (n === 5) renderReview();
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
    if (!getActiveImageSrc()) { setStatus('Please upload an image first.', true); return false; }
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
    return true;
  }
  if (n === 3) {
    const animated = document.querySelector('input[name="anim-mode"]:checked').value === 'animated';
    isAnimated = animated;
    if (animated) {
      const fc = parseInt(document.getElementById('frame-count-input').value, 10);
      if (!fc || fc < 2) { setStatus('Frame count must be at least 2.', true); return false; }
      frameCount = fc;
      frameRate  = parseFloat(document.getElementById('frame-rate-input').value) || 8;
      if (frameRate <= 0) frameRate = 8;
      frameWidth = Math.round(naturalW / frameCount);
    } else {
      frameCount = 1;
      frameRate  = 8;
      frameWidth = naturalW;
    }
    return true;
  }
  return true;
}

// ── Edit-mode data loading ─────────────────────────────────────────────────────

async function loadEditData(type) {
  try {
    const res = await fetch('/design/objects');
    if (!res.ok) throw new Error('Failed to fetch objects registry');
    const registry = await res.json();
    const def = registry[type];
    if (!def) { setStatus(`Object '${type}' not found in registry.`, true); return false; }

    originalType      = type;
    typeKey           = type;
    existingSpritePath = def.spritePath || `/assets/entities/${type}.png`;

    frameWidth = def.imageWidth;
    naturalH   = def.imageHeight;
    frameCount = def.frameCount || 1;
    frameRate  = def.frameRate  || 8;
    isAnimated = frameCount > 1;
    naturalW   = frameWidth * frameCount;  // computed; real image may differ

    if (def.collision) {
      collision   = { ...def.collision };
      noCollision = false;
    } else {
      collision   = null;
      noCollision = true;
    }

    // Verify actual image dimensions (may differ from registry if manually edited)
    await new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        naturalW = img.naturalWidth;
        naturalH = img.naturalHeight;
        frameWidth = isAnimated ? Math.round(naturalW / frameCount) : naturalW;
        resolve();
      };
      img.onerror = resolve;
      img.src = existingSpritePath;
    });

    return true;
  } catch (err) {
    setStatus(`Failed to load object data: ${err.message}`, true);
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
    <h2>Step 1 — ${isEditMode ? 'Replace Image (optional)' : 'Upload Image'}</h2>
    <p>Upload a PNG for your object. For animated objects all frames must be in a single horizontal row of equal width.</p>
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

  // In edit mode, show existing image immediately
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
        // Update frameWidth if animation config already set
        frameWidth = isAnimated ? Math.round(naturalW / frameCount) : naturalW;
        preview.src = dataURL;
        preview.style.display = '';
        infoEl.textContent = `${naturalW} × ${naturalH} px (new)`;
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

// ── Step 2: Identifier ─────────────────────────────────────────────────────────

function buildIdentifierStep() {
  const el = document.getElementById('step-identifier');
  const renameNote = isEditMode
    ? '<p style="color:#dfaa7a;font-size:12px;margin-top:4px">⚠ Renaming will not update existing map files that reference this type.</p>'
    : '';
  el.innerHTML = `
    <h2>Step 2 — ${isEditMode ? 'Type Identifier (rename optional)' : 'Object Identifier'}</h2>
    <p>Unique type key for this object. Only lowercase letters, digits, and underscores (e.g. <code>my_lamp</code>).</p>
    ${renameNote}
    <div class="ob-form" style="margin-top:8px">
      <label for="type-key-input">Type key</label>
      <input id="type-key-input" type="text" placeholder="e.g. my_lamp" autocomplete="off" spellcheck="false"
             value="${isEditMode ? typeKey : ''}">
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

// ── Step 3: Animation ──────────────────────────────────────────────────────────

function buildAnimationStep() {
  const el = document.getElementById('step-animation');
  el.innerHTML = `
    <h2>Step 3 — Animation</h2>
    <p>Is this a static image or an animated spritesheet with all frames in one horizontal row?</p>
    <div class="ob-radio-row">
      <label><input type="radio" name="anim-mode" value="static" ${!isAnimated ? 'checked' : ''}> Static (no animation)</label>
      <label><input type="radio" name="anim-mode" value="animated" ${isAnimated ? 'checked' : ''}> Animated spritesheet</label>
    </div>
    <div id="anim-config" style="display:${isAnimated ? '' : 'none'}">
      <div class="ob-form">
        <label for="frame-count-input">Number of frames</label>
        <input id="frame-count-input" type="number" min="2" max="256" value="${frameCount > 1 ? frameCount : 2}">
        <label for="frame-rate-input">Frame rate (fps)</label>
        <input id="frame-rate-input" type="number" min="1" max="60" value="${frameRate}">
      </div>
      <div id="anim-frame-info" style="font-size:12px;color:#888;margin-top:10px"></div>
      <canvas id="anim-preview-canvas"
        style="display:block;margin-top:12px;border:1px solid #444;background:#111;image-rendering:pixelated;max-width:100%">
      </canvas>
    </div>
  `;
}

function onEnterAnimationStep() {
  const radios     = document.querySelectorAll('input[name="anim-mode"]');
  const animConfig = document.getElementById('anim-config');
  const fcInput    = document.getElementById('frame-count-input');
  const frInput    = document.getElementById('frame-rate-input');

  if (isAnimated) updateAnimPreview();

  radios.forEach(r => r.addEventListener('change', () => {
    const anim = document.querySelector('input[name="anim-mode"]:checked').value === 'animated';
    animConfig.style.display = anim ? '' : 'none';
    if (anim) updateAnimPreview();
  }));
  fcInput.addEventListener('input', updateAnimPreview);
}

function updateAnimPreview() {
  const fcInput = document.getElementById('frame-count-input');
  const infoEl  = document.getElementById('anim-frame-info');
  const cvs     = document.getElementById('anim-preview-canvas');
  const fc = parseInt(fcInput.value, 10) || 0;
  if (!fc || fc < 2 || !getActiveImageSrc()) { if (infoEl) infoEl.textContent = ''; return; }
  const fw = Math.round(naturalW / fc);
  if (infoEl) infoEl.textContent = `Each frame: ${fw} × ${naturalH} px`;

  const img = new Image();
  img.onload = () => {
    const maxDisplay = 200;
    const scale = Math.min(maxDisplay / fw, maxDisplay / img.naturalHeight);
    const fh = img.naturalHeight;
    cvs.width  = Math.round(fw * scale);
    cvs.height = Math.round(fh * scale);
    const tc = cvs.getContext('2d');
    tc.imageSmoothingEnabled = false;
    tc.clearRect(0, 0, cvs.width, cvs.height);
    tc.drawImage(img, 0, 0, fw, fh, 0, 0, cvs.width, cvs.height);
  };
  img.src = getActiveImageSrc();
}

// ── Step 4: Collision ──────────────────────────────────────────────────────────

function buildCollisionStep() {
  const el = document.getElementById('step-collision');
  el.innerHTML = `
    <h2>Step 4 — Collision Box</h2>
    <p>Draw a collision rectangle on the image (the area that blocks player movement).
       Check <em>No collision</em> to skip — the object will be purely visual.</p>
    <label style="display:flex;align-items:center;gap:8px;margin-bottom:16px;cursor:pointer;font-size:13px">
      <input type="checkbox" id="no-collision-cb"> No collision box (visual-only object)
    </label>
    <div id="collision-editor">
      <div id="collision-wrap">
        <canvas id="collision-canvas"></canvas>
        <div id="collision-info">
          <div id="col-coords" style="font-family:monospace;font-size:12px;color:#aaa">No box drawn</div>
          <br>
          <button id="col-reset-btn"
            style="padding:5px 14px;background:#3a2a2a;border:1px solid #5a3a3a;color:#ddd;border-radius:3px;cursor:pointer;font-size:12px">
            Reset
          </button>
        </div>
      </div>
    </div>
  `;
}

function onEnterCollisionStep() {
  const noCbEl   = document.getElementById('no-collision-cb');
  const coordEl  = document.getElementById('col-coords');
  const resetBtn = document.getElementById('col-reset-btn');
  const colCvs   = document.getElementById('collision-canvas');

  noCbEl.checked = noCollision;
  setEditorEnabled(!noCollision);

  // Restore collision coord display if entering from a previous visit
  if (!noCollision && collision) {
    coordEl.textContent =
      `x0:${collision.x0}  y0:${collision.y0}  x1:${collision.x1}  y1:${collision.y1}` +
      `  (${collision.x1 - collision.x0} × ${collision.y1 - collision.y0} px)`;
  }

  noCbEl.addEventListener('change', () => {
    noCollision = noCbEl.checked;
    setEditorEnabled(!noCollision);
    if (noCollision) { collision = null; coordEl.textContent = 'No collision box'; }
  });

  resetBtn.addEventListener('click', () => {
    collision = null;
    coordEl.textContent = 'No box drawn';
    drawCollisionCanvas();
  });

  colCvs.addEventListener('mousedown', e => {
    if (noCollision) return;
    const r = colCvs.getBoundingClientRect();
    colDragStartImgX = Math.round((e.clientX - r.left) / colDisplayScale);
    colDragStartImgY = Math.round((e.clientY - r.top)  / colDisplayScale);
    colDragging = true;
    collision = null;
  });

  colCvs.addEventListener('mousemove', e => {
    if (!colDragging) return;
    const r  = colCvs.getBoundingClientRect();
    const ix = Math.round((e.clientX - r.left) / colDisplayScale);
    const iy = Math.round((e.clientY - r.top)  / colDisplayScale);
    const fw = frameWidth || naturalW;
    collision = {
      x0: Math.max(0, Math.min(colDragStartImgX, ix)),
      y0: Math.max(0, Math.min(colDragStartImgY, iy)),
      x1: Math.min(fw,       Math.max(colDragStartImgX, ix)),
      y1: Math.min(naturalH, Math.max(colDragStartImgY, iy)),
    };
    drawCollisionCanvas();
    coordEl.textContent =
      `x0:${collision.x0}  y0:${collision.y0}  x1:${collision.x1}  y1:${collision.y1}` +
      `  (${collision.x1 - collision.x0} × ${collision.y1 - collision.y0} px)`;
  });

  // Reset colImg if the active source changed
  const activeSrc = getActiveImageSrc();
  if (!colImg || colImgSrc !== activeSrc) {
    colImg    = new Image();
    colImgSrc = activeSrc;
    colImg.src = activeSrc;
  }

  drawCollisionCanvas();
}

function setEditorEnabled(enabled) {
  const editor = document.getElementById('collision-editor');
  if (!editor) return;
  editor.style.opacity       = enabled ? '1' : '0.35';
  editor.style.pointerEvents = enabled ? '' : 'none';
}

function drawCollisionCanvas() {
  const colCvs = document.getElementById('collision-canvas');
  if (!colCvs) return;

  const fw = frameWidth || naturalW;
  const fh = naturalH;
  const MAX_DISPLAY = 380;
  colDisplayScale = Math.max(1, Math.min(6, Math.min(MAX_DISPLAY / fw, MAX_DISPLAY / fh)));

  colCvs.width  = Math.round(fw * colDisplayScale);
  colCvs.height = Math.round(fh * colDisplayScale);

  const tc = colCvs.getContext('2d');
  tc.imageSmoothingEnabled = false;

  function draw() {
    tc.clearRect(0, 0, colCvs.width, colCvs.height);
    tc.drawImage(colImg, 0, 0, fw, fh, 0, 0, colCvs.width, colCvs.height);
    if (collision) {
      const { x0, y0, x1, y1 } = collision;
      const s = colDisplayScale;
      tc.fillStyle   = 'rgba(255, 80, 80, 0.2)';
      tc.fillRect(x0 * s, y0 * s, (x1 - x0) * s, (y1 - y0) * s);
      tc.strokeStyle = 'rgba(255, 80, 80, 0.9)';
      tc.lineWidth   = 2;
      tc.strokeRect(x0 * s, y0 * s, (x1 - x0) * s, (y1 - y0) * s);
    }
  }

  if (colImg && colImg.complete && colImg.naturalWidth > 0) {
    draw();
  } else if (colImg) {
    colImg.onload = draw;
  }
}

// ── Step 5: Review ─────────────────────────────────────────────────────────────

function renderReview() {
  const el = document.getElementById('step-review');
  const colInfo = (noCollision || !collision)
    ? 'None (visual-only)'
    : `x0:${collision.x0}  y0:${collision.y0}  x1:${collision.x1}  y1:${collision.y1}`;

  el.innerHTML = `
    <h2>Step 5 — Review & ${isEditMode ? 'Update' : 'Save'}</h2>
    <div id="review-wrap">
      <div id="review-summary">
        <strong>Action:</strong> ${isEditMode ? `Update '${originalType}'${typeKey !== originalType ? ` → rename to '${typeKey}'` : ''}` : `Create '${typeKey}'`}<br>
        <strong>Type:</strong> ${typeKey}<br>
        <strong>Animated:</strong> ${isAnimated ? `Yes — ${frameCount} frames @ ${frameRate} fps` : 'No'}<br>
        <strong>Frame size:</strong> ${frameWidth} × ${naturalH} px<br>
        <strong>Collision:</strong> ${colInfo}<br>
        ${isEditMode && !uploadedDataURL ? '<strong>Image:</strong> keeping existing sprite<br>' : ''}
      </div>
      <div id="review-preview-wrap">
        <canvas id="review-canvas"></canvas>
        <div id="review-label">First frame preview${!noCollision && collision ? ' (collision in red)' : ''}</div>
      </div>
    </div>
  `;

  const cvs = document.getElementById('review-canvas');
  const fw  = frameWidth || naturalW;
  const fh  = naturalH;
  const MAX_DISPLAY = 240;
  const scale = Math.max(1, Math.min(6, Math.min(MAX_DISPLAY / fw, MAX_DISPLAY / fh)));
  cvs.width  = Math.round(fw * scale);
  cvs.height = Math.round(fh * scale);

  const img = new Image();
  img.onload = () => {
    const tc = cvs.getContext('2d');
    tc.imageSmoothingEnabled = false;
    tc.drawImage(img, 0, 0, fw, fh, 0, 0, cvs.width, cvs.height);
    if (!noCollision && collision) {
      const { x0, y0, x1, y1 } = collision;
      tc.fillStyle   = 'rgba(255, 80, 80, 0.2)';
      tc.fillRect(x0 * scale, y0 * scale, (x1 - x0) * scale, (y1 - y0) * scale);
      tc.strokeStyle = 'rgba(255, 80, 80, 0.9)';
      tc.lineWidth   = 2;
      tc.strokeRect(x0 * scale, y0 * scale, (x1 - x0) * scale, (y1 - y0) * scale);
    }
  };
  img.src = getActiveImageSrc();
}

// ── Save / Update ──────────────────────────────────────────────────────────────

async function saveObject() {
  btnSave.disabled = true;
  setStatus(isEditMode ? 'Updating…' : 'Saving…');

  const body = {
    type:        typeKey,
    imageWidth:  frameWidth,
    imageHeight: naturalH,
    ...(isAnimated ? { frameCount, frameRate } : {}),
    ...(!noCollision && collision ? { collision } : {}),
    ...(uploadedDataURL ? { imageBase64: uploadedDataURL } : {}),
    ...(isEditMode ? { originalType } : {}),
  };

  const endpoint = isEditMode ? '/design/update-object' : '/design/save-object';

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
        : `Saved! '${typeKey}' is now available in the map designer.`
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

// ── Mouseup (global) ───────────────────────────────────────────────────────────

window.addEventListener('mouseup', () => { colDragging = false; });

// ── Init ───────────────────────────────────────────────────────────────────────

async function init() {
  // Fetch existing type keys for uniqueness validation
  try {
    const res = await fetch('/design/objects');
    if (res.ok) existingTypes = new Set(Object.keys(await res.json()));
  } catch (_) {}

  // In edit mode, load existing object data
  if (isEditMode) {
    document.querySelector('#toolbar strong').textContent = `Object Builder — Edit: ${editType}`;
    const ok = await loadEditData(editType);
    if (!ok) return;
  }

  buildIndicator();
  buildUploadStep();
  buildIdentifierStep();
  buildAnimationStep();
  buildCollisionStep();

  btnPrev.addEventListener('click', goPrev);
  btnNext.addEventListener('click', goNext);
  btnSave.addEventListener('click', saveObject);

  showStep(1);
}

init();
