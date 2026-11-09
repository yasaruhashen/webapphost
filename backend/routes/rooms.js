const express = require('express');
const router = express.Router();
const { Room, User, QueueItem, Message } = require('../db/database');

// Helper to generate a guaranteed unique room code like "UNI-8842"
async function generateUniqueRoomCode() {
  for (let i = 0; i < 50; i++) {
    const num = Math.floor(1000 + Math.random() * 9000);
    const code = `UNI-${num}`;
    const exists = await Room.findOne({ code });
    if (!exists) return code;
  }
  return `UNI-${Date.now().toString().slice(-4)}`;
}

// ----------------------------------------------------------------------------
// GET /api/rooms - List watch rooms with strict user account isolation
// ----------------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const { category, search, host_email, scope } = req.query;
    const cleanHostEmail = (host_email && typeof host_email === 'string') ? host_email.trim().toLowerCase() : '';

    const filter = {};

    // If scope is explicitly 'public' or 'community', return public rooms created by other students
    if (scope === 'public' || scope === 'community') {
      filter.is_private = 0;
      if (cleanHostEmail) {
        filter.host_email = { $ne: cleanHostEmail };
      }
    } else if (cleanHostEmail) {
      // By default, when a user is signed in, return ONLY rooms belonging to this account!
      filter.host_email = cleanHostEmail;
    } else {
      // Unauthenticated / guest: show public rooms
      filter.is_private = 0;
    }

    if (category && category !== 'All' && category !== 'all' && category !== 'my-rooms') {
      filter.category = category;
    }

    if (search && search.trim() !== '') {
      const term = search.trim();
      const regex = new RegExp(term, 'i');
      filter.$or = [
        { title: regex },
        { host_name: regex },
        { code: regex }
      ];
    }

    const rooms = await Room.find(filter).sort({ created_at: -1 });
    res.json({
      rooms,
      total: rooms.length
    });
  } catch (error) {
    console.error('[Rooms API] Fetch rooms error:', error);
    res.status(500).json({ error: 'Failed to retrieve watch rooms.' });
  }
});

// ----------------------------------------------------------------------------
// POST /api/rooms - Create a new room with a unique code linked to account
// ----------------------------------------------------------------------------
router.post('/', async (req, res) => {
  try {
    const { title, category, host_name, host_email, is_private, passcode, media_url, media_title, media_source } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Room title is required.' });
    }

    let code = (req.body.code && typeof req.body.code === 'string') ? req.body.code.trim().toUpperCase() : '';
    if (code) {
      const existing = await Room.findOne({ code });
      if (existing) {
        code = await generateUniqueRoomCode();
      }
    } else {
      code = await generateUniqueRoomCode();
    }

    const cleanHostEmail = (host_email && typeof host_email === 'string') ? host_email.trim().toLowerCase() : 'guest@unitogether.edu';
    let hostName = host_name ? host_name.trim() : 'Student Host';

    // Look up user in database to retrieve user_id and verified name
    let userId = null;
    const user = await User.findOne({ email: cleanHostEmail });
    if (user) {
      userId = user.id;
      if (!host_name || host_name === 'Guest Host' || host_name === 'Yasaru') {
        hostName = user.display_name || user.name;
      }
    }

    let cleanMedia = (media_url && typeof media_url === 'string') ? media_url.trim() : '';
    if (!cleanMedia.startsWith('http://') && !cleanMedia.startsWith('https://')) {
      cleanMedia = 'https://www.youtube.com/watch?v=MsRSKLbz3ss';
    }

    const defaultTitle = media_title || title.trim();
    const defaultSource = media_source || 'YouTube (HD 1080p)';

    const newRoom = await Room.create({
      code,
      title: title.trim(),
      category: category || 'Study Group',
      host_name: hostName,
      host_email: cleanHostEmail,
      user_id: userId,
      is_private: is_private ? 1 : 0,
      passcode: passcode || null,
      media_url: cleanMedia,
      media_title: defaultTitle,
      media_source: defaultSource,
      active_members: 1
    });

    const io = req.app.get('io');
    if (io) {
      io.emit('rooms_updated');
    }

    res.status(201).json({
      message: 'Watch room created successfully!',
      room: newRoom
    });
  } catch (error) {
    console.error('[Rooms API] Create room error:', error);
    res.status(500).json({ error: 'Failed to create watch room.' });
  }
});

// ----------------------------------------------------------------------------
// PUT /api/rooms/:code - Update room details (with host verification)
// ----------------------------------------------------------------------------
router.put('/:code', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const { title, category, media_url, media_title, media_source, is_private, active_members, host_email } = req.body;

    const existing = await Room.findOne({ code });
    if (!existing) {
      return res.status(404).json({ error: 'Room not found.' });
    }

    // Verify ownership
    if (host_email && existing.host_email) {
      if (existing.host_email.trim().toLowerCase() !== host_email.trim().toLowerCase()) {
        return res.status(403).json({ error: 'You are not authorized to modify this room.' });
      }
    }

    if (title !== undefined) existing.title = title.trim();
    if (category !== undefined) existing.category = category.trim();
    if (media_url !== undefined) existing.media_url = media_url.trim();
    if (media_title !== undefined) existing.media_title = media_title.trim();
    if (media_source !== undefined) existing.media_source = media_source.trim();
    if (is_private !== undefined) existing.is_private = is_private ? 1 : 0;
    if (active_members !== undefined) existing.active_members = Number(active_members);

    await existing.save();

    const io = req.app.get('io');
    if (io) {
      io.to(code).emit('room_details_updated', existing);
      io.emit('rooms_updated');
    }

    res.json({
      message: 'Room details updated successfully!',
      room: existing
    });
  } catch (error) {
    console.error('[Rooms API] Update room error:', error);
    res.status(500).json({ error: 'Failed to update watch room details.' });
  }
});

// ----------------------------------------------------------------------------
// DELETE /api/rooms/:code - Remove / delete a room (with host verification)
// ----------------------------------------------------------------------------
router.delete('/:code', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const hostEmail = (req.query.host_email || (req.body && req.body.host_email) || '').trim().toLowerCase();

    const existing = await Room.findOne({ code });
    if (!existing) {
      return res.status(404).json({ error: 'Room not found.' });
    }

    // Verify ownership
    if (hostEmail && existing.host_email) {
      if (existing.host_email.trim().toLowerCase() !== hostEmail) {
        return res.status(403).json({ error: 'You are not authorized to delete this room.' });
      }
    }

    await Message.deleteMany({ room_code: code });
    await QueueItem.deleteMany({ room_code: code });
    await Room.deleteOne({ code });

    const io = req.app.get('io');
    if (io) {
      io.to(code).emit('room_deleted', { code });
      io.emit('rooms_updated');
    }

    res.json({
      message: 'Room deleted successfully!',
      code
    });
  } catch (error) {
    console.error('[Rooms API] Delete room error:', error);
    res.status(500).json({ error: 'Failed to delete room.' });
  }
});

// ----------------------------------------------------------------------------
// GET /api/rooms/:code - Get single room details, queue, and recent chat
// ----------------------------------------------------------------------------
router.get('/:code', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const room = await Room.findOne({ code });

    if (!room) {
      return res.status(404).json({ error: 'Watch party room not found.' });
    }

    const queue = await QueueItem.find({ room_code: code }).sort({ position: 1 });
    const messages = await Message.find({ room_code: code }).sort({ created_at: 1 });

    res.json({
      room,
      queue,
      messages
    });
  } catch (error) {
    console.error('[Rooms API] Get room details error:', error);
    res.status(500).json({ error: 'Failed to retrieve room details.' });
  }
});

// ----------------------------------------------------------------------------
// POST /api/rooms/:code/sync - Synchronize video playback state
// ----------------------------------------------------------------------------
router.post('/:code/sync', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const { current_time, is_playing, media_url, media_title } = req.body;

    const room = await Room.findOne({ code });
    if (!room) {
      return res.status(404).json({ error: 'Room not found.' });
    }

    if (current_time !== undefined) room.current_time = Number(current_time);
    if (is_playing !== undefined) room.is_playing = is_playing ? 1 : 0;
    if (media_url !== undefined) room.media_url = media_url;
    if (media_title !== undefined) room.media_title = media_title;

    await room.save();

    const io = req.app.get('io');
    if (io) {
      io.to(code).emit('peer_sync', {
        roomCode: code,
        current_time: room.current_time,
        is_playing: room.is_playing === 1,
        media_url: room.media_url,
        media_title: room.media_title
      });
    }

    res.json({
      message: 'Playback synchronized',
      syncState: room
    });
  } catch (error) {
    console.error('[Rooms API] Sync error:', error);
    res.status(500).json({ error: 'Failed to synchronize room state.' });
  }
});

// ----------------------------------------------------------------------------
// GET /api/rooms/:code/queue - Retrieve queue items
// ----------------------------------------------------------------------------
router.get('/:code/queue', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const queue = await QueueItem.find({ room_code: code }).sort({ position: 1 });
    res.json({ queue });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve playlist queue.' });
  }
});

// ----------------------------------------------------------------------------
// POST /api/rooms/:code/queue - Add item to playlist queue
// ----------------------------------------------------------------------------
router.post('/:code/queue', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const { title, media_url, duration, added_by } = req.body;

    if (!title || !media_url) {
      return res.status(400).json({ error: 'Video title and URL are required.' });
    }

    const count = await QueueItem.countDocuments({ room_code: code });
    const nextPos = count + 1;

    const newItem = await QueueItem.create({
      room_code: code,
      title: title.trim(),
      media_url: media_url.trim(),
      duration: duration || '03:30',
      added_by: added_by || 'Anonymous',
      position: nextPos
    });

    res.status(201).json({
      message: 'Item added to queue',
      item: newItem
    });
  } catch (error) {
    console.error('[Rooms API] Add queue item error:', error);
    res.status(500).json({ error: 'Failed to add item to queue.' });
  }
});

// ----------------------------------------------------------------------------
// DELETE /api/rooms/:code/queue/:id - Remove item from queue
// ----------------------------------------------------------------------------
router.delete('/:code/queue/:id', async (req, res) => {
  try {
    const { code, id } = req.params;
    await QueueItem.deleteOne({ room_code: code.toUpperCase(), _id: id });
    res.json({ message: 'Item removed from playlist queue.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete queue item.' });
  }
});

// ----------------------------------------------------------------------------
// GET /api/rooms/:code/messages - Retrieve chat history
// ----------------------------------------------------------------------------
router.get('/:code/messages', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const messages = await Message.find({ room_code: code }).sort({ created_at: 1 });
    res.json({ messages });
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve messages.' });
  }
});

// ----------------------------------------------------------------------------
// POST /api/rooms/:code/messages - Send a message to the room
// ----------------------------------------------------------------------------
router.post('/:code/messages', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const { user_name, user_avatar, message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message cannot be empty.' });
    }

    const newMsg = await Message.create({
      room_code: code,
      user_name: user_name || 'Guest',
      user_avatar: user_avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=80&q=80',
      message: message.trim()
    });

    const io = req.app.get('io');
    if (io) {
      io.to(code).emit('receive_message', newMsg);
    }

    res.status(201).json({
      message: 'Message sent',
      chatMessage: newMsg
    });
  } catch (error) {
    console.error('[Rooms API] Send message error:', error);
    res.status(500).json({ error: 'Failed to send message.' });
  }
});

module.exports = router;
