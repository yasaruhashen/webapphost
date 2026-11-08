const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/database');

const JWT_SECRET = process.env.JWT_SECRET || 'unitogether_super_secret_jwt_key_2026';

// Helper to generate token
function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// ----------------------------------------------------------------------------
// POST /api/auth/register - Register new student account
// ----------------------------------------------------------------------------
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, faculty } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, student email, and password are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Check if user already exists
    const existing = await db.get('SELECT id FROM users WHERE email = ?', [cleanEmail]);
    if (existing) {
      return res.status(409).json({ error: 'An account with this student email already exists.' });
    }

    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password.trim(), salt);
    const defaultAvatar = 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=80&q=80';

    const insertRes = await db.run(
      `INSERT INTO users (name, email, password_hash, faculty, role, avatar)
       VALUES (?, ?, ?, ?, 'host', ?)`,
      [name.trim(), cleanEmail, passwordHash, faculty || 'Faculty of Computing & Technology', defaultAvatar]
    );

    const user = {
      id: Number(insertRes.lastInsertRowid),
      name: name.trim(),
      email: cleanEmail,
      faculty: faculty || 'Faculty of Computing & Technology',
      role: 'host',
      avatar: defaultAvatar,
      isGuest: false
    };

    const token = generateToken(user);
    res.status(201).json({
      message: 'Account created successfully!',
      user,
      token
    });
  } catch (error) {
    console.error('[Auth API] Register error:', error);
    res.status(500).json({ error: 'Server error during registration.' });
  }
});

// ----------------------------------------------------------------------------
// POST /api/auth/login - Authenticate student credentials
// ----------------------------------------------------------------------------
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Student email and password are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const userRow = await db.get('SELECT * FROM users WHERE email = ?', [cleanEmail]);

    if (!userRow) {
      return res.status(401).json({ error: 'Invalid university email or password.' });
    }

    const match = bcrypt.compareSync(password.trim(), userRow.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid university email or password.' });
    }

    const user = {
      id: userRow.id,
      name: userRow.name,
      email: userRow.email,
      faculty: userRow.faculty,
      role: userRow.role,
      avatar: userRow.avatar,
      isGuest: false
    };

    const token = generateToken(user);
    res.json({
      message: 'Logged in successfully!',
      user,
      token
    });
  } catch (error) {
    console.error('[Auth API] Login error:', error);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// ----------------------------------------------------------------------------
// POST /api/auth/oauth - Social login (Google / Facebook)
// ----------------------------------------------------------------------------
router.post('/oauth', async (req, res) => {
  try {
    const { provider, name, email, avatar } = req.body;

    if (!provider || !email) {
      return res.status(400).json({ error: 'Provider and email are required.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = (name && name.trim()) ? name.trim() : (provider === 'google' ? 'Google Student' : 'Facebook Student');

    let userAvatar = avatar;
    if (!userAvatar) {
      userAvatar = (provider === 'google')
        ? 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=80&q=80'
        : 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?auto=format&fit=crop&w=80&q=80';
    }

    let userRow = await db.get('SELECT * FROM users WHERE email = ?', [cleanEmail]);

    if (!userRow) {
      const salt = bcrypt.genSaltSync(10);
      const dummyHash = bcrypt.hashSync(`oauth_${provider}_${Date.now()}`, salt);
      const faculty = (provider === 'google') ? 'Google Verified Student' : 'Facebook Student Network';

      const insertRes = await db.run(
        `INSERT INTO users (name, email, password_hash, faculty, role, avatar)
         VALUES (?, ?, ?, ?, 'host', ?)`,
        [cleanName, cleanEmail, dummyHash, faculty, userAvatar]
      );

      userRow = await db.get('SELECT * FROM users WHERE id = ?', [insertRes.lastInsertRowid]);
    }

    const user = {
      id: userRow.id,
      name: userRow.name,
      email: userRow.email,
      faculty: userRow.faculty,
      role: userRow.role,
      avatar: userRow.avatar,
      provider: provider,
      isGuest: false
    };

    const token = generateToken(user);

    res.json({
      message: `Signed in with ${provider === 'google' ? 'Google' : 'Facebook'} successfully!`,
      user,
      token
    });
  } catch (error) {
    console.error('[Auth API] OAuth login error:', error);
    res.status(500).json({ error: 'Server error during social login.' });
  }
});

// ----------------------------------------------------------------------------
// GET /api/auth/me - Verify session token
// ----------------------------------------------------------------------------
router.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized. Token missing.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const userRow = await db.get('SELECT id, name, email, faculty, role, avatar FROM users WHERE id = ?', [decoded.id]);
    if (!userRow) {
      return res.status(404).json({ error: 'User account not found.' });
    }

    res.json({
      user: {
        ...userRow,
        isGuest: false
      }
    });
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
});

module.exports = router;

