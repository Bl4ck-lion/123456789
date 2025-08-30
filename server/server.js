import express from "express";
import http from "http";
import { Server } from "socket.io";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";

const PORT = process.env.PORT || 3001;
const ORIGIN = process.env.ALLOWED_ORIGIN || "http://localhost:3000";

const app = express();
app.use(helmet());
app.use(express.json({ limit: "50kb" }));
app.use(cors({ origin: ORIGIN }));
app.use(rateLimit({ windowMs: 60_000, max: 200 }));

// In-memory simple stores (demo)
const users = new Map(); // username -> { socketId, publicKey }
const rooms = new Map(); // room -> Set(username)

app.get('/status', (req, res) => res.json({ ok: true }));
app.get('/users', (req, res) => {
  const list = [...users.entries()].map(([u, v]) => ({ username: u, publicKey: v.publicKey }));
  res.json({ users: list });
});

// Simple prekey store for libsignal demos (optional)
const prekeys = new Map();
app.post('/v1/prekey/:username', (req, res) => {
  prekeys.set(req.params.username, req.body);
  res.json({ ok: true });
});
app.get('/v1/prekey/:username', (req, res) => {
  const b = prekeys.get(req.params.username);
  if(!b) return res.status(404).json({ error: 'not found' });
  res.json(b);
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: ORIGIN } });

io.on('connection', socket => {
  const username = socket.handshake.auth?.username;
  if(!username){ socket.disconnect(true); return; }
  users.set(username, { socketId: socket.id, publicKey: users.get(username)?.publicKey || '' });
  io.emit('presence', { username, online: true });

  socket.on('register-pubkey', ({ username: u, publicKey }) => {
    if(!u) return;
    users.set(u, { socketId: socket.id, publicKey });
  });

  socket.on('join-room', ({ room }) => {
    if(!room) return;
    socket.join(room);
    if(!rooms.has(room)) rooms.set(room, new Set());
    rooms.get(room).add(username);
    io.to(room).emit('room-update', { room, members: [...rooms.get(room)] });
  });

  socket.on('leave-room', ({ room }) => {
    if(!room) return;
    socket.leave(room);
    rooms.get(room)?.delete(username);
    io.to(room).emit('room-update', { room, members: [...(rooms.get(room)||[])] });
  });

  socket.on('private-message', ({ to, payload }) => {
    const target = users.get(to);
    if(!target?.socketId) return;
    io.to(target.socketId).emit('private-message', payload);
  });

  socket.on('group-message', ({ room, packets }) => {
    for(const { to, payload } of packets){
      const target = users.get(to);
      if(!target?.socketId) continue;
      io.to(target.socketId).emit('group-message', { room, payload });
    }
  });

  socket.on('disconnect', () => {
    users.get(username) && users.set(username, { ...users.get(username), socketId: null });
    io.emit('presence', { username, online: false });
  });
});

server.listen(PORT, ()=> console.log(`Realtime server running on :${PORT}`));
