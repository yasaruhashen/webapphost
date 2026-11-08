require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');

// Route modules
const authRoutes = require('./routes/auth');
const roomsRoutes = require('./routes/rooms');
const db = require('./db/database');

const app = express();

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
    database: 'SQLite (LibSQL)',
    serverless: !!process.env.VERCEL,
    timestamp: new Date().toISOString()
  });
});

// Friendly route aliases
app.get('/room.html', (req, res) => res.sendFile(path.join(frontendDir, 'pages', 'room.html')));
app.get('/rooms.html', (req, res) => res.sendFile(path.join(frontendDir, 'pages', 'rooms.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(frontendDir, 'pages', 'login.html')));
app.get('/profile.html', (req, res) => res.sendFile(path.join(frontendDir, 'pages', 'profile.html')));

// Fallback for SPA routing if accessing root
app.get('/', (req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'));
});

// Create HTTP server (for local execution & optional Socket.io support)
const server = http.createServer(app);

// Initialize Socket.io only when running as a persistent Node server (local)
let io;
if (!process.env.VERCEL) {
  try {
    const { Server } = require('socket.io');
    io = new Server(server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });
    app.set('io', io);

    io.on('connection', (socket) => {
      console.log(`[Socket.io] Client connected: ${socket.id}`);

      socket.on('join_room', (roomCode) => {
        socket.join(roomCode);
        console.log(`[Socket.io] ${socket.id} joined room ${roomCode}`);
        socket.to(roomCode).emit('user_joined', { socketId: socket.id });
      });

      socket.on('sync_playback', (data) => {
        // Broadcast play, pause, seek event to room peers
        socket.to(data.roomCode).emit('peer_sync', data);
      });

      socket.on('new_chat_message', (data) => {
        io.to(data.roomCode).emit('receive_message', data);
      });

      socket.on('disconnect', () => {
        console.log(`[Socket.io] Client disconnected: ${socket.id}`);
      });
    });
  } catch (err) {
    console.warn('[Socket.io] Socket.io not initialized:', err.message);
  }
}

// Start standalone server when executed directly (node backend/server.js)
const PORT = process.env.PORT || 5000;
if (require.main === module && !process.env.VERCEL) {
  server.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(` UniTogether API Server running on port ${PORT}`);
    console.log(` Health check: http://localhost:${PORT}/api/health`);
    console.log(` Frontend URL: http://localhost:${PORT}/`);
    console.log(` Database: SQLite (LibSQL)`);
    console.log(`=======================================================`);
  });
}

// Export app for Vercel Serverless Function deployment
module.exports = app;

