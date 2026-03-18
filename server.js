const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// rooms[roomId] = { videoId, state, currentTime, hostId, users: Map<socketId, {name, color}> }
const rooms = new Map();

io.on('connection', (socket) => {
  // ── Create Room ────────────────────────────────────────────────────────
  socket.on('create-room', ({ roomId, username, color }) => {
    if (rooms.has(roomId)) {
      return handleJoin(socket, roomId, username, color);
    }
    rooms.set(roomId, {
      videoId:     '',
      state:       'paused',
      currentTime: 0,
      hostId:      socket.id,
      users:       new Map([[socket.id, { name: username, color }]])
    });
    socket.join(roomId);
    socket.data.roomId   = roomId;
    socket.data.username = username;
    socket.data.color    = color;

    socket.emit('room-created', { roomId });
    io.to(roomId).emit('room-update', getRoomData(roomId));
    console.log(`Room ${roomId} created by ${username}`);
  });

  // ── Join Room ──────────────────────────────────────────────────────────
  socket.on('join-room', ({ roomId, username, color }) => {
    handleJoin(socket, roomId, username, color);
  });

  // ── Set Video (host only) ──────────────────────────────────────────────
  socket.on('set-video', ({ videoId }) => {
    const room = getRoom(socket);
    if (!room || room.hostId !== socket.id) return;
    room.videoId     = videoId;
    room.currentTime = 0;
    room.state       = 'paused';
    io.to(socket.data.roomId).emit('video-changed', { videoId });
    io.to(socket.data.roomId).emit('room-update', getRoomData(socket.data.roomId));
  });

  // ── Player State Sync (host only) ─────────────────────────────────────
  socket.on('player-state', ({ state, currentTime }) => {
    const room = getRoom(socket);
    if (!room || room.hostId !== socket.id) return;
    room.state       = state;
    room.currentTime = currentTime;
    socket.to(socket.data.roomId).emit('sync-player', { state, currentTime });
  });

  socket.on('player-seek', ({ currentTime }) => {
    const room = getRoom(socket);
    if (!room || room.hostId !== socket.id) return;
    room.currentTime = currentTime;
    socket.to(socket.data.roomId).emit('sync-seek', { currentTime });
  });

  // ── Guest requests current position ────────────────────────────────────
  socket.on('request-sync', () => {
    const room = getRoom(socket);
    if (!room) return;
    socket.emit('sync-player', { state: room.state, currentTime: room.currentTime });
  });

  // ── Chat ───────────────────────────────────────────────────────────────
  socket.on('send-chat', ({ message }) => {
    const room = getRoom(socket);
    if (!room) return;
    io.to(socket.data.roomId).emit('chat-message', {
      system:    false,
      username:  socket.data.username,
      color:     socket.data.color,
      message,
      timestamp: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
    });
  });

  // ── Disconnect ─────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    const room   = rooms.get(roomId);
    if (!room) return;

    const username = socket.data.username;
    room.users.delete(socket.id);

    if (room.users.size === 0) {
      rooms.delete(roomId);
      console.log(`Room ${roomId} deleted (empty)`);
      return;
    }

    if (room.hostId === socket.id) {
      room.hostId = room.users.keys().next().value;
      io.to(roomId).emit('host-changed', { newHostId: room.hostId });
    }

    io.to(roomId).emit('room-update', getRoomData(roomId));
    io.to(roomId).emit('chat-message', { system: true, message: `${username} ออกจากห้อง` });
    console.log(`${username} left room ${roomId}`);
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────

function handleJoin(socket, roomId, username, color) {
  const room = rooms.get(roomId);
  if (!room) {
    socket.emit('error', { message: 'ไม่พบห้องนี้ กรุณาตรวจสอบรหัสห้องอีกครั้ง' });
    return;
  }
  room.users.set(socket.id, { name: username, color });
  socket.join(roomId);
  socket.data.roomId   = roomId;
  socket.data.username = username;
  socket.data.color    = color;

  socket.emit('room-joined', {
    roomId,
    videoId:     room.videoId,
    state:       room.state,
    currentTime: room.currentTime,
    isHost:      room.hostId === socket.id
  });

  io.to(roomId).emit('room-update', getRoomData(roomId));
  io.to(roomId).emit('chat-message', { system: true, message: `${username} เข้าร่วมห้อง` });
  console.log(`${username} joined room ${roomId}`);
}

function getRoom(socket) {
  return rooms.get(socket.data.roomId);
}

function getRoomData(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;
  return {
    roomId,
    hostId: room.hostId,
    videoId: room.videoId,
    users: Array.from(room.users.entries()).map(([id, u]) => ({
      id,
      name:   u.name,
      color:  u.color,
      isHost: id === room.hostId
    }))
  };
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running → http://localhost:${PORT}`);
});
