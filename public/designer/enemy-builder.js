// ─── Constants ────────────────────────────────────────────────────────────────
const COLLISION_ZOOM = 6;
const GRID_ZOOM_MAX  = 8;

// Maps 0-based wizard step index → selectedFrames state index (0–6)
// Steps 3–9 are the seven animation-picker steps
const STEP_TO_STATE = { 3:0, 4:1, 5:2, 6:3, 7:4, 8:5, 9:6 };

const ANIM_STEP_IDS = [
  'step-anim-idle',
  'step-anim-walk-side',
  'step-anim-walk-down',
  'step-anim-walk-up',
  'step-anim-attack-side',
  'step-anim-attack-down',
  'step-anim-attack-up',
];

const ANIM_STEP_TITLES = [
  'Idle Frames',
  'Walk Side — left-facing (right is auto-mirrored)',
  'Walk Down',
  'Walk Up',
  'Attack Side — left-facing (right is auto-mirrored)',
  'Attack Down',
  'Attack Up',
];

// ─── State ────────────────────────────────────────────────────────────────────
let sourceImage    = null;
let frameWidth     = 32;
let frameHeight    = 32;
let framesPerState = 2;

// selectedFrames[stateIndex] = array of source frame indices in click order
// States: 0=idle, 1=walk_side, 2=walk_down, 3=walk_up,
//         4=attack_side, 5=attack_down, 6=attack_up
const selectedFrames = [[], [], [], [], [], [], []];

let currentStep = 0;

let collisionBox        = { x: 4, y: 4, width: 24, height: 24 };
let isDraggingCollision = false;
let collisionDragStart  = { x: 0, y: 0 };

let stats = {
  type:               '',
  label:              '',
  level:              1,
  hp:                 20,
  damage:             2,
  xpReward:           150,
  goldAmount:         25,
  goldChance:         0.3,
  defaultRespawnTime: 10,
  speed:              100,
  aggroRange:         320,
  attackRange:        48,
  attackCooldownMs:   300,
};

let previewTimer = null;
let previewFrame = 0;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const stepEls     = [...document.querySelectorAll('.eb-step')];
const indicatorEl = document.getElementById('step-indicator');
const btnPrev     = document.getElementById('btn-prev');
const btnNext     = document.getElementById('btn-next');
const btnSave     = document.getElementById('btn-save');
const statusEl    = document.getElementById('eb-status');

const TOTAL_STEPS = stepEls.length; // 13

// ─── Step panel initialization ────────────────────────────────────────────────
function initUploadStep() {
  document.getElementById('step-upload').innerHTML = `
    <h2>Step 1: Upload Spritesheet</h2>
    <p>Select a PNG spritesheet image. All animation frames must be the same size.</p>
    <input type="file" id="eb-file-input" accept="image/png" style="margin-top:8px">
    <canvas id="upload-preview"></canvas>
  `;
  document.getElementById('eb-file-input').addEventListener('change', onFileSelect);
}

function initFrameSizeStep() {
  document.getElementById('step-frame-size').innerHTML = `
    <h2>Step 2: Frame Size</h2>
    <p>Set the width and height of one animation frame in pixels. The grid overlay updates live.</p>
    <div style="display:flex;gap:20px;align-items:center;margin-bottom:12px">
      <label style="font-size:12px;color:#bbb">
        Frame Width:&nbsp;
        <input id="eb-fw" type="number" min="8" max="512" value="${frameWidth}"
          style="width:70px;padding:4px 6px;background:#2a2a2a;border:1px solid #555;color:#eee;border-radius:3px">
        &nbsp;px
      </label>
      <label style="font-size:12px;color:#bbb">
        Frame Height:&nbsp;
        <input id="eb-fh" type="number" min="8" max="512" value="${frameHeight}"
          style="width:70px;padding:4px 6px;background:#2a2a2a;border:1px solid #555;color:#eee;border-radius:3px">
        &nbsp;px
      </label>
    </div>
    <div class="grid-wrap"><canvas id="grid-canvas"></canvas></div>
  `;
  document.getElementById('eb-fw').addEventListener('input', onFrameSizeChange);
  document.getElementById('eb-fh').addEventListener('input', onFrameSizeChange);
}

function initFramesNStep() {
  document.getElementById('step-frames-n').innerHTML = `
    <h2>Step 3: Frames Per State</h2>
    <p>
      How many frames does each animation state have?<br>
      This count is the same for every state: idle, walk, and attack.
    </p>
    <label style="font-size:12px;color:#bbb">
      Frames per state (N):&nbsp;
      <input id="eb-n" type="number" min="1" max="32" value="${framesPerState}"
        style="width:70px;padding:4px 6px;background:#2a2a2a;border:1px solid #555;color:#eee;border-radius:3px">
    </label>
  `;
  document.getElementById('eb-n').addEventListener('input', (e) => {
    const n = Math.max(1, parseInt(e.target.value, 10) || 1);
    if (n !== framesPerState) {
      framesPerState = n;
      // Clear all frame selections when N changes
      for (let i = 0; i < selectedFrames.length; i++) selectedFrames[i] = [];
    }
  });
}

function initAnimSteps() {
  ANIM_STEP_IDS.forEach((id, si) => {
    document.getElementById(id).innerHTML = `
      <h2>Step ${si + 4}: ${ANIM_STEP_TITLES[si]}</h2>
      <p>
        Click frames in the order they should play.
        Selected frames are highlighted green and numbered.
        Click a selected frame to deselect it.
        <span id="anim-progress-${si}" class="sel-count"></span>
      </p>
      <div class="grid-wrap"><canvas id="anim-canvas-${si}"></canvas></div>
    `;
  });
}

function initCollisionStep() {
  document.getElementById('step-collision').innerHTML = `
    <h2>Step 11: Hitbox</h2>
    <p>
      The first idle frame is shown enlarged below.
      Drag to define the enemy's hitbox (in frame-local pixels).
    </p>
    <div id="collision-wrap">
      <canvas id="collision-canvas"></canvas>
      <div id="collision-info">
        x: ${collisionBox.x} px<br>
        y: ${collisionBox.y} px<br>
        width: ${collisionBox.width} px<br>
        height: ${collisionBox.height} px
      </div>
    </div>
  `;
}

function initStatsStep() {
  document.getElementById('step-stats').innerHTML = `
    <h2>Step 12: Enemy Stats</h2>
    <p>Configure the enemy's game statistics. Type key must be lowercase letters, digits, and underscores only.</p>
    <div id="stats-form">
      <label>Type key (e.g. "orc")</label>
      <input id="eb-type" type="text" placeholder="orc" value="${stats.type}">
      <label>Display name</label>
      <input id="eb-label" type="text" placeholder="Orc Warrior" value="${stats.label}">
      <label>Level</label>
      <input id="eb-level" type="number" min="1" max="100" value="${stats.level}">
      <label>Hit Points (HP)</label>
      <input id="eb-hp" type="number" min="1" value="${stats.hp}">
      <label>Damage per hit</label>
      <input id="eb-damage" type="number" min="0" value="${stats.damage}">
      <label>XP reward on kill</label>
      <input id="eb-xp" type="number" min="0" value="${stats.xpReward}">
      <label>Gold drop amount</label>
      <input id="eb-gold-amount" type="number" min="0" value="${stats.goldAmount}">
      <label>Gold drop chance (0–1)</label>
      <input id="eb-gold-chance" type="number" min="0" max="1" step="0.05" value="${stats.goldChance}">
      <label>Default respawn time (s)</label>
      <input id="eb-respawn" type="number" min="1" value="${stats.defaultRespawnTime}">
      <label>Speed (px/s)</label>
      <input id="eb-speed" type="number" min="1" value="${stats.speed}">
      <label>Aggro range (px)</label>
      <input id="eb-aggro" type="number" min="0" value="${stats.aggroRange}">
      <label>Attack range (px)</label>
      <input id="eb-atk-range" type="number" min="0" value="${stats.attackRange}">
      <label>Attack cooldown (ms)</label>
      <input id="eb-atk-cd" type="number" min="0" value="${stats.attackCooldownMs}">
    </div>
  `;
}

function initReviewStep() {
  document.getElementById('step-review').innerHTML = `
    <h2>Step 13: Review & Save</h2>
    <p>Check the details below. Click "Save Enemy" to write the PNG and register this enemy.</p>
    <div id="review-wrap">
      <pre id="review-summary"></pre>
      <div id="review-preview-wrap">
        <canvas id="review-canvas"></canvas>
        <div id="review-label">Idle animation preview</div>
      </div>
    </div>
  `;
}

// ─── File upload ──────────────────────────────────────────────────────────────
function onFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      sourceImage = img;
      const canvas  = document.getElementById('upload-preview');
      const maxW    = 600;
      const maxH    = 260;
      const scale   = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
      canvas.width  = Math.round(img.naturalWidth  * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      setStatus('Spritesheet loaded: ' + img.naturalWidth + ' × ' + img.naturalHeight + ' px');
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

// ─── Frame-size step ──────────────────────────────────────────────────────────
function renderGridCanvas() {
  if (!sourceImage) return;
  const canvas = document.getElementById('grid-canvas');
  if (!canvas) return;

  const maxW = 700, maxH = 380;
  const zoom = Math.min(
    GRID_ZOOM_MAX,
    Math.floor(Math.min(maxW / sourceImage.naturalWidth, maxH / sourceImage.naturalHeight)) || 1,
  );

  canvas.width  = sourceImage.naturalWidth  * zoom;
  canvas.height = sourceImage.naturalHeight * zoom;

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);

  // Grid overlay
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth   = 0.5;
  const fw = frameWidth  * zoom;
  const fh = frameHeight * zoom;
  for (let x = fw; x < canvas.width;  x += fw) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = fh; y < canvas.height; y += fh) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }
}

function onFrameSizeChange() {
  frameWidth  = Math.max(1, parseInt(document.getElementById('eb-fw').value,  10) || 32);
  frameHeight = Math.max(1, parseInt(document.getElementById('eb-fh').value,  10) || 32);
  // Invalidate all frame selections — old pixel coords no longer valid
  for (let i = 0; i < selectedFrames.length; i++) selectedFrames[i] = [];
  renderGridCanvas();
}

// ─── Animation tile pickers ───────────────────────────────────────────────────
function getAnimZoom() {
  if (!sourceImage) return 2;
  const cols = Math.max(1, Math.floor(sourceImage.naturalWidth  / frameWidth));
  const rows = Math.max(1, Math.floor(sourceImage.naturalHeight / frameHeight));
  const maxW = 700, maxH = 380;
  const zoomW = Math.floor(maxW / (cols * frameWidth));
  const zoomH = Math.floor(maxH / (rows * frameHeight));
  return Math.max(1, Math.min(GRID_ZOOM_MAX, zoomW, zoomH));
}

function renderAnimCanvas(si) {
  if (!sourceImage) return;
  const canvas = document.getElementById('anim-canvas-' + si);
  if (!canvas) return;

  const cols = Math.max(1, Math.floor(sourceImage.naturalWidth  / frameWidth));
  const rows = Math.max(1, Math.floor(sourceImage.naturalHeight / frameHeight));
  const zoom = getAnimZoom();

  canvas.dataset.zoom = zoom;
  canvas.width  = cols * frameWidth  * zoom;
  canvas.height = rows * frameHeight * zoom;

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);

  // Highlight selected frames
  const arr = selectedFrames[si];
  arr.forEach((fi, order) => {
    const fc = fi % cols;
    const fr = Math.floor(fi / cols);
    const px = fc * frameWidth  * zoom;
    const py = fr * frameHeight * zoom;
    const pw = frameWidth  * zoom;
    const ph = frameHeight * zoom;
    ctx.fillStyle = 'rgba(100,220,100,0.45)';
    ctx.fillRect(px, py, pw, ph);
    // Order label
    ctx.fillStyle = '#fff';
    ctx.font = 'bold ' + Math.max(10, Math.floor(ph * 0.35)) + 'px sans-serif';
    ctx.shadowColor = '#000';
    ctx.shadowBlur  = 3;
    ctx.fillText(String(order + 1), px + 3, py + Math.max(13, Math.floor(ph * 0.45)));
    ctx.shadowBlur = 0;
  });

  // Grid overlay
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth   = 0.5;
  for (let c = 1; c < cols; c++) {
    ctx.beginPath();
    ctx.moveTo(c * frameWidth * zoom, 0);
    ctx.lineTo(c * frameWidth * zoom, canvas.height);
    ctx.stroke();
  }
  for (let r = 1; r < rows; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * frameHeight * zoom);
    ctx.lineTo(canvas.width, r * frameHeight * zoom);
    ctx.stroke();
  }

  // Selection count badge
  const prog = document.getElementById('anim-progress-' + si);
  if (prog) {
    const n = arr.length;
    prog.textContent = n + ' / ' + framesPerState + ' selected';
    prog.className   = 'sel-count' + (n === framesPerState ? '' : ' warn');
  }

  // Attach click listener once per canvas
  if (!canvas.dataset.hasListener) {
    canvas.dataset.hasListener = 'true';
    canvas.addEventListener('click', (ev) => {
      const rect   = canvas.getBoundingClientRect();
      const z      = parseFloat(canvas.dataset.zoom) || 1;
      const cols_  = Math.max(1, Math.floor(sourceImage.naturalWidth / frameWidth));
      const col    = Math.floor((ev.clientX - rect.left)  / (frameWidth  * z));
      const row    = Math.floor((ev.clientY - rect.top)   / (frameHeight * z));
      const fi     = row * cols_ + col;
      const sIdx   = parseInt(canvas.id.replace('anim-canvas-', ''), 10);
      const arr_   = selectedFrames[sIdx];
      const pos    = arr_.indexOf(fi);
      if (pos !== -1) {
        arr_.splice(pos, 1);
      } else if (arr_.length < framesPerState) {
        arr_.push(fi);
      }
      renderAnimCanvas(sIdx);
    });
  }
}

// ─── Collision canvas ─────────────────────────────────────────────────────────
function initCollisionCanvasListeners() {
  const canvas = document.getElementById('collision-canvas');
  if (!canvas || canvas.dataset.hasListener) return;
  canvas.dataset.hasListener = 'true';

  canvas.addEventListener('mousedown', (e) => {
    const { lx, ly }  = toLocal(e, canvas);
    isDraggingCollision = true;
    collisionDragStart  = { x: lx, y: ly };
    collisionBox        = { x: lx, y: ly, width: 0, height: 0 };
    renderCollisionCanvas();
  });
  canvas.addEventListener('mousemove', (e) => {
    if (!isDraggingCollision) return;
    const { lx, ly } = toLocal(e, canvas);
    collisionBox = {
      x:      Math.min(collisionDragStart.x, lx),
      y:      Math.min(collisionDragStart.y, ly),
      width:  Math.abs(lx - collisionDragStart.x),
      height: Math.abs(ly - collisionDragStart.y),
    };
    renderCollisionCanvas();
  });
  canvas.addEventListener('mouseup', () => { isDraggingCollision = false; });
  canvas.addEventListener('mouseleave', () => { isDraggingCollision = false; });
}

function toLocal(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    lx: Math.max(0, Math.min(frameWidth  - 1, Math.floor((e.clientX - rect.left)  / COLLISION_ZOOM))),
    ly: Math.max(0, Math.min(frameHeight - 1, Math.floor((e.clientY - rect.top)   / COLLISION_ZOOM))),
  };
}

function renderCollisionCanvas() {
  if (!sourceImage) return;
  const canvas = document.getElementById('collision-canvas');
  if (!canvas) return;

  // Use the first idle frame as the reference
  const idleFrames   = selectedFrames[0];
  const firstIdleIdx = idleFrames.length > 0 ? idleFrames[0] : 0;
  const cols         = Math.max(1, Math.floor(sourceImage.naturalWidth / frameWidth));
  const fc           = firstIdleIdx % cols;
  const fr           = Math.floor(firstIdleIdx / cols);

  canvas.width  = frameWidth  * COLLISION_ZOOM;
  canvas.height = frameHeight * COLLISION_ZOOM;

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    sourceImage,
    fc * frameWidth, fr * frameHeight, frameWidth, frameHeight,
    0, 0, canvas.width, canvas.height,
  );

  // Collision rectangle overlay
  const bx = collisionBox.x      * COLLISION_ZOOM;
  const by = collisionBox.y      * COLLISION_ZOOM;
  const bw = collisionBox.width  * COLLISION_ZOOM;
  const bh = collisionBox.height * COLLISION_ZOOM;
  ctx.fillStyle   = 'rgba(255,80,80,0.3)';
  ctx.strokeStyle = 'rgba(255,80,80,0.9)';
  ctx.lineWidth   = 1;
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeRect(bx, by, bw, bh);

  // Update info panel
  const infoEl = document.getElementById('collision-info');
  if (infoEl) {
    infoEl.innerHTML =
      'x: ' + collisionBox.x + ' px<br>' +
      'y: ' + collisionBox.y + ' px<br>' +
      'width: '  + collisionBox.width  + ' px<br>' +
      'height: ' + collisionBox.height + ' px';
  }
}

// ─── Stats reader ─────────────────────────────────────────────────────────────
function readStats() {
  const g = (id) => document.getElementById(id);
  stats.type               = (g('eb-type')?.value        ?? '').trim();
  stats.label              = (g('eb-label')?.value       ?? '').trim();
  stats.level              = parseInt(g('eb-level')?.value,       10) || 1;
  stats.hp                 = parseInt(g('eb-hp')?.value,          10) || 1;
  stats.damage             = parseInt(g('eb-damage')?.value,      10) || 0;
  stats.xpReward           = parseInt(g('eb-xp')?.value,          10) || 0;
  stats.goldAmount         = parseInt(g('eb-gold-amount')?.value,  10) || 0;
  stats.goldChance         = parseFloat(g('eb-gold-chance')?.value)    || 0;
  stats.defaultRespawnTime = parseInt(g('eb-respawn')?.value,      10) || 10;
  stats.speed              = parseInt(g('eb-speed')?.value,        10) || 100;
  stats.aggroRange         = parseInt(g('eb-aggro')?.value,        10) || 320;
  stats.attackRange        = parseInt(g('eb-atk-range')?.value,    10) || 48;
  stats.attackCooldownMs   = parseInt(g('eb-atk-cd')?.value,       10) || 300;
}

// ─── Review step ──────────────────────────────────────────────────────────────
function renderReviewStep() {
  readStats();

  const summaryEl = document.getElementById('review-summary');
  if (summaryEl) {
    summaryEl.textContent = JSON.stringify({
      type:               stats.type    || '(not set)',
      label:              stats.label   || '(not set)',
      level:              stats.level,
      hp:                 stats.hp,
      damage:             stats.damage,
      xpReward:           stats.xpReward,
      goldAmount:         stats.goldAmount,
      goldChance:         stats.goldChance,
      defaultRespawnTime: stats.defaultRespawnTime,
      speed:              stats.speed,
      aggroRange:         stats.aggroRange,
      attackRange:        stats.attackRange,
      attackCooldownMs:   stats.attackCooldownMs,
      frameWidth,
      frameHeight,
      framesPerState,
      collision:          { ...collisionBox },
    }, null, 2);
  }

  startIdlePreview();
}

function startIdlePreview() {
  if (previewTimer) { clearInterval(previewTimer); previewTimer = null; }

  const canvas     = document.getElementById('review-canvas');
  const idleFrames = selectedFrames[0];
  if (!canvas || !sourceImage || !idleFrames.length) return;

  canvas.width  = frameWidth  * 3;
  canvas.height = frameHeight * 3;

  const ctx  = canvas.getContext('2d');
  const cols = Math.max(1, Math.floor(sourceImage.naturalWidth / frameWidth));
  previewFrame = 0;

  function drawFrame() {
    const fi  = idleFrames[previewFrame % idleFrames.length];
    const fc  = fi % cols;
    const fr  = Math.floor(fi / cols);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(
      sourceImage,
      fc * frameWidth, fr * frameHeight, frameWidth, frameHeight,
      0, 0, canvas.width, canvas.height,
    );
    previewFrame++;
  }

  drawFrame();
  previewTimer = setInterval(drawFrame, Math.round(1000 / 6));
}

// ─── Spritesheet assembly ─────────────────────────────────────────────────────
function assembleSpritesheetCanvas() {
  const cols = Math.max(1, Math.floor(sourceImage.naturalWidth / frameWidth));
  const outW = framesPerState * frameWidth;
  const outH = 7 * frameHeight; // 7 animation rows

  const out = document.createElement('canvas');
  out.width  = outW;
  out.height = outH;
  const ctx  = out.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // Output row order must match GameScene.ts STATE_NAMES:
  //   row 0=idle, 1=walk_up, 2=walk_side, 3=walk_down,
  //       4=attack_up, 5=attack_side, 6=attack_down
  // selectedFrames indices (wizard step order):
  //   [0]=idle, [1]=walk_side, [2]=walk_down, [3]=walk_up,
  //   [4]=attack_side, [5]=attack_down, [6]=attack_up
  // Mapping: output row R → selectedFrames[ROW_ORDER[R]]
  const ROW_ORDER = [0, 3, 1, 2, 6, 4, 5];

  ROW_ORDER.forEach((stateIdx, outputRow) => {
    const frames = selectedFrames[stateIdx];
    frames.forEach((srcFrameIdx, colIndex) => {
      const srcCol = srcFrameIdx % cols;
      const srcRow = Math.floor(srcFrameIdx / cols);
      ctx.drawImage(
        sourceImage,
        srcCol * frameWidth,   srcRow * frameHeight,    frameWidth, frameHeight,
        colIndex * frameWidth, outputRow * frameHeight, frameWidth, frameHeight,
      );
    });
  });

  return out;
}

// ─── Save ─────────────────────────────────────────────────────────────────────
async function saveEnemy() {
  readStats();

  if (!/^[a-z0-9_]+$/.test(stats.type)) {
    setStatus('Invalid type key — use only lowercase letters, digits, and underscores.', true);
    return;
  }
  if (!stats.label) {
    setStatus('Display name is required.', true);
    return;
  }

  btnSave.disabled = true;
  setStatus('Assembling spritesheet…');

  const sheetCanvas = assembleSpritesheetCanvas();
  const base64      = sheetCanvas.toDataURL('image/png');

  const payload = {
    ...stats,
    frameWidth,
    frameHeight,
    framesPerState,
    hitbox:       { ...collisionBox },
    spriteBase64: base64,
  };

  setStatus('Saving…');

  try {
    const res  = await fetch('/design/save-enemy', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    const json = await res.json();
    if (json.ok) {
      setStatus('"' + stats.type + '" saved! It is now available in the map designer.');
    } else {
      setStatus('Error: ' + json.error, true);
      btnSave.disabled = false;
    }
  } catch (err) {
    setStatus('Network error: ' + err.message, true);
    btnSave.disabled = false;
  }
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function showStep(n) {
  // Stop idle preview timer when leaving the review step
  if (previewTimer) { clearInterval(previewTimer); previewTimer = null; }

  stepEls.forEach((el, i) => el.classList.toggle('active', i === n));
  currentStep = n;

  btnPrev.disabled        = (n === 0);
  const isLast            = (n === TOTAL_STEPS - 1);
  btnNext.style.display   = isLast ? 'none' : '';
  btnSave.style.display   = isLast ? '' : 'none';
  btnSave.disabled        = false;

  renderIndicator();

  // Render step-specific content
  if (n === 1) renderGridCanvas();

  const si = STEP_TO_STATE[n];
  if (si !== undefined) renderAnimCanvas(si);

  if (n === 10) {
    initCollisionCanvasListeners();
    renderCollisionCanvas();
  }

  if (n === 12) renderReviewStep();
}

function renderIndicator() {
  let html = '';
  for (let i = 0; i < TOTAL_STEPS; i++) {
    const cls = i < currentStep ? 'done' : i === currentStep ? 'active' : '';
    html += '<div class="step-dot ' + cls + '" title="Step ' + (i + 1) + '"></div>';
  }
  indicatorEl.innerHTML = html;
}

function canProceed() {
  switch (currentStep) {
    case 0:  return !!sourceImage;
    case 1:  return frameWidth > 0 && frameHeight > 0;
    case 2:  return framesPerState > 0;
    case 3: case 4: case 5: case 6: case 7: case 8: case 9: {
      const si = STEP_TO_STATE[currentStep];
      return selectedFrames[si].length === framesPerState;
    }
    case 10: return collisionBox.width > 0 && collisionBox.height > 0;
    case 11: {
      readStats();
      return /^[a-z0-9_]+$/.test(stats.type) && stats.label.length > 0;
    }
    default: return true;
  }
}

function blockMessage() {
  switch (currentStep) {
    case 0:  return 'Please upload a spritesheet image first.';
    case 1:  return 'Frame size must be at least 1 × 1.';
    case 2:  return 'Frames per state must be at least 1.';
    case 3: case 4: case 5: case 6: case 7: case 8: case 9: {
      const si  = STEP_TO_STATE[currentStep];
      const sel = selectedFrames[si].length;
      return 'Select exactly ' + framesPerState + ' frame(s). (' + sel + ' selected so far.)';
    }
    case 10: return 'Drag on the frame image to define a collision box.';
    case 11: return 'Type key must be lowercase alphanumeric/underscore and a display name is required.';
    default: return '';
  }
}

function setStatus(msg, isErr) {
  statusEl.textContent = msg || '';
  statusEl.className   = isErr ? 'err' : (msg ? 'ok' : '');
}

btnNext.addEventListener('click', () => {
  if (!canProceed()) {
    setStatus(blockMessage(), true);
    return;
  }
  setStatus('');
  if (currentStep < TOTAL_STEPS - 1) showStep(currentStep + 1);
});

btnPrev.addEventListener('click', () => {
  setStatus('');
  if (currentStep > 0) showStep(currentStep - 1);
});

btnSave.addEventListener('click', saveEnemy);

// ─── Bootstrap ────────────────────────────────────────────────────────────────
(function init() {
  initUploadStep();
  initFrameSizeStep();
  initFramesNStep();
  initAnimSteps();
  initCollisionStep();
  initStatsStep();
  initReviewStep();
  showStep(0);
})();
