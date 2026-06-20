'use strict';

// ─── DOM ──────────────────────────────────────────────────────────────────────
const canvas           = document.getElementById('game-canvas');
const ctx              = canvas.getContext('2d');
const overlayWaiting   = document.getElementById('screen-waiting');
const overlayCountdown = document.getElementById('screen-countdown');
const overlayReconnect = document.getElementById('screen-reconnect');
const overlayGameover  = document.getElementById('screen-gameover');
const displayRoomCode  = document.getElementById('display-room-code');
const displayCtrlUrl   = document.getElementById('display-controller-url');
const reconnectCode    = document.getElementById('reconnect-room-code');
const qrImg            = document.getElementById('qr-img');
const countdownNum     = document.getElementById('countdown-number');
const goScore          = document.getElementById('go-score');
const goCombo          = document.getElementById('go-combo');
const playAgainBtn     = document.getElementById('play-again-btn');

// ─── Canvas resize ────────────────────────────────────────────────────────────
function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ─── Overlay helpers ──────────────────────────────────────────────────────────
function showOverlay(el) {
  [overlayWaiting, overlayCountdown, overlayReconnect, overlayGameover].forEach(o => {
    o.classList.remove('active');
  });
  if (el) el.classList.add('active');
}

// ─── Socket ───────────────────────────────────────────────────────────────────
const socket = io({ transports: ['websocket', 'polling'] });
let roomCode = null;

socket.on('connect', () => {
  console.log('[display] connected', socket.id);
  socket.emit('create_room');
});

socket.on('room_created', ({ code, qrDataUrl, controllerUrl }) => {
  roomCode = code;
  displayRoomCode.textContent = code;
  reconnectCode.textContent   = code;
  displayCtrlUrl.textContent  = controllerUrl || '';

  if (qrDataUrl) {
    qrImg.src = qrDataUrl;
    qrImg.style.display = 'block';
  } else {
    qrImg.style.display = 'none';
  }

  showOverlay(overlayWaiting);
  console.log('[display] room created:', code);
});

socket.on('player_joined', () => {
  console.log('[display] player joined');
  startCountdown(() => startGame());
});

socket.on('controller_disconnected', () => {
  console.log('[display] controller disconnected');
  gameRunning = false;
  showOverlay(overlayReconnect);
});

socket.on('motion_data', (payload) => {
  latestMotion = payload;
});

socket.on('disconnect', () => {
  console.log('[display] socket disconnected');
});

// ─── Game state ───────────────────────────────────────────────────────────────
let gameRunning     = false;
let score           = 0;
let combo           = 0;
let comboMultiplier = 1;
let maxCombo        = 0;
let lives           = 3;
let latestMotion    = null;
let frameId         = null;
let gameStartTime   = 0;
let lastSpawnTime   = 0;
let spawnInterval   = 2000; // ms between spawn bursts
let shakeFrames     = 0;
let shakeAmp        = 0;

const fruits = [];
const bombs  = [];
const particles = [];

// Blade trail: array of { x, y, timestamp }
const bladeTrail = [];
const TRAIL_DURATION = 150; // ms

// Blade position (canvas coords)
let bladeX = -200;
let bladeY = -200;

// Combo display flash
let comboFlashAlpha = 0;
let comboFlashText  = '';

// ─── Fruit types ─────────────────────────────────────────────────────────────
const FRUIT_TYPES = [
  { name: 'watermelon', color: '#2ecc71', innerColor: '#e74c3c', size: 63, detail: 'watermelon' },
  { name: 'orange',     color: '#f39c12', innerColor: '#e67e22', size: 51, detail: 'orange' },
  { name: 'lemon',      color: '#f1c40f', innerColor: '#f39c12', size: 45, detail: 'lemon' },
  { name: 'strawberry', color: '#e74c3c', innerColor: '#c0392b', size: 42, detail: 'strawberry' },
  { name: 'grape',      color: '#9b59b6', innerColor: '#8e44ad', size: 39, detail: 'grape' },
  { name: 'kiwi',       color: '#27ae60', innerColor: '#a0d468', size: 48, detail: 'kiwi' },
  { name: 'peach',      color: '#f8a5c2', innerColor: '#e88fa0', size: 51, detail: 'peach' },
  { name: 'blueberry',  color: '#3498db', innerColor: '#2980b9', size: 33, detail: 'blueberry' },
];

// ─── Draw fruit ───────────────────────────────────────────────────────────────
function drawFruit(f) {
  const { x, y, type, radius, sliced, sliceOffset } = f;
  if (sliced) return;

  ctx.save();
  ctx.translate(x, y);

  // Glow
  const glowGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, radius * 1.8);
  glowGrad.addColorStop(0, type.color + '44');
  glowGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = glowGrad;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 1.8, 0, Math.PI * 2);
  ctx.fill();

  switch (type.detail) {
    case 'watermelon':
      drawWatermelon(radius, type);
      break;
    case 'orange':
      drawCitrus(radius, type);
      break;
    case 'lemon':
      drawLemon(radius, type);
      break;
    case 'strawberry':
      drawStrawberry(radius, type);
      break;
    case 'grape':
      drawGrape(radius, type);
      break;
    case 'kiwi':
      drawKiwi(radius, type);
      break;
    case 'peach':
      drawPeach(radius, type);
      break;
    default:
      drawGenericFruit(radius, type);
  }

  ctx.restore();
}

function drawWatermelon(r, type) {
  // Green shell
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(-r*0.3, -r*0.3, 0, 0, 0, r);
  g.addColorStop(0, '#58d68d');
  g.addColorStop(0.6, '#2ecc71');
  g.addColorStop(1, '#1a8a4a');
  ctx.fillStyle = g;
  ctx.fill();

  // Dark green stripes
  ctx.strokeStyle = '#1d6a38';
  ctx.lineWidth = r * 0.12;
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI;
    ctx.save();
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.bezierCurveTo(r * 0.4, -r * 0.5, r * 0.4, r * 0.5, 0, r);
    ctx.stroke();
    ctx.restore();
  }

  // Red inner (bottom half visible)
  ctx.beginPath();
  ctx.arc(0, r * 0.1, r * 0.78, 0, Math.PI * 2);
  const ig = ctx.createRadialGradient(-r*0.2, -r*0.1, 0, 0, r*0.1, r*0.78);
  ig.addColorStop(0, '#ff6b6b');
  ig.addColorStop(0.7, '#e74c3c');
  ig.addColorStop(1, '#c0392b');
  ctx.fillStyle = ig;
  ctx.fill();

  // Seeds
  ctx.fillStyle = '#2c1654';
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3;
    const sx = Math.cos(a) * r * 0.4;
    const sy = Math.sin(a) * r * 0.35 + r * 0.1;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.07, r * 0.04, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Highlight
  ctx.beginPath();
  ctx.arc(-r * 0.25, -r * 0.3, r * 0.18, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fill();
}

function drawCitrus(r, type) {
  // Orange base
  const g = ctx.createRadialGradient(-r*0.3, -r*0.3, 0, 0, 0, r);
  g.addColorStop(0, '#f9ca24');
  g.addColorStop(0.5, '#f0932b');
  g.addColorStop(1, '#e55039');
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();

  // Texture bumps
  ctx.strokeStyle = 'rgba(0,0,0,0.1)';
  ctx.lineWidth = 0.5;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const bx = Math.cos(a) * r * 0.55;
    const by = Math.sin(a) * r * 0.55;
    ctx.beginPath();
    ctx.arc(bx, by, r * 0.1, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Highlight
  ctx.beginPath();
  ctx.arc(-r * 0.28, -r * 0.32, r * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fill();
}

function drawLemon(r, type) {
  ctx.save();
  ctx.scale(1.3, 0.85);
  const g = ctx.createRadialGradient(-r*0.2, -r*0.2, 0, 0, 0, r);
  g.addColorStop(0, '#fff176');
  g.addColorStop(0.5, '#f1c40f');
  g.addColorStop(1, '#d4a017');
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();

  // Tip bumps
  ctx.fillStyle = '#d4a017';
  ctx.beginPath();
  ctx.arc(r * 0.85, 0, r * 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-r * 0.85, 0, r * 0.15, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  // Highlight
  ctx.beginPath();
  ctx.arc(-r * 0.2, -r * 0.3, r * 0.17, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fill();
}

function drawStrawberry(r, type) {
  // Berry shape (heart-like)
  const g = ctx.createRadialGradient(-r*0.2, -r*0.1, 0, 0, r*0.1, r);
  g.addColorStop(0, '#ff6b81');
  g.addColorStop(0.5, '#e74c3c');
  g.addColorStop(1, '#b71c1c');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, r * 0.9);
  ctx.bezierCurveTo(r * 0.9, r * 0.4, r * 0.9, -r * 0.2, 0, -r * 0.6);
  ctx.bezierCurveTo(-r * 0.9, -r * 0.2, -r * 0.9, r * 0.4, 0, r * 0.9);
  ctx.fill();

  // Seeds
  ctx.fillStyle = '#fff9c4';
  const seedPositions = [
    [0,-r*0.2],[r*0.3,r*0.1],[-r*0.3,r*0.1],[r*0.15,r*0.45],[-r*0.15,r*0.45],[0,r*0.65]
  ];
  seedPositions.forEach(([sx,sy]) => {
    ctx.beginPath();
    ctx.ellipse(sx, sy, r*0.05, r*0.07, 0, 0, Math.PI*2);
    ctx.fill();
  });

  // Green top
  ctx.fillStyle = '#27ae60';
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = (i/5)*Math.PI*2 - Math.PI/2;
    const lx = Math.cos(a)*r*0.5, ly = Math.sin(a)*r*0.5 - r*0.6;
    ctx.moveTo(0, -r*0.6);
    ctx.lineTo(lx, ly);
  }
  ctx.strokeStyle = '#27ae60';
  ctx.lineWidth = r * 0.12;
  ctx.lineCap = 'round';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(-r*0.2, -r*0.25, r*0.15, 0, Math.PI*2);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fill();
}

function drawGrape(r, type) {
  const grapeColor = '#9b59b6';
  const positions = [
    [0,-r*0.35],[r*0.32,-r*0.15],[-r*0.32,-r*0.15],
    [r*0.18,r*0.2],[-r*0.18,r*0.2],[0,r*0.5]
  ];
  positions.forEach(([gx,gy]) => {
    const gr = r * 0.4;
    const gg = ctx.createRadialGradient(gx-gr*0.3, gy-gr*0.3, 0, gx, gy, gr);
    gg.addColorStop(0, '#c39bd3');
    gg.addColorStop(0.5, grapeColor);
    gg.addColorStop(1, '#6c3483');
    ctx.beginPath();
    ctx.arc(gx, gy, gr, 0, Math.PI*2);
    ctx.fillStyle = gg;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(gx - gr*0.25, gy - gr*0.25, gr*0.2, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.fill();
  });

  // Stem
  ctx.strokeStyle = '#5d4037';
  ctx.lineWidth = r * 0.08;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.72);
  ctx.quadraticCurveTo(r*0.3, -r*0.9, r*0.2, -r);
  ctx.stroke();
}

function drawKiwi(r, type) {
  // Brown shell
  const g = ctx.createRadialGradient(0, 0, r*0.6, 0, 0, r);
  g.addColorStop(0, '#a0d468');
  g.addColorStop(0.7, '#5d4037');
  g.addColorStop(1, '#4a2c1a');
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI*2);
  ctx.fillStyle = g;
  ctx.fill();

  // Green inner
  const ig = ctx.createRadialGradient(0, 0, 0, 0, 0, r*0.75);
  ig.addColorStop(0, '#c5e1a5');
  ig.addColorStop(0.4, '#8bc34a');
  ig.addColorStop(0.8, '#558b2f');
  ig.addColorStop(1, '#33691e');
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.75, 0, Math.PI*2);
  ctx.fillStyle = ig;
  ctx.fill();

  // Center
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.2, 0, Math.PI*2);
  ctx.fillStyle = '#fff9c4';
  ctx.fill();

  // Seeds (radial lines)
  ctx.strokeStyle = '#33691e';
  ctx.lineWidth = r * 0.05;
  for (let i = 0; i < 8; i++) {
    const a = (i/8)*Math.PI*2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a)*r*0.22, Math.sin(a)*r*0.22);
    ctx.lineTo(Math.cos(a)*r*0.68, Math.sin(a)*r*0.68);
    ctx.stroke();
  }

  // Highlight
  ctx.beginPath();
  ctx.arc(-r*0.2, -r*0.25, r*0.15, 0, Math.PI*2);
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.fill();
}

function drawPeach(r, type) {
  const g = ctx.createRadialGradient(-r*0.2, -r*0.2, 0, 0, 0, r);
  g.addColorStop(0, '#ffeaa7');
  g.addColorStop(0.4, '#fdcb6e');
  g.addColorStop(0.8, '#f39c12');
  g.addColorStop(1, '#d68910');
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI*2);
  ctx.fillStyle = g;
  ctx.fill();

  // Blush
  ctx.beginPath();
  ctx.arc(r*0.25, r*0.1, r*0.35, 0, Math.PI*2);
  ctx.fillStyle = 'rgba(231,76,60,0.2)';
  ctx.fill();

  // Crease
  ctx.strokeStyle = 'rgba(0,0,0,0.1)';
  ctx.lineWidth = r*0.07;
  ctx.beginPath();
  ctx.moveTo(0, -r*0.85);
  ctx.quadraticCurveTo(r*0.15, 0, 0, r*0.85);
  ctx.stroke();

  // Leaf
  ctx.fillStyle = '#27ae60';
  ctx.save();
  ctx.translate(0, -r*0.85);
  ctx.rotate(-0.3);
  ctx.beginPath();
  ctx.ellipse(r*0.2, -r*0.15, r*0.28, r*0.1, Math.PI*0.3, 0, Math.PI*2);
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(-r*0.22, -r*0.28, r*0.18, 0, Math.PI*2);
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fill();
}

function drawGenericFruit(r, type) {
  const g = ctx.createRadialGradient(-r*0.3, -r*0.3, 0, 0, 0, r);
  g.addColorStop(0, lightenColor(type.color, 40));
  g.addColorStop(0.6, type.color);
  g.addColorStop(1, darkenColor(type.color, 30));
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI*2);
  ctx.fillStyle = g;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(-r*0.25, -r*0.28, r*0.18, 0, Math.PI*2);
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fill();
}

// ─── Draw bomb ────────────────────────────────────────────────────────────────
function drawBomb(b) {
  if (b.sliced) return;
  const { x, y, radius } = b;
  ctx.save();
  ctx.translate(x, y);

  // Glow
  const glowG = ctx.createRadialGradient(0, 0, 0, 0, 0, radius*2);
  glowG.addColorStop(0, 'rgba(255,59,92,0.3)');
  glowG.addColorStop(1, 'transparent');
  ctx.fillStyle = glowG;
  ctx.beginPath();
  ctx.arc(0, 0, radius*2, 0, Math.PI*2);
  ctx.fill();

  // Body
  const bg = ctx.createRadialGradient(-radius*0.25, -radius*0.25, 0, 0, 0, radius);
  bg.addColorStop(0, '#555');
  bg.addColorStop(0.5, '#222');
  bg.addColorStop(1, '#111');
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI*2);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Shine
  ctx.beginPath();
  ctx.arc(-radius*0.28, -radius*0.32, radius*0.2, 0, Math.PI*2);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fill();

  // Fuse cord
  ctx.strokeStyle = '#a0522d';
  ctx.lineWidth = radius * 0.08;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(radius * 0.4, -radius * 0.4);
  ctx.quadraticCurveTo(radius * 0.8, -radius * 0.9, radius * 0.2, -radius * 1.2);
  ctx.stroke();

  // Fuse spark (animated)
  const sparkSize = radius * 0.18 + Math.sin(Date.now() * 0.02) * radius * 0.08;
  const sparkGrad = ctx.createRadialGradient(
    radius * 0.2, -radius * 1.2, 0,
    radius * 0.2, -radius * 1.2, sparkSize * 2
  );
  sparkGrad.addColorStop(0, '#fff');
  sparkGrad.addColorStop(0.3, '#ffdd59');
  sparkGrad.addColorStop(0.6, '#ff6348');
  sparkGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = sparkGrad;
  ctx.beginPath();
  ctx.arc(radius * 0.2, -radius * 1.2, sparkSize * 2, 0, Math.PI * 2);
  ctx.fill();

  // BOMB text
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = `bold ${radius * 0.5}px Orbitron, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('💣', 0, 0);

  ctx.restore();
}

// ─── Particles ────────────────────────────────────────────────────────────────
function spawnParticles(x, y, color, count = 10) {
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
    const speed = 3 + Math.random() * 8;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      alpha: 1,
      size: 4 + Math.random() * 6,
      life: 0,
      maxLife: 25 + Math.floor(Math.random() * 20)
    });
  }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.25; // gravity
    p.vx *= 0.97;
    p.life++;
    p.alpha = 1 - p.life / p.maxLife;
    if (p.life >= p.maxLife) particles.splice(i, 1);
  }
}

function drawParticles() {
  particles.forEach(p => {
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (1 - p.life / p.maxLife * 0.5), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

// ─── Blade trail ──────────────────────────────────────────────────────────────
function updateBladeTrail(x, y) {
  const now = performance.now();
  bladeTrail.push({ x, y, t: now });
  // Remove old points
  while (bladeTrail.length > 1 && now - bladeTrail[0].t > TRAIL_DURATION) {
    bladeTrail.shift();
  }
}

function drawBladeTrail(isSlicing) {
  if (bladeTrail.length < 2) return;
  const now = performance.now();

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (let i = 1; i < bladeTrail.length; i++) {
    const prev = bladeTrail[i - 1];
    const curr = bladeTrail[i];
    const age = (now - curr.t) / TRAIL_DURATION;
    const alpha = Math.max(0, 1 - age);
    const width  = Math.max(1, (1 - age) * (isSlicing ? 12 : 6));

    const grad = ctx.createLinearGradient(prev.x, prev.y, curr.x, curr.y);
    if (isSlicing) {
      grad.addColorStop(0, `rgba(0, 212, 255, ${alpha * 0.3})`);
      grad.addColorStop(1, `rgba(255, 255, 255, ${alpha})`);
    } else {
      grad.addColorStop(0, `rgba(123, 47, 255, ${alpha * 0.2})`);
      grad.addColorStop(1, `rgba(0, 212, 255, ${alpha * 0.5})`);
    }

    ctx.strokeStyle = grad;
    ctx.lineWidth = width;
    ctx.shadowColor = isSlicing ? '#00d4ff' : '#7b2fff';
    ctx.shadowBlur = isSlicing ? 20 : 8;

    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(curr.x, curr.y);
    ctx.stroke();
  }

  // Bright tip
  if (bladeTrail.length > 0) {
    const tip = bladeTrail[bladeTrail.length - 1];
    const tipGrad = ctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, isSlicing ? 20 : 10);
    tipGrad.addColorStop(0, isSlicing ? 'rgba(255,255,255,0.9)' : 'rgba(0,212,255,0.6)');
    tipGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = tipGrad;
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, isSlicing ? 20 : 10, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

// ─── Slice detection (line-segment vs circle) ─────────────────────────────────
function pointToSegmentDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function checkSlices(isSlicing) {
  if (!isSlicing || bladeTrail.length < 2) return;

  const now = performance.now();

  for (let ti = bladeTrail.length - 1; ti >= 1; ti--) {
    const p1 = bladeTrail[ti - 1];
    const p2 = bladeTrail[ti];
    if (now - p1.t > 80) break; // only check recent trail

    // Check fruits
    for (let i = fruits.length - 1; i >= 0; i--) {
      const f = fruits[i];
      if (f.sliced) continue;
      const dist = pointToSegmentDist(f.x, f.y, p1.x, p1.y, p2.x, p2.y);
      if (dist < f.radius * 1.1) {
        sliceFruit(i);
        break;
      }
    }

    // Check bombs
    for (let i = bombs.length - 1; i >= 0; i--) {
      const b = bombs[i];
      if (b.sliced) continue;
      const dist = pointToSegmentDist(b.x, b.y, p1.x, p1.y, p2.x, p2.y);
      if (dist < b.radius * 1.1) {
        sliceBomb(i);
        break;
      }
    }
  }
}

function sliceFruit(i) {
  const f = fruits[i];
  f.sliced = true;

  combo++;
  if (combo > maxCombo) maxCombo = combo;
  comboMultiplier = 1 + Math.floor(combo / 5);
  const points = 10 * comboMultiplier;
  score += points;

  // Floating score text
  spawnScoreText(f.x, f.y, '+' + points, f.type.color);

  // Combo flash
  if (combo > 1) {
    comboFlashText  = 'x' + combo + ' COMBO!';
    comboFlashAlpha = 1;
  }

  // Particles
  spawnParticles(f.x, f.y, f.type.color, 12);
  spawnParticles(f.x, f.y, f.type.innerColor, 6);

  // Sound
  playSliceSound();

  // Relay to controller
  socket.emit('slice_confirmed', { type: 'fruit', combo });

  fruits.splice(i, 1);
}

function sliceBomb(i) {
  const b = bombs[i];
  b.sliced = true;

  lives = Math.max(0, lives - 1);
  combo = 0;
  comboMultiplier = 1;

  // Screen shake
  shakeFrames = 25;
  shakeAmp    = 12;

  // Bomb particles
  spawnParticles(b.x, b.y, '#ff3b5c', 15);
  spawnParticles(b.x, b.y, '#ffa502', 10);

  // Sound
  playBombSound();

  // Relay
  socket.emit('slice_confirmed', { type: 'bomb' });

  bombs.splice(i, 1);

  if (lives <= 0) {
    setTimeout(triggerGameOver, 500);
  }
}

// ─── Score text floaters ─────────────────────────────────────────────────────
const scoreTexts = [];

function spawnScoreText(x, y, text, color) {
  scoreTexts.push({ x, y: y - 20, vy: -1.5, text, color, alpha: 1, life: 0, maxLife: 50 });
}

function updateAndDrawScoreTexts() {
  for (let i = scoreTexts.length - 1; i >= 0; i--) {
    const s = scoreTexts[i];
    s.y  += s.vy;
    s.vy *= 0.97;
    s.life++;
    s.alpha = 1 - s.life / s.maxLife;

    ctx.save();
    ctx.globalAlpha = s.alpha;
    ctx.font = 'bold 22px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = s.color;
    ctx.shadowColor = s.color;
    ctx.shadowBlur = 10;
    ctx.fillText(s.text, s.x, s.y);
    ctx.restore();

    if (s.life >= s.maxLife) scoreTexts.splice(i, 1);
  }
}

// ─── Fruit spawning ───────────────────────────────────────────────────────────
function spawnFruitBurst() {
  const count = Math.random() < 0.25 ? 2 + Math.floor(Math.random() * 2) : 1;
  for (let c = 0; c < count; c++) {
    const type = FRUIT_TYPES[Math.floor(Math.random() * FRUIT_TYPES.length)];
    const margin = 80;
    const x = margin + Math.random() * (canvas.width - margin * 2);
    const y = canvas.height + type.size + 20 + c * 30;
    const vy = -(15 + Math.random() * 7);
    const vx = (Math.random() - 0.5) * 4;

    fruits.push({ x, y, vx, vy, type, radius: type.size, sliced: false });
  }
}

function spawnBomb() {
  const x = 80 + Math.random() * (canvas.width - 160);
  const y = canvas.height + 40;
  const vy = -(14 + Math.random() * 6);
  const vx = (Math.random() - 0.5) * 3;
  bombs.push({ x, y, vx, vy, radius: 48, sliced: false });
}

// ─── HUD drawing ──────────────────────────────────────────────────────────────
function drawHUD() {
  const pad = 24;
  const top = pad + 20;

  // Score (top left)
  ctx.save();
  ctx.font = 'bold 28px Orbitron, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#00d4ff';
  ctx.shadowColor = '#00d4ff';
  ctx.shadowBlur = 15;
  ctx.fillText(String(score).padStart(6, '0'), pad, top);
  ctx.restore();

  // Score label
  ctx.save();
  ctx.font = '10px Rajdhani, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(0,212,255,0.5)';
  ctx.fillText('SCORE', pad, top - 14);
  ctx.restore();

  // Combo (top center)
  if (combo > 1) {
    ctx.save();
    ctx.font = 'bold 22px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#f1c40f';
    ctx.shadowColor = '#f1c40f';
    ctx.shadowBlur = 20;
    ctx.fillText('x' + combo + ' COMBO', canvas.width / 2, top);
    ctx.restore();
  }

  // Lives (top right) — heart symbols
  ctx.save();
  ctx.font = '26px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  const livesStr = '❤️'.repeat(Math.max(0, lives)) + '🖤'.repeat(Math.max(0, 3 - lives));
  ctx.fillText(livesStr, canvas.width - pad, top);
  ctx.restore();

  // Multiplier badge
  if (comboMultiplier > 1) {
    ctx.save();
    const bx = canvas.width / 2;
    const by = top + 36;
    ctx.font = 'bold 14px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#ff6b6b';
    ctx.shadowColor = '#ff6b6b';
    ctx.shadowBlur = 12;
    ctx.fillText('×' + comboMultiplier + ' MULTIPLIER', bx, by);
    ctx.restore();
  }

  // Combo flash text
  if (comboFlashAlpha > 0) {
    ctx.save();
    ctx.globalAlpha = comboFlashAlpha;
    ctx.font = 'bold 52px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f1c40f';
    ctx.shadowColor = '#f1c40f';
    ctx.shadowBlur = 40;
    ctx.fillText(comboFlashText, canvas.width / 2, canvas.height / 2 - 60);
    ctx.restore();
    comboFlashAlpha = Math.max(0, comboFlashAlpha - 0.03);
  }
}

// ─── Background ───────────────────────────────────────────────────────────────
function drawBackground() {
  // Deep space gradient
  const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
  bg.addColorStop(0, '#050510');
  bg.addColorStop(1, '#0a0018');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Subtle grid
  ctx.save();
  ctx.strokeStyle = 'rgba(0,212,255,0.03)';
  ctx.lineWidth = 1;
  const gSize = 60;
  for (let gx = 0; gx < canvas.width; gx += gSize) {
    ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, canvas.height); ctx.stroke();
  }
  for (let gy = 0; gy < canvas.height; gy += gSize) {
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(canvas.width, gy); ctx.stroke();
  }
  ctx.restore();

  // Horizon line glow
  const hl = canvas.height * 0.75;
  const horizGrad = ctx.createLinearGradient(0, hl - 40, 0, hl + 40);
  horizGrad.addColorStop(0, 'transparent');
  horizGrad.addColorStop(0.5, 'rgba(123,47,255,0.06)');
  horizGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = horizGrad;
  ctx.fillRect(0, hl - 40, canvas.width, 80);
}

// ─── Countdown ────────────────────────────────────────────────────────────────
function startCountdown(cb) {
  showOverlay(overlayCountdown);
  let count = 3;
  countdownNum.textContent = count;
  playCountdownBeep(false);

  const tick = () => {
    count--;
    if (count <= 0) {
      countdownNum.textContent = 'GO!';
      playCountdownBeep(true);
      setTimeout(() => {
        showOverlay(null);
        cb();
      }, 600);
    } else {
      countdownNum.textContent = count;
      playCountdownBeep(false);
      countdownNum.style.animation = 'none';
      void countdownNum.offsetWidth;
      countdownNum.style.animation = 'count-pop 0.5s cubic-bezier(0.175,0.885,0.32,1.275)';
      setTimeout(tick, 900);
    }
  };

  countdownNum.style.animation = 'count-pop 0.5s cubic-bezier(0.175,0.885,0.32,1.275)';
  setTimeout(tick, 900);
}

// ─── Game start / reset ───────────────────────────────────────────────────────
function startGame() {
  // Reset state
  score           = 0;
  combo           = 0;
  comboMultiplier = 1;
  maxCombo        = 0;
  lives           = 3;
  gameRunning     = true;
  gameStartTime   = performance.now();
  lastSpawnTime   = performance.now();
  spawnInterval   = 2000;
  shakeFrames     = 0;
  shakeAmp        = 0;
  comboFlashAlpha = 0;
  fruits.length   = 0;
  bombs.length    = 0;
  particles.length = 0;
  scoreTexts.length = 0;
  bladeTrail.length = 0;
  latestMotion    = null;

  showOverlay(null);
  if (frameId) cancelAnimationFrame(frameId);
  gameLoop();
}

// ─── Game over ────────────────────────────────────────────────────────────────
function triggerGameOver() {
  gameRunning = false;
  cancelAnimationFrame(frameId);

  goScore.textContent = score;
  goCombo.textContent = 'x' + maxCombo;

  playGameOverSound();

  socket.emit('game_over', { score, maxCombo });
  showOverlay(overlayGameover);
}

playAgainBtn.addEventListener('click', () => {
  startCountdown(() => startGame());
});

// ─── Main game loop ───────────────────────────────────────────────────────────
function gameLoop() {
  if (!gameRunning) return;

  const now = performance.now();

  // Difficulty ramp: every 30s decrease spawn interval (min 600ms)
  const elapsed = now - gameStartTime;
  spawnInterval = Math.max(600, 2000 - Math.floor(elapsed / 30000) * 300);

  // Spawn logic
  if (now - lastSpawnTime > spawnInterval) {
    spawnFruitBurst();
    if (Math.random() < 0.2) spawnBomb(); // ~1 in 5 chance per burst
    lastSpawnTime = now;
  }

  // Physics
  const GRAVITY = 0.32;
  for (let i = fruits.length - 1; i >= 0; i--) {
    const f = fruits[i];
    f.vy += GRAVITY;
    f.x  += f.vx;
    f.y  += f.vy;
    if (f.y > canvas.height + f.radius + 50) {
      // Missed fruit
      fruits.splice(i, 1);
      lives = Math.max(0, lives - 1);
      combo = 0;
      comboMultiplier = 1;
      playMissSound();
      if (lives <= 0) { triggerGameOver(); return; }
    }
  }

  for (let i = bombs.length - 1; i >= 0; i--) {
    const b = bombs[i];
    b.vy += GRAVITY;
    b.x  += b.vx;
    b.y  += b.vy;
    if (b.y > canvas.height + b.radius + 50) {
      bombs.splice(i, 1); // miss bomb safely
    }
  }

  updateParticles();

  // Update blade position from motion data
  let isSlicing = false;
  if (latestMotion) {
    const { x, y, isSlicing: slicing } = latestMotion;
    // x and y are already normalized to [-1, 1] from controller
    // Map to canvas coordinates: map [-1,1] to [0, canvas.width/height]
    bladeX = ((x + 1) / 2) * canvas.width;
    bladeY = ((y + 1) / 2) * canvas.height;  // y is already negated by controller
    isSlicing = slicing;
    updateBladeTrail(bladeX, bladeY);
    checkSlices(isSlicing);
  }

  // ── Draw frame ───────────────────────────────────────────────────────────────
  // Screen shake offset
  let ox = 0, oy = 0;
  if (shakeFrames > 0) {
    ox = (Math.random() - 0.5) * shakeAmp * 2;
    oy = (Math.random() - 0.5) * shakeAmp * 2;
    shakeAmp = Math.max(0, shakeAmp - 0.5);
    shakeFrames--;
  }

  ctx.save();
  ctx.translate(ox, oy);

  drawBackground();

  // Draw fruits
  fruits.forEach(f => drawFruit(f));
  // Draw bombs
  bombs.forEach(b => drawBomb(b));
  // Draw particles
  drawParticles();
  // Draw blade trail
  drawBladeTrail(isSlicing);
  // Score floaters
  updateAndDrawScoreTexts();

  ctx.restore();

  // HUD always on top without shake
  drawHUD();

  frameId = requestAnimationFrame(gameLoop);
}

// ─── Color helpers ────────────────────────────────────────────────────────────
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 128, g: 128, b: 128 };
}

function lightenColor(hex, amt) {
  const c = hexToRgb(hex);
  return `rgb(${Math.min(255,c.r+amt)},${Math.min(255,c.g+amt)},${Math.min(255,c.b+amt)})`;
}

function darkenColor(hex, amt) {
  const c = hexToRgb(hex);
  return `rgb(${Math.max(0,c.r-amt)},${Math.max(0,c.g-amt)},${Math.max(0,c.b-amt)})`;
}

// ─── Initial render ───────────────────────────────────────────────────────────
// Draw the dark background on load before socket connects
(function initialDraw() {
  ctx.fillStyle = '#050510';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
})();

showOverlay(overlayWaiting);

// ─── Web Audio API Synthesis ──────────────────────────────────────────────────
let audioCtx = null;
let noiseBuffer = null;

function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

window.addEventListener('click', initAudio);
window.addEventListener('touchstart', initAudio);

function getNoiseBuffer() {
  if (!audioCtx) return null;
  if (noiseBuffer) return noiseBuffer;
  const bufferSize = audioCtx.sampleRate * 0.2; // 0.2s noise
  noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

function playSliceSound() {
  initAudio();
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();

  const buf = getNoiseBuffer();
  if (!buf) return;

  const noise = audioCtx.createBufferSource();
  noise.buffer = buf;

  const filter = audioCtx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(1000, audioCtx.currentTime);
  filter.frequency.exponentialRampToValueAtTime(220, audioCtx.currentTime + 0.18);
  filter.Q.value = 4;

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.18);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);

  noise.start();
}

function playBombSound() {
  initAudio();
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();

  // Noise explosion component
  const noise = audioCtx.createBufferSource();
  const dur = 0.8;
  const bufferSize = audioCtx.sampleRate * dur;
  const buf = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
  noise.buffer = buf;

  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(320, audioCtx.currentTime);
  filter.frequency.exponentialRampToValueAtTime(12, audioCtx.currentTime + dur);

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.7, audioCtx.currentTime);
  gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + dur);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);
  noise.start();

  // Low sine boom
  const osc = audioCtx.createOscillator();
  const oscGain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(120, audioCtx.currentTime);
  osc.frequency.linearRampToValueAtTime(30, audioCtx.currentTime + 0.45);

  oscGain.gain.setValueAtTime(0.6, audioCtx.currentTime);
  oscGain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.45);

  osc.connect(oscGain);
  oscGain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.5);
}

function playMissSound() {
  initAudio();
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(200, audioCtx.currentTime);
  osc.frequency.linearRampToValueAtTime(80, audioCtx.currentTime + 0.22);

  gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.22);

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start();
  osc.stop(audioCtx.currentTime + 0.23);
}

function playCountdownBeep(isGo = false) {
  initAudio();
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(isGo ? 880 : 440, audioCtx.currentTime);

  gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + (isGo ? 0.35 : 0.12));

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start();
  osc.stop(audioCtx.currentTime + (isGo ? 0.36 : 0.13));
}

function playGameOverSound() {
  initAudio();
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();

  const notes = [220, 196, 174, 146];
  notes.forEach((freq, idx) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime + idx * 0.15);

    gain.gain.setValueAtTime(0, audioCtx.currentTime + idx * 0.15);
    gain.gain.linearRampToValueAtTime(0.18, audioCtx.currentTime + idx * 0.15 + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + idx * 0.15 + 0.35);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(audioCtx.currentTime + idx * 0.15);
    osc.stop(audioCtx.currentTime + idx * 0.15 + 0.4);
  });
}

