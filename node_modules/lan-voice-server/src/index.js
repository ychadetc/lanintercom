import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import dgram from 'node:dgram';
import os from 'node:os';
import { Server } from 'socket.io';
import { randomInt } from 'node:crypto';

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3001);
const DISCOVERY_PORT = Number(process.env.DISCOVERY_PORT || 41234);
const app = express();
app.use(cors({ origin: true }));
app.use(express.json());
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: true, methods: ['GET', 'POST'] } });

// In-memory room registry. Rooms disappear when their final participant leaves.
const rooms = new Map();
const publicRooms = () => [...rooms.values()].map(({ code, name, mode, members }) => ({
  code, name, mode, participantCount: members.size
}));
const emitRooms = () => io.emit('rooms:update', publicRooms());
const makeCode = () => {
  let code;
  do { code = String(randomInt(100000, 1000000)); } while (rooms.has(code));
  return code;
};

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'lan-voice-server' }));
app.get('/api/rooms', (_req, res) => res.json(publicRooms()));

io.on('connection', (socket) => {
  socket.emit('rooms:update', publicRooms());

  socket.on('rooms:refresh', () => socket.emit('rooms:update', publicRooms()));

  socket.on('room:create', ({ name, mode } = {}, ack = () => {}) => {
    const code = makeCode();
    const room = { code, name: String(name || 'Voice Room').trim().slice(0, 40) || 'Voice Room', mode: mode === 'ptt' ? 'ptt' : 'continuous', members: new Map() };
    rooms.set(code, room);
    joinRoom(socket, room, ack);
  });

  socket.on('room:join', ({ code, displayName } = {}, ack = () => {}) => {
    const room = rooms.get(String(code || '').trim());
    if (!room) return ack({ ok: false, error: 'Room not found. Check the code or refresh the room list.' });
    joinRoom(socket, room, ack, displayName);
  });

  socket.on('webrtc:offer', ({ to, offer }) => io.to(to).emit('webrtc:offer', { from: socket.id, offer }));
  socket.on('webrtc:answer', ({ to, answer }) => io.to(to).emit('webrtc:answer', { from: socket.id, answer }));
  socket.on('webrtc:ice', ({ to, candidate }) => io.to(to).emit('webrtc:ice', { from: socket.id, candidate }));
  socket.on('disconnect', () => leaveRoom(socket));
});

function joinRoom(socket, room, ack, displayName = 'Guest') {
  // A socket may only occupy one room at a time.
  leaveRoom(socket);
  const peers = [...room.members.entries()].map(([id, member]) => ({ id, displayName: member.displayName }));
  room.members.set(socket.id, { displayName: String(displayName || 'Guest').trim().slice(0, 24) || 'Guest' });
  socket.join(room.code);
  socket.data.roomCode = room.code;
  socket.emit('room:joined', { code: room.code, name: room.name, mode: room.mode, peers });
  socket.to(room.code).emit('peer:joined', { id: socket.id, displayName: room.members.get(socket.id).displayName });
  ack({ ok: true, room: { code: room.code, name: room.name, mode: room.mode } });
  emitRooms();
}

function leaveRoom(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  socket.data.roomCode = undefined;
  if (!room) return;
  room.members.delete(socket.id);
  socket.to(code).emit('peer:left', { id: socket.id });
  socket.leave(code);
  if (room.members.size === 0) rooms.delete(code);
  emitRooms();
}

// UDP LAN announcement: useful for native companion clients / LAN diagnostics.
// Browsers cannot receive UDP packets, so browser room discovery uses Socket.IO above.
const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
udp.bind(() => { udp.setBroadcast(true); });
function advertise() {
  const payload = Buffer.from(JSON.stringify({ type: 'LAN_VOICE_ROOMS', port: PORT, rooms: publicRooms() }));
  udp.send(payload, DISCOVERY_PORT, '255.255.255.255', (err) => { if (err) console.error('UDP discovery broadcast:', err.message); });
}
const discoveryTimer = setInterval(advertise, 3000);

function lanAddresses() {
  const result = [];
  for (const entries of Object.values(os.networkInterfaces())) for (const item of entries || []) {
    if (item.family === 'IPv4' && !item.internal) result.push(item.address);
  }
  return result;
}
httpServer.listen(PORT, HOST, () => {
  console.log(`LAN Voice server listening on ${HOST}:${PORT}`);
  console.log('Open the client from another device using:');
  for (const address of lanAddresses()) console.log(`  http://${address}:5173`);
});
process.on('SIGINT', () => { clearInterval(discoveryTimer); udp.close(); httpServer.close(() => process.exit(0)); });
