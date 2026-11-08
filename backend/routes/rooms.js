const express = require('express');
const router = express.Router();
const db = require('../db/database');

// Helper to generate a guaranteed unique room code like "UNI-8842"
async function generateUniqueRoomCode() {
  for (let i = 0; i < 50; i++) {
    const num = Math.floor(1000 + Math.random() * 9000);
    const code = `UNI-${num}`;
    const exists = await db.get('SELECT id FROM rooms WHERE code = ?', [code]);
    if (!exists) return code;
  }
  return `UNI-${Date.now().toString().slice(-4)}`;
}

// ----------------------------------------------------------------------------
// GET /api/rooms - List all watch rooms (with category & search filtering)
// ----------------------------------------------------------------------------
router.get('/', async (req, res) => {
  try {
    const { category, search } = req.query;
    let query = 'SELECT * FROM rooms WHERE is_private = 0';
    const params = [];

    if (category && category !== 'All' && category !== 'all') {
      query += ' AND category = ?';
      params.push(category);
    }

    if (search && search.trim() !== '') {
      query += ' AND (title LIKE ? OR host_name LIKE ? OR code LIKE ?)';
      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }

    query += ' ORDER BY created_at DESC';

    const rooms = await db.all(query, params);
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
// POST /api/rooms - Create a new room with a unique code
// ----------------------------------------------------------------------------
router.post('/', async (req, res) => {
  try {
    const { title, category, host_name, host_email, is_private, passcode, media_url, media_title, media_source } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Room title is required.' });
    }

    // Determine unique code (if user requested a custom one, check availability)
    let code = (req.body.code && typeof req.body.code === 'string') ? req.body.code.trim().toUpperCase() : '';
    if (code) {
      const existing = await db.get('SELECT id FROM rooms WHERE code = ?', [code]);
      if (existing) {
        code = await generateUniqueRoomCode();
      }
    } else {
      code = await generateUniqueRoomCode();
    }

    const hostName = host_name ? host_name.trim() : 'Yasaru (Host)';
    const defaultMedia = media_url || 'https://www.youtube.com/watch?v=zSWdZVtXT7E';
    const defaultTitle = media_title || title.trim();
    const defaultSource = media_source || 'YouTube (HD 1080p)';

    await db.execute({
      sql: `INSERT INTO rooms (code, title, category, host_name, host_email, is_private, passcode, media_url, media_title, media_source, active_members)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      args: [
        code,
        title.trim(),
        category || 'Study Group',
        hostName,
        host_email || 'student@unitogether.edu',
        is_private ? 1 : 0,
        passcode || null,
        defaultMedia,
        defaultTitle,
        defaultSource
      ]
    });

    const newRoom = await db.get('SELECT * FROM rooms WHERE code = ?', [code]);

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
// PUT /api/rooms/:code - Update room details
// ----------------------------------------------------------------------------
router.put('/:code', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const { title, category, media_url, media_title, media_source, is_private, active_members } = req.body;

    const existing = await db.get('SELECT * FROM rooms WHERE code = ?', [code]);
    if (!existing) {
      return res.status(404).json({ error: 'Room not found.' });
    }

    await db.execute({
      sql: `UPDATE rooms 
            SET title = COALESCE(?, title),
                category = COALESCE(?, category),
                media_url = COALESCE(?, media_url),
                media_title = COALESCE(?, media_title),
                media_source = COALESCE(?, media_source),
                is_private = COALESCE(?, is_private),
                active_members = COALESCE(?, active_members)
            WHERE code = ?`,
      args: [
        title ? title.trim() : null,
        category || null,
        media_url || null,
        media_title || null,
        media_source || null,
        is_private !== undefined ? (is_private ? 1 : 0) : null,
        active_members !== undefined ? active_members : null,
        code
      ]
    });

    const updated = await db.get('SELECT * FROM rooms WHERE code = ?', [code]);

    const io = req.app.get('io');
    if (io) {
      io.to(code).emit('room_details_updated', updated);
      io.emit('rooms_updated');
    }

    res.json({
      message: 'Room details updated successfully!',
      room: updated
    });
  } catch (error) {
    console.error('[Rooms API] Update room error:', error);
    res.status(500).json({ error: 'Failed to update watch room details.' });
  }
});

// ----------------------------------------------------------------------------
// DELETE /api/rooms/:code - Remove / delete a room
// ----------------------------------------------------------------------------
router.delete('/:code', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const existing = await db.get('SELECT id, title FROM rooms WHERE code = ?', [code]);
    if (!existing) {
      return res.status(404).json({ error: 'Room not found.' });
    }

    await db.execute('DELETE FROM messages WHERE room_code = ?', [code]);
    await db.execute('DELETE FROM queue_items WHERE room_code = ?', [code]);
    await db.execute('DELETE FROM rooms WHERE code = ?', [code]);

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
    const room = await db.get('SELECT * FROM rooms WHERE code = ?', [code]);

    if (!room) {
      return res.status(404).json({ error: 'Watch party room not found.' });
    }

    const queue = await db.all('SELECT * FROM queue_items WHERE room_code = ? ORDER BY position ASC', [code]);
    const messages = await db.all('SELECT * FROM messages WHERE room_code = ? ORDER BY created_at ASC', [code]);

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

    const room = await db.get('SELECT id FROM rooms WHERE code = ?', [code]);
    if (!room) {
      return res.status(404).json({ error: 'Room not found.' });
    }

    await db.execute({
      sql: `UPDATE rooms 
            SET current_time = COALESCE(?, current_time),
                is_playing = COALESCE(?, is_playing),
                media_url = COALESCE(?, media_url),
                media_title = COALESCE(?, media_title)
            WHERE code = ?`,
      args: [
        current_time !== undefined ? current_time : null,
        is_playing !== undefined ? (is_playing ? 1 : 0) : null,
        media_url || null,
        media_title || null,
        code
      ]
    });

    const updated = await db.get('SELECT code, current_time, is_playing, media_url, media_title FROM rooms WHERE code = ?', [code]);
    const io = req.app.get('io');
    if (io) {
      io.to(code).emit('peer_sync', {
        roomCode: code,
        current_time: updated.current_time,
        is_playing: updated.is_playing === 1,
        media_url: updated.media_url,
        media_title: updated.media_title
      });
    }
    res.json({
      message: 'Playback synchronized',
      syncState: updated
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
    const queue = await db.all('SELECT * FROM queue_items WHERE room_code = ? ORDER BY position ASC', [code]);
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

    const countRes = await db.get('SELECT COUNT(*) as cnt FROM queue_items WHERE room_code = ?', [code]);
    const nextPos = (countRes ? countRes.cnt : 0) + 1;

    const runRes = await db.run(
      `INSERT INTO queue_items (room_code, title, media_url, duration, added_by, position)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [code, title.trim(), media_url.trim(), duration || '03:30', added_by || 'Anonymous', nextPos]
    );

    const newItem = await db.get('SELECT * FROM queue_items WHERE id = ?', [runRes.lastInsertRowid]);
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
    await db.execute('DELETE FROM queue_items WHERE room_code = ? AND id = ?', [code.toUpperCase(), id]);
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
    const messages = await db.all('SELECT * FROM messages WHERE room_code = ? ORDER BY created_at ASC', [code]);
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

    const runRes = await db.run(
      `INSERT INTO messages (room_code, user_name, user_avatar, message)
       VALUES (?, ?, ?, ?)`,
      [
        code,
        user_name || 'Guest',
        user_avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=80&q=80',
        message.trim()
      ]
    );

    const newMsg = await db.get('SELECT * FROM messages WHERE id = ?', [runRes.lastInsertRowid]);
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

