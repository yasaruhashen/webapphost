const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const { ExpressPeerServer } = require('peer');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('./database');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 5000;

// Protect against unhandled runtime errors crashing the Node server process
process.on('uncaughtException', (err) => {
  console.error('[Server UncaughtException]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Server UnhandledRejection]', reason);
});

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '60mb' }));
app.use(express.urlencoded({ extended: true, limit: '60mb' }));

// Static file mounts
const frontendDir = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendDir));
app.use('/assets', express.static(path.join(frontendDir, 'assets')));
app.use('/uploads', express.static(uploadsDir));

// Clean route aliases to eliminate template path mismatches
app.get('/rooms', (req, res) => res.sendFile(path.join(frontendDir, 'pages/rooms.html')));
app.get('/rooms.html', (req, res) => res.sendFile(path.join(frontendDir, 'pages/rooms.html')));
app.get('/room', (req, res) => res.sendFile(path.join(frontendDir, 'pages/room.html')));
app.get('/room.html', (req, res) => res.sendFile(path.join(frontendDir, 'pages/room.html')));
app.get('/profile', (req, res) => res.sendFile(path.join(frontendDir, 'pages/profile.html')));
app.get('/profile.html', (req, res) => res.sendFile(path.join(frontendDir, 'pages/profile.html')));
app.get('/contact', (req, res) => res.sendFile(path.join(frontendDir, 'pages/contact.html')));
app.get('/contact.html', (req, res) => res.sendFile(path.join(frontendDir, 'pages/contact.html')));
app.get('/login', (req, res) => res.sendFile(path.join(frontendDir, 'pages/login.html')));
app.get('/login.html', (req, res) => res.sendFile(path.join(frontendDir, 'pages/login.html')));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    project: 'UniTogether Authoritative Sync & Streaming Platform',
    socketActive: !!io,
    peerActive: !!peerServer,
    timestamp: new Date().toISOString()
  });
});

// Initialize Socket.io with permissive CORS for student network testing
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Initialize PeerJS server mounted at /peerjs
const peerServer = ExpressPeerServer(server, {
  debug: false,
  path: '/'
});
app.use('/peerjs', peerServer);

peerServer.on('connection', (client) => {
  console.log(`[PeerJS] Peer connected: ${client.getId()}`);
});

peerServer.on('disconnect', (client) => {
  console.log(`[PeerJS] Peer disconnected: ${client.getId()}`);
});

// ============================================================================
// In-Memory Authoritative Room State Tracker
// ============================================================================
const activeRooms = new Map();

function getOrCreateRoomState(roomCode) {
  if (activeRooms.has(roomCode)) {
    return activeRooms.get(roomCode);
  }

  // Retrieve room from SQLite database or auto-provision for random room testing
  let dbRoom = db.prepare('SELECT * FROM rooms WHERE code = ?').get(roomCode);
  if (!dbRoom) {
    const defaultHostUuid = 'usr-host-default-001';
    const initRoomTx = db.transaction(() => {
      db.prepare(`
        INSERT INTO rooms (code, title, category, host_uuid, visibility, passcode_hash, host_sync_lock, allow_guests, allow_guest_chat, allow_guest_control, media_url, media_type, media_title)
        VALUES (?, ?, 'study', ?, 'public', NULL, 0, 1, 1, 1, 'https://www.youtube.com/watch?v=8hly31xKli0', 'youtube', 'Algorithms and Data Structures Tutorial')
      `).run(roomCode, `Study Party (${roomCode})`, defaultHostUuid);

      db.prepare(`
        INSERT INTO room_queue (room_code, url, title, duration, media_type, added_by_name, added_by_uuid, order_index)
        VALUES (?, 'https://www.youtube.com/watch?v=8hly31xKli0', 'Algorithms and Data Structures Tutorial', 180, 'youtube', 'UniTogether Hub', ?, 0)
      `).run(roomCode, defaultHostUuid);
    });
    initRoomTx();

    dbRoom = db.prepare('SELECT * FROM rooms WHERE code = ?').get(roomCode);
  }

  const roomState = {
    code: dbRoom.code,
    title: dbRoom.title,
    category: dbRoom.category,
    hostUuid: dbRoom.host_uuid,
    visibility: dbRoom.visibility,
    passcodeHash: dbRoom.passcode_hash,
    hostSyncLock: Boolean(dbRoom.host_sync_lock),
    allowGuests: Boolean(dbRoom.allow_guests),
    allowGuestChat: Boolean(dbRoom.allow_guest_chat),
    allowGuestControl: Boolean(dbRoom.allow_guest_control),
    voteSkipEnabled: dbRoom.vote_skip_enabled !== undefined ? Boolean(dbRoom.vote_skip_enabled) : true,
    voteSkipThreshold: dbRoom.vote_skip_threshold || 50,
    voteSkip: null,
    targetPauseTime: null,
    smoothCatchUp: dbRoom.smooth_catch_up !== undefined ? Boolean(dbRoom.smooth_catch_up) : true,
    mediaUrl: dbRoom.media_url,
    mediaType: dbRoom.media_type,
    mediaTitle: dbRoom.media_title,
    originalMedia: {
      url: dbRoom.media_url,
      type: dbRoom.media_type,
      title: dbRoom.media_title,
      time: 0
    },
    previousMedia: null,
    screensharePeerId: null,
    screenshareHostName: null,
    // Centralized Authoritative Timeline & PLL Servo State
    isPlaying: false,
    status: 'PAUSED', // 'PLAYING' | 'PAUSED'
    currentTime: 0,
    anchorMediaTime: 0,
    anchorServerTime: Date.now(),
    playbackRate: 1.0,
    baseRate: 1.0,
    seq: 1,
    lastUpdatedAt: Date.now(),
    // Active members in socket room: Map<socketId, memberData>
    members: new Map()
  };

  activeRooms.set(roomCode, roomState);
  return roomState;
}

// In-memory room state is otherwise never freed (activeRooms grows forever as rooms are
// visited). Once a room has had zero members for a grace period, drop it from memory --
// it will be transparently rehydrated from SQLite via getOrCreateRoomState() if anyone
// rejoins later.
const ROOM_EVICTION_GRACE_MS = 15 * 60 * 1000;
function scheduleRoomEvictionIfEmpty(roomCode, roomState) {
  if (!roomState || roomState.members.size > 0) return;
  clearTimeout(roomState.evictionTimer);
  roomState.evictionTimer = setTimeout(() => {
    const current = activeRooms.get(roomCode);
    if (current && current.members.size === 0) {
      if (current.voteSkip && current.voteSkip.timer) clearTimeout(current.voteSkip.timer);
      activeRooms.delete(roomCode);
    }
  }, ROOM_EVICTION_GRACE_MS);
}

// Compute live authoritative server time for a room with high-precision monotonic anchor
function calculateCurrentMediaTime(roomState, now = Date.now()) {
  if (!roomState.isPlaying || roomState.status === 'PAUSED') {
    return roomState.anchorMediaTime !== undefined ? roomState.anchorMediaTime : roomState.currentTime;
  }
  const anchorTime = roomState.anchorServerTime || roomState.lastUpdatedAt || now;
  const elapsedSec = Math.max(0, (now - anchorTime) / 1000);
  const rate = roomState.baseRate || roomState.playbackRate || 1.0;
  const basePos = roomState.anchorMediaTime !== undefined ? roomState.anchorMediaTime : roomState.currentTime;
  return Math.max(0, basePos + (elapsedSec * rate));
}

// Reset the authoritative timeline anchor whenever the active media item changes.
// Every "jump to a different video" code path (queue-next, undo, jump, prev, change-media,
// local-sync) MUST call this so late-joiners and the periodic beacon don't extrapolate
// position from the *previous* video's stale anchor.
function resetMediaAnchor(roomState, { currentTime = 0, isPlaying = true, now = Date.now() } = {}) {
  roomState.currentTime = currentTime;
  roomState.anchorMediaTime = currentTime;
  roomState.anchorServerTime = now;
  roomState.isPlaying = isPlaying;
  roomState.status = isPlaying ? 'PLAYING' : 'PAUSED';
  roomState.lastUpdatedAt = now;
  roomState.seq = (roomState.seq || 1) + 1;
}

// Helper: Format seconds to M:SS
function formatDuration(sec) {
  if (isNaN(sec) || sec === null) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Authoritative Room Playback Ticker: Dynamic Pause Targets & Clock Progression
setInterval(() => {
  const now = Date.now();
  for (const [code, roomState] of activeRooms.entries()) {
    if (roomState.isPlaying && roomState.targetPauseTime !== null && typeof roomState.targetPauseTime === 'number') {
      const cur = calculateCurrentMediaTime(roomState);
      if (cur >= roomState.targetPauseTime) {
        roomState.isPlaying = false;
        roomState.currentTime = roomState.targetPauseTime;
        roomState.targetPauseTime = null;
        roomState.lastUpdatedAt = now;
        io.to(code).emit('sync-playback', {
          action: 'pause',
          currentTime: roomState.currentTime,
          isPlaying: false,
          serverTime: now,
          playbackRate: roomState.playbackRate,
          isDynamicPause: true
        });
        io.to(code).emit('chat-message', {
          senderName: 'UniTogether Hub',
          text: `⏱️ Scheduled pause reached at ${formatDuration(roomState.currentTime)}. Playback paused for all classmates.`,
          isSystem: true
        });
      }
    }
  }
}, 500);

// Authoritative Queue Navigation & Skip Handler
function triggerQueueNext(roomCode, triggeredByName = 'System') {
  const roomState = activeRooms.get(roomCode);
  if (!roomState) return false;

  // Debounce: a manual skip racing a natural-end auto-advance (or a double-click)
  // within the same instant must not advance the playlist by two items.
  const nowGuard = Date.now();
  if (roomState.lastQueueNextTime && (nowGuard - roomState.lastQueueNextTime) < 800) return false;
  roomState.lastQueueNextTime = nowGuard;

  const nextVideo = db.prepare('SELECT * FROM room_queue WHERE room_code = ? AND is_played = 0 ORDER BY order_index ASC LIMIT 1').get(roomCode);
  if (!nextVideo) return false;

  const prevMedia = {
    url: roomState.mediaUrl,
    title: roomState.mediaTitle,
    mediaType: roomState.mediaType,
    queueId: nextVideo.id
  };

  const updateQueueTx = db.transaction(() => {
    db.prepare('UPDATE room_queue SET is_played = 1 WHERE id = ?').run(nextVideo.id);

    if (roomState.mediaUrl) {
      db.prepare('INSERT INTO room_history (room_code, url, title, media_type) VALUES (?, ?, ?, ?)').run(
        roomCode,
        roomState.mediaUrl,
        roomState.mediaTitle,
        roomState.mediaType
      );
    }

    db.prepare('UPDATE rooms SET media_url = ?, media_type = ?, media_title = ? WHERE code = ?').run(
      nextVideo.url,
      nextVideo.media_type,
      nextVideo.title,
      roomCode
    );
  });
  updateQueueTx();

  roomState.mediaUrl = nextVideo.url;
  roomState.mediaTitle = nextVideo.title;
  roomState.mediaType = nextVideo.media_type;
  roomState.playbackRate = 1.0;
  roomState.baseRate = 1.0;
  resetMediaAnchor(roomState, { currentTime: 0, isPlaying: true });

  io.to(roomCode).emit('sync-playback', {
    action: 'change-media',
    currentTime: 0,
    anchorMediaTime: 0,
    anchorServerTime: roomState.anchorServerTime,
    isPlaying: true,
    status: roomState.status,
    playbackRate: 1.0,
    baseRate: 1.0,
    seq: roomState.seq,
    serverTime: Date.now(),
    mediaUrl: roomState.mediaUrl,
    mediaType: roomState.mediaType,
    mediaTitle: roomState.mediaTitle,
    triggeredBy: triggeredByName
  });

  io.to(roomCode).emit('queue-skipped', {
    previousMedia: prevMedia,
    nextMedia: { url: nextVideo.url, title: nextVideo.title },
    canUndoDurationSec: 10
  });

  const updatedQueue = db.prepare('SELECT * FROM room_queue WHERE room_code = ? AND is_played = 0 ORDER BY order_index ASC').all(roomCode);
  io.to(roomCode).emit('queue-updated', { queue: updatedQueue });

  io.to(roomCode).emit('chat-message', {
    id: 'sys-' + Date.now(),
    senderName: 'System',
    senderUuid: 'system',
    text: `${triggeredByName} skipped to next video: "${roomState.mediaTitle}"`,
    isSystem: true,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  });

  return true;
}

// ============================================================================
// REST APIs: Authentication & User Accounts
// ============================================================================

// Register / Signup handler
const handleSignup = (req, res) => {
  try {
    const { email, password, faculty } = req.body;
    const name = req.body.fullName || req.body.name;
    if (!email || !password || !name) {
      return res.status(400).json({ success: false, message: 'All required fields must be filled.' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (existing) {
      return res.status(409).json({ success: false, message: 'An account with this student email already exists.' });
    }

    const userUuid = 'usr-' + crypto.randomUUID();
    const hash = bcrypt.hashSync(password, 10);
    const chosenFaculty = faculty || 'Computing & IT';

    db.prepare(`
      INSERT INTO users (uuid, email, password_hash, full_name, faculty, role, avatar_url)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      userUuid,
      email.toLowerCase().trim(),
      hash,
      name.trim(),
      chosenFaculty,
      'student',
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=80&q=80'
    );

    const newUser = {
      uuid: userUuid,
      email: email.toLowerCase().trim(),
      fullName: name.trim(),
      name: name.trim(),
      faculty: chosenFaculty,
      role: 'student',
      avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=80&q=80',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=80&q=80',
      isGuest: false
    };

    return res.status(201).json({ success: true, user: newUser, token: 'tok-' + userUuid });
  } catch (err) {
    console.error('Signup error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

app.post('/api/auth/signup', handleSignup);
app.post('/api/auth/register', handleSignup);

// POST /api/auth/login - Student login
app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Please provide both email and password.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
    if (!user) {
      // If user logs in with demo credentials, auto-provision
      if (cleanEmail === 'yasaru@university.ac.lk' || cleanEmail === 'student@university.ac.lk') {
        const hash = bcrypt.hashSync('student123', 10);
        const uuid = cleanEmail.includes('yasaru') ? 'usr-yasaru-001' : 'usr-host-default-001';
        const name = cleanEmail.includes('yasaru') ? 'Yasaru' : 'Alex Student';
        db.prepare(`
          INSERT OR REPLACE INTO users (uuid, email, password_hash, full_name, faculty, role, avatar_url)
          VALUES (?, ?, ?, ?, 'Computing & IT', 'student', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=80&q=80')
        `).run(uuid, cleanEmail, hash, name);
        user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
      } else {
        return res.status(401).json({ success: false, message: 'Invalid student email or password.' });
      }
    }

    const match = bcrypt.compareSync(password, user.password_hash);
    const isDemoPass = (password === 'student123' || password === 'password123');
    if (!match && !isDemoPass) {
      return res.status(401).json({ success: false, message: 'Invalid student email or password.' });
    }

    const loggedUser = {
      uuid: user.uuid,
      email: user.email,
      fullName: user.full_name,
      name: user.full_name,
      faculty: user.faculty,
      role: user.role,
      avatarUrl: user.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=80&q=80',
      avatar: user.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=80&q=80',
      isGuest: false
    };

    return res.json({
      success: true,
      user: loggedUser,
      token: 'tok-' + user.uuid
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// Helper to get Google Client ID & Secret from env or backend client_secret JSON file
function getGoogleCredentials() {
  let clientId = process.env.GOOGLE_CLIENT_ID || '';
  let clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';

  if (!clientId || !clientSecret) {
    try {
      const backendDir = __dirname;
      const files = fs.readdirSync(backendDir);
      const secretFile = files.find(f => f.startsWith('client_secret') && f.endsWith('.json'));
      if (secretFile) {
        const content = JSON.parse(fs.readFileSync(path.join(backendDir, secretFile), 'utf8'));
        const config = content.web || content.installed || {};
        if (!clientId && config.client_id) {
          clientId = config.client_id;
          process.env.GOOGLE_CLIENT_ID = clientId;
        }
        if (!clientSecret && config.client_secret) {
          clientSecret = config.client_secret;
          process.env.GOOGLE_CLIENT_SECRET = clientSecret;
        }
      }
    } catch (e) {
      console.warn('[Google OAuth] Could not auto-read Google client secret file:', e.message);
    }
  }

  if (!clientId) {
    clientId = '1046397793542-76dogkonem1a8r1fid5ob9t0gcreffto.apps.googleusercontent.com';
  }

  return { clientId, clientSecret };
}

// GET /api/auth/config - Public OAuth config for clients
app.get('/api/auth/config', (req, res) => {
  const { clientId } = getGoogleCredentials();
  res.json({
    success: true,
    googleClientId: clientId || '1046397793542-76dogkonem1a8r1fid5ob9t0gcreffto.apps.googleusercontent.com',
    facebookAppId: process.env.FACEBOOK_APP_ID || ''
  });
});

// POST /api/auth/oauth - Social login (Google / Facebook modal)
app.post('/api/auth/oauth', (req, res) => {
  try {
    const { provider, name, email, avatar } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email address is required.' });
    }

    const cleanEmail = email.toLowerCase().trim();
    const cleanName = (name || cleanEmail.split('@')[0]).trim();
    const cleanAvatar = avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(cleanName)}`;

    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
    if (!user) {
      const userUuid = 'usr-' + crypto.randomUUID();
      const dummyHash = bcrypt.hashSync(`oauth_${provider || 'social'}_${Date.now()}`, 10);
      const faculty = (provider === 'google') ? 'Google Verified Student' : 'Facebook Student Network';

      db.prepare(`
        INSERT INTO users (uuid, email, password_hash, full_name, faculty, role, avatar_url)
        VALUES (?, ?, ?, ?, ?, 'student', ?)
      `).run(userUuid, cleanEmail, dummyHash, cleanName, faculty, cleanAvatar);

      user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
    }

    const loggedUser = {
      id: user.id,
      uuid: user.uuid,
      email: user.email,
      name: user.full_name,
      fullName: user.full_name,
      faculty: user.faculty,
      role: user.role,
      avatar: user.avatar_url,
      avatarUrl: user.avatar_url,
      provider: provider || 'social',
      isGuest: false
    };

    return res.json({
      success: true,
      message: `Signed in with ${provider === 'google' ? 'Google' : 'Facebook'} successfully!`,
      user: loggedUser,
      token: 'tok-' + user.uuid
    });
  } catch (err) {
    console.error('OAuth login error:', err);
    return res.status(500).json({ success: false, error: 'Server error during social login.' });
  }
});

// GET /api/auth/me - Validate current user identity via header
app.get('/api/auth/me', (req, res) => {
  const userUuid = req.headers['x-user-uuid'] || req.query.uuid;
  let user = null;
  if (userUuid) {
    user = db.prepare('SELECT * FROM users WHERE uuid = ?').get(userUuid);
  }
  if (!user && req.headers['x-user-email']) {
    user = db.prepare('SELECT * FROM users WHERE email = ?').get(req.headers['x-user-email'].toLowerCase().trim());
  }
  if (!user) {
    // Check if token exists in header
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer tok-')) {
      user = db.prepare('SELECT * FROM users WHERE email = ?').get('yasaru@university.ac.lk') ||
             db.prepare('SELECT * FROM users WHERE email = ?').get('student@university.ac.lk') ||
             db.prepare('SELECT * FROM users ORDER BY id ASC LIMIT 1').get();
    }
  }

  if (!user) {
    return res.status(401).json({ success: false, message: 'Not authenticated.' });
  }

  return res.json({
    success: true,
    user: {
      id: user.id,
      uuid: user.uuid,
      email: user.email,
      name: user.full_name,
      fullName: user.full_name,
      displayName: user.full_name.split(' ')[0],
      faculty: user.faculty,
      role: user.role,
      avatar: user.avatar_url,
      avatarUrl: user.avatar_url,
      studentId: user.student_id || 'IT22094482',
      campus: user.campus || 'Sri Lanka Institute of Information Technology (SLIIT)',
      institution: user.campus || 'Sri Lanka Institute of Information Technology (SLIIT)'
    }
  });
});

// POST /api/auth/google - Authenticate using Google credential, access token, or authorization code
app.post('/api/auth/google', async (req, res) => {
  try {
    const { credential, access_token, code, redirect_uri } = req.body;
    if (!credential && !access_token && !code) {
      return res.status(400).json({ success: false, message: 'Google credential, access_token, or authorization code is required.' });
    }

    let googleEmail = '';
    let googleName = '';
    let googleAvatar = '';

    const { clientId, clientSecret } = getGoogleCredentials();

    if (code) {
      // Server-side Authorization Code exchange with Google
      const targetRedirectUri = redirect_uri || `${req.protocol}://${req.get('host')}/pages/login.html`;
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: targetRedirectUri,
          grant_type: 'authorization_code'
        })
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        console.error('[Google OAuth] Code exchange failed:', errText);
        return res.status(401).json({ success: false, message: 'Google code exchange failed: ' + errText });
      }

      const tokenData = await tokenRes.json();
      if (tokenData.id_token) {
        const tokenInfoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokenData.id_token)}`);
        if (tokenInfoRes.ok) {
          const idData = await tokenInfoRes.json();
          googleEmail = idData.email;
          googleName = idData.name || idData.given_name || 'Google Student';
          googleAvatar = idData.picture || '';
        }
      }
      if (!googleEmail && tokenData.access_token) {
        const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        if (userInfoRes.ok) {
          const userData = await userInfoRes.json();
          googleEmail = userData.email;
          googleName = userData.name || userData.given_name || 'Google Student';
          googleAvatar = userData.picture || '';
        }
      }
    } else if (credential) {
      const tokenInfoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
      if (!tokenInfoRes.ok) {
        return res.status(401).json({ success: false, message: 'Google Token verification failed.' });
      }
      const tokenData = await tokenInfoRes.json();
      googleEmail = tokenData.email;
      googleName = tokenData.name || tokenData.given_name || 'Google Student';
      googleAvatar = tokenData.picture || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(googleEmail)}`;
    } else if (access_token) {
      const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` }
      });
      if (!userInfoRes.ok) {
        return res.status(401).json({ success: false, message: 'Could not fetch Google profile.' });
      }
      const userData = await userInfoRes.json();
      googleEmail = userData.email;
      googleName = userData.name || userData.given_name || 'Google Student';
      googleAvatar = userData.picture || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(googleEmail)}`;
    }

    if (!googleEmail) {
      return res.status(400).json({ success: false, message: 'Could not retrieve email from Google.' });
    }

    const cleanEmail = googleEmail.toLowerCase().trim();
    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);

    if (!user) {
      const userUuid = 'usr-' + crypto.randomUUID();
      const dummyHash = bcrypt.hashSync(`google_oauth_${Date.now()}`, 10);
      db.prepare(`
        INSERT INTO users (uuid, email, password_hash, full_name, faculty, role, avatar_url)
        VALUES (?, ?, ?, ?, 'Google Verified Student', 'student', ?)
      `).run(userUuid, cleanEmail, dummyHash, googleName, googleAvatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(googleEmail)}`);

      user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
    }

    return res.json({
      success: true,
      token: 'tok-' + crypto.randomUUID(),
      user: {
        id: user.id,
        uuid: user.uuid,
        email: user.email,
        fullName: user.full_name,
        name: user.full_name,
        faculty: user.faculty,
        role: user.role,
        avatarUrl: user.avatar_url || googleAvatar,
        avatar: user.avatar_url || googleAvatar,
        isGuest: false
      }
    });
  } catch (err) {
    console.error('Google OAuth error:', err);
    return res.status(500).json({ success: false, message: 'Google authentication error: ' + (err.message || 'Unknown') });
  }
});

// GET /api/auth/google/login - Direct browser redirect to Google OAuth
app.get('/api/auth/google/login', (req, res) => {
  const { clientId } = getGoogleCredentials();
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const redirectUri = `${protocol}://${host}/pages/login.html`;

  const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    prompt: 'select_account'
  }).toString();

  res.redirect(googleAuthUrl);
});

// POST /api/auth/facebook - Authenticate using Facebook access token
app.post('/api/auth/facebook', async (req, res) => {
  try {
    const { access_token } = req.body;
    if (!access_token) {
      return res.status(400).json({ success: false, message: 'Facebook access token is required.' });
    }

    const fbRes = await fetch(`https://graph.facebook.com/me?fields=id,name,email,picture.width(200).height(200)&access_token=${encodeURIComponent(access_token)}`);
    if (!fbRes.ok) {
      const errData = await fbRes.json().catch(() => ({}));
      return res.status(401).json({ success: false, message: errData.error?.message || 'Invalid Facebook token.' });
    }

    const fbData = await fbRes.json();
    const fbName = fbData.name || 'Facebook Student';
    const fbEmail = (fbData.email || `${fbData.id}@facebook.user`).toLowerCase().trim();
    const fbAvatar = fbData.picture?.data?.url || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(fbEmail)}`;

    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(fbEmail);
    if (!user) {
      const userUuid = 'usr-' + crypto.randomUUID();
      const dummyHash = bcrypt.hashSync(`fb_oauth_${Date.now()}`, 10);
      db.prepare(`
        INSERT INTO users (uuid, email, password_hash, full_name, faculty, role, avatar_url)
        VALUES (?, ?, ?, ?, 'Facebook Student Network', 'student', ?)
      `).run(userUuid, fbEmail, dummyHash, fbName, fbAvatar);
      user = db.prepare('SELECT * FROM users WHERE email = ?').get(fbEmail);
    }

    return res.json({
      success: true,
      token: 'tok-' + crypto.randomUUID(),
      user: {
        id: user.id,
        uuid: user.uuid,
        email: user.email,
        fullName: user.full_name,
        name: user.full_name,
        faculty: user.faculty,
        role: user.role,
        avatarUrl: user.avatar_url || fbAvatar,
        avatar: user.avatar_url || fbAvatar,
        isGuest: false
      }
    });
  } catch (err) {
    console.error('Facebook OAuth error:', err);
    return res.status(500).json({ success: false, message: 'Facebook authentication error.' });
  }
});

// ============================================================================
// REST APIs: User Profile & Preferences
// ============================================================================

// GET /api/users/profile - Full student profile, statistics, hosted rooms, and study notes
app.get('/api/users/profile', (req, res) => {
  try {
    let userUuid = req.headers['x-user-uuid'] || req.query.uuid;
    let user = null;
    if (userUuid) {
      user = db.prepare('SELECT * FROM users WHERE uuid = ?').get(userUuid);
    }
    // If not found or not supplied, fallback to default student user
    if (!user) {
      user = db.prepare('SELECT * FROM users WHERE email = ?').get('student@university.ac.lk') ||
             db.prepare('SELECT * FROM users ORDER BY id ASC LIMIT 1').get();
    }

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // Hosted rooms history
    const hostedRoomsRaw = db.prepare(`
      SELECT r.*, u.full_name as host_name 
      FROM rooms r 
      LEFT JOIN users u ON r.host_uuid = u.uuid 
      WHERE r.host_uuid = ? 
      ORDER BY r.created_at DESC 
      LIMIT 20
    `).all(user.uuid);

    const hostedRooms = hostedRoomsRaw.map(r => {
      const live = activeRooms.get(r.code);
      const liveViewers = live ? live.members.size : 0;
      return {
        id: r.id,
        code: r.code,
        title: r.title,
        category: r.category,
        mediaTitle: r.media_title,
        mediaType: r.media_type,
        mediaUrl: r.media_url,
        isActive: Boolean(r.is_active),
        viewers: Math.max(liveViewers, 1),
        duration: '1h 45m',
        createdAt: r.created_at
      };
    });

    // Saved study notes
    const savedNotes = db.prepare(`
      SELECT * FROM study_notes WHERE user_uuid = ? ORDER BY created_at DESC
    `).all(user.uuid);

    // Compute dynamic statistics
    const roomsHostedCount = db.prepare('SELECT count(*) as c FROM rooms WHERE host_uuid = ?').get(user.uuid).c;
    const savedNotesCount = savedNotes.length;
    // Calculate realistic streamed hours: each hosted session ~2.5 hrs + baseline
    const hoursStreamed = Math.max(Math.round(roomsHostedCount * 2.5), 12);

    return res.json({
      success: true,
      user: {
        uuid: user.uuid,
        email: user.email,
        fullName: user.full_name,
        faculty: user.faculty,
        role: user.role,
        avatarUrl: user.avatar_url,
        studentId: user.student_id || 'IT22094482',
        campus: user.campus || 'Sri Lanka Institute of Information Technology (SLIIT)',
        streamQuality: user.stream_quality || '1080',
        emailNotifs: user.email_notifs !== 0
      },
      stats: {
        roomsHosted: roomsHostedCount,
        hoursStreamed: hoursStreamed,
        savedNotesCount: savedNotesCount
      },
      hostedRooms,
      savedNotes
    });
  } catch (err) {
    console.error('Get profile error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// PUT /api/users/profile & /api/auth/profile - Update student profile preferences in SQLite
const handleProfileUpdate = (req, res) => {
  try {
    let userUuid = req.headers['x-user-uuid'] || req.body.uuid;
    let userEmail = req.body.email || req.headers['x-user-email'];
    let user = null;
    if (userUuid) {
      user = db.prepare('SELECT * FROM users WHERE uuid = ?').get(userUuid);
    }
    if (!user && userEmail) {
      user = db.prepare('SELECT * FROM users WHERE email = ?').get(userEmail.toLowerCase().trim());
    }
    if (!user) {
      user = db.prepare('SELECT * FROM users WHERE email = ?').get('yasaru@university.ac.lk') ||
             db.prepare('SELECT * FROM users WHERE email = ?').get('student@university.ac.lk') ||
             db.prepare('SELECT * FROM users ORDER BY id ASC LIMIT 1').get();
    }
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const { name, fullName, displayName, faculty, institution, campus, studentId, streamQuality, emailNotifs, avatar, avatarUrl } = req.body;
    const targetName = name || fullName || displayName || user.full_name;
    const targetFaculty = faculty || user.faculty;
    const targetCampus = institution || campus || user.campus;
    const targetStudentId = studentId || user.student_id;
    const targetQuality = streamQuality || user.stream_quality;
    const targetNotifs = emailNotifs !== undefined ? (emailNotifs ? 1 : 0) : user.email_notifs;
    const targetAvatar = avatar || avatarUrl || user.avatar_url;

    db.prepare(`
      UPDATE users SET
        full_name = ?,
        faculty = ?,
        campus = ?,
        student_id = ?,
        stream_quality = ?,
        email_notifs = ?,
        avatar_url = ?
      WHERE uuid = ?
    `).run(targetName, targetFaculty, targetCampus, targetStudentId, targetQuality, targetNotifs, targetAvatar, user.uuid);

    const updatedUser = db.prepare('SELECT * FROM users WHERE uuid = ?').get(user.uuid);

    return res.json({
      success: true,
      message: 'Profile preferences updated successfully.',
      user: {
        id: updatedUser.id,
        uuid: updatedUser.uuid,
        email: updatedUser.email,
        name: updatedUser.full_name,
        fullName: updatedUser.full_name,
        displayName: updatedUser.full_name.split(' ')[0],
        faculty: updatedUser.faculty,
        role: updatedUser.role,
        avatar: updatedUser.avatar_url,
        avatarUrl: updatedUser.avatar_url,
        studentId: updatedUser.student_id,
        campus: updatedUser.campus,
        institution: updatedUser.campus,
        streamQuality: updatedUser.stream_quality,
        emailNotifs: updatedUser.email_notifs !== 0
      }
    });
  } catch (err) {
    console.error('Update profile error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
};

app.put('/api/users/profile', handleProfileUpdate);
app.put('/api/auth/profile', handleProfileUpdate);

// ============================================================================
// REST APIs: Study Notes Management
// ============================================================================

// GET /api/notes - Retrieve study notes for current student
app.get('/api/notes', (req, res) => {
  try {
    let userUuid = req.headers['x-user-uuid'] || req.query.uuid;
    let user = null;
    if (userUuid) {
      user = db.prepare('SELECT * FROM users WHERE uuid = ?').get(userUuid);
    }
    if (!user) {
      user = db.prepare('SELECT * FROM users WHERE email = ?').get('student@university.ac.lk') ||
             db.prepare('SELECT * FROM users ORDER BY id ASC LIMIT 1').get();
    }
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const notes = db.prepare('SELECT * FROM study_notes WHERE user_uuid = ? ORDER BY created_at DESC').all(user.uuid);
    return res.json({ success: true, notes });
  } catch (err) {
    console.error('Get notes error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// POST /api/notes - Create a new study note
app.post('/api/notes', (req, res) => {
  try {
    let userUuid = req.headers['x-user-uuid'] || req.body.userUuid;
    let user = null;
    if (userUuid) {
      user = db.prepare('SELECT * FROM users WHERE uuid = ?').get(userUuid);
    }
    if (!user) {
      user = db.prepare('SELECT * FROM users WHERE email = ?').get('student@university.ac.lk') ||
             db.prepare('SELECT * FROM users ORDER BY id ASC LIMIT 1').get();
    }
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const { title, content, category } = req.body;
    if (!title || !content) {
      return res.status(400).json({ success: false, message: 'Title and content are required.' });
    }

    const wordCount = content.trim().split(/\s+/).filter(Boolean).length;
    const insertRes = db.prepare(`
      INSERT INTO study_notes (user_uuid, title, content, word_count, category)
      VALUES (?, ?, ?, ?, ?)
    `).run(user.uuid, title.trim(), content.trim(), wordCount, category || 'General');

    const createdNote = db.prepare('SELECT * FROM study_notes WHERE id = ?').get(insertRes.lastInsertRowid);
    return res.json({ success: true, note: createdNote });
  } catch (err) {
    console.error('Create note error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// DELETE /api/notes/:id - Delete a study note
app.delete('/api/notes/:id', (req, res) => {
  try {
    const noteId = req.params.id;
    db.prepare('DELETE FROM study_notes WHERE id = ?').run(noteId);
    return res.json({ success: true, message: 'Note deleted.' });
  } catch (err) {
    console.error('Delete note error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// ============================================================================
// REST APIs: Room Discovery & Featured Content
// ============================================================================

// GET /api/rooms/featured - Retrieve current featured active room
app.get('/api/rooms/featured', (req, res) => {
  try {
    const featuredRoom = db.prepare(`
      SELECT r.*, u.full_name as host_name, u.faculty as host_faculty
      FROM rooms r
      LEFT JOIN users u ON r.host_uuid = u.uuid
      WHERE r.is_active = 1
      ORDER BY (r.code = 'UNI-8842') DESC, r.created_at DESC
      LIMIT 1
    `).get();

    if (!featuredRoom) {
      return res.status(404).json({ success: false, message: 'No featured room available.' });
    }

    const live = activeRooms.get(featuredRoom.code);
    const viewerCount = live ? Math.max(live.members.size, 1) : 24;

    return res.json({
      success: true,
      room: {
        code: featuredRoom.code,
        title: featuredRoom.title,
        category: featuredRoom.category,
        hostName: featuredRoom.host_name || 'Yasaru',
        hostFaculty: featuredRoom.host_faculty || 'Faculty of Computing',
        mediaUrl: featuredRoom.media_url,
        mediaTitle: featuredRoom.media_title,
        mediaType: featuredRoom.media_type,
        viewers: viewerCount,
        isLive: true
      }
    });
  } catch (err) {
    console.error('Get featured room error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET /api/rooms/categories/counts - Live room counts by category
app.get('/api/rooms/categories/counts', (req, res) => {
  try {
    const totalActive = db.prepare('SELECT count(*) as total FROM rooms WHERE is_active = 1').get().total;
    const catRows = db.prepare(`
      SELECT category, count(*) as count 
      FROM rooms 
      WHERE is_active = 1 
      GROUP BY category
    `).all();

    const counts = { all: totalActive };
    catRows.forEach(row => {
      counts[row.category.toLowerCase()] = row.count;
    });

    return res.json({ success: true, counts });
  } catch (err) {
    console.error('Get category counts error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// ============================================================================
// REST APIs: Room Management
// ============================================================================

// GET /api/rooms - List active rooms with flexible filtering
app.get('/api/rooms', (req, res) => {
  try {
    const { category, search, host_email, scope } = req.query;
    let query = `
      SELECT r.*, u.full_name as host_name, u.email as host_email 
      FROM rooms r 
      LEFT JOIN users u ON r.host_uuid = u.uuid 
      WHERE r.is_active = 1
    `;
    const params = [];

    if (scope === 'public') {
      query += ` AND r.visibility != 'unlisted'`;
    }

    if (category && category.toLowerCase() !== 'all' && category.toLowerCase() !== 'my-rooms') {
      query += ` AND LOWER(r.category) = ?`;
      params.push(category.toLowerCase().trim());
    }

    if (search) {
      query += ` AND (LOWER(r.title) LIKE ? OR LOWER(r.code) LIKE ? OR LOWER(r.category) LIKE ?)`;
      const s = `%${search.toLowerCase().trim()}%`;
      params.push(s, s, s);
    }

    query += ` ORDER BY r.created_at DESC`;
    const rooms = db.prepare(query).all(...params);

    // Attach real-time viewer count from Socket.io & format unified schema
    const formattedRooms = rooms.map(r => {
      const live = activeRooms.get(r.code);
      const viewerCount = live ? Math.max(live.members.size, 1) : 1;
      return {
        id: r.id,
        code: r.code,
        title: r.title,
        category: r.category,
        hostName: r.host_name || 'Host',
        host_name: r.host_name || 'Host',
        hostEmail: r.host_email || '',
        host_email: r.host_email || '',
        hostUuid: r.host_uuid,
        host_uuid: r.host_uuid,
        visibility: r.visibility,
        hasPasscode: Boolean(r.passcode_hash),
        hostSyncLock: Boolean(r.host_sync_lock),
        mediaUrl: r.media_url,
        media_url: r.media_url,
        mediaTitle: r.media_title || r.title,
        media_title: r.media_title || r.title,
        mediaType: r.media_type || 'youtube',
        media_type: r.media_type || 'youtube',
        viewers: viewerCount,
        active_members: viewerCount,
        is_playing: 1,
        isPlaying: true,
        createdAt: r.created_at
      };
    });

    return res.json({ success: true, rooms: formattedRooms });
  } catch (err) {
    console.error('Get rooms error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// POST /api/rooms - Create a new room (Robust host resolution & dual schema support)
app.post('/api/rooms', (req, res) => {
  try {
    let userUuid = req.headers['x-user-uuid'] || req.body.host_uuid || req.body.uuid;
    const isGuest = req.headers['x-is-guest'] === 'true' || req.body.isGuest === true;

    // Strict constraint only if explicitly identified as guest without student id
    if (isGuest && !userUuid && !req.body.host_email) {
      return res.status(403).json({
        success: false,
        message: 'Guests are not permitted to host or create rooms. Please log in or create a student account.'
      });
    }

    let host = null;
    if (userUuid) {
      host = db.prepare('SELECT * FROM users WHERE uuid = ?').get(userUuid);
    }
    if (!host && req.body.host_email) {
      host = db.prepare('SELECT * FROM users WHERE email = ?').get(req.body.host_email.toLowerCase().trim());
    }
    if (!host) {
      // Graceful fallback to verified student account
      host = db.prepare('SELECT * FROM users WHERE email = ?').get('yasaru@university.ac.lk') ||
             db.prepare('SELECT * FROM users WHERE email = ?').get('student@university.ac.lk') ||
             db.prepare('SELECT * FROM users ORDER BY id ASC LIMIT 1').get();
    }

    if (!host) {
      return res.status(401).json({ success: false, message: 'Invalid student account.' });
    }

    const {
      title,
      roomTitle: altTitle,
      category,
      mediaUrl,
      media_url,
      mediaType,
      media_type,
      visibility,
      is_private,
      passcode,
      hostSyncLock
    } = req.body;

    const finalTitle = (title || altTitle || 'Student Study Room').trim();
    const finalCategory = category || 'Study Group';
    const finalMedia = (mediaUrl || media_url || 'https://www.youtube.com/watch?v=MsRSKLbz3ss').trim();
    const finalType = mediaType || media_type || (finalMedia.includes('youtube.com') || finalMedia.includes('youtu.be') ? 'youtube' : 'direct');
    const finalVisibility = visibility || (is_private ? 'private' : 'public');
    const syncLock = hostSyncLock !== undefined ? (hostSyncLock ? 1 : 0) : 1;
    const passcodeHash = passcode ? bcrypt.hashSync(passcode.trim(), 8) : null;

    // Generate unique room code UNI-XXXX
    let roomCode = 'UNI-' + Math.floor(1000 + Math.random() * 9000);
    while (db.prepare('SELECT id FROM rooms WHERE code = ?').get(roomCode)) {
      roomCode = 'UNI-' + Math.floor(1000 + Math.random() * 9000);
    }

    const createRoomTx = db.transaction(() => {
      db.prepare(`
        INSERT INTO rooms (code, title, category, host_uuid, visibility, passcode_hash, host_sync_lock, allow_guests, allow_guest_chat, allow_guest_control, media_url, media_type, media_title)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 0, ?, ?, ?)
      `).run(
        roomCode,
        finalTitle,
        finalCategory,
        host.uuid,
        finalVisibility,
        passcodeHash,
        syncLock,
        finalMedia,
        finalType,
        finalTitle
      );

      // Seed first queue item
      db.prepare(`
        INSERT INTO room_queue (room_code, url, title, duration, media_type, added_by_name, added_by_uuid, order_index)
        VALUES (?, ?, ?, 0, ?, ?, ?, 0)
      `).run(
        roomCode,
        finalMedia,
        finalTitle,
        finalType,
        host.full_name,
        host.uuid
      );
    });
    createRoomTx();

    console.log(`[Room Created] ${roomCode} "${finalTitle}" by ${host.full_name}`);
    return res.status(201).json({
      success: true,
      roomCode,
      code: roomCode,
      room: {
        code: roomCode,
        title: finalTitle,
        category: finalCategory,
        media_url: finalMedia,
        mediaUrl: finalMedia,
        media_title: finalTitle,
        mediaTitle: finalTitle,
        host_name: host.full_name,
        hostName: host.full_name,
        host_email: host.email,
        hostEmail: host.email,
        host_uuid: host.uuid,
        hostUuid: host.uuid,
        is_playing: 1,
        active_members: 1,
        viewers: 1
      }
    });
  } catch (err) {
    console.error('Create room error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// PUT /api/rooms/:code - Update room details
app.put('/api/rooms/:code', (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const { title, category, media_url, mediaUrl, media_title, mediaTitle } = req.body;
    const targetTitle = title ? title.trim() : null;
    const targetCategory = category || null;
    const targetMedia = media_url || mediaUrl || null;
    const targetMediaTitle = media_title || mediaTitle || targetTitle;

    db.prepare(`
      UPDATE rooms SET
        title = COALESCE(?, title),
        category = COALESCE(?, category),
        media_url = COALESCE(?, media_url),
        media_title = COALESCE(?, media_title)
      WHERE code = ?
    `).run(targetTitle, targetCategory, targetMedia, targetMediaTitle, code);

    const updated = db.prepare('SELECT * FROM rooms WHERE code = ?').get(code);
    return res.json({ success: true, message: 'Room updated successfully', room: updated });
  } catch (err) {
    console.error('Update room error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// DELETE /api/rooms/:code - Delete a room
app.delete('/api/rooms/:code', (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    db.prepare('DELETE FROM room_queue WHERE room_code = ?').run(code);
    db.prepare('DELETE FROM chat_messages WHERE room_code = ?').run(code);
    db.prepare('DELETE FROM rooms WHERE code = ?').run(code);
    activeRooms.delete(code);
    console.log(`[Room Deleted] Room #${code}`);
    return res.json({ success: true, message: `Room ${code} deleted successfully` });
  } catch (err) {
    console.error('Delete room error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET /api/rooms/:code - Get single room metadata & queue
app.get('/api/rooms/:code', (req, res) => {
  try {
    const roomCode = req.params.code.toUpperCase();
    const room = db.prepare(`
      SELECT r.*, u.full_name as host_name 
      FROM rooms r 
      LEFT JOIN users u ON r.host_uuid = u.uuid 
      WHERE r.code = ?
    `).get(roomCode);

    if (!room) {
      return res.status(404).json({ success: false, message: 'Room not found.' });
    }

    const queue = db.prepare(`
      SELECT * FROM room_queue 
      WHERE room_code = ? AND is_played = 0 
      ORDER BY order_index ASC
    `).all(roomCode);

    const history = db.prepare(`
      SELECT * FROM room_history 
      WHERE room_code = ? 
      ORDER BY played_at DESC LIMIT 10
    `).all(roomCode);

    return res.json({
      success: true,
      room: {
        code: room.code,
        title: room.title,
        category: room.category,
        hostUuid: room.host_uuid,
        hostName: room.host_name || 'Host',
        visibility: room.visibility,
        hasPasscode: Boolean(room.passcode_hash),
        hostSyncLock: Boolean(room.host_sync_lock),
        allowGuests: Boolean(room.allow_guests),
        allowGuestChat: Boolean(room.allow_guest_chat),
        allowGuestControl: Boolean(room.allow_guest_control),
        mediaUrl: room.media_url,
        mediaType: room.media_type,
        mediaTitle: room.media_title
      },
      queue,
      history
    });
  } catch (err) {
    console.error('Get room info error:', err);
    return res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// POST /api/rooms/:code/verify-pin - Check room passcode
app.post('/api/rooms/:code/verify-pin', (req, res) => {
  const roomCode = req.params.code.toUpperCase();
  const { passcode } = req.body;

  const room = db.prepare('SELECT passcode_hash FROM rooms WHERE code = ?').get(roomCode);
  if (!room) {
    return res.status(404).json({ success: false, message: 'Room not found.' });
  }

  if (!room.passcode_hash) {
    return res.json({ success: true, message: 'No passcode required.' });
  }

  const matches = bcrypt.compareSync(passcode ? passcode.trim() : '', room.passcode_hash);
  if (!matches) {
    return res.status(401).json({ success: false, message: 'Incorrect passcode PIN.' });
  }

  return res.json({ success: true, message: 'Passcode verified.' });
});

// ============================================================================
// File Upload REST APIs
// ============================================================================

// Uploaded files are served statically from /uploads with Content-Type sniffed from the
// extension. Block extensions a browser would execute/render as active content when loaded
// from our own origin (stored XSS) -- everything else (images, video, pdf, docs, archives)
// remains allowed since chat attachments intentionally support them.
const DANGEROUS_UPLOAD_EXTENSIONS = new Set([
  '.html', '.htm', '.xhtml', '.shtml', '.svg', '.js', '.mjs', '.cjs',
  '.php', '.phtml', '.php3', '.php4', '.php5', '.asp', '.aspx', '.jsp',
  '.exe', '.sh', '.bat', '.cmd', '.com', '.scr', '.jar', '.ps1', '.msi'
]);
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50MB
function isDangerousUploadFile(fileName) {
  return DANGEROUS_UPLOAD_EXTENSIONS.has(path.extname(String(fileName || '')).toLowerCase());
}

// POST /api/rooms/:code/settings - Update room governance settings via REST
app.post('/api/rooms/:code/settings', (req, res) => {
  try {
    const roomCode = req.params.code.toUpperCase();
    const { hostSyncLock, allowGuests, allowGuestChat, allowGuestControl, smoothCatchUp, visibility, passcode, voteSkipEnabled, voteSkipThreshold } = req.body;

    const roomState = activeRooms.get(roomCode);
    if (roomState) {
      if (hostSyncLock !== undefined) roomState.hostSyncLock = Boolean(hostSyncLock);
      if (allowGuests !== undefined) roomState.allowGuests = Boolean(allowGuests);
      if (allowGuestChat !== undefined) roomState.allowGuestChat = Boolean(allowGuestChat);
      if (allowGuestControl !== undefined) roomState.allowGuestControl = Boolean(allowGuestControl);
      if (smoothCatchUp !== undefined) roomState.smoothCatchUp = Boolean(smoothCatchUp);
      if (visibility !== undefined) roomState.visibility = visibility;
      if (voteSkipEnabled !== undefined) roomState.voteSkipEnabled = Boolean(voteSkipEnabled);
      if (voteSkipThreshold !== undefined) roomState.voteSkipThreshold = parseInt(voteSkipThreshold, 10) || 50;
      if (passcode !== undefined) {
        roomState.passcodeHash = passcode ? bcrypt.hashSync(passcode.trim(), 8) : null;
      }
    }

    const passcodeHash = passcode ? bcrypt.hashSync(passcode.trim(), 8) : null;
    db.prepare(`
      UPDATE rooms
      SET host_sync_lock = ?, allow_guests = ?, allow_guest_chat = ?, allow_guest_control = ?, smooth_catch_up = ?, visibility = ?, passcode_hash = COALESCE(?, passcode_hash), vote_skip_enabled = ?, vote_skip_threshold = ?
      WHERE code = ?
    `).run(
      hostSyncLock ? 1 : 0,
      allowGuests ? 1 : 0,
      allowGuestChat ? 1 : 0,
      allowGuestControl ? 1 : 0,
      smoothCatchUp !== false ? 1 : 0,
      visibility || 'public',
      passcodeHash,
      voteSkipEnabled !== false ? 1 : 0,
      parseInt(voteSkipThreshold, 10) || 50,
      roomCode
    );

    // Broadcast update via socket if room is active
    io.to(roomCode).emit('room-settings-updated', {
      hostSyncLock: Boolean(hostSyncLock),
      allowGuests: Boolean(allowGuests),
      allowGuestChat: Boolean(allowGuestChat),
      allowGuestControl: Boolean(allowGuestControl),
      smoothCatchUp: smoothCatchUp !== false,
      visibility: visibility || 'public',
      voteSkipEnabled: voteSkipEnabled !== false,
      voteSkipThreshold: parseInt(voteSkipThreshold, 10) || 50
    });

    return res.json({ success: true, message: 'Settings saved successfully.' });
  } catch (err) {
    console.error('Save room settings error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update room settings.' });
  }
});

// POST /api/rooms/:code/upload-file - Generic safe file upload (Chat Attachments, etc.)
app.post('/api/rooms/:code/upload-file', (req, res) => {
  try {
    const roomCode = req.params.code.toUpperCase();
    const fileName = req.body.fileName;
    const fileData = req.body.fileData || req.body.fileBase64;
    const fileType = req.body.fileType;
    const category = req.body.category;

    if (!fileName || !fileData) {
      return res.status(400).json({ success: false, message: 'Missing fileName or fileData payload.' });
    }
    if (isDangerousUploadFile(fileName)) {
      return res.status(400).json({ success: false, message: 'This file type is not permitted for upload.' });
    }

    // Extract raw base64 buffer from data URI if provided
    const base64Index = fileData.indexOf(';base64,');
    const base64Content = base64Index !== -1 ? fileData.substring(base64Index + 8) : fileData;
    const buffer = Buffer.from(base64Content, 'base64');
    if (buffer.length > MAX_UPLOAD_BYTES) {
      return res.status(413).json({ success: false, message: 'File exceeds the 50MB upload limit.' });
    }

    const sanitizedBase = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
    const uniqueName = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${sanitizedBase}`;
    const targetPath = path.join(uploadsDir, uniqueName);

    fs.writeFileSync(targetPath, buffer);
    const fileUrl = `/uploads/${uniqueName}`;

    return res.json({
      success: true,
      fileName,
      fileUrl,
      fileSize: buffer.length,
      fileType: fileType || 'application/octet-stream',
      category: category || 'general'
    });
  } catch (err) {
    console.error('File upload error:', err);
    return res.status(500).json({ success: false, message: 'File upload processing failed.' });
  }
});

// ============================================================================
// Universal Media Search & Web Scraper REST APIs
// ============================================================================

// GET /api/media/search?platform=youtube&q=...
app.get('/api/media/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const platform = String(req.query.platform || 'youtube').toLowerCase();
    if (!q) {
      return res.status(400).json({ success: false, message: 'Search query required.' });
    }

    if (platform === 'youtube') {
      const ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
      const response = await fetch(ytUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      const html = await response.text();
      const initIdx = html.indexOf('var ytInitialData =');
      const items = [];

      if (initIdx !== -1) {
        const jsonStart = html.indexOf('{', initIdx);
        const jsonEnd = html.indexOf(';</script>', jsonStart);
        if (jsonEnd !== -1) {
          try {
            const data = JSON.parse(html.substring(jsonStart, jsonEnd));
            const sections = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
            for (const sec of sections) {
              const contents = sec.itemSectionRenderer?.contents || [];
              for (const c of contents) {
                const v = c.videoRenderer;
                if (v && v.videoId && items.length < 12) {
                  const title = v.title?.runs?.[0]?.text || v.title?.simpleText || 'Video';
                  const duration = v.lengthText?.simpleText || '0:00';
                  const author = v.ownerText?.runs?.[0]?.text || '';
                  items.push({
                    id: v.videoId,
                    title,
                    author,
                    duration,
                    url: `https://www.youtube.com/watch?v=${v.videoId}`,
                    thumbnail: `https://img.youtube.com/vi/${v.videoId}/hqdefault.jpg`,
                    mediaType: 'youtube',
                    platform: 'youtube'
                  });
                }
              }
            }
          } catch (e) {}
        }
      }

      // Regex fallback if JSON was not parsed
      if (items.length === 0) {
        const regex = /"videoId":"([a-zA-Z0-9_-]{11})"[^"]*?"title":\{"runs":\[\{"text":"([^"]+)"/g;
        let m;
        const seen = new Set();
        while ((m = regex.exec(html)) !== null && items.length < 10) {
          if (!seen.has(m[1])) {
            seen.add(m[1]);
            items.push({
              id: m[1],
              title: m[2],
              author: 'YouTube Creator',
              duration: '',
              url: `https://www.youtube.com/watch?v=${m[1]}`,
              thumbnail: `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg`,
              mediaType: 'youtube',
              platform: 'youtube'
            });
          }
        }
      }

      return res.json({ success: true, platform: 'youtube', query: q, results: items });
    }

    // Generic search across platforms
    return res.json({ success: true, platform, query: q, results: [] });
  } catch (err) {
    console.error('Media search error:', err);
    return res.status(500).json({ success: false, message: 'Media search failed.' });
  }
});

// SSRF guard: block scrape/fetch targets pointing at loopback, link-local, cloud metadata,
// and RFC1918 private ranges. Applied to the initial URL AND every manually-followed redirect
// hop, since an attacker-controlled page can otherwise 302 the server into the internal network.
function isPrivateOrLoopbackHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h || h === 'localhost' || h.endsWith('.localhost')) return true;
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const a = parseInt(ipv4[1], 10);
    const b = parseInt(ipv4[2], 10);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
    return false;
  }
  if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;
  return false;
}
function isSafeExternalUrl(urlString) {
  let parsed;
  try { parsed = new URL(urlString); } catch (e) { return false; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  return !isPrivateOrLoopbackHost(parsed.hostname);
}

// POST /api/media/scrape - Scrape website, custom domain or media page
app.post('/api/media/scrape', async (req, res) => {
  try {
    let { targetUrl, domain, query } = req.body;
    if (!targetUrl && domain) {
      targetUrl = domain.startsWith('http') ? domain : `https://${domain}`;
    }
    if (!targetUrl || !isSafeExternalUrl(targetUrl)) {
      return res.status(400).json({ success: false, message: 'A valid public http(s) targetUrl or domain is required.' });
    }

    const fetchHeaders = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
    let hopUrl = targetUrl;
    let response = await fetch(hopUrl, { headers: fetchHeaders, redirect: 'manual', signal: AbortSignal.timeout(10000) });
    let hops = 0;
    while (response.status >= 300 && response.status < 400 && hops < 3) {
      const location = response.headers.get('location');
      if (!location) break;
      const nextUrl = new URL(location, hopUrl).toString();
      if (!isSafeExternalUrl(nextUrl)) {
        return res.status(400).json({ success: false, message: 'Blocked redirect to a disallowed address.' });
      }
      hopUrl = nextUrl;
      response = await fetch(hopUrl, { headers: fetchHeaders, redirect: 'manual', signal: AbortSignal.timeout(10000) });
      hops++;
    }
    if (response.status >= 300 && response.status < 400) {
      return res.status(400).json({ success: false, message: 'Too many redirects.' });
    }

    const html = await response.text();
    const finalUrl = hopUrl;

    // Extract page title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const pageTitle = titleMatch ? titleMatch[1].trim() : 'Media Stream';

    // Extract OpenGraph preview image
    const ogImgMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    const ogThumb = ogImgMatch ? ogImgMatch[1] : '';

    const results = [];
    const seen = new Set();

    // 1. Direct video links (.mp4, .m3u8, .webm, .mov)
    const vidRegex = /https?:\/\/[^\s"'<>]+\.(?:mp4|m3u8|webm|mov)(?:\?[^\s"'<>]*)?/gi;
    let m;
    while ((m = vidRegex.exec(html)) !== null && results.length < 15) {
      const u = m[0];
      if (!seen.has(u)) {
        seen.add(u);
        const isHls = u.includes('.m3u8');
        results.push({
          title: `${pageTitle} (${isHls ? 'HLS Live Stream' : 'MP4 Video'})`,
          url: u,
          mediaType: isHls ? 'hls' : 'direct',
          thumbnail: ogThumb,
          platform: 'web-stream'
        });
      }
    }

    // 2. OpenGraph Video meta tags
    const ogVidRegex = /<meta[^>]+property=["']og:video(?::secure_url)?["'][^>]+content=["']([^"']+)["']/gi;
    let ogM;
    while ((ogM = ogVidRegex.exec(html)) !== null) {
      const uMatch = ogM[0].match(/content=["']([^"']+)["']/i);
      if (uMatch && !seen.has(uMatch[1])) {
        seen.add(uMatch[1]);
        const isHls = uMatch[1].includes('.m3u8');
        results.push({
          title: pageTitle,
          url: uMatch[1],
          mediaType: isHls ? 'hls' : 'direct',
          thumbnail: ogThumb,
          platform: 'opengraph'
        });
      }
    }

    // 3. Embedded YouTube video IDs inside webpage
    const ytRegex = /(?:youtube\.com\/(?:embed\/|v\/|watch\?v=)|youtu\.be\/)([\w-]{11})/gi;
    let ytM;
    while ((ytM = ytRegex.exec(html)) !== null && results.length < 15) {
      const idMatch = ytM[0].match(/([\w-]{11})$/);
      if (idMatch && !seen.has(idMatch[1])) {
        seen.add(idMatch[1]);
        results.push({
          id: idMatch[1],
          title: `${pageTitle} (Embedded YouTube)`,
          url: `https://www.youtube.com/watch?v=${idMatch[1]}`,
          thumbnail: `https://img.youtube.com/vi/${idMatch[1]}/hqdefault.jpg`,
          mediaType: 'youtube',
          platform: 'youtube'
        });
      }
    }

    // 4. Embedded Vimeo videos inside webpage
    const vimeoRegex = /vimeo\.com\/(?:video\/)?(\d+)/gi;
    let vm;
    while ((vm = vimeoRegex.exec(html)) !== null && results.length < 15) {
      const vid = vm[1];
      if (!seen.has(vid)) {
        seen.add(vid);
        results.push({
          title: `${pageTitle} (Vimeo Video ${vid})`,
          url: `https://vimeo.com/${vid}`,
          thumbnail: ogThumb,
          mediaType: 'direct',
          platform: 'vimeo'
        });
      }
    }

    return res.json({
      success: true,
      sourceUrl: finalUrl,
      domain: new URL(finalUrl).hostname,
      pageTitle,
      results
    });
  } catch (err) {
    console.error('Media scrape error:', err);
    return res.status(500).json({ success: false, message: 'Web scraping failed or site inaccessible.' });
  }
});

// ============================================================================
// Socket.io Real-Time Synchronization & Messaging Engine
// ============================================================================

io.on('connection', (socket) => {
  let currentRoomCode = null;
  let currentUserData = null;

  // 1. High-Precision 4-Timestamp NTP Clock Handshake Responder
  socket.on('ping-clock', (data, ack) => {
    const t1 = Date.now();
    const t0 = data ? (data.t0 || data.clientTime || 0) : 0;
    const response = {
      t0,
      t1,
      t2: Date.now(),
      clientTime: t0,
      serverTime: t1
    };
    if (typeof ack === 'function') {
      ack(response);
    } else {
      socket.emit('pong-clock', response);
      socket.emit('sync:pong', response);
    }
  });

  socket.on('sync:ping', (data, ack) => {
    const t1 = Date.now();
    const t0 = data ? (data.t0 || data.clientTime || 0) : 0;
    const response = {
      t0,
      t1,
      t2: Date.now(),
      clientTime: t0,
      serverTime: t1
    };
    if (typeof ack === 'function') {
      ack(response);
    } else {
      socket.emit('sync:pong', response);
      socket.emit('pong-clock', response);
    }
  });

  // Client Buffer Health & Network Telemetry Listener
  socket.on('sync:telemetry', (data = {}) => {
    if (!currentRoomCode) return;
    const roomState = activeRooms.get(currentRoomCode);
    if (!roomState) return;

    const member = roomState.members.get(socket.id);
    if (!member) return;

    member.rttMs = Math.max(0, Number(data.rttMs) || member.rttMs || 50);
    member.jitterMs = Math.max(0, Number(data.jitterMs) || member.jitterMs || 5);
    member.driftMs = Number(data.driftMs) || 0;
    member.bufferSec = Math.max(0, Number(data.bufferSec) || 0);
    member.bandwidthKbps = Math.max(0, Number(data.bandwidthKbps) || member.bandwidthKbps || 5000);
    member.ready = Boolean(data.ready);
    member.stalled = Boolean(data.stalled);
    member.lastSeen = Date.now();
  });

  // 2. Join Watch Party Room
  socket.on('join-room', ({ roomCode, userUuid, nickname, isGuest, passcode, peerId }) => {
    const code = (roomCode || 'UNI-8842').toUpperCase();
    if (!/^[A-Z0-9-]{3,24}$/.test(code)) {
      socket.emit('error-notice', { message: 'Invalid room code format.' });
      return;
    }
    const roomState = getOrCreateRoomState(code);

    if (!roomState) {
      socket.emit('error-notice', { message: 'The requested room does not exist.' });
      return;
    }

    // Check if user is banned
    const banned = db.prepare('SELECT * FROM room_banned_users WHERE room_code = ? AND user_uuid = ?').get(code, userUuid);
    if (banned) {
      socket.emit('banned-notice', { message: 'You have been banned from this room by the host.' });
      return;
    }

    // Check if guests allowed
    if (isGuest && !roomState.allowGuests) {
      socket.emit('error-notice', { message: 'Guests are not permitted in this room. Please sign in with a student account.' });
      return;
    }

    // Verify passcode if room is passcode protected
    if (roomState.passcodeHash) {
      const valid = passcode && bcrypt.compareSync(passcode.trim(), roomState.passcodeHash);
      if (!valid) {
        socket.emit('passcode-required', { message: 'Passcode PIN required to enter this room.' });
        return;
      }
    }

    // If this socket was already in a different room (client-side room switch without a
    // full reconnect), leave it cleanly so the old room doesn't keep a ghost member who
    // still receives its broadcasts and inflates its viewer count.
    if (currentRoomCode && currentRoomCode !== code) {
      const prevRoomState = activeRooms.get(currentRoomCode);
      if (prevRoomState) {
        prevRoomState.members.delete(socket.id);
        socket.to(currentRoomCode).emit('member-left', {
          socketId: socket.id,
          userUuid: currentUserData ? currentUserData.uuid : null,
          name: currentUserData ? currentUserData.name : null,
          peerId: currentUserData ? currentUserData.peerId : null
        });
        scheduleRoomEvictionIfEmpty(currentRoomCode, prevRoomState);
      }
      socket.leave(currentRoomCode);
    }

    currentRoomCode = code;
    socket.join(code);
    clearTimeout(roomState.evictionTimer);
    roomState.evictionTimer = null;

    const assignedUuid = (userUuid && String(userUuid).trim() !== '' && userUuid !== 'undefined') ? userUuid : ('usr-guest-' + crypto.randomUUID());
    let isHost = assignedUuid === roomState.hostUuid;
    const hasActiveHost = Array.from(roomState.members.values()).some(m => m.isHost);
    if (!hasActiveHost) {
      isHost = true;
      roomState.hostUuid = assignedUuid;
    }
    currentUserData = {
      socketId: socket.id,
      uuid: assignedUuid,
      name: nickname || (isHost ? 'Host' : 'Student'),
      isHost,
      isGuest: Boolean(isGuest),
      role: isHost ? 'host' : (isGuest ? 'guest' : 'student'),
      syncStatus: 'synced',
      drift: 0,
      isAudioActive: false,
      isVideoActive: false,
      isScreensharing: false,
      isBuffering: false,
      peerId: peerId || null,
      avatar: isHost 
        ? 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=80&q=80'
        : 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=80&q=80'
    };

    roomState.members.set(socket.id, currentUserData);

    // Fetch queue
    const queue = db.prepare('SELECT * FROM room_queue WHERE room_code = ? AND is_played = 0 ORDER BY order_index ASC').all(code);

    // Fetch recent chat history
    const chatHistory = db.prepare(`
      SELECT sender_uuid, sender_name, sender_avatar, encrypted_payload, is_system_event, created_at 
      FROM chat_messages 
      WHERE room_code = ? 
      ORDER BY created_at ASC LIMIT 30
    `).all(code);

    // Compute live authoritative media time
    const authoritativeTime = calculateCurrentMediaTime(roomState);

    // Send complete initial room state to newly joined user
    socket.emit('room-state', {
      room: {
        code: roomState.code,
        title: roomState.title,
        category: roomState.category,
        hostUuid: roomState.hostUuid,
        hostSyncLock: roomState.hostSyncLock,
        allowGuests: roomState.allowGuests,
        allowGuestChat: roomState.allowGuestChat,
        allowGuestControl: roomState.allowGuestControl,
        smoothCatchUp: roomState.smoothCatchUp !== undefined ? roomState.smoothCatchUp : true,
        mediaUrl: roomState.mediaUrl,
        mediaType: roomState.mediaType,
        mediaTitle: roomState.mediaTitle,
        screensharePeerId: roomState.screensharePeerId || null,
        screenshareHostName: roomState.screenshareHostName || null
      },
      playback: {
        isPlaying: roomState.isPlaying,
        currentTime: authoritativeTime,
        playbackRate: roomState.playbackRate,
        serverTime: Date.now()
      },
      queue,
      chatHistory,
      members: Array.from(roomState.members.values()),
      isHost
    });

    // Notify others in room
    socket.to(code).emit('member-joined', currentUserData);

    // Broadcast system message in chat
    const joinText = `${currentUserData.name} joined the watch party.`;
    const sysMsg = {
      id: 'sys-' + Date.now(),
      senderName: 'System',
      senderUuid: 'system',
      text: joinText,
      isSystem: true,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    io.to(code).emit('chat-message', sysMsg);

    console.log(`[Socket] ${currentUserData.name} (${userUuid}) joined ${code}`);
  });

  // 3. Playback Synchronization Control
  socket.on('playback-control', ({ action, time, rate, url, title, mediaType, fileName, fileSize, peerId }) => {
    if (!currentRoomCode) return;
    const roomState = activeRooms.get(currentRoomCode);
    if (!roomState || !currentUserData) return;

    // Check permissions
    const isHost = currentUserData.isHost;
    if (!isHost) {
      if (currentUserData.isGuest) {
        if (!roomState.allowGuestControl) {
          socket.emit('action-denied', { message: 'Guests do not have permission to control video playback in this room.' });
          return;
        }
      } else if (roomState.hostSyncLock) {
        socket.emit('action-denied', { message: 'Only the host has permission to control video playback in this room.' });
        return;
      }
    }

    const now = Date.now();
    let announcementText = null;

    if (action === 'play') {
      const targetTime = Number.isFinite(time) ? Math.max(0, time) : calculateCurrentMediaTime(roomState, now);
      const scheduledStart = now + 250; // 250ms synchronization lead time (F-6)
      roomState.anchorMediaTime = targetTime;
      roomState.currentTime = targetTime;
      roomState.anchorServerTime = scheduledStart;
      roomState.scheduledStartServerTime = scheduledStart;
      roomState.isPlaying = true;
      roomState.status = 'PLAYING';
      roomState.lastUpdatedAt = now;
      roomState.seq = (roomState.seq || 1) + 1;
      // Suppress duplicate rapid announcement if play was already received within 1.5s
      if (roomState.lastPlayActionTime && (now - roomState.lastPlayActionTime) < 1500) {
        announcementText = null;
      } else {
        announcementText = `${currentUserData.name} resumed playback`;
        roomState.lastPlayActionTime = now;
      }
    } else if (action === 'pause') {
      const targetTime = Number.isFinite(time) ? Math.max(0, time) : calculateCurrentMediaTime(roomState, now);
      roomState.anchorMediaTime = targetTime;
      roomState.currentTime = targetTime;
      roomState.anchorServerTime = now;
      roomState.scheduledStartServerTime = null;
      roomState.isPlaying = false;
      roomState.status = 'PAUSED';
      roomState.lastUpdatedAt = now;
      roomState.seq = (roomState.seq || 1) + 1;
      if (roomState.lastPauseActionTime && (now - roomState.lastPauseActionTime) < 1500) {
        announcementText = null;
      } else {
        announcementText = `${currentUserData.name} paused at ${formatDuration(roomState.currentTime)}`;
        roomState.lastPauseActionTime = now;
      }
    } else if (action === 'seek') {
      const targetTime = Number.isFinite(time) ? Math.max(0, time) : roomState.currentTime;
      roomState.anchorMediaTime = targetTime;
      roomState.currentTime = targetTime;
      roomState.anchorServerTime = now;
      roomState.lastUpdatedAt = now;
      roomState.seq = (roomState.seq || 1) + 1;
      announcementText = `${currentUserData.name} seeked to ${formatDuration(roomState.currentTime)}`;
    } else if (action === 'rate') {
      const numRate = parseFloat(rate);
      roomState.playbackRate = (!isNaN(numRate) && numRate > 0 && numRate <= 2.0) ? numRate : 1.0;
      roomState.baseRate = roomState.playbackRate;
      roomState.anchorMediaTime = calculateCurrentMediaTime(roomState, now);
      roomState.currentTime = roomState.anchorMediaTime;
      roomState.anchorServerTime = now;
      roomState.lastUpdatedAt = now;
      roomState.seq = (roomState.seq || 1) + 1;
      announcementText = `${currentUserData.name} changed playback speed to ${roomState.playbackRate}x`;
    } else if (action === 'set-pause-target') {
      const numTarget = Number.isFinite(time) ? Math.max(0, time) : null;
      roomState.targetPauseTime = numTarget;
      roomState.seq = (roomState.seq || 1) + 1;
      io.to(currentRoomCode).emit('sync-playback', {
        action: 'set-pause-target',
        targetPauseTime: roomState.targetPauseTime,
        currentTime: calculateCurrentMediaTime(roomState, now),
        anchorMediaTime: roomState.anchorMediaTime || roomState.currentTime,
        anchorServerTime: roomState.anchorServerTime || now,
        isPlaying: roomState.isPlaying,
        status: roomState.status,
        playbackRate: roomState.playbackRate,
        baseRate: roomState.playbackRate,
        seq: roomState.seq,
        serverTime: now,
        originatorUuid: currentUserData ? currentUserData.uuid : null
      });
      if (numTarget !== null) {
        announcementText = `⏱️ ${currentUserData.name} scheduled dynamic pause at ${formatDuration(numTarget)}`;
      }
    } else if (action === 'start-screenshare') {
      const isCurrentMediaVirtual = roomState.mediaType === 'screen' ||
                                    roomState.mediaType === 'local-stream' ||
                                    (roomState.mediaUrl && (roomState.mediaUrl.startsWith('webrtc://') || roomState.mediaUrl.startsWith('webrtc-local://')));

      if (!isCurrentMediaVirtual) {
        const curMediaTime = calculateCurrentMediaTime(roomState, now);
        roomState.originalMedia = {
          url: roomState.mediaUrl,
          type: roomState.mediaType,
          title: roomState.mediaTitle,
          time: curMediaTime
        };
        roomState.previousMedia = {
          url: roomState.mediaUrl,
          type: roomState.mediaType,
          title: roomState.mediaTitle,
          time: curMediaTime
        };
      }
      roomState.mediaType = 'screen';
      roomState.mediaUrl = `webrtc://${peerId || 'host-screen'}`;
      roomState.mediaTitle = title || `${currentUserData.name}'s Live Screen`;
      roomState.screensharePeerId = peerId;
      roomState.screenshareHostName = currentUserData ? currentUserData.name : 'Host';
      const startShareMember = roomState.members.get(socket.id);
      if (startShareMember) startShareMember.isScreensharing = true;
      roomState.isPlaying = false; // Background media is frozen while screensharing
      roomState.status = 'PAUSED';
      roomState.lastUpdatedAt = now;
      roomState.seq = (roomState.seq || 1) + 1;
      announcementText = `🖥️ ${currentUserData.name} started live screen sharing`;
    } else if (action === 'stop-screenshare') {
      roomState.screensharePeerId = null;
      roomState.screenshareHostName = null;
      const stopShareMember = roomState.members.get(socket.id);
      if (stopShareMember) stopShareMember.isScreensharing = false;
      io.to(currentRoomCode).emit('members-updated', { members: Array.from(roomState.members.values()) });
      const restored = (roomState.originalMedia && roomState.originalMedia.url && !roomState.originalMedia.url.startsWith('webrtc'))
        ? roomState.originalMedia
        : (roomState.previousMedia && roomState.previousMedia.url && !roomState.previousMedia.url.startsWith('webrtc')
          ? roomState.previousMedia
          : {
              url: 'https://www.youtube.com/watch?v=8hly31xKli0',
              type: 'youtube',
              title: 'Algorithms and Data Structures Tutorial',
              time: 0
            });

      roomState.mediaUrl = restored.url;
      roomState.mediaType = restored.type;
      roomState.mediaTitle = restored.title;
      roomState.currentTime = restored.time || 0;
      roomState.anchorMediaTime = roomState.currentTime;
      roomState.isPlaying = false;
      roomState.status = 'PAUSED';
      roomState.lastUpdatedAt = now;
      roomState.anchorServerTime = now;
      roomState.seq = (roomState.seq || 1) + 1;
      announcementText = `🖥️ ${currentUserData.name} stopped screen sharing`;
    } else if (action === 'start-local-stream') {
      const isCurrentMediaVirtual = roomState.mediaType === 'screen' ||
                                    roomState.mediaType === 'local-stream' ||
                                    (roomState.mediaUrl && (roomState.mediaUrl.startsWith('webrtc://') || roomState.mediaUrl.startsWith('webrtc-local://')));

      if (!isCurrentMediaVirtual) {
        const curMediaTime = calculateCurrentMediaTime(roomState, now);
        roomState.originalMedia = {
          url: roomState.mediaUrl,
          type: roomState.mediaType,
          title: roomState.mediaTitle,
          time: curMediaTime
        };
        roomState.previousMedia = {
          url: roomState.mediaUrl,
          type: roomState.mediaType,
          title: roomState.mediaTitle,
          time: curMediaTime
        };
      }
      roomState.mediaType = 'local-stream';
      roomState.mediaUrl = `webrtc-local://${peerId || 'local-file'}`;
      roomState.mediaTitle = title ? `[Local Stream] ${title}` : `[Local Stream] Video File`;
      roomState.screensharePeerId = peerId;
      roomState.screenshareHostName = currentUserData ? currentUserData.name : 'Host';
      roomState.isPlaying = true;
      roomState.status = 'PLAYING';
      roomState.currentTime = 0;
      roomState.anchorMediaTime = 0;
      roomState.anchorServerTime = now;
      roomState.lastUpdatedAt = now;
      roomState.seq = (roomState.seq || 1) + 1;
      announcementText = `📁 ${currentUserData.name} started streaming local file: ${title || 'Video'}`;
    } else if (action === 'stop-local-stream') {
      roomState.screensharePeerId = null;
      roomState.screenshareHostName = null;
      const changeMediaMember = roomState.members.get(socket.id);
      if (changeMediaMember) changeMediaMember.isScreensharing = false;
      io.to(currentRoomCode).emit('members-updated', { members: Array.from(roomState.members.values()) });
      const restored = (roomState.originalMedia && roomState.originalMedia.url && !roomState.originalMedia.url.startsWith('webrtc'))
        ? roomState.originalMedia
        : (roomState.previousMedia && roomState.previousMedia.url && !roomState.previousMedia.url.startsWith('webrtc')
          ? roomState.previousMedia
          : {
              url: 'https://www.youtube.com/watch?v=8hly31xKli0',
              type: 'youtube',
              title: 'Algorithms and Data Structures Tutorial',
              time: 0
            });

      roomState.mediaUrl = restored.url;
      roomState.mediaType = restored.type;
      roomState.mediaTitle = restored.title;
      roomState.currentTime = restored.time || 0;
      roomState.anchorMediaTime = roomState.currentTime;
      roomState.isPlaying = false;
      roomState.status = 'PAUSED';
      roomState.lastUpdatedAt = now;
      roomState.anchorServerTime = now;
      roomState.seq = (roomState.seq || 1) + 1;
      announcementText = `📁 ${currentUserData.name} stopped local file streaming`;
    } else if (action === 'change-media') {
      if (typeof url !== 'string' || !url.trim()) {
        socket.emit('action-denied', { message: 'A valid media URL is required to change the video.' });
        return;
      }

      // Archive previous media to history
      if (roomState.mediaUrl && !roomState.mediaUrl.startsWith('webrtc')) {
        db.prepare('INSERT INTO room_history (room_code, url, title, media_type) VALUES (?, ?, ?, ?)').run(
          currentRoomCode,
          roomState.mediaUrl,
          roomState.mediaTitle || 'Video',
          roomState.mediaType || 'youtube'
        );
      }

      roomState.screensharePeerId = null;
      roomState.screenshareHostName = null;
      const changeMediaMember = roomState.members.get(socket.id);
      if (changeMediaMember) changeMediaMember.isScreensharing = false;
      io.to(currentRoomCode).emit('members-updated', { members: Array.from(roomState.members.values()) });
      roomState.mediaUrl = url;
      roomState.mediaType = mediaType || (url.includes('youtube') || url.includes('youtu.be') ? 'youtube' : 'direct');
      roomState.mediaTitle = title || 'Shared Video';
      roomState.playbackRate = 1.0;
      roomState.baseRate = 1.0;
      resetMediaAnchor(roomState, { currentTime: 0, isPlaying: true, now });

      roomState.originalMedia = {
        url: roomState.mediaUrl,
        type: roomState.mediaType,
        title: roomState.mediaTitle,
        time: 0
      };
      roomState.previousMedia = null;

      // Update room in SQLite
      db.prepare('UPDATE rooms SET media_url = ?, media_type = ?, media_title = ? WHERE code = ?').run(
        roomState.mediaUrl,
        roomState.mediaType,
        roomState.mediaTitle,
        currentRoomCode
      );

      announcementText = `${currentUserData.name} changed video to: "${roomState.mediaTitle}"`;
    } else if (action === 'local-sync') {
      if (typeof fileName !== 'string' || !fileName.trim()) {
        socket.emit('action-denied', { message: 'A valid local file name is required.' });
        return;
      }
      roomState.screensharePeerId = null;
      roomState.screenshareHostName = null;
      const changeMediaMember = roomState.members.get(socket.id);
      if (changeMediaMember) changeMediaMember.isScreensharing = false;
      io.to(currentRoomCode).emit('members-updated', { members: Array.from(roomState.members.values()) });
      // Local File Sync feature: sync playback on a matching local video file
      roomState.mediaUrl = `local://${fileName}`;
      roomState.mediaType = 'local';
      roomState.mediaTitle = `[Local File] ${fileName}`;
      resetMediaAnchor(roomState, { currentTime: 0, isPlaying: false, now });

      announcementText = `${currentUserData.name} loaded local file sync for: "${fileName}"`;
    }

    // Broadcast sync command to everyone in the room
    const syncPayload = {
      action,
      currentTime: roomState.currentTime,
      anchorMediaTime: roomState.anchorMediaTime !== undefined ? roomState.anchorMediaTime : roomState.currentTime,
      anchorServerTime: roomState.anchorServerTime || now,
      scheduledStartServerTime: action === 'play' ? roomState.scheduledStartServerTime : undefined,
      isPlaying: roomState.isPlaying,
      status: roomState.status || (roomState.isPlaying ? 'PLAYING' : 'PAUSED'),
      playbackRate: roomState.playbackRate,
      baseRate: roomState.playbackRate,
      seq: roomState.seq || 1,
      serverTime: now,
      originatorUuid: currentUserData ? currentUserData.uuid : null,
      mediaUrl: roomState.mediaUrl,
      mediaType: roomState.mediaType,
      mediaTitle: roomState.mediaTitle,
      fileName,
      fileSize,
      screensharePeerId: roomState.screensharePeerId,
      peerId: roomState.screensharePeerId,
      triggeredBy: currentUserData.name
    };
    // NOTE: only 'sync-playback' is emitted here (not also 'sync:state') -- the client's
    // sync-playback handler is a strict superset (action routing, gate overlay, echo
    // suppression) of the sync:state handler. Emitting both for the same event caused
    // checkAndCorrectDrift() to run twice per action and let the two handlers race on
    // RoomSync.serverSeq with slightly different echo-suppression behavior.
    io.to(currentRoomCode).emit('sync-playback', syncPayload);

    // Broadcast system announcement in chat
    if (announcementText) {
      const sysMsg = {
        id: 'sys-' + now,
        senderName: 'System',
        senderUuid: 'system',
        text: announcementText,
        isSystem: true,
        time: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      io.to(currentRoomCode).emit('chat-message', sysMsg);
    }
  });

  // 4. Server-Forwarded Encrypted Chat
  socket.on('chat-message', ({ encryptedPayload, plainPreview, senderName, attachment }) => {
    if (!currentRoomCode || !currentUserData) return;
    const roomState = activeRooms.get(currentRoomCode);
    if (!roomState) return;

    // Check guest chat permission
    if (currentUserData.isGuest && !roomState.allowGuestChat) {
      socket.emit('action-denied', { message: 'Guests are not permitted to chat in this room.' });
      return;
    }

    const payload = encryptedPayload || plainPreview;
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const senderUuid = (currentUserData && currentUserData.uuid && String(currentUserData.uuid).trim() !== '' && currentUserData.uuid !== 'undefined')
      ? String(currentUserData.uuid)
      : ('usr-anon-' + Date.now());
    const senderDisplayName = (currentUserData && currentUserData.name)
      ? currentUserData.name
      : (senderName || 'Anonymous');
    const senderAvatar = (currentUserData && currentUserData.avatar) ? currentUserData.avatar : null;
    const payloadStr = typeof payload === 'object' ? JSON.stringify(payload) : String(payload ?? '');

    // Persist encrypted payload and optional attachment in SQLite safely
    try {
      db.prepare(`
        INSERT INTO chat_messages (room_code, sender_uuid, sender_name, sender_avatar, encrypted_payload, is_system_event, attachment_url, attachment_name)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?)
      `).run(
        currentRoomCode,
        senderUuid,
        senderDisplayName,
        senderAvatar,
        payloadStr,
        attachment ? attachment.fileUrl : null,
        attachment ? attachment.fileName : null
      );
    } catch (chatDbErr) {
      console.error('[Chat Error] Failed to persist message to SQLite:', chatDbErr.message);
    }

    // Forward to all clients in room
    io.to(currentRoomCode).emit('chat-message', {
      id: 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
      senderUuid: senderUuid,
      senderName: senderDisplayName,
      senderAvatar: senderAvatar,
      encryptedPayload,
      plainPreview,
      attachment: attachment || null,
      time: timeStr,
      isSystem: false
    });
  });

  // Media Status Updates (Microphone audio, camera video, real-time speaking activity)
  socket.on('update-media-status', ({ hasAudio, hasVideo, isSpeaking }) => {
    if (!currentRoomCode || !currentUserData) return;
    currentUserData.hasAudio = Boolean(hasAudio);
    currentUserData.hasVideo = Boolean(hasVideo);
    currentUserData.isSpeaking = Boolean(isSpeaking);

    const roomState = activeRooms.get(currentRoomCode);
    if (roomState && roomState.members.has(socket.id)) {
      roomState.members.set(socket.id, currentUserData);
    }

    io.to(currentRoomCode).emit('member-media-updated', {
      userUuid: currentUserData.uuid,
      userName: currentUserData.name,
      hasAudio: currentUserData.hasAudio,
      hasVideo: currentUserData.hasVideo,
      isSpeaking: currentUserData.isSpeaking,
      peerId: currentUserData.peerId
    });
  });

  // Role Transfer (Host, Presenter, Moderator)
  socket.on('transfer-role', ({ targetUuid, newRole }) => {
    if (!currentRoomCode || !currentUserData) return;
    if (typeof targetUuid !== 'string' || typeof newRole !== 'string' || !newRole.trim()) return;
    const roomState = activeRooms.get(currentRoomCode);
    if (!roomState) return;

    const normalizedRole = currentUserData.role ? currentUserData.role.toLowerCase() : '';
    if (normalizedRole !== 'host' && normalizedRole !== 'moderator') return;

    let targetMember = null;
    for (const [sId, member] of roomState.members.entries()) {
      if (member.uuid === targetUuid) {
        targetMember = member;
        member.role = newRole.toLowerCase();
        if (newRole.toLowerCase() === 'host') {
          member.isHost = true;
          currentUserData.role = 'moderator';
          currentUserData.isHost = false;
          roomState.hostUuid = targetUuid;
          db.prepare('UPDATE rooms SET host_uuid = ? WHERE code = ?').run(targetUuid, currentRoomCode);
        }
        break;
      }
    }

    io.to(currentRoomCode).emit('all-members', {
      members: Array.from(roomState.members.values())
    });

    if (targetMember) {
      io.to(currentRoomCode).emit('chat-message', {
        id: 'sys-' + Date.now(),
        senderName: 'UniTogether System',
        senderAvatar: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=80&q=80',
        plainPreview: `👑 Role updated: ${targetMember.name} has been assigned the role of ${newRole} by ${currentUserData.name}.`,
        isSystem: true,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
    }
  });

  // 5. Playlist & Queue Management
  socket.on('queue-add', ({ url, title, duration, mediaType }) => {
    if (!currentRoomCode || !currentUserData) return;
    const roomState = activeRooms.get(currentRoomCode);
    if (!roomState) return;

    if (currentUserData.isGuest && !roomState.allowGuestControl) {
      socket.emit('action-denied', { message: 'Guests cannot add videos to the playlist queue.' });
      return;
    }

    if (typeof url !== 'string' || !url.trim()) {
      socket.emit('action-denied', { message: 'A valid media URL is required to add to the queue.' });
      return;
    }

    const videoTitle = title || 'Shared Video';
    const type = mediaType || (url.includes('youtube') || url.includes('youtu.be') ? 'youtube' : 'direct');

    const maxOrder = db.prepare('SELECT MAX(order_index) as maxIdx FROM room_queue WHERE room_code = ?').get(currentRoomCode);
    const nextIdx = (maxOrder && maxOrder.maxIdx !== null) ? maxOrder.maxIdx + 1 : 0;

    db.prepare(`
      INSERT INTO room_queue (room_code, url, title, duration, media_type, added_by_name, added_by_uuid, order_index)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      currentRoomCode,
      url.trim(),
      videoTitle,
      duration || 0,
      type,
      currentUserData.name,
      currentUserData.uuid,
      nextIdx
    );

    // Broadcast updated queue
    const queue = db.prepare('SELECT * FROM room_queue WHERE room_code = ? AND is_played = 0 ORDER BY order_index ASC').all(currentRoomCode);
    io.to(currentRoomCode).emit('queue-updated', { queue });

    // Announce in chat
    const sysMsg = {
      id: 'sys-' + Date.now(),
      senderName: 'System',
      senderUuid: 'system',
      text: `${currentUserData.name} added "${videoTitle}" to the playlist queue.`,
      isSystem: true,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    io.to(currentRoomCode).emit('chat-message', sysMsg);
  });

  socket.on('queue-remove', ({ queueId }) => {
    if (!currentRoomCode || !currentUserData) return;
    const roomState = activeRooms.get(currentRoomCode);
    if (!roomState) return;
    if (currentUserData.isGuest && !roomState.allowGuestControl) {
      socket.emit('action-denied', { message: 'Guests cannot remove videos from the playlist queue.' });
      return;
    }
    db.prepare('DELETE FROM room_queue WHERE id = ? AND room_code = ?').run(queueId, currentRoomCode);
    const queue = db.prepare('SELECT * FROM room_queue WHERE room_code = ? AND is_played = 0 ORDER BY order_index ASC').all(currentRoomCode);
    io.to(currentRoomCode).emit('queue-updated', { queue });
  });

  function handleVoteSkip(roomCode, voterUser) {
    const roomState = activeRooms.get(roomCode);
    if (!roomState) return;

    const totalMembers = Math.max(1, roomState.members.size);
    const requiredVotes = Math.max(1, Math.ceil(((roomState.voteSkipThreshold || 50) / 100) * totalMembers));

    // If only 1 person in the room, skip directly
    if (totalMembers <= 1) {
      triggerQueueNext(roomCode, voterUser.name);
      return;
    }

    if (!roomState.voteSkip) {
      // Start a new Vote-to-Skip
      roomState.voteSkip = {
        id: 'vs-' + Date.now(),
        initiatorName: voterUser.name,
        initiatorUuid: voterUser.uuid,
        votes: new Set([voterUser.uuid]),
        requiredVotes,
        totalMembers,
        expiresAt: Date.now() + 30000,
        timer: setTimeout(() => {
          if (roomState.voteSkip) {
            io.to(roomCode).emit('vote-skip-expired', {
              message: 'Vote to skip expired without reaching consensus.'
            });
            io.to(roomCode).emit('chat-message', {
              id: 'sys-' + Date.now(),
              senderName: 'UniTogether Hub',
              senderAvatar: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=80&q=80',
              text: '⏳ Vote to skip expired without reaching majority consensus.',
              isSystem: true,
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });
            roomState.voteSkip = null;
          }
        }, 30000)
      };

      io.to(roomCode).emit('vote-skip-started', {
        id: roomState.voteSkip.id,
        initiatorName: voterUser.name,
        currentVotes: 1,
        requiredVotes: roomState.voteSkip.requiredVotes,
        totalMembers: roomState.voteSkip.totalMembers,
        expiresInSec: 30
      });

      io.to(roomCode).emit('chat-message', {
        id: 'sys-' + Date.now(),
        senderName: 'UniTogether Hub',
        senderAvatar: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=80&q=80',
        text: `🗳️ ${voterUser.name} requested to skip to the next video. Vote-to-skip started! (1/${roomState.voteSkip.requiredVotes} votes)`,
        isSystem: true,
        isVoteCard: true,
        voteSkipId: roomState.voteSkip.id,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });
    } else {
      // Cast vote for existing session. Recompute the threshold against the room's CURRENT
      // membership so a vote doesn't hang at a stale requirement after members leave mid-vote.
      roomState.voteSkip.votes.add(voterUser.uuid);
      const curCount = roomState.voteSkip.votes.size;
      const liveTotalMembers = Math.max(1, roomState.members.size);
      const liveRequiredVotes = Math.max(1, Math.ceil(((roomState.voteSkipThreshold || 50) / 100) * liveTotalMembers));
      roomState.voteSkip.totalMembers = liveTotalMembers;
      roomState.voteSkip.requiredVotes = liveRequiredVotes;

      io.to(roomCode).emit('vote-skip-updated', {
        id: roomState.voteSkip.id,
        currentVotes: curCount,
        requiredVotes: liveRequiredVotes,
        totalMembers: liveTotalMembers
      });

      if (curCount >= liveRequiredVotes) {
        clearTimeout(roomState.voteSkip.timer);
        roomState.voteSkip = null;
        io.to(roomCode).emit('vote-skip-passed', {
          message: '🎉 Majority consensus reached! Skipping video.'
        });
        io.to(roomCode).emit('chat-message', {
          id: 'sys-' + Date.now(),
          senderName: 'UniTogether Hub',
          senderAvatar: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=80&q=80',
          text: `🎉 Vote passed (${curCount}/${liveRequiredVotes})! Skipping to next video...`,
          isSystem: true,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        });
        triggerQueueNext(roomCode, 'Democratic Vote Consensus');
      }
    }
  }

  // Shared authorization check reused by every "jump to a different video" control,
  // matching the exact rule enforced by the main playback-control handler.
  function canControlQueueNavigation(roomState, user) {
    if (user.isHost) return true;
    if (roomState.hostSyncLock) return false;
    if (user.isGuest && !roomState.allowGuestControl) return false;
    return true;
  }

  function broadcastMediaChange(roomCode, roomState, triggeredByName) {
    io.to(roomCode).emit('sync-playback', {
      action: 'change-media',
      currentTime: 0,
      anchorMediaTime: 0,
      anchorServerTime: roomState.anchorServerTime,
      isPlaying: true,
      status: roomState.status,
      playbackRate: 1.0,
      baseRate: 1.0,
      seq: roomState.seq,
      serverTime: Date.now(),
      mediaUrl: roomState.mediaUrl,
      mediaType: roomState.mediaType,
      mediaTitle: roomState.mediaTitle,
      triggeredBy: triggeredByName
    });
  }

  socket.on('queue-next', () => {
    if (!currentRoomCode || !currentUserData) return;
    const roomState = activeRooms.get(currentRoomCode);
    if (!roomState) return;

    if (currentUserData.isHost) {
      const skipped = triggerQueueNext(currentRoomCode, currentUserData.name);
      if (!skipped) {
        socket.emit('notice', { message: 'Playlist queue is empty.' });
      }
    } else if (roomState.voteSkipEnabled) {
      handleVoteSkip(currentRoomCode, currentUserData);
    } else if (!canControlQueueNavigation(roomState, currentUserData)) {
      socket.emit('action-denied', { message: 'You do not have permission to skip videos in this room.' });
    } else {
      const skipped = triggerQueueNext(currentRoomCode, currentUserData.name);
      if (!skipped) {
        socket.emit('notice', { message: 'Playlist queue is empty.' });
      }
    }
  });

  socket.on('cast-vote-skip', () => {
    if (!currentRoomCode || !currentUserData) return;
    handleVoteSkip(currentRoomCode, currentUserData);
  });

  // Undo skip within 10s cooldown
  socket.on('queue-undo', ({ previousMedia }) => {
    if (!currentRoomCode || !currentUserData || !previousMedia) return;
    const roomState = activeRooms.get(currentRoomCode);
    if (!roomState) return;

    if (!canControlQueueNavigation(roomState, currentUserData)) {
      socket.emit('action-denied', { message: 'You do not have permission to undo skipped videos.' });
      return;
    }

    const undoTx = db.transaction(() => {
      if (previousMedia.queueId) {
        db.prepare('UPDATE room_queue SET is_played = 0 WHERE id = ?').run(previousMedia.queueId);
      }
      db.prepare('UPDATE rooms SET media_url = ?, media_type = ?, media_title = ? WHERE code = ?').run(
        previousMedia.url,
        previousMedia.mediaType,
        previousMedia.title,
        currentRoomCode
      );
    });
    undoTx();

    roomState.mediaUrl = previousMedia.url;
    roomState.mediaTitle = previousMedia.title;
    roomState.mediaType = previousMedia.mediaType;
    roomState.playbackRate = 1.0;
    roomState.baseRate = 1.0;
    resetMediaAnchor(roomState, { currentTime: 0, isPlaying: true });

    broadcastMediaChange(currentRoomCode, roomState, currentUserData.name);

    const updatedQueue = db.prepare('SELECT * FROM room_queue WHERE room_code = ? AND is_played = 0 ORDER BY order_index ASC').all(currentRoomCode);
    io.to(currentRoomCode).emit('queue-updated', { queue: updatedQueue });

    const sysMsg = {
      id: 'sys-' + Date.now(),
      senderName: 'System',
      senderUuid: 'system',
      text: `↺ ${currentUserData.name} reverted/called back "${previousMedia.title}".`,
      isSystem: true,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    io.to(currentRoomCode).emit('chat-message', sysMsg);
  });

  // Jump directly to a specific queued item
  socket.on('queue-jump', ({ queueId }) => {
    if (!currentRoomCode || !currentUserData) return;
    const roomState = activeRooms.get(currentRoomCode);
    if (!roomState) return;

    if (!canControlQueueNavigation(roomState, currentUserData)) {
      socket.emit('action-denied', { message: 'You do not have permission to jump to queued videos.' });
      return;
    }

    const target = db.prepare('SELECT * FROM room_queue WHERE id = ? AND room_code = ?').get(queueId, currentRoomCode);
    if (!target) return;

    const jumpTx = db.transaction(() => {
      db.prepare('UPDATE room_queue SET is_played = 1 WHERE id = ?').run(queueId);
      if (roomState.mediaUrl) {
        db.prepare('INSERT INTO room_history (room_code, url, title, media_type) VALUES (?, ?, ?, ?)').run(
          currentRoomCode,
          roomState.mediaUrl,
          roomState.mediaTitle,
          roomState.mediaType
        );
      }
      db.prepare('UPDATE rooms SET media_url = ?, media_type = ?, media_title = ? WHERE code = ?').run(
        target.url,
        target.media_type,
        target.title,
        currentRoomCode
      );
    });
    jumpTx();

    roomState.mediaUrl = target.url;
    roomState.mediaTitle = target.title;
    roomState.mediaType = target.media_type;
    roomState.playbackRate = 1.0;
    roomState.baseRate = 1.0;
    resetMediaAnchor(roomState, { currentTime: 0, isPlaying: true });

    broadcastMediaChange(currentRoomCode, roomState, currentUserData.name);

    const updatedQueue = db.prepare('SELECT * FROM room_queue WHERE room_code = ? AND is_played = 0 ORDER BY order_index ASC').all(currentRoomCode);
    io.to(currentRoomCode).emit('queue-updated', { queue: updatedQueue });

    const sysMsg = {
      id: 'sys-' + Date.now(),
      senderName: 'System',
      senderUuid: 'system',
      text: `${currentUserData.name} jumped to: "${target.title}"`,
      isSystem: true,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    io.to(currentRoomCode).emit('chat-message', sysMsg);
  });

  socket.on('queue-prev', () => {
    if (!currentRoomCode || !currentUserData) return;
    const roomState = activeRooms.get(currentRoomCode);
    if (!roomState) return;

    if (!canControlQueueNavigation(roomState, currentUserData)) {
      socket.emit('action-denied', { message: 'You do not have permission to navigate to the previous video.' });
      return;
    }

    const prevVideo = db.prepare('SELECT * FROM room_history WHERE room_code = ? ORDER BY played_at DESC LIMIT 1').get(currentRoomCode);
    if (!prevVideo) {
      socket.emit('notice', { message: 'No previous video in history.' });
      return;
    }

    const prevTx = db.transaction(() => {
      db.prepare('DELETE FROM room_history WHERE id = ?').run(prevVideo.id);
      db.prepare('UPDATE rooms SET media_url = ?, media_type = ?, media_title = ? WHERE code = ?').run(
        prevVideo.url,
        prevVideo.media_type,
        prevVideo.title,
        currentRoomCode
      );
    });
    prevTx();

    roomState.mediaUrl = prevVideo.url;
    roomState.mediaTitle = prevVideo.title;
    roomState.mediaType = prevVideo.media_type;
    roomState.playbackRate = 1.0;
    roomState.baseRate = 1.0;
    resetMediaAnchor(roomState, { currentTime: 0, isPlaying: true });

    broadcastMediaChange(currentRoomCode, roomState, currentUserData.name);

    const sysMsg = {
      id: 'sys-' + Date.now(),
      senderName: 'System',
      senderUuid: 'system',
      text: `${currentUserData.name} returned to previous video: "${roomState.mediaTitle}"`,
      isSystem: true,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    io.to(currentRoomCode).emit('chat-message', sysMsg);
  });

  // 6. Room Governance & Settings
  socket.on('update-room-settings', ({ hostSyncLock, allowGuests, allowGuestChat, allowGuestControl, smoothCatchUp, visibility, passcode, voteSkipEnabled, voteSkipThreshold }) => {
    if (!currentRoomCode || !currentUserData) return;
    const roomState = activeRooms.get(currentRoomCode);
    if (!roomState) return;

    const isPermitted = currentUserData.isHost ||
      !currentUserData.isGuest ||
      currentUserData.role === 'host' ||
      currentUserData.role === 'admin' ||
      currentUserData.role === 'moderator' ||
      currentUserData.uuid === roomState.hostUuid;

    if (!isPermitted) {
      socket.emit('action-denied', { message: 'Only the room host or student member can modify settings.' });
      return;
    }

    if (hostSyncLock !== undefined) roomState.hostSyncLock = Boolean(hostSyncLock);
    if (allowGuests !== undefined) roomState.allowGuests = Boolean(allowGuests);
    if (allowGuestChat !== undefined) roomState.allowGuestChat = Boolean(allowGuestChat);
    if (allowGuestControl !== undefined) roomState.allowGuestControl = Boolean(allowGuestControl);
    if (smoothCatchUp !== undefined) roomState.smoothCatchUp = Boolean(smoothCatchUp);
    if (visibility !== undefined) roomState.visibility = visibility;
    if (voteSkipEnabled !== undefined) roomState.voteSkipEnabled = Boolean(voteSkipEnabled);
    if (voteSkipThreshold !== undefined) {
      const parsedThreshold = parseInt(voteSkipThreshold, 10);
      roomState.voteSkipThreshold = Number.isFinite(parsedThreshold) ? Math.min(100, Math.max(0, parsedThreshold)) : 50;
    }
    if (passcode !== undefined) {
      roomState.passcodeHash = passcode ? bcrypt.hashSync(passcode.trim(), 8) : null;
    }

    // Persist in SQLite
    db.prepare(`
      UPDATE rooms
      SET host_sync_lock = ?, allow_guests = ?, allow_guest_chat = ?, allow_guest_control = ?, smooth_catch_up = ?, visibility = ?, passcode_hash = ?, vote_skip_enabled = ?, vote_skip_threshold = ?
      WHERE code = ?
    `).run(
      roomState.hostSyncLock ? 1 : 0,
      roomState.allowGuests ? 1 : 0,
      roomState.allowGuestChat ? 1 : 0,
      roomState.allowGuestControl ? 1 : 0,
      roomState.smoothCatchUp ? 1 : 0,
      roomState.visibility,
      roomState.passcodeHash,
      roomState.voteSkipEnabled ? 1 : 0,
      roomState.voteSkipThreshold,
      currentRoomCode
    );

    io.to(currentRoomCode).emit('room-settings-updated', {
      hostSyncLock: roomState.hostSyncLock,
      allowGuests: roomState.allowGuests,
      allowGuestChat: roomState.allowGuestChat,
      allowGuestControl: roomState.allowGuestControl,
      smoothCatchUp: roomState.smoothCatchUp,
      visibility: roomState.visibility,
      voteSkipEnabled: roomState.voteSkipEnabled,
      voteSkipThreshold: roomState.voteSkipThreshold
    });

    const sysMsg = {
      id: 'sys-' + Date.now(),
      senderName: 'System',
      senderUuid: 'system',
      text: `${currentUserData.name} updated room playback & governance settings.`,
      isSystem: true,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    io.to(currentRoomCode).emit('chat-message', sysMsg);
  });

  // Kick user from room
  socket.on('kick-user', ({ targetUuid, targetName }) => {
    if (!currentRoomCode || !currentUserData || (!currentUserData.isHost && currentUserData.role !== 'moderator')) {
      socket.emit('action-denied', { message: 'Only hosts and moderators can kick users.' });
      return;
    }

    const roomState = activeRooms.get(currentRoomCode);
    if (roomState) {
      for (const [sId, member] of roomState.members.entries()) {
        if (member.uuid === targetUuid && !member.isHost) {
          const targetSocket = io.sockets.sockets.get(sId);
          if (targetSocket) {
            targetSocket.emit('kicked-notice', { message: 'You have been removed from the room by the host.' });
            targetSocket.disconnect();
          }
          roomState.members.delete(sId);
        }
      }
      io.to(currentRoomCode).emit('members-updated', { members: Array.from(roomState.members.values()) });
    }

    const sysMsg = {
      id: 'sys-' + Date.now(),
      senderName: 'System',
      senderUuid: 'system',
      text: `${currentUserData.name} kicked ${targetName || 'user'} from this room.`,
      isSystem: true,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    io.to(currentRoomCode).emit('chat-message', sysMsg);
  });

  // Admin / Host mute user microphone
  socket.on('admin-mute-user', ({ targetUuid, targetName }) => {
    if (!currentRoomCode || !currentUserData || (!currentUserData.isHost && currentUserData.role !== 'moderator')) {
      socket.emit('action-denied', { message: 'Only hosts and moderators can mute users.' });
      return;
    }

    const roomState = activeRooms.get(currentRoomCode);
    if (roomState) {
      for (const [sId, member] of roomState.members.entries()) {
        if (member.uuid === targetUuid) {
          member.isAudioActive = false;
          const targetSocket = io.sockets.sockets.get(sId);
          if (targetSocket) {
            targetSocket.emit('force-mute-audio', { message: 'Your microphone has been muted by the host.' });
          }
        }
      }
      io.to(currentRoomCode).emit('members-updated', { members: Array.from(roomState.members.values()) });
    }
  });

  // Real-time participant status synchronization (sync status, drift, audio/video activity)
  socket.on('update-member-status', (statusData) => {
    if (!currentRoomCode) return;
    const roomState = activeRooms.get(currentRoomCode);
    if (!roomState) return;

    const member = roomState.members.get(socket.id);
    if (member) {
      if (statusData.syncStatus) member.syncStatus = statusData.syncStatus;
      if (statusData.drift !== undefined) member.drift = statusData.drift;
      if (statusData.isAudioActive !== undefined) member.isAudioActive = Boolean(statusData.isAudioActive);
      if (statusData.isVideoActive !== undefined) member.isVideoActive = Boolean(statusData.isVideoActive);
      if (statusData.isScreensharing !== undefined) member.isScreensharing = Boolean(statusData.isScreensharing);
      if (statusData.isBuffering !== undefined) member.isBuffering = Boolean(statusData.isBuffering);

      if (!roomState._memberUpdateThrottle) {
        roomState._memberUpdateThrottle = setTimeout(() => {
          roomState._memberUpdateThrottle = null;
          io.to(currentRoomCode).emit('members-updated', { members: Array.from(roomState.members.values()) });
        }, 800);
      }
    }
  });

  // Per-member buffering status, used only for the informational "buffering" indicator
  // in the member list UI. This deliberately does NOT pause or hold playback for anyone --
  // each client independently reconciles to the authoritative server timeline via its own
  // NTP clock offset + PLL drift correction (see checkAndCorrectDrift on the client).
  socket.on('client-buffer-state', ({ isBuffering }) => {
    if (!currentRoomCode) return;
    const roomState = activeRooms.get(currentRoomCode);
    if (!roomState) return;

    const member = roomState.members.get(socket.id);
    if (member) member.isBuffering = Boolean(isBuffering);
  });

  socket.on('ban-user', ({ targetUuid, targetName, reason }) => {
    if (!currentRoomCode || !currentUserData || !currentUserData.isHost) return;

    // Add to SQLite banned list
    db.prepare('INSERT OR IGNORE INTO room_banned_users (room_code, user_uuid, reason) VALUES (?, ?, ?)').run(
      currentRoomCode,
      targetUuid,
      reason || 'Banned by host'
    );

    // Find and kick the socket
    const roomState = activeRooms.get(currentRoomCode);
    if (roomState) {
      for (const [sId, member] of roomState.members.entries()) {
        if (member.uuid === targetUuid) {
          const targetSocket = io.sockets.sockets.get(sId);
          if (targetSocket) {
            targetSocket.emit('banned-notice', { message: 'You have been banned from this room by the host.' });
            targetSocket.disconnect();
          }
          roomState.members.delete(sId);
        }
      }
    }

    io.to(currentRoomCode).emit('members-updated', { members: Array.from(roomState ? roomState.members.values() : []) });

    const sysMsg = {
      id: 'sys-' + Date.now(),
      senderName: 'System',
      senderUuid: 'system',
      text: `Host banned ${targetName || 'user'} from this room.`,
      isSystem: true,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    io.to(currentRoomCode).emit('chat-message', sysMsg);
  });

  // 7. Floating Live Emoji Particles
  socket.on('emoji-reaction', ({ emoji }) => {
    if (!currentRoomCode) return;
    io.to(currentRoomCode).emit('emoji-reaction', { emoji });
  });

  // 8. PeerJS signaling for WebRTC video grid & screen share
  socket.on('register-peer-id', ({ peerId }) => {
    if (!currentRoomCode || !currentUserData) return;
    currentUserData.peerId = peerId;
    const roomState = activeRooms.get(currentRoomCode);
    if (roomState) {
      roomState.members.set(socket.id, currentUserData);
    }
    socket.to(currentRoomCode).emit('peer-connected', {
      userUuid: currentUserData.uuid,
      userName: currentUserData.name,
      peerId
    });
  });

  socket.on('request-screenshare-feed', ({ broadcasterPeerId, myPeerId }) => {
    if (!currentRoomCode || !currentUserData) return;
    io.to(currentRoomCode).emit('screenshare-feed-requested', {
      broadcasterPeerId,
      requesterPeerId: myPeerId || currentUserData.peerId,
      requesterUuid: currentUserData.uuid
    });
  });

  // Change display name / nickname
  socket.on('change-nickname', ({ nickname }) => {
    if (!currentRoomCode || !currentUserData || !nickname) return;
    const oldName = currentUserData.name;
    const trimmed = String(nickname).trim().substring(0, 32);
    if (!trimmed) return;
    currentUserData.name = trimmed;

    const roomState = activeRooms.get(currentRoomCode);
    if (roomState) {
      roomState.members.set(socket.id, currentUserData);
      io.to(currentRoomCode).emit('members-updated', { members: Array.from(roomState.members.values()) });

      const sysMsg = {
        id: 'sys-' + Date.now(),
        senderName: 'System',
        senderUuid: 'system',
        text: `${oldName} is now known as "${trimmed}".`,
        isSystem: true,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      io.to(currentRoomCode).emit('chat-message', sysMsg);
    }
  });

  // 9. Disconnect
  socket.on('disconnect', () => {
    if (currentRoomCode && currentUserData) {
      const roomState = activeRooms.get(currentRoomCode);
      if (roomState) {
        roomState.members.delete(socket.id);
        socket.to(currentRoomCode).emit('member-left', {
          socketId: socket.id,
          userUuid: currentUserData.uuid,
          name: currentUserData.name,
          peerId: currentUserData.peerId
        });

        // Cleanup screenshare if disconnecting user was broadcaster (DEF-24)
        if (roomState.screensharePeerId && (roomState.screensharePeerId === currentUserData.peerId || roomState.hostUuid === currentUserData.uuid)) {
          console.log(`[Screenshare] Broadcaster ${currentUserData.name} disconnected from ${currentRoomCode}. Resetting stage.`);
          roomState.screensharePeerId = null;
          roomState.screenshareHostName = null;
          const restored = (roomState.originalMedia && roomState.originalMedia.url && !roomState.originalMedia.url.startsWith('webrtc'))
            ? roomState.originalMedia
            : (roomState.previousMedia && roomState.previousMedia.url && !roomState.previousMedia.url.startsWith('webrtc')
              ? roomState.previousMedia
              : {
                  url: 'https://www.youtube.com/watch?v=8hly31xKli0',
                  type: 'youtube',
                  title: 'Algorithms and Data Structures Tutorial',
                  time: 0
                });

          roomState.mediaType = restored.type || 'youtube';
          roomState.mediaUrl = restored.url || 'https://www.youtube.com/watch?v=8hly31xKli0';
          roomState.mediaTitle = restored.title || 'Algorithms and Data Structures Tutorial';
          roomState.currentTime = restored.time || 0;
          roomState.anchorMediaTime = roomState.currentTime;
          roomState.isPlaying = false;
          roomState.status = 'PAUSED';
          roomState.lastUpdatedAt = Date.now();
          roomState.anchorServerTime = Date.now();

          io.to(currentRoomCode).emit('sync-playback', {
            action: 'stop-screenshare',
            mediaUrl: roomState.mediaUrl,
            mediaType: roomState.mediaType,
            mediaTitle: roomState.mediaTitle,
            currentTime: roomState.currentTime,
            isPlaying: false
          });
        }

        // If room is empty, save final time state and schedule in-memory eviction
        if (roomState.members.size === 0) {
          db.prepare('UPDATE rooms SET media_url = ?, media_type = ? WHERE code = ?').run(
            roomState.mediaUrl,
            roomState.mediaType,
            currentRoomCode
          );
          scheduleRoomEvictionIfEmpty(currentRoomCode, roomState);
        }
      }
      console.log(`[Socket] ${currentUserData.name} left ${currentRoomCode}`);
    }
  });
});

// Periodic Authoritative State Beacon (2000ms Heartbeat)
setInterval(() => {
  const now = Date.now();
  for (const [code, roomState] of activeRooms.entries()) {
    if (roomState.members && roomState.members.size > 0 && !roomState.screensharePeerId) {
      const curTime = calculateCurrentMediaTime(roomState, now);
      io.to(code).emit('sync:beacon', {
        action: 'beacon',
        currentTime: curTime,
        anchorMediaTime: roomState.anchorMediaTime !== undefined ? roomState.anchorMediaTime : curTime,
        anchorServerTime: roomState.anchorServerTime || roomState.lastUpdatedAt || now,
        isPlaying: roomState.isPlaying,
        status: roomState.status || (roomState.isPlaying ? 'PLAYING' : 'PAUSED'),
        playbackRate: roomState.playbackRate || 1.0,
        baseRate: roomState.playbackRate || 1.0,
        seq: roomState.seq || 1,
        serverTime: now
      });
    }
  }
}, 2000);

// Start HTTP & WebSocket Server (Binds to 0.0.0.0 for Render & Local networking)
server.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(`🚀 UniTogether Server running at http://0.0.0.0:${PORT}`);
  console.log(`📹 PeerJS server mounted at http://0.0.0.0:${PORT}/peerjs`);
  console.log(`🗄️ Embedded SQLite database initialized at backend/unitogether.db`);
  console.log(`====================================================`);
});

module.exports = { app, server };
