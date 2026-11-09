require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');

// Route modules
const authRoutes = require('./routes/auth');
const roomsRoutes = require('./routes/rooms');
const { connectDb, mongoose } = require('./db/database');

const app = express();

// Middleware with 25MB body limit for image & file attachments
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb', extended: true }));

// Serve frontend static files when running locally
const frontendDir = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendDir));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/rooms', roomsRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    project: 'UniTogether API',
    host: 'Render.com',
    database: 'MongoDB (Mongoose)',
    mongoConnected: mongoose.connection.readyState === 1,
    socketActive: !!io,
    timestamp: new Date().toISOString()
  });
});

// Friendly route aliases (with & without .html)
app.get('/room.html', (req, res) => res.sendFile(path.join(frontendDir, 'pages', 'room.html')));
app.get('/room', (req, res) => res.sendFile(path.join(frontendDir, 'pages', 'room.html')));
app.get('/rooms.html', (req, res) => res.sendFile(path.join(frontendDir, 'pages', 'rooms.html')));
app.get('/rooms', (req, res) => res.sendFile(path.join(frontendDir, 'pages', 'rooms.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(frontendDir, 'pages', 'login.html')));
app.get('/login', (req, res) => res.sendFile(path.join(frontendDir, 'pages', 'login.html')));
app.get('/profile.html', (req, res) => res.sendFile(path.join(frontendDir, 'pages', 'profile.html')));
app.get('/profile', (req, res) => res.sendFile(path.join(frontendDir, 'pages', 'profile.html')));
app.get('/edit-profile', (req, res) => res.sendFile(path.join(frontendDir, 'pages', 'profile.html')));
app.get('/contact.html', (req, res) => res.sendFile(path.join(frontendDir, 'pages', 'contact.html')));
app.get('/contact', (req, res) => res.sendFile(path.join(frontendDir, 'pages', 'contact.html')));

// Fallback for SPA routing if accessing root
app.get('/', (req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'));
});

// Create HTTP server (for Render & local persistent execution)
const server = http.createServer(app);

// Initialize Socket.io persistent WebSocket server
let io;
try {
  const { Server } = require('socket.io');
  io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });
  app.set('io', io);

    // In-memory tracking of active participants per room: roomCode -> Map(socketId -> userInfo)
    const roomParticipants = new Map();

    io.on('connection', (socket) => {
      console.log(`[Socket.io] Client connected: ${socket.id}`);
      let currentJoinedRoom = null;

      socket.on('join_room', (payload) => {
        let roomCode = payload;
        let userData = null;

        if (typeof payload === 'object' && payload !== null) {
          roomCode = payload.roomCode || payload.room_code || payload.code;
          userData = payload.user || payload;
        }

        if (!roomCode || typeof roomCode !== 'string') return;
        roomCode = roomCode.toUpperCase().trim();
        currentJoinedRoom = roomCode;

        socket.join(roomCode);

        if (!roomParticipants.has(roomCode)) {
          roomParticipants.set(roomCode, new Map());
        }

        const participantsMap = roomParticipants.get(roomCode);
        const name = (userData && userData.name) ? userData.name : 'Guest';
        const avatar = (userData && userData.avatar) ? userData.avatar : `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(name)}`;
        const email = (userData && userData.email) ? userData.email : '';
        const isHost = (userData && userData.isHost) ? true : false;

        participantsMap.set(socket.id, {
          socketId: socket.id,
          name,
          avatar,
          email,
          isHost,
          micMuted: false,
          joinedAt: new Date().toISOString()
        });

        console.log(`[Socket.io] ${name} (${socket.id}) joined room ${roomCode}. Total members: ${participantsMap.size}`);

        // Broadcast active participants to all peers in this room
        const activeUsersList = Array.from(participantsMap.values());
        io.to(roomCode).emit('room_users', activeUsersList);
        socket.to(roomCode).emit('user_joined', { socketId: socket.id, user: participantsMap.get(socket.id) });
      });

      socket.on('mic_status', (data) => {
        if (!currentJoinedRoom || !roomParticipants.has(currentJoinedRoom)) return;
        const participantsMap = roomParticipants.get(currentJoinedRoom);
        if (participantsMap.has(socket.id)) {
          const user = participantsMap.get(socket.id);
          user.micMuted = !!data.micMuted;
          io.to(currentJoinedRoom).emit('room_users', Array.from(participantsMap.values()));
        }
      });

      socket.on('sync_playback', (data) => {
        // Broadcast play, pause, seek event to room peers
        const targetRoom = data.roomCode || data.room_code;
        if (targetRoom) {
          socket.to(targetRoom).emit('peer_sync', data);
        }
      });

      socket.on('new_chat_message', (data) => {
        const targetRoom = data.roomCode || data.room_code;
        if (targetRoom) {
          io.to(targetRoom).emit('receive_message', data);
        }
      });

      socket.on('disconnect', () => {
        console.log(`[Socket.io] Client disconnected: ${socket.id}`);
        if (currentJoinedRoom && roomParticipants.has(currentJoinedRoom)) {
          const participantsMap = roomParticipants.get(currentJoinedRoom);
          participantsMap.delete(socket.id);
          console.log(`[Socket.io] Left room ${currentJoinedRoom}. Remaining members: ${participantsMap.size}`);
          io.to(currentJoinedRoom).emit('room_users', Array.from(participantsMap.values()));
          if (participantsMap.size === 0) {
            roomParticipants.delete(currentJoinedRoom);
          }
        }
      });
    });
  } catch (err) {
    console.warn('[Socket.io] Socket.io not initialized:', err.message);
  }

// Start standalone server on Render.com & Local (binds to 0.0.0.0 for container networking)
const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(` UniTogether Server running on port ${PORT}`);
  console.log(` Host: Render.com / Local`);
  console.log(` Health check: http://0.0.0.0:${PORT}/api/health`);
  console.log(` Frontend URL: http://0.0.0.0:${PORT}/`);
  console.log(` Database: MongoDB (Mongoose)`);
  console.log(` Socket.io WebSockets: Active (Real-Time Synchronized)`);
  console.log(`=======================================================`);
});

module.exports = { app, server };

