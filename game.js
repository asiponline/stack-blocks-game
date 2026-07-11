const canvas = document.querySelector('#gameCanvas');
const ctx = canvas.getContext('2d');

const scoreEl = document.querySelector('#score');
const bestEl = document.querySelector('#best');
const comboEl = document.querySelector('#combo');
const coinsEl = document.querySelector('#coins');
const startBtn = document.querySelector('#startBtn');
const restartBtn = document.querySelector('#restartBtn');
const pauseBtn = document.querySelector('#pauseBtn');
const muteBtn = document.querySelector('#muteBtn');
const dropBtn = document.querySelector('#dropBtn');
const overlay = document.querySelector('#overlay');
const overlayTitle = document.querySelector('#overlayTitle');
const overlayText = document.querySelector('#overlayText');
const overlayAction = document.querySelector('#overlayAction');
const feedback = document.querySelector('#feedback');
const effectChip = document.querySelector('#effectChip');
const powerButtons = Array.from(document.querySelectorAll('.powerup'));

const POWER_DEFS = {
  freeze: { icon: '❄️', name: '冰冻', desc: '接下来 3 块速度减半' },
  widen: { icon: '➕', name: '加宽', desc: '下一块宽度大幅恢复' },
  magnet: { icon: '🧲', name: '磁吸', desc: '下一块自动完美对齐' },
};

const BIOMES = [
  { name: '草原', top: [16, 26, 46], bottom: [10, 15, 26], glow: [101, 230, 200] },
  { name: '黄昏', top: [58, 32, 60], bottom: [26, 16, 34], glow: [255, 170, 120] },
  { name: '深海', top: [10, 34, 58], bottom: [6, 16, 32], glow: [90, 190, 255] },
  { name: '极夜', top: [30, 18, 54], bottom: [12, 8, 26], glow: [184, 146, 255] },
  { name: '星域', top: [8, 10, 24], bottom: [2, 3, 10], glow: [255, 224, 130] },
];

const state = {
  width: 0,
  height: 0,
  dpr: 1,
  blocks: [],
  moving: null,
  particles: [],
  floats: [],
  score: 0,
  combo: 0,
  maxCombo: 0,
  coins: Number(localStorage.getItem('stack-block-coins') || 0),
  best: Number(localStorage.getItem('stack-block-best') || 0),
  speed: 2.25,
  direction: 1,
  axis: 'x',
  cameraY: 0,
  targetCameraY: 0,
  running: false,
  ended: false,
  paused: false,
  muted: localStorage.getItem('stack-block-muted') === '1',
  lastTime: 0,
  powers: { freeze: 0, widen: 0, magnet: 0 },
  effects: { freeze: 0, magnet: false, widen: false },
  wind: 0,
  windPhase: 0,
  shake: 0,
  glow: 0,
  biomeIndex: 0,
  biomeMix: 0,
  reviveUsed: false,
  perfectsSinceReward: 0,
  maxWidth: 0,
  stars: [],
  bgTime: 0,
};

const palette = ['#65e6c8', '#7aa7ff', '#b892ff', '#ffce6b', '#ff7aa8', '#78dd83'];
bestEl.textContent = state.best;
coinsEl.textContent = state.coins;

/* ---------- Audio (WebAudio, no asset files) ---------- */
let audioCtx = null;
function ensureAudio() {
  if (state.muted) return null;
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      audioCtx = null;
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function tone(freq, dur = 0.12, type = 'sine', gain = 0.14) {
  const ac = ensureAudio();
  if (!ac) return;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(gain, ac.currentTime + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
  osc.connect(g).connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + dur + 0.02);
}

function sfx(kind) {
  if (state.muted) return;
  if (kind === 'place') tone(320, 0.1, 'triangle', 0.12);
  else if (kind === 'perfect') {
    const base = 520 + Math.min(state.combo, 8) * 40;
    tone(base, 0.12, 'sine', 0.16);
    setTimeout(() => tone(base * 1.5, 0.12, 'sine', 0.12), 60);
  } else if (kind === 'coin') {
    tone(880, 0.08, 'square', 0.1);
    setTimeout(() => tone(1320, 0.1, 'square', 0.08), 55);
  } else if (kind === 'power') {
    tone(660, 0.1, 'sawtooth', 0.1);
    setTimeout(() => tone(990, 0.12, 'sawtooth', 0.08), 70);
  } else if (kind === 'fail') {
    tone(180, 0.28, 'sawtooth', 0.16);
    setTimeout(() => tone(110, 0.35, 'sawtooth', 0.14), 90);
  } else if (kind === 'milestone') {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.16, 'sine', 0.13), i * 90));
  }
}

/* ---------- Layout ---------- */
function resize() {
  const rect = canvas.parentElement.getBoundingClientRect();
  if (!rect || rect.width < 2 || rect.height < 2) return; // 布局尚未就绪，等下一帧
  state.dpr = Math.min(window.devicePixelRatio || 1, 2);
  state.width = rect.width;
  state.height = rect.height;
  canvas.width = Math.floor(rect.width * state.dpr);
  canvas.height = Math.floor(rect.height * state.dpr);
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  initStars();
  if (!state.running && !state.ended) reset(false);
}

function initStars() {
  const count = Math.max(40, Math.round((state.width * state.height) / 4200));
  state.stars = [];
  for (let i = 0; i < count; i += 1) {
    const tint = Math.random();
    const color = tint < 0.72 ? '255,255,255' : (tint < 0.86 ? '186,212,255' : '255,198,236');
    state.stars.push({
      x: Math.random() * state.width,
      y: Math.random() * state.height,
      r: 0.5 + Math.random() * 1.7,
      base: 0.35 + Math.random() * 0.65,
      phase: Math.random() * Math.PI * 2,
      vy: 0.25 + Math.random() * 1.1,
      color,
    });
  }
}

function baseY() {
  return state.height - 72;
}

function blockHeight() {
  return Math.max(24, Math.min(34, state.height * 0.047));
}

function initialBlockWidth() {
  return Math.min(180, state.width * 0.46);
}

// 连续完美成长机制
const GROW_EVERY = 5;               // 连续完美多少次触发一次加长
const GROW_STEP = 48;               // 每次成长增加的宽度 & 上限
function maxWidthCap() {
  return state.width * 0.92;        // 相对画布的硬上限
}

/* ---------- Reset / Spawn ---------- */
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
    floats: [],
    score: 0,
    combo: 0,
    maxCombo: 0,
    speed: 2.25,
    direction: 1,
    axis: 'x',
    cameraY: 0,
    targetCameraY: 0,
    running: autoStart,
    ended: false,
    paused: false,
    lastTime: performance.now(),
    powers: { freeze: 0, widen: 0, magnet: 0 },
    effects: { freeze: 0, magnet: false, widen: false },
    wind: 0,
    windPhase: 0,
    shake: 0,
    glow: 0,
    biomeIndex: 0,
    biomeMix: 0,
    reviveUsed: false,
    perfectsSinceReward: 0,
    maxWidth: w,
  });

  scoreEl.textContent = '0';
  comboEl.textContent = '0';
  coinsEl.textContent = state.coins;
  updatePowerUI();
  updateEffectChip();
  pauseBtn.textContent = '暂停';

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
    x: last.x,
    y: last.y - h,
    w: last.w,
    h,
    color,
    fixed: false,
    phase: Math.random() * Math.PI,
    coin: null,
  };

  if (state.axis === 'z') {
    state.moving.x = state.direction > 0 ? -last.w * 0.8 : state.width - margin;
  } else {
    state.moving.x = state.direction > 0 ? margin : state.width - margin - last.w;
  }

  // 金币：约 45% 概率在方块上附带一枚金币（相对方块左边的偏移比例）
  if (Math.random() < 0.45 && !state.effects.magnet) {
    state.moving.coin = { rel: 0.18 + Math.random() * 0.64, taken: false };
  }

  // 风力：20 层后逐步引入
  state.wind = state.score >= 20 ? Math.min(0.9, (state.score - 20) * 0.02) : 0;

  state.targetCameraY = Math.max(0, baseY() - state.moving.y - h * 2);
}

/* ---------- Core drop logic ---------- */
function dropBlock() {
  if (!state.running || state.paused || !state.moving) return;

  const moving = state.moving;
  const last = state.blocks[state.blocks.length - 1];

  // 磁吸：直接完美对齐
  if (state.effects.magnet) {
    moving.x = last.x;
    moving.w = last.w;
    state.effects.magnet = false;
  }

  const overlapStart = Math.max(moving.x, last.x);
  const overlapEnd = Math.min(moving.x + moving.w, last.x + last.w);
  const overlap = overlapEnd - overlapStart;

  if (overlap <= 5) {
    createDebris(moving, true);
    state.shake = 16;
    sfx('fail');
    // 磁吸/复活救场：若持有磁吸道具且未使用，可自动挽救一次
    if (state.powers.magnet > 0 && !state.reviveUsed) {
      state.powers.magnet -= 1;
      state.reviveUsed = true;
      moving.x = last.x;
      moving.w = Math.max(overlap, last.w * 0.6);
      showFeedback('🧲 磁吸救场！');
      updatePowerUI();
      finalizePlacement(moving, false, last, true);
      return;
    }
    endGame();
    return;
  }

  const perfectTolerance = Math.max(8, moving.w * 0.06);
  const diff = Math.abs(moving.x - last.x);
  const perfect = diff <= perfectTolerance;

  // 金币结算：金币绝对位置是否落在保留区内
  if (moving.coin && !moving.coin.taken) {
    const coinX = moving.x + moving.coin.rel * moving.w;
    if (coinX >= overlapStart && coinX <= overlapEnd) {
      collectCoin(coinX, moving.y);
    } else {
      moving.coin = null; // 错过
    }
  }

  if (perfect) {
    moving.x = last.x;
    let bonus = Math.min(10, state.combo + 2);
    if (state.effects.widen) {
      bonus += 60;
      state.effects.widen = false;
    }
    moving.w = Math.min(last.w + bonus, state.maxWidth);
    state.combo += 1;
    state.maxCombo = Math.max(state.maxCombo, state.combo);
    state.glow = Math.min(1, 0.35 + state.combo * 0.12);
    state.perfectsSinceReward += 1;
    sfx('perfect');

    // 连续 GROW_EVERY 次完美：抬升宽度上限，方块居中加长
    if (state.combo % GROW_EVERY === 0) {
      state.maxWidth = Math.min(maxWidthCap(), state.maxWidth + GROW_STEP);
      const grown = Math.min(state.maxWidth, moving.w + GROW_STEP);
      const sidePad = 18;
      moving.x = moving.x - (grown - moving.w) / 2;
      moving.w = grown;
      if (moving.x < sidePad) moving.x = sidePad;
      if (moving.x + moving.w > state.width - sidePad) {
        moving.x = state.width - sidePad - moving.w;
      }
      state.glow = 1;
      sfx('milestone');
      showFeedback(`🌟 连续 ${state.combo} 完美 · 方块加长！`);
    } else {
      showFeedback(state.combo >= 2 ? `Perfect ×${state.combo}` : 'Perfect!');
    }

    // 每 4 次完美奖励一个随机道具
    if (state.perfectsSinceReward >= 4) {
      state.perfectsSinceReward = 0;
      grantRandomPower();
    }
  } else {
    const cutLeft = moving.x < last.x;
    const cutW = moving.w - overlap;
    const cutX = cutLeft ? moving.x : overlapEnd;
    createDebris({ ...moving, x: cutX, w: cutW }, false);
    if (state.effects.widen) {
      // 加宽：即使切掉也补偿一部分宽度
      moving.x = overlapStart;
      moving.w = Math.min(overlap + 60, last.w);
      state.effects.widen = false;
    } else {
      moving.x = overlapStart;
      moving.w = overlap;
    }
    state.combo = 0;
    state.glow = 0;
    sfx('place');
    showFeedback(`+${state.score + 1}`);
  }

  finalizePlacement(moving, perfect, last, false);
}

function finalizePlacement(moving, perfect) {
  moving.fixed = true;
  moving.coin = null;
  state.blocks.push(moving);
  state.moving = null;
  state.score += 1;

  // 消耗冰冻计数
  let effSpeed = 0.18 + state.combo * 0.015;
  if (state.effects.freeze > 0) {
    state.effects.freeze -= 1;
    effSpeed *= 0.35;
    updateEffectChip();
  }
  state.speed = Math.min(9, state.speed + effSpeed);

  scoreEl.textContent = state.score;
  comboEl.textContent = state.combo;

  if (state.score > state.best) {
    state.best = state.score;
    localStorage.setItem('stack-block-best', String(state.best));
    bestEl.textContent = state.best;
  }

  checkMilestone(state.score);

  setTimeout(() => {
    if (state.running && !state.paused) spawnMovingBlock();
  }, 90);
}

/* ---------- Coins & Powers ---------- */
function collectCoin(x, y) {
  state.coins += 1;
  localStorage.setItem('stack-block-coins', String(state.coins));
  coinsEl.textContent = state.coins;
  sfx('coin');
  state.floats.push({ x, y: y + state.cameraY, text: '+1 🪙', life: 1, vy: -0.7 });
  // 每 8 枚金币兑换一个随机道具
  if (state.coins > 0 && state.coins % 8 === 0) {
    grantRandomPower();
    showFeedback('🪙 集满 8 金币，赠送道具！');
  }
}

function grantRandomPower() {
  const keys = Object.keys(POWER_DEFS);
  const key = keys[Math.floor(Math.random() * keys.length)];
  state.powers[key] += 1;
  sfx('power');
  const def = POWER_DEFS[key];
  state.floats.push({
    x: state.width / 2,
    y: state.height * 0.35,
    text: `获得 ${def.icon}${def.name}`,
    life: 1.2,
    vy: -0.5,
  });
  updatePowerUI();
}

function activatePower(key) {
  if (!state.running || state.paused) return;
  if (!state.powers[key] || state.powers[key] <= 0) return;
  state.powers[key] -= 1;

  if (key === 'freeze') {
    state.effects.freeze = 3;
  } else if (key === 'widen') {
    state.effects.widen = true;
  } else if (key === 'magnet') {
    state.effects.magnet = true;
  }
  sfx('power');
  showFeedback(`${POWER_DEFS[key].icon} ${POWER_DEFS[key].name} 已激活`);
  updatePowerUI();
  updateEffectChip();
}

function updatePowerUI() {
  powerButtons.forEach((btn) => {
    const key = btn.dataset.power;
    const count = state.powers[key] || 0;
    const countEl = btn.querySelector('.p-count');
    if (countEl) countEl.textContent = count;
    btn.disabled = count <= 0 || !state.running;
    btn.classList.toggle('empty', count <= 0);
  });
}

function updateEffectChip() {
  const active = [];
  if (state.effects.freeze > 0) active.push(`❄️×${state.effects.freeze}`);
  if (state.effects.widen) active.push('➕ 就绪');
  if (state.effects.magnet) active.push('🧲 就绪');
  if (state.wind > 0.02) active.push(`🌬️ 风力 ${(state.wind * 100 | 0)}%`);
  if (active.length) {
    effectChip.textContent = active.join('  ·  ');
    effectChip.classList.add('show');
  } else {
    effectChip.classList.remove('show');
  }
}

/* ---------- Milestones ---------- */
function checkMilestone(score) {
  const milestones = { 10: '小有所成', 20: '风起云涌', 30: '登峰造极', 50: '摩天巨塔', 75: '云端之上', 100: '通天之柱' };
  if (milestones[score]) {
    sfx('milestone');
    state.floats.push({
      x: state.width / 2,
      y: state.height * 0.3,
      text: `🏆 ${score} 层 · ${milestones[score]}`,
      life: 1.8,
      vy: -0.4,
      big: true,
    });
  }
}

/* ---------- End ---------- */
function endGame() {
  state.running = false;
  state.ended = true;
  state.combo = 0;
  comboEl.textContent = '0';
  updatePowerUI();
  updateEffectChip();
  showOverlay(
    '游戏结束',
    `本局叠了 ${state.score} 层，最高连击 ${state.maxCombo}，累计金币 ${state.coins} 🪙。最高纪录 ${state.best} 层，再来一次冲击更高！`,
    '重新开始'
  );
}

/* ---------- Pause / Mute ---------- */
function togglePause() {
  if (!state.running) return;
  state.paused = !state.paused;
  pauseBtn.textContent = state.paused ? '继续' : '暂停';
  if (state.paused) {
    showOverlay('已暂停', '深呼吸，看准位置。点击继续回到游戏。', '继续');
  } else {
    hideOverlay();
    state.lastTime = performance.now();
    if (!state.moving) spawnMovingBlock();
  }
}

function toggleMute() {
  state.muted = !state.muted;
  localStorage.setItem('stack-block-muted', state.muted ? '1' : '0');
  muteBtn.textContent = state.muted ? '🔇 静音' : '🔊 音效';
  if (!state.muted) ensureAudio();
}

/* ---------- Overlay / Feedback ---------- */
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
  showFeedback.timer = window.setTimeout(() => feedback.classList.remove('show'), 700);
}

/* ---------- Particles ---------- */
function createDebris(block, isFail) {
  const count = isFail ? 22 : 9;
  for (let i = 0; i < count; i += 1) {
    state.particles.push({
      x: block.x + Math.random() * Math.max(block.w, 8),
      y: block.y + Math.random() * block.h,
      w: Math.max(5, Math.random() * 13),
      h: Math.max(5, Math.random() * 13),
      vx: (Math.random() - 0.5) * (isFail ? 9 : 4),
      vy: -Math.random() * 4 - 1,
      life: 1,
      color: block.color,
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.2,
    });
  }
}

/* ---------- Update ---------- */
function update(delta) {
  state.cameraY += (state.targetCameraY - state.cameraY) * 0.08;
  state.glow *= 0.94;
  state.shake *= 0.86;
  state.bgTime += delta * 0.0006;

  // 星空缓慢向下漂浮（营造向上攀升的感觉）
  for (const s of state.stars) {
    s.y += s.vy * delta * 0.01;
    if (s.y > state.height + 4) {
      s.y = -4;
      s.x = Math.random() * state.width;
    }
  }

  // 生物群系随高度平滑推进
  const targetBiome = Math.min(BIOMES.length - 1, Math.floor(state.score / 15));
  state.biomeMix += ((targetBiome + Math.min(1, (state.score % 15) / 15)) - state.biomeMix) * 0.05;

  if (state.running && !state.paused && state.moving) {
    const m = state.moving;
    let travelSpeed = state.speed * delta * 0.072;
    if (state.effects.freeze > 0) travelSpeed *= 0.5;
    m.phase += delta * 0.006;

    // 风力：给运动加一点非线性抖动
    let windOffset = 0;
    if (state.wind > 0) {
      state.windPhase += delta * 0.004;
      windOffset = Math.sin(state.windPhase) * state.wind * delta * 0.05;
    }

    m.x += state.direction * travelSpeed + windOffset;

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

  state.floats = state.floats.filter((f) => {
    f.y += f.vy;
    f.life -= 0.012;
    return f.life > 0;
  });
}

/* ---------- Draw helpers ---------- */
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

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// 对 RGB 颜色做色相旋转，用于让背景随时间柔和渐变
function hueRotate(rgb, deg) {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const m = [
    0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928,
    0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.140, 0.072 - cos * 0.072 - sin * 0.283,
    0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072,
  ];
  const r = rgb[0];
  const g = rgb[1];
  const b = rgb[2];
  return [
    Math.max(0, Math.min(255, r * m[0] + g * m[1] + b * m[2])),
    Math.max(0, Math.min(255, r * m[3] + g * m[4] + b * m[5])),
    Math.max(0, Math.min(255, r * m[6] + g * m[7] + b * m[8])),
  ];
}

function currentBiome() {
  const i = Math.floor(state.biomeMix);
  const t = state.biomeMix - i;
  const a = BIOMES[Math.min(i, BIOMES.length - 1)];
  const b = BIOMES[Math.min(i + 1, BIOMES.length - 1)];
  const mix = (arrA, arrB) => arrA.map((v, k) => Math.round(lerp(v, arrB[k], t)));
  return { top: mix(a.top, b.top), bottom: mix(a.bottom, b.bottom), glow: mix(a.glow, b.glow) };
}

function drawBackground() {
  if (state.width < 2 || state.height < 2) return; // 画布尚未就绪
  const bio = currentBiome();
  const t = state.bgTime;
  // 色相随呼吸式缓慢偏移，让整体色彩逐渐变化
  const hueShift = Math.sin(t) * 26;
  const top = hueRotate(bio.top, hueShift).map(Math.round);
  const bottom = hueRotate(bio.bottom, hueShift).map(Math.round);

  const g = ctx.createLinearGradient(0, 0, 0, state.height);
  g.addColorStop(0, `rgb(${top.join(',')})`);
  g.addColorStop(1, `rgb(${bottom.join(',')})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, state.width, state.height);

  // 流行风格：缓慢流动、循环变色的星云光斑
  const nebula = [[255, 120, 200], [120, 200, 255], [180, 140, 255], [255, 210, 120]];
  for (let i = 0; i < 2; i += 1) {
    const phase = t * (0.4 + i * 0.25) + i * Math.PI;
    const cx = state.width * (0.5 + 0.34 * Math.sin(phase));
    const cy = state.height * (0.42 + 0.3 * Math.cos(phase * 0.8));
    const col = nebula[(Math.floor(t * 0.3) + i) % nebula.length];
    const radius = state.width * (0.55 + 0.12 * Math.sin(phase * 1.3));
    if (radius > 0.5) {
      const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      rg.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},0.18)`);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, state.width, state.height);
    }
  }

  // 星空：闪烁 + 缓慢漂浮
  for (const s of state.stars) {
    const tw = 0.5 + 0.5 * Math.sin(t * 2.2 + s.phase);
    ctx.globalAlpha = s.base * (0.32 + 0.68 * tw);
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${s.color},1)`;
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 连击光晕
  if (state.glow > 0.02 && state.width > 0) {
    const rg = ctx.createRadialGradient(
      state.width / 2, state.height * 0.45, 20,
      state.width / 2, state.height * 0.45, state.width * 0.8
    );
    rg.addColorStop(0, `rgba(${bio.glow.join(',')}, ${0.22 * state.glow})`);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, state.width, state.height);
  }
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

  // 金币
  if (isMoving && block.coin && !block.coin.taken) {
    const cx = block.x + block.coin.rel * block.w;
    const cy = y + bob - 16;
    ctx.beginPath();
    ctx.arc(cx, cy, 9, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd447';
    ctx.shadowColor = 'rgba(255, 212, 71, 0.8)';
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.font = '700 10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('¥', cx, cy + 3.5);
    ctx.textAlign = 'left';
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

function drawFloats() {
  state.floats.forEach((f) => {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, f.life));
    ctx.fillStyle = f.big ? '#ffe082' : '#ffffff';
    ctx.font = f.big ? '800 22px Inter, sans-serif' : '800 15px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 8;
    ctx.fillText(f.text, f.x, f.y);
    ctx.restore();
  });
  ctx.textAlign = 'left';
}

function drawGuide() {
  if (!state.running || state.paused || !state.moving) return;
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
  ctx.save();
  if (state.shake > 0.4) {
    const s = state.shake;
    ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
  }

  drawBackground();

  const floorY = baseY() + blockHeight() + state.cameraY;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.fillRect(32, floorY + 8, state.width - 64, 2);

  drawGuide();
  state.blocks.forEach((block, index) => drawBlock(block, index));
  if (state.moving) drawBlock(state.moving, state.blocks.length, true);
  drawParticles();
  drawFloats();

  if (!state.running && !state.ended) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.font = '800 20px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('点击开始，搭建你的高塔', state.width / 2, state.height / 2 + 110);
    ctx.textAlign = 'left';
  }
  ctx.restore();
}

/* ---------- Loop ---------- */
function loop(now) {
  requestAnimationFrame(loop); // 先预约下一帧，任何异常都不会让循环永久死亡
  const delta = Math.min(32, now - state.lastTime || 16);
  state.lastTime = now;
  try {
    if (state.width < 2 || state.height < 2) { resize(); return; }
    if (!state.paused) update(delta);
    drawScene();
  } catch (err) {
    if (typeof console !== 'undefined') console.error('frame error:', err);
  }
}

/* ---------- Input ---------- */
function handleAction(event) {
  if (event) event.preventDefault();
  ensureAudio();
  if (!state.running) {
    reset(true);
    return;
  }
  if (state.paused) return;
  dropBlock();
}

startBtn.addEventListener('click', () => { ensureAudio(); reset(true); });
restartBtn.addEventListener('click', () => { ensureAudio(); reset(true); });
overlayAction.addEventListener('click', () => {
  ensureAudio();
  if (state.paused) { togglePause(); return; }
  reset(true);
});
pauseBtn.addEventListener('click', togglePause);
muteBtn.addEventListener('click', toggleMute);
dropBtn.addEventListener('click', handleAction);
canvas.addEventListener('pointerdown', handleAction);

powerButtons.forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    activatePower(btn.dataset.power);
  });
});

window.addEventListener('keydown', (event) => {
  if (['Space', 'Enter', 'ArrowDown'].includes(event.code)) {
    handleAction(event);
  } else if (event.code === 'KeyP') {
    togglePause();
  } else if (event.code === 'KeyM') {
    toggleMute();
  } else if (event.code === 'Digit1') {
    activatePower('freeze');
  } else if (event.code === 'Digit2') {
    activatePower('widen');
  } else if (event.code === 'Digit3') {
    activatePower('magnet');
  }
});

window.addEventListener('resize', resize);
window.addEventListener('load', resize);
if (window.ResizeObserver) {
  try {
    new ResizeObserver(() => resize()).observe(canvas.parentElement);
  } catch (e) { /* 忽略 */ }
}

muteBtn.textContent = state.muted ? '🔇 静音' : '🔊 音效';
requestAnimationFrame(loop); // 先启动循环，即使首帧布局未就绪也能自动恢复
try { resize(); } catch (e) { if (typeof console !== 'undefined') console.error(e); }

// 玩法与技巧弹窗
(function setupRulesModal() {
  const rulesBtn = document.getElementById('rulesBtn');
  const rulesModal = document.getElementById('rulesModal');
  const rulesClose = document.getElementById('rulesClose');
  const rulesOk = document.getElementById('rulesOk');
  if (!rulesBtn || !rulesModal) return;

  const openRules = () => { rulesModal.hidden = false; };
  const closeRules = () => { rulesModal.hidden = true; };

  rulesBtn.addEventListener('click', openRules);
  rulesClose && rulesClose.addEventListener('click', closeRules);
  rulesOk && rulesOk.addEventListener('click', closeRules);
  rulesModal.addEventListener('click', (e) => {
    if (e.target === rulesModal) closeRules();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !rulesModal.hidden) closeRules();
  });
})();
