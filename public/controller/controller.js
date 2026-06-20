'use strict';

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const screenConnect    = document.getElementById('screen-connect');
const screenPermission = document.getElementById('screen-permission');
const screenReady      = document.getElementById('screen-ready');
const connectBtn       = document.getElementById('connect-btn');
const permissionBtn    = document.getElementById('permission-btn');
const roomCodeInput    = document.getElementById('room-code-input');
const connectError     = document.getElementById('connect-error');
const permissionError  = document.getElementById('permission-error');
const statusDot        = document.getElementById('status-dot');
const readyTitle       = document.getElementById('ready-title');
const readySub         = document.getElementById('ready-sub');
const sliceFlash       = document.getElementById('slice-flash');
const calibrateBtn     = document.getElementById('calibrate-btn');

// ─── State ─────────────────────────────────────────────────────────────────────
let socket = null;
let currentRoom = null;
let motionActive = false;

// Sensor smoothing state (cursor mode: orientation only)
let smoothAlpha = 0, smoothBeta = 0, smoothGamma = 0;

// Calibration offsets
let betaOffset = 0;
let gammaOffset = 0;

// Touch fallback state
let touchActive = false;
let lastTouchX = 0;
let lastTouchY = 0;
let lastTouchTime = 0;

// Low-pass filter coefficient
const ALPHA = 0.2;

// Throttle: send at ~60 times per second for smooth blade tracking
const SEND_RATE = 1000 / 60;
let lastSendTime = 0;

// ─── Screen management ────────────────────────────────────────────────────────
function showScreen(screen) {
  [screenConnect, screenPermission, screenReady].forEach(s => s.classList.remove('active'));
  screen.classList.add('active');
}

// ─── URL param pre-fill ───────────────────────────────────────────────────────
(function prefillFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const room = params.get('room');
  if (room) {
    roomCodeInput.value = room.toUpperCase().slice(0, 4);
  }
})();

// Force uppercase as user types
roomCodeInput.addEventListener('input', () => {
  const pos = roomCodeInput.selectionStart;
  roomCodeInput.value = roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  try { roomCodeInput.setSelectionRange(pos, pos); } catch(e) {}
});

// ─── Socket connection ────────────────────────────────────────────────────────
function initSocket() {
  socket = io({ transports: ['websocket', 'polling'] });

  socket.on('connect', () => {
    console.log('[socket] connected:', socket.id);
  });

  socket.on('disconnect', () => {
    console.log('[socket] disconnected');
    if (screenReady.classList.contains('active')) {
      statusDot.classList.add('disconnected');
      statusDot.classList.remove('connected');
      readyTitle.textContent = 'DISCONNECTED';
      readySub.textContent = 'Please refresh and reconnect.';
    }
  });

  socket.on('join_success', ({ code }) => {
    console.log('[socket] join_success', code);
    currentRoom = code;
    proceedAfterJoin();
  });

  socket.on('join_error', ({ message }) => {
    showError(connectError, message);
    connectBtn.disabled = false;
    connectBtn.textContent = 'CONNECT';
  });

  socket.on('display_disconnected', () => {
    statusDot.classList.add('disconnected');
    readyTitle.textContent = 'DISPLAY OFFLINE';
    readySub.textContent = 'The game window was closed.';
    motionActive = false;
  });

  // Slice feedback → vibration
  socket.on('slice_confirmed', ({ type }) => {
    if (!navigator.vibrate) return;
    if (type === 'fruit') {
      navigator.vibrate(40);
      triggerFlash('fruit');
    } else if (type === 'bomb') {
      navigator.vibrate([40, 20, 40]);
      triggerFlash('bomb');
    }
  });
}

function triggerFlash(type) {
  sliceFlash.className = 'slice-flash';
  // force reflow
  void sliceFlash.offsetWidth;
  sliceFlash.classList.add(type + '-flash');
  sliceFlash.classList.remove('hidden');
  setTimeout(() => sliceFlash.classList.add('hidden'), 300);
}

// ─── Connect button ───────────────────────────────────────────────────────────
connectBtn.addEventListener('click', () => {
  const code = roomCodeInput.value.toUpperCase().trim();
  if (code.length !== 4) {
    showError(connectError, 'Please enter a 4-character room code.');
    return;
  }
  hideError(connectError);
  connectBtn.disabled = true;
  connectBtn.textContent = 'CONNECTING…';

  if (!socket) initSocket();

  // If socket is already connected, emit immediately; otherwise wait for connect
  if (socket.connected) {
    socket.emit('join_room', { code });
  } else {
    socket.once('connect', () => socket.emit('join_room', { code }));
    socket.connect();
  }
});

// Allow Enter key on input
roomCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') connectBtn.click();
});

// ─── After join: iOS permission or skip ──────────────────────────────────────
function proceedAfterJoin() {
  const isIOS13Plus =
    typeof DeviceMotionEvent !== 'undefined' &&
    typeof DeviceMotionEvent.requestPermission === 'function';

  if (isIOS13Plus) {
    showScreen(screenPermission);
  } else {
    startMotionListeners();
    showReadyScreen();
  }
}

// ─── iOS permission button ────────────────────────────────────────────────────
permissionBtn.addEventListener('click', async () => {
  try {
    const motionResult = await DeviceMotionEvent.requestPermission();
    if (motionResult !== 'granted') {
      showError(permissionError, 'Motion permission denied. Please enable in Settings.');
      return;
    }
    // Also request orientation if available
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      await DeviceOrientationEvent.requestPermission().catch(() => {});
    }
    startMotionListeners();
    showReadyScreen();
  } catch (err) {
    showError(permissionError, 'Could not request permission: ' + err.message);
  }
});

let touchListenersInitialized = false;

// ─── Ready screen ─────────────────────────────────────────────────────────────
function showReadyScreen() {
  showScreen(screenReady);
  statusDot.classList.remove('disconnected');
  statusDot.classList.add('connected');
  readyTitle.textContent = 'CONNECTED';
  readySub.textContent = 'Start swinging!';

  if (!touchListenersInitialized) {
    initTouchControls();
    touchListenersInitialized = true;
  }
}

// Calibration button listener
calibrateBtn.addEventListener('click', () => {
  betaOffset = smoothBeta;
  gammaOffset = smoothGamma;
  console.log('[calibrate] set center offset:', { betaOffset, gammaOffset });
  
  // Visual feedback: button temporarily shows "CENTERED!"
  const origText = calibrateBtn.textContent;
  calibrateBtn.textContent = 'CENTERED!';
  calibrateBtn.style.borderColor = 'var(--success)';
  setTimeout(() => {
    calibrateBtn.textContent = origText;
    calibrateBtn.style.borderColor = 'rgba(255,255,255,0.15)';
  }, 1000);
});

// ─── Sensor listeners ─────────────────────────────────────────────────────────
function startMotionListeners() {
  motionActive = true;

  window.addEventListener('devicemotion', onDeviceMotion, { passive: true });
  window.addEventListener('deviceorientation', onDeviceOrientation, { passive: true });
}

function onDeviceMotion(e) {
  // Cursor mode: position-only, acceleration not used
}

function onDeviceOrientation(e) {
  smoothAlpha = smoothAlpha * (1 - ALPHA) + (e.alpha || 0) * ALPHA;
  smoothBeta  = smoothBeta  * (1 - ALPHA) + (e.beta  || 0) * ALPHA;
  smoothGamma = smoothGamma * (1 - ALPHA) + (e.gamma || 0) * ALPHA;
  
  // Continuous emission when motion is active for smooth real-time tracking
  tryEmit();
}

function tryEmit() {
  if (!motionActive || !socket || !socket.connected || !currentRoom) return;
  if (touchActive) return; // Ignore sensor data while user is actively dragging/touching

  const now = performance.now();
  if (now - lastSendTime < SEND_RATE) return;
  lastSendTime = now;

  // Tilt → normalized x,y with calibration offset (cursor position only)
  let diffGamma = smoothGamma - gammaOffset;
  let diffBeta = smoothBeta - betaOffset;

  // normalize differences to [-180, 180]
  if (diffGamma > 180) diffGamma -= 360;
  if (diffGamma < -180) diffGamma += 360;
  if (diffBeta > 180) diffBeta -= 360;
  if (diffBeta < -180) diffBeta += 360;

  // Sensitivity: 40 degrees tilt reaches edge (±1 normalized)
  // x-axis: gamma (left/right roll) → x position
  // y-axis: -beta (up/down pitch) → y position
  const sensitivity = 40;
  const x = Math.max(-1, Math.min(1, diffGamma / sensitivity));
  const y = Math.max(-1, Math.min(1, -diffBeta / sensitivity));

  const payload = {
    x,
    y,
    timestamp: now
  };

  socket.emit('motion_data', payload);
}

// ─── Touch Fallback Controls ──────────────────────────────────────────────────
function initTouchControls() {
  screenReady.addEventListener('touchstart', handleTouchStart, { passive: false });
  screenReady.addEventListener('touchmove', handleTouchMove, { passive: false });
  screenReady.addEventListener('touchend', handleTouchEnd, { passive: false });
}

function handleTouchStart(e) {
  const touch = e.touches[0];
  const rect = screenReady.getBoundingClientRect();
  lastTouchX = touch.clientX;
  lastTouchY = touch.clientY;
  lastTouchTime = performance.now();
  touchActive = true;

  sendTouchUpdate(touch, rect);
  e.preventDefault();
}

function handleTouchMove(e) {
  if (!touchActive) return;
  const touch = e.touches[0];
  const rect = screenReady.getBoundingClientRect();

  sendTouchUpdate(touch, rect);

  lastTouchX = touch.clientX;
  lastTouchY = touch.clientY;
  lastTouchTime = performance.now();
  e.preventDefault();
}

function handleTouchEnd(e) {
  touchActive = false;
  if (socket && socket.connected && currentRoom) {
    socket.emit('motion_data', {
      x: (lastTouchX / window.innerWidth) * 2 - 1,
      y: -((lastTouchY / window.innerHeight) * 2 - 1),
      timestamp: performance.now()
    });
  }
}

function sendTouchUpdate(touch, rect) {
  if (!socket || !socket.connected || !currentRoom) return;

  const normX = ((touch.clientX - rect.left) / rect.width) * 2 - 1;
  const normY = -(((touch.clientY - rect.top) / rect.height) * 2 - 1);

  socket.emit('motion_data', {
    x: Math.max(-1, Math.min(1, normX)),
    y: Math.max(-1, Math.min(1, normY)),
    timestamp: performance.now()
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

function hideError(el) {
  el.textContent = '';
  el.classList.add('hidden');
}
