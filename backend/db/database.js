const { createClient } = require('@libsql/client');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

// Determine database file path or remote Turso URL
let dbUrl = process.env.TURSO_DATABASE_URL;
let dbAuthToken = process.env.TURSO_AUTH_TOKEN;

if (!dbUrl) {
  if (process.env.VERCEL) {
    // Vercel serverless functions have write access to /tmp
    dbUrl = 'file:/tmp/unitogether.db';
  } else {
    // Local development: store in backend/data/unitogether.db
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const dbPath = path.join(dataDir, 'unitogether.db').replace(/\\/g, '/');
    dbUrl = `file:${dbPath}`;
  }
}

console.log(`[Database] Initializing SQLite client with URL: ${dbUrl}`);

const client = createClient({
  url: dbUrl,
  authToken: dbAuthToken
});

function normalizeStmt(stmt, args) {
  if (typeof stmt === 'object' && stmt !== null && stmt.sql) {
    return { sql: stmt.sql, args: stmt.args || [] };
  }
  return { sql: stmt, args: args || [] };
}

// Helper functions for clean SQL execution
const db = {
  client,

  async execute(stmt, args = []) {
    return client.execute(normalizeStmt(stmt, args));
  },

  async all(stmt, args = []) {
    const res = await client.execute(normalizeStmt(stmt, args));
    return res.rows;
  },

  async get(stmt, args = []) {
    const res = await client.execute(normalizeStmt(stmt, args));
    return res.rows.length > 0 ? res.rows[0] : null;
  },

  async run(stmt, args = []) {
    const res = await client.execute(normalizeStmt(stmt, args));
    return {
      lastInsertRowid: res.lastInsertRowid,
      rowsAffected: res.rowsAffected
    };
  }
};

// Initialize schema and seed demo data
async function initDb() {
  try {
    // 1. Users Table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        faculty TEXT DEFAULT 'Faculty of Computing & IT',
        role TEXT DEFAULT 'host',
        avatar TEXT DEFAULT 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=80&q=80',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Rooms Table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS rooms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        category TEXT DEFAULT 'Study Group',
        host_name TEXT NOT NULL,
        host_email TEXT NOT NULL,
        is_private INTEGER DEFAULT 0,
        passcode TEXT,
        media_url TEXT DEFAULT 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
        media_title TEXT DEFAULT 'Data Structures & Algorithms - Dynamic Programming',
        media_source TEXT DEFAULT 'YouTube (HD 1080p)',
        current_time REAL DEFAULT 0,
        is_playing INTEGER DEFAULT 0,
        active_members INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. Playlist Queue Table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS queue_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_code TEXT NOT NULL,
        title TEXT NOT NULL,
        media_url TEXT NOT NULL,
        duration TEXT DEFAULT '03:45',
        added_by TEXT NOT NULL,
        position INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (room_code) REFERENCES rooms(code) ON DELETE CASCADE
      )
    `);

    // 4. Chat Messages Table
    await db.execute(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_code TEXT NOT NULL,
        user_name TEXT NOT NULL,
        user_avatar TEXT DEFAULT 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=80&q=80',
        message TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (room_code) REFERENCES rooms(code) ON DELETE CASCADE
      )
    `);

    // Seed Demo User if not exists
    const existingUser = await db.get('SELECT id FROM users WHERE email = ?', ['yasaru@university.ac.lk']);
    if (!existingUser) {
      const demoHash = bcrypt.hashSync('student123', 10);
      await db.execute({
        sql: `INSERT INTO users (name, email, password_hash, faculty, role, avatar)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          'Yasaru Bandara',
          'yasaru@university.ac.lk',
          demoHash,
          'Faculty of Computing & Technology',
          'host',
          'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=80&q=80'
        ]
      });
      console.log('[Database] Seeded demo user: yasaru@university.ac.lk / student123');
    }

    // Seed Demo Room if not exists
    const existingRoom = await db.get('SELECT id FROM rooms WHERE code = ?', ['UNI-8842']);
    if (!existingRoom) {
      await db.execute({
        sql: `INSERT INTO rooms (code, title, category, host_name, host_email, is_private, media_url, media_title, media_source, active_members)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          'UNI-8842',
          'CS204: Algorithms & Data Structures - Final Exam Review 🍿',
          'Study Group',
          'Yasaru Bandara',
          'yasaru@university.ac.lk',
          0,
          'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
          'Interstellar — Official Trailer',
          'YouTube (HD 1080p)',
          4
        ]
      });

      // Seed Queue for UNI-8842
      await db.execute({
        sql: `INSERT INTO queue_items (room_code, title, media_url, duration, added_by, position)
              VALUES 
              (?, ?, ?, ?, ?, 1),
              (?, ?, ?, ?, ?, 2),
              (?, ?, ?, ?, ?, 3)`,
        args: [
          'UNI-8842', 'Interstellar — Official Trailer', 'https://www.youtube.com/watch?v=zSWdZVtXT7E', '02:34', 'Alex',
          'UNI-8842', 'Hans Zimmer Live Suite', 'https://www.youtube.com/watch?v=1FhXG01tW28', '04:12', 'Yasaru',
          'UNI-8842', 'Hubble 3D Cosmic Journey', 'https://www.youtube.com/watch?v=2rUtS5qL3lM', '05:45', 'Ramesh'
        ]
      });

      // Seed Messages for UNI-8842
      await db.execute({
        sql: `INSERT INTO messages (room_code, user_name, user_avatar, message)
              VALUES 
              (?, ?, ?, ?),
              (?, ?, ?, ?),
              (?, ?, ?, ?)`,
        args: [
          'UNI-8842', 'Yasaru', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=80&q=80', 'Welcome everyone! Sound is on, let me know if audio volume is too loud for anyone 🍿',
          'UNI-8842', 'Udith', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=80&q=80', 'Sound is crystal clear! Hans Zimmer soundtrack always gives chills 🙌',
          'UNI-8842', 'Ramesh', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=80&q=80', 'I added the Hubble telescope 3D video to the queue right after this one!'
        ]
      });

      console.log('[Database] Seeded demo room UNI-8842 with queue & chat messages');
    }

    console.log('[Database] SQLite Schema initialization complete.');
  } catch (error) {
    console.error('[Database] Schema initialization error:', error);
  }
}

// Trigger initial setup
initDb();

module.exports = db;
