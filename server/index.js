'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

// ─── Static routes ───────────────────────────────────────────────────────────
app.use('/display', express.static(path.join(__dirname, '../public/display')));
app.use('/controller', express.static(path.join(__dirname, '../public/controller')));

// Root redirect
app.get('/', (req, res) => res.redirect('/display'));

// ─── Room management ─────────────────────────────────────────────────────────
// rooms = Map<code, { displaySocketId, controllerSocketId|null }>
const rooms = new Map();

const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0,O,1,I

function generateCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () =>
      CHARSET[Math.floor(Math.random() * CHARSET.length)]
    ).join('');
  } while (rooms.has(code));
  return code;
}

// ─── Socket.io ───────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id}`);

  // ── Display: create room ──────────────────────────────────────────────────
  socket.on('create_room', async (_, callback) => {
    // Clean up any old room owned by this display socket
    for (const [code, room] of rooms.entries()) {
      if (room.displaySocketId === socket.id) {
        rooms.delete(code);
        socket.leave(code);
      }
    }

    const code = generateCode();
    rooms.set(code, { displaySocketId: socket.id, controllerSocketId: null });
    socket.join(code);
    socket.roomCode = code;

    // Build controller URL from host header
    const host = socket.handshake.headers.host || `localhost:${PORT}`;
    const protocol = socket.handshake.headers['x-forwarded-proto'] || 'http';
    const controllerUrl = `${protocol}://${host}/controller/?room=${code}`;

    try {
      const qrDataUrl = await QRCode.toDataURL(controllerUrl, {
        width: 300,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' }
      });
      console.log(`[room] Created ${code} for display ${socket.id}`);
      socket.emit('room_created', { code, qrDataUrl, controllerUrl });
    } catch (err) {
      console.error('QR generation failed:', err);
      socket.emit('room_created', { code, qrDataUrl: null, controllerUrl });
    }
  });

  // ── Controller: join room ─────────────────────────────────────────────────
  socket.on('join_room', ({ code }) => {
    const upperCode = (code || '').toUpperCase().trim();
    const room = rooms.get(upperCode);

    if (!room) {
      socket.emit('join_error', { message: 'Room not found. Check the code and try again.' });
      return;
    }

    if (room.controllerSocketId) {
      socket.emit('join_error', { message: 'A controller is already connected to this room.' });
      return;
    }

    room.controllerSocketId = socket.id;
    socket.join(upperCode);
    socket.roomCode = upperCode;
    socket.isController = true;

    console.log(`[room] Controller ${socket.id} joined ${upperCode}`);

    // Notify display
    io.to(room.displaySocketId).emit('player_joined', { socketId: socket.id });
    // Acknowledge controller
    socket.emit('join_success', { code: upperCode });
  });

  // ── Controller → Display: motion data ────────────────────────────────────
  socket.on('motion_data', (payload) => {
    if (!socket.roomCode) return;
    const room = rooms.get(socket.roomCode);
    if (!room) return;
    // Forward only to the display socket
    io.to(room.displaySocketId).emit('motion_data', payload);
  });

  // ── Display → Controller: slice confirmed ────────────────────────────────
  socket.on('slice_confirmed', (payload) => {
    if (!socket.roomCode) return;
    const room = rooms.get(socket.roomCode);
    if (!room || !room.controllerSocketId) return;
    io.to(room.controllerSocketId).emit('slice_confirmed', payload);
  });

  // ── Game over relay ───────────────────────────────────────────────────────
  socket.on('game_over', (payload) => {
    if (!socket.roomCode) return;
    socket.to(socket.roomCode).emit('game_over', payload);
  });

  // ── Disconnect ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`[disconnect] ${socket.id}`);
    const code = socket.roomCode;
    if (!code) return;

    const room = rooms.get(code);
    if (!room) return;

    if (socket.isController) {
      // Controller left — notify display
      room.controllerSocketId = null;
      io.to(room.displaySocketId).emit('controller_disconnected');
      console.log(`[room] Controller left ${code}`);
    } else {
      // Display left — clean up room entirely
      if (room.controllerSocketId) {
        io.to(room.controllerSocketId).emit('display_disconnected');
      }
      rooms.delete(code);
      console.log(`[room] Deleted ${code} (display left)`);
    }
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🗡️  AirBlade server running on http://0.0.0.0:${PORT}`);
  console.log(`   Display:    http://localhost:${PORT}/display`);
  console.log(`   Controller: http://localhost:${PORT}/controller\n`);
});
