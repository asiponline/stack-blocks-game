const canvas = document.querySelector('#gameCanvas');
const ctx = canvas.getContext('2d');

const scoreEl = document.querySelector('#score');
const bestEl = document.querySelector('#best');
const comboEl = document.querySelector('#combo');
const startBtn = document.querySelector('#startBtn');
const restartBtn = document.querySelector('#restartBtn');
const dropBtn = document.querySelector('#dropBtn');
const overlay = document.querySelector('#overlay');
const overlayTitle = document.querySelector('#overlayTitle');
const overlayText = document.querySelector('#overlayText');
const overlayAction = document.querySelector('#overlayAction');
const feedback = document.querySelector('#feedback');

const state = {
  width: 0,
  height: 0,
  dpr: 1,
  blocks: [],
  moving: null,
  particles: [],
  score: 0,
  combo: 0,
  best: Number(localStorage.getItem('stack-block-best') || 0),
  speed: 2.25,
  direction: 1,
  axis: 'x',
  cameraY: 0,
  targetCameraY: 0,
  running: false,
  ended: false,
  lastTime: 0,
};

const palette = ['#65e6c8', '#7aa7ff', '#b892ff', '#ffce6b', '#ff7aa8', '#78dd83'];
bestEl.textContent = state.best;

function resize() {
  const rect = canvas.parentElement.getBoundingClientRect();
  state.dpr = Math.min(window.devicePixelRatio || 1, 2);
  state.width = rect.width;
  state.height = rect.height;
  canvas.width = Math.floor(rect.width * state.dpr);
  canvas.height = Math.floor(rect.height * state.dpr);
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  if (!state.running && !state.ended) reset(false);
}

function baseY() {
  return state.height - 72;
}

function blockHeight() {
  return Math.max(24, Math.min(34, state.height * 0.047));
}

function initialBlockWidth() {
  return Math.min(250, state.width * 0.62);
}

function reset(autoStart = true) {
  const h = blockHeight();
  const w = initialBlockWidth();
  const base = {
    x: (state.width - w) / 2,
    y: baseY(),
    w,
    h,
    color: '#3b4965',
    fixed: true,
  };

  Object.assign(state, {
    blocks: [base],
    moving: null,
    particles: [],
    score: 0,
    combo: 0,
    speed: 2.25,
    direction: 1,
    axis: 'x',
    cameraY: 0,
    targetCameraY: 0,
    running: autoStart,
    ended: false,
    lastTime: performance.now(),
  });

  scoreEl.textContent = '0';
  comboEl.textContent = '0';
  if (autoStart) {
    hideOverlay();
    spawnMovingBlock();
  } else {
    showOverlay('叠方块', '在方块移动到合适位置时点击落下，重叠部分会保留，失手则游戏结束。', '开始挑战');
  }
}

function spawnMovingBlock() {
  const last = state.blocks[state.blocks.length - 1];
  const h = blockHeight();
  const margin = 26;
  const color = palette[state.blocks.length % palette.length];
  state.axis = state.blocks.length % 2 === 0 ? 'z' : 'x';
  state.direction = Math.random() > 0.5 ? 1 : -1;

  state.moving = {
    x: state.axis === 'x' ? margin : last.x,
    y: last.y - h,
    w: last.w,
    h,
    color,
    fixed: false,
    phase: Math.random() * Math.PI,
  };

  if (state.axis === 'z') {
    state.moving.x = state.direction > 0 ? -last.w * 0.8 : state.width - margin;
  } else {
    state.moving.x = state.direction > 0 ? margin : state.width - margin - last.w;
  }

  state.targetCameraY = Math.max(0, baseY() - state.moving.y - h * 2);
}

function dropBlock() {
  if (!state.running || !state.moving) return;

  const moving = state.moving;
  const last = state.blocks[state.blocks.length - 1];
  const overlapStart = Math.max(moving.x, last.x);
  const overlapEnd = Math.min(moving.x + moving.w, last.x + last.w);
  const overlap = overlapEnd - overlapStart;

  if (overlap <= 5) {
    createDebris(moving, true);
    endGame();
    return;
  }

  const perfectTolerance = Math.max(8, moving.w * 0.06);
  const diff = Math.abs(moving.x - last.x);
  const perfect = diff <= perfectTolerance;

  if (perfect) {
    moving.x = last.x;
    moving.w = Math.min(last.w + Math.min(8, state.combo + 2), initialBlockWidth());
    state.combo += 1;
    showFeedback(state.combo >= 2 ? `Perfect x${state.combo}` : 'Perfect!');
  } else {
    const cutLeft = moving.x < last.x;
    const cutW = moving.w - overlap;
    const cutX = cutLeft ? moving.x : overlapEnd;
    createDebris({ ...moving, x: cutX, w: cutW }, false);
    moving.x = overlapStart;
    moving.w = overlap;
    state.combo = 0;
    showFeedback(`+${state.score + 1}`);
  }

  moving.fixed = true;
  state.blocks.push(moving);
  state.moving = null;
  state.score += 1;
  state.speed = Math.min(8.5, state.speed + 0.18 + state.combo * 0.015);
  scoreEl.textContent = state.score;
  comboEl.textContent = state.combo;

  if (state.score > state.best) {
    state.best = state.score;
    localStorage.setItem('stack-block-best', String(state.best));
    bestEl.textContent = state.best;
  }

  setTimeout(() => {
    if (state.running) spawnMovingBlock();
  }, 90);
}

function endGame() {
  state.running = false;
  state.ended = true;
  state.combo = 0;
  comboEl.textContent = '0';
  showOverlay('游戏结束', `本局叠了 ${state.score} 层，最高纪录 ${state.best} 层。再来一次，冲击更高塔吧！`, '重新开始');
}

function showOverlay(title, text, action) {
  overlayTitle.textContent = title;
  overlayText.textContent = text;
  overlayAction.textContent = action;
  overlay.classList.remove('hidden');
}

function hideOverlay() {
  overlay.classList.add('hidden');
}

function showFeedback(text) {
  feedback.textContent = text;
  feedback.classList.add('show');
  window.clearTimeout(showFeedback.timer);
  showFeedback.timer = window.setTimeout(() => feedback.classList.remove('show'), 620);
}

function createDebris(block, isFail) {
  const count = isFail ? 18 : 9;
  for (let i = 0; i < count; i += 1) {
    state.particles.push({
      x: block.x + Math.random() * Math.max(block.w, 8),
      y: block.y + Math.random() * block.h,
      w: Math.max(5, Math.random() * 13),
      h: Math.max(5, Math.random() * 13),
      vx: (Math.random() - 0.5) * (isFail ? 8 : 4),
      vy: -Math.random() * 4 - 1,
      life: 1,
      color: block.color,
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.2,
    });
  }
}

function update(delta) {
  state.cameraY += (state.targetCameraY - state.cameraY) * 0.08;

  if (state.running && state.moving) {
    const m = state.moving;
    const travelSpeed = state.speed * delta * 0.072;
    m.phase += delta * 0.006;
    m.x += state.direction * travelSpeed;

    const sidePad = 18;
    if (m.x <= sidePad) {
      m.x = sidePad;
      state.direction = 1;
    }
    if (m.x + m.w >= state.width - sidePad) {
      m.x = state.width - sidePad - m.w;
      state.direction = -1;
    }
  }

  state.particles = state.particles.filter((p) => {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.22;
    p.rotation += p.spin;
    p.life -= 0.018;
    return p.life > 0 && p.y - state.cameraY < state.height + 100;
  });
}

function roundedRect(x, y, w, h, r) {
  const radius = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawBlock(block, index, isMoving = false) {
  const y = block.y + state.cameraY;
  const bob = isMoving ? Math.sin(block.phase) * 2 : 0;
  const radius = 10;

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 10;
  roundedRect(block.x, y + bob, block.w, block.h, radius);
  ctx.fillStyle = block.color;
  ctx.fill();

  const grad = ctx.createLinearGradient(block.x, y, block.x, y + block.h);
  grad.addColorStop(0, 'rgba(255, 255, 255, 0.26)');
  grad.addColorStop(0.48, 'rgba(255, 255, 255, 0.04)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0.18)');
  roundedRect(block.x, y + bob, block.w, block.h, radius);
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.shadowColor = 'transparent';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
  roundedRect(block.x + 8, y + bob + 6, Math.max(12, block.w - 16), 4, 4);
  ctx.fill();

  if (index > 0 && index % 5 === 0 && !isMoving) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.font = '700 12px Inter, sans-serif';
    ctx.fillText(`${index}`, block.x + 12, y + bob + block.h - 9);
  }
  ctx.restore();
}

function drawParticles() {
  state.particles.forEach((p) => {
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.translate(p.x, p.y + state.cameraY);
    ctx.rotate(p.rotation);
    ctx.fillStyle = p.color;
    roundedRect(-p.w / 2, -p.h / 2, p.w, p.h, 3);
    ctx.fill();
    ctx.restore();
  });
}

function drawGuide() {
  if (!state.running || !state.moving) return;
  const last = state.blocks[state.blocks.length - 1];
  const y = last.y + state.cameraY;
  ctx.save();
  ctx.setLineDash([8, 8]);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
  ctx.lineWidth = 2;
  roundedRect(last.x, y - blockHeight(), last.w, blockHeight(), 10);
  ctx.stroke();
  ctx.restore();
}

function drawScene() {
  ctx.clearRect(0, 0, state.width, state.height);

  const floorY = baseY() + blockHeight() + state.cameraY;
  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.fillRect(32, floorY + 8, state.width - 64, 2);
  ctx.restore();

  drawGuide();
  state.blocks.forEach((block, index) => drawBlock(block, index));
  if (state.moving) drawBlock(state.moving, state.blocks.length, true);
  drawParticles();

  if (!state.running && !state.ended) {
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.13)';
    ctx.font = '800 20px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('点击开始，搭建你的高塔', state.width / 2, state.height / 2 + 110);
    ctx.restore();
  }
}

function loop(now) {
  const delta = Math.min(32, now - state.lastTime || 16);
  state.lastTime = now;
  update(delta);
  drawScene();
  requestAnimationFrame(loop);
}

function handleAction(event) {
  if (event) event.preventDefault();
  if (!state.running) {
    reset(true);
    return;
  }
  dropBlock();
}

startBtn.addEventListener('click', () => reset(true));
restartBtn.addEventListener('click', () => reset(true));
overlayAction.addEventListener('click', () => reset(true));
dropBtn.addEventListener('click', handleAction);
canvas.addEventListener('pointerdown', handleAction);

window.addEventListener('keydown', (event) => {
  if (['Space', 'Enter', 'ArrowDown'].includes(event.code)) {
    handleAction(event);
  }
});

window.addEventListener('resize', resize);

resize();
requestAnimationFrame(loop);
