const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'unitogether.db');
const db = new Database(dbPath);

// Enable WAL mode for high concurrency & better write performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize schema tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    faculty TEXT NOT NULL DEFAULT 'Computing & IT',
    role TEXT NOT NULL DEFAULT 'student',
    avatar_url TEXT DEFAULT '',
    student_id TEXT DEFAULT 'IT22094482',
    campus TEXT DEFAULT 'Sri Lanka Institute of Information Technology (SLIIT)',
    stream_quality TEXT DEFAULT '1080',
    email_notifs INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS study_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_uuid TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    word_count INTEGER DEFAULT 0,
    category TEXT DEFAULT 'General',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    title TEXT NOT NULL,
    category TEXT DEFAULT 'study',
    host_uuid TEXT NOT NULL,
    visibility TEXT DEFAULT 'public',
    passcode_hash TEXT DEFAULT NULL,
    host_sync_lock INTEGER DEFAULT 0,
    allow_guests INTEGER DEFAULT 1,
    allow_guest_chat INTEGER DEFAULT 1,
    allow_guest_control INTEGER DEFAULT 1,
    smooth_catch_up INTEGER DEFAULT 1,
    max_users INTEGER DEFAULT 50,
    media_url TEXT NOT NULL,
    media_type TEXT DEFAULT 'youtube',
    media_title TEXT DEFAULT 'Lecture Stream',
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS room_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_code TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    duration INTEGER DEFAULT 0,
    media_type TEXT DEFAULT 'youtube',
    added_by_name TEXT NOT NULL,
    added_by_uuid TEXT NOT NULL,
    order_index INTEGER DEFAULT 0,
    is_played INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS room_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_code TEXT NOT NULL,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    media_type TEXT NOT NULL,
    played_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_code TEXT NOT NULL,
    sender_uuid TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    sender_avatar TEXT DEFAULT '',
    encrypted_payload TEXT NOT NULL,
    is_system_event INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS room_banned_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_code TEXT NOT NULL,
    user_uuid TEXT NOT NULL,
    reason TEXT DEFAULT 'Banned by host',
    banned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(room_code, user_uuid)
  );

  -- Index definitions for high-frequency queries (DEF-28)
  CREATE INDEX IF NOT EXISTS idx_rooms_code ON rooms(code);
  CREATE INDEX IF NOT EXISTS idx_room_queue_code ON room_queue(room_code);
  CREATE INDEX IF NOT EXISTS idx_chat_messages_code ON chat_messages(room_code);
  CREATE INDEX IF NOT EXISTS idx_room_history_code ON room_history(room_code);
  CREATE INDEX IF NOT EXISTS idx_study_notes_user ON study_notes(user_uuid);
`);

// Add auxiliary columns safely
try {
  db.prepare('ALTER TABLE chat_messages ADD COLUMN attachment_url TEXT').run();
} catch (e) {}
try {
  db.prepare('ALTER TABLE chat_messages ADD COLUMN attachment_name TEXT').run();
} catch (e) {}
try {
  db.prepare('ALTER TABLE rooms ADD COLUMN vote_skip_enabled INTEGER DEFAULT 1').run();
} catch (e) {}
try {
  db.prepare('ALTER TABLE rooms ADD COLUMN vote_skip_threshold INTEGER DEFAULT 50').run();
} catch (e) {}
try {
  db.prepare("ALTER TABLE users ADD COLUMN student_id TEXT DEFAULT 'IT22094482'").run();
} catch (e) {}
try {
  db.prepare("ALTER TABLE users ADD COLUMN campus TEXT DEFAULT 'Sri Lanka Institute of Information Technology (SLIIT)'").run();
} catch (e) {}
try {
  db.prepare("ALTER TABLE users ADD COLUMN stream_quality TEXT DEFAULT '1080'").run();
} catch (e) {}
try {
  db.prepare("ALTER TABLE users ADD COLUMN email_notifs INTEGER DEFAULT 1").run();
} catch (e) {}

// Seed default student account if not present
const defaultEmail = 'student@university.ac.lk';
const existingUser = db.prepare('SELECT * FROM users WHERE email = ?').get(defaultEmail);
let defaultHostUuid = 'usr-host-default-001';

if (!existingUser) {
  const hash = bcrypt.hashSync('password123', 10);
  db.prepare(`
    INSERT INTO users (uuid, email, password_hash, full_name, faculty, role, avatar_url)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    defaultHostUuid,
    defaultEmail,
    hash,
    'Yasaru Bandara',
    'Computing & IT',
    'student',
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=80&q=80'
  );
  console.log('[SQLite] Seeded default student user: student@university.ac.lk / password123');
} else {
  defaultHostUuid = existingUser.uuid;
}

// Seed default room UNI-8842 if not present
const defaultRoomCode = 'UNI-8842';
const existingRoom = db.prepare('SELECT * FROM rooms WHERE code = ?').get(defaultRoomCode);

if (!existingRoom) {
  db.prepare(`
    INSERT INTO rooms (code, title, category, host_uuid, visibility, host_sync_lock, allow_guests, allow_guest_chat, allow_guest_control, media_url, media_type, media_title)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    defaultRoomCode,
    'CS204: Algorithms & Data Structures - Final Exam Review 🍿',
    'study',
    defaultHostUuid,
    'public',
    0, // host_sync_lock
    1, // allow_guests
    1, // allow_guest_chat
    1, // allow_guest_control
    'https://www.youtube.com/watch?v=8hly31xKli0',
    'youtube',
    'Algorithms and Data Structures Tutorial - Full Course'
  );

  // Seed default queue items
  const insertQueue = db.prepare(`
    INSERT INTO room_queue (room_code, url, title, duration, media_type, added_by_name, added_by_uuid, order_index)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertQueue.run(
    defaultRoomCode,
    'https://www.youtube.com/watch?v=8hly31xKli0',
    'Algorithms and Data Structures Tutorial - Full Course',
    1800,
    'youtube',
    'Yasaru Bandara',
    defaultHostUuid,
    0
  );

  insertQueue.run(
    defaultRoomCode,
    'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    'Open Source Demo Video (Direct MP4)',
    596,
    'direct',
    'Udith',
    'usr-udith-002',
    1
  );

  insertQueue.run(
    defaultRoomCode,
    'https://www.youtube.com/watch?v=oBt53YbR9Kk',
    'Dynamic Programming - Learn to Solve Algorithmic Problems',
    3600,
    'youtube',
    'Ramesh',
    'usr-ramesh-003',
    2
  );

  console.log('[SQLite] Seeded default room UNI-8842 with sample playlist queue');
}

// Automatically ensure realistic university demo users & rooms are seeded
try {
  const userCount = db.prepare('SELECT count(*) as c FROM users').get().c;
  if (userCount < 7) {
    const seedSampleData = require('./seed_sample_data');
    seedSampleData(db);
  }
} catch (e) {
  console.warn('[SQLite] Automatic seed check warning:', e.message);
}

// Ensure default student user has full profile metadata
try {
  db.prepare(`
    UPDATE users 
    SET student_id = COALESCE(student_id, 'IT22094482'),
        campus = COALESCE(campus, 'Sri Lanka Institute of Information Technology (SLIIT)'),
        stream_quality = COALESCE(stream_quality, '1080'),
        email_notifs = COALESCE(email_notifs, 1)
    WHERE uuid = ?
  `).run(defaultHostUuid);
} catch (e) {}

// Seed realistic study notes for default student if none exist
try {
  const notesCount = db.prepare('SELECT count(*) as c FROM study_notes WHERE user_uuid = ?').get(defaultHostUuid).c;
  if (notesCount === 0) {
    const insertNote = db.prepare(`
      INSERT INTO study_notes (user_uuid, title, content, word_count, category, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    insertNote.run(
      defaultHostUuid,
      'CS204 Dynamic Programming Review Notes',
      'Covered optimal substructure, tabulation vs memoization, 0/1 knapsack, and longest common subsequence.',
      450,
      'Algorithms',
      new Date().toISOString(),
      new Date().toISOString()
    );

    insertNote.run(
      defaultHostUuid,
      'Socket.io & WebRTC Architecture Cheatsheet',
      'Summary of sub-second video synchronization, STUN/TURN servers, and client event payloads.',
      680,
      'Web Engineering',
      new Date(Date.now() - 86400000 * 11).toISOString(),
      new Date(Date.now() - 86400000 * 11).toISOString()
    );

    insertNote.run(
      defaultHostUuid,
      'Computer Networks - OSI Model & TCP/IP',
      'Exam cram sheet covering 3-way handshakes, subnetting formulas, routing algorithms, and flow control.',
      820,
      'Networking',
      new Date(Date.now() - 86400000 * 24).toISOString(),
      new Date(Date.now() - 86400000 * 24).toISOString()
    );

    console.log('[SQLite] Seeded default study notes for student user');
  }
} catch (e) {
  console.warn('[SQLite] Study notes seed warning:', e.message);
}

module.exports = db;
