const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const { User, Room } = require('../db/database');

const JWT_SECRET = process.env.JWT_SECRET || 'unitogether_super_secret_jwt_key_2026';

// Helper to generate token
function generateToken(user) {
  const userId = user.id || (user._id ? user._id.toString() : '');
  return jwt.sign(
    { id: userId, email: user.email, name: user.name, role: user.role || 'host' },
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
    const existing = await User.findOne({ email: cleanEmail });
    if (existing) {
      return res.status(409).json({ error: 'An account with this student email already exists.' });
    }

    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password.trim(), salt);
    const defaultAvatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(name.trim())}`;

    const newUser = await User.create({
      name: name.trim(),
      display_name: name.trim(),
      email: cleanEmail,
      password_hash: passwordHash,
      faculty: faculty || 'Faculty of Computing & Technology',
      role: 'host',
      avatar: defaultAvatar
    });

    const userObj = {
      ...newUser.toJSON(),
      isGuest: false
    };

    const token = generateToken(userObj);
    res.status(201).json({
      message: 'Account created successfully!',
      user: userObj,
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
    const user = await User.findOne({ email: cleanEmail });

    if (!user) {
      return res.status(401).json({ error: 'Invalid university email or password.' });
    }

    const match = bcrypt.compareSync(password.trim(), user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid university email or password.' });
    }

    const userObj = {
      ...user.toJSON(),
      isGuest: false
    };

    const token = generateToken(userObj);
    res.json({
      message: 'Logged in successfully!',
      user: userObj,
      token
    });
  } catch (error) {
    console.error('[Auth API] Login error:', error);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// Helper to get Google Client ID & Secret from env or backend client_secret JSON file
function getGoogleCredentials() {
  let clientId = process.env.GOOGLE_CLIENT_ID || '';
  let clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';

  if (!clientId || !clientSecret) {
    try {
      const backendDir = path.join(__dirname, '..');
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

  return { clientId, clientSecret };
}

// ----------------------------------------------------------------------------
// GET /api/auth/config - Public OAuth Configuration
// ----------------------------------------------------------------------------
router.get('/config', (req, res) => {
  const { clientId } = getGoogleCredentials();
  res.json({
    googleClientId: clientId || process.env.GOOGLE_CLIENT_ID || '1046397793542-76dogkonem1a8r1fid5ob9t0gcreffto.apps.googleusercontent.com',
    facebookAppId: process.env.FACEBOOK_APP_ID || ''
  });
});

// ----------------------------------------------------------------------------
// POST /api/auth/config - Update OAuth Client IDs in memory & persist to .env
// ----------------------------------------------------------------------------
router.post('/config', (req, res) => {
  try {
    const { googleClientId, facebookAppId } = req.body;
    if (googleClientId !== undefined) process.env.GOOGLE_CLIENT_ID = googleClientId.trim();
    if (facebookAppId !== undefined) process.env.FACEBOOK_APP_ID = facebookAppId.trim();

    const envPath = path.join(__dirname, '..', '.env');
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }

    const updateEnvVar = (key, val) => {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${key}=${val}`);
      } else {
        envContent += `\n${key}=${val}`;
      }
    };

    if (googleClientId !== undefined) updateEnvVar('GOOGLE_CLIENT_ID', googleClientId.trim());
    if (facebookAppId !== undefined) updateEnvVar('FACEBOOK_APP_ID', facebookAppId.trim());

    fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf8');

    res.json({
      message: 'OAuth configuration updated successfully.',
      googleClientId: process.env.GOOGLE_CLIENT_ID || '',
      facebookAppId: process.env.FACEBOOK_APP_ID || ''
    });
  } catch (err) {
    console.error('[Auth Config] Error saving config:', err);
    res.status(500).json({ error: 'Failed to save OAuth configuration.' });
  }
});

// ----------------------------------------------------------------------------
// POST /api/auth/google - Authenticate using Real Google ID Token or Access Token
// ----------------------------------------------------------------------------
router.post('/google', async (req, res) => {
  try {
    const { credential, access_token } = req.body;

    if (!credential && !access_token) {
      return res.status(400).json({ error: 'Google credential or access token is required.' });
    }

    let googleEmail = '';
    let googleName = '';
    let googleAvatar = '';

    if (credential) {
      const tokenInfoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
      if (!tokenInfoRes.ok) {
        const errText = await tokenInfoRes.text();
        console.error('[Google OAuth] Token verification failed:', errText);
        return res.status(401).json({ error: 'Invalid Google credential token.' });
      }
      const tokenData = await tokenInfoRes.json();
      googleEmail = tokenData.email;
      googleName = tokenData.name || (tokenData.given_name ? `${tokenData.given_name} ${tokenData.family_name || ''}`.trim() : 'Google Student');
      googleAvatar = tokenData.picture || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(googleEmail)}`;
    } else if (access_token) {
      const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` }
      });
      if (!userInfoRes.ok) {
        return res.status(401).json({ error: 'Failed to fetch Google user profile from Google API.' });
      }
      const userData = await userInfoRes.json();
      googleEmail = userData.email;
      googleName = userData.name || userData.given_name || 'Google Student';
      googleAvatar = userData.picture || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(googleEmail)}`;
    }

    if (!googleEmail) {
      return res.status(400).json({ error: 'Could not retrieve email from Google account.' });
    }

    const cleanEmail = googleEmail.trim().toLowerCase();
    let user = await User.findOne({ email: cleanEmail });

    if (!user) {
      const salt = bcrypt.genSaltSync(10);
      const dummyHash = bcrypt.hashSync(`google_oauth_${Date.now()}`, salt);
      user = await User.create({
        name: googleName,
        display_name: googleName,
        email: cleanEmail,
        password_hash: dummyHash,
        faculty: 'Google Verified Student',
        role: 'host',
        avatar: googleAvatar
      });
    } else {
      if (googleAvatar && (!user.avatar || user.avatar.includes('dicebear'))) {
        user.avatar = googleAvatar;
        await user.save();
      }
    }

    const userObj = {
      ...user.toJSON(),
      provider: 'google',
      isGuest: false
    };

    const token = generateToken(userObj);
    res.json({
      message: `Successfully signed in via Google as ${user.name}!`,
      user: userObj,
      token
    });
  } catch (error) {
    console.error('[Google OAuth] Server error:', error);
    res.status(500).json({ error: 'Server error during Google authentication.' });
  }
});

// ----------------------------------------------------------------------------
// POST /api/auth/facebook - Authenticate using Real Facebook Access Token
// ----------------------------------------------------------------------------
router.post('/facebook', async (req, res) => {
  try {
    const { access_token } = req.body;
    if (!access_token) {
      return res.status(400).json({ error: 'Facebook access token is required.' });
    }

    const fbRes = await fetch(`https://graph.facebook.com/me?fields=id,name,email,picture.width(200).height(200)&access_token=${encodeURIComponent(access_token)}`);
    if (!fbRes.ok) {
      const errData = await fbRes.json().catch(() => ({}));
      return res.status(401).json({ error: errData.error?.message || 'Invalid Facebook token.' });
    }

    const fbData = await fbRes.json();
    const fbName = fbData.name || 'Facebook Student';
    const fbEmail = (fbData.email || `${fbData.id}@facebook.user`).toLowerCase();
    const fbAvatar = fbData.picture?.data?.url || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(fbEmail)}`;

    let user = await User.findOne({ email: fbEmail });
    if (!user) {
      const salt = bcrypt.genSaltSync(10);
      const dummyHash = bcrypt.hashSync(`fb_oauth_${Date.now()}`, salt);
      user = await User.create({
        name: fbName,
        display_name: fbName,
        email: fbEmail,
        password_hash: dummyHash,
        faculty: 'Facebook Student Network',
        role: 'host',
        avatar: fbAvatar
      });
    }

    const userObj = {
      ...user.toJSON(),
      provider: 'facebook',
      isGuest: false
    };

    const token = generateToken(userObj);
    res.json({
      message: `Successfully signed in via Facebook as ${user.name}!`,
      user: userObj,
      token
    });
  } catch (error) {
    console.error('[Facebook OAuth] Server error:', error);
    res.status(500).json({ error: 'Server error during Facebook authentication.' });
  }
});

// ----------------------------------------------------------------------------
// POST /api/auth/oauth - Social login fallback (Google / Facebook)
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

    let user = await User.findOne({ email: cleanEmail });

    if (!user) {
      const salt = bcrypt.genSaltSync(10);
      const dummyHash = bcrypt.hashSync(`oauth_${provider}_${Date.now()}`, salt);
      const faculty = (provider === 'google') ? 'Google Verified Student' : 'Facebook Student Network';

      user = await User.create({
        name: cleanName,
        display_name: cleanName,
        email: cleanEmail,
        password_hash: dummyHash,
        faculty: faculty,
        role: 'host',
        avatar: userAvatar
      });
    }

    const userObj = {
      ...user.toJSON(),
      provider: provider,
      isGuest: false
    };

    const token = generateToken(userObj);
    res.json({
      message: `Signed in with ${provider === 'google' ? 'Google' : 'Facebook'} successfully!`,
      user: userObj,
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

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(404).json({ error: 'User account not found.' });
    }

    res.json({
      user: {
        ...user.toJSON(),
        isGuest: false
      }
    });
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
});

// ----------------------------------------------------------------------------
// PUT /api/auth/profile - Update student profile details & avatar
// ----------------------------------------------------------------------------
router.put('/profile', async (req, res) => {
  try {
    const { name, displayName, email, avatar, faculty, institution, phone, bio, degree } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required to update profile.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: cleanEmail });
    if (!user) {
      return res.status(404).json({ error: 'User profile not found.' });
    }

    if (name !== undefined) user.name = name.trim();
    if (displayName !== undefined) user.display_name = displayName.trim();
    if (avatar !== undefined) user.avatar = avatar.trim();
    if (faculty !== undefined) user.faculty = faculty.trim();
    if (institution !== undefined) user.institution = institution.trim();
    if (phone !== undefined) user.phone = phone.trim();
    if (bio !== undefined) user.bio = bio.trim();
    if (degree !== undefined) user.degree = degree.trim();

    await user.save();

    // Also update host_name on all rooms owned by this user
    const updatedDisplayName = user.display_name || user.name;
    await Room.updateMany({ host_email: cleanEmail }, { host_name: updatedDisplayName });

    res.json({
      message: 'Profile updated successfully!',
      user: {
        ...user.toJSON(),
        isGuest: false
      }
    });
  } catch (error) {
    console.error('[Auth API] Profile update error:', error);
    res.status(500).json({ error: 'Failed to update profile.' });
  }
});

module.exports = router;
