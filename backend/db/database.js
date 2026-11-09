const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

// Real Mongoose Models
const RealUser = require('../models/User');
const RealRoom = require('../models/Room');
const RealQueueItem = require('../models/QueueItem');
const RealMessage = require('../models/Message');

const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI || '';

// ----------------------------------------------------------------------------
// Lightning-Fast Persistent Local Storage (Fallback when MongoDB is offline)
// ----------------------------------------------------------------------------
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const storeFilePath = path.join(dataDir, 'store.json');

let storeData = {
  users: [],
  rooms: [],
  queue_items: [],
  messages: []
};

function loadStore() {
  try {
    if (fs.existsSync(storeFilePath)) {
      const raw = fs.readFileSync(storeFilePath, 'utf8');
      const parsed = JSON.parse(raw);
      storeData = { ...storeData, ...parsed };
    }
  } catch (e) {
    console.warn('[LocalStorage] Error loading store.json:', e.message);
  }
}

function persistStore() {
  try {
    fs.writeFileSync(storeFilePath, JSON.stringify(storeData, null, 2), 'utf8');
  } catch (e) {
    console.warn('[LocalStorage] Error persisting store.json:', e.message);
  }
}

loadStore();

// Seed initial demo data into store if empty
function seedLocalStore() {
  const demoEmail = 'yasaru@university.ac.lk';
  let demoUser = storeData.users.find(u => u.email.toLowerCase() === demoEmail);
  if (!demoUser) {
    const demoHash = bcrypt.hashSync('student123', 10);
    demoUser = {
      _id: 'user_yasaru_demo_101',
      id: 'user_yasaru_demo_101',
      name: 'Yasaru Bandara',
      display_name: 'Yasaru',
      email: demoEmail,
      password_hash: demoHash,
      faculty: 'Faculty of Computing & Technology',
      role: 'host',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=80&q=80',
      institution: 'University of Sri Jayewardenepura',
      degree: 'BSc (Hons) Computer Science',
      created_at: new Date().toISOString()
    };
    storeData.users.push(demoUser);
  }

  const demoRoomCode = 'UNI-8842';
  let demoRoom = storeData.rooms.find(r => r.code === demoRoomCode);
  if (!demoRoom) {
    demoRoom = {
      _id: 'room_uni8842_demo_202',
      id: 'room_uni8842_demo_202',
      code: demoRoomCode,
      title: 'CS204: Algorithms & Data Structures - Final Exam Review 🍿',
      category: 'Study Group',
      host_name: 'Yasaru Bandara',
      host_email: demoEmail,
      user_id: demoUser.id,
      is_private: 0,
      passcode: null,
      media_url: 'https://www.youtube.com/watch?v=MsRSKLbz3ss',
      media_title: 'Interstellar — Official Trailer',
      media_source: 'YouTube (HD 1080p)',
      current_time: 0,
      is_playing: 0,
      active_members: 4,
      created_at: new Date().toISOString()
    };
    storeData.rooms.push(demoRoom);

    storeData.queue_items.push(
      { _id: 'q1', id: 'q1', room_code: demoRoomCode, title: 'Interstellar — Official Trailer', media_url: 'https://www.youtube.com/watch?v=MsRSKLbz3ss', duration: '02:34', added_by: 'Alex', position: 1, created_at: new Date().toISOString() },
      { _id: 'q2', id: 'q2', room_code: demoRoomCode, title: 'Hans Zimmer Live Suite', media_url: 'https://www.youtube.com/watch?v=1FhXG01tW28', duration: '04:12', added_by: 'Yasaru', position: 2, created_at: new Date().toISOString() },
      { _id: 'q3', id: 'q3', room_code: demoRoomCode, title: 'Hubble 3D Cosmic Journey', media_url: 'https://www.youtube.com/watch?v=2rUtS5qL3lM', duration: '05:45', added_by: 'Ramesh', position: 3, created_at: new Date().toISOString() }
    );

    storeData.messages.push(
      { _id: 'm1', id: 'm1', room_code: demoRoomCode, user_name: 'Yasaru', user_avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=80&q=80', message: 'Welcome everyone! Sound is on, let me know if audio volume is too loud for anyone 🍿', created_at: new Date().toISOString() },
      { _id: 'm2', id: 'm2', room_code: demoRoomCode, user_name: 'Udith', user_avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=80&q=80', message: 'Sound is crystal clear! Hans Zimmer soundtrack always gives chills 🙌', created_at: new Date().toISOString() },
      { _id: 'm3', id: 'm3', room_code: demoRoomCode, user_name: 'Ramesh', user_avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=80&q=80', message: 'I added the Hubble telescope 3D video to the queue right after this one!', created_at: new Date().toISOString() }
    );
  }

  persistStore();
}

seedLocalStore();

// Wrapper document providing Mongoose-compatible .save(), .toJSON(), and properties
class MockDocument {
  constructor(data, collectionKey) {
    Object.assign(this, data);
    if (!this._id) {
      this._id = 'id_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
    }
    this.id = this._id.toString();
    this._collectionKey = collectionKey;
  }

  toJSON() {
    const obj = { ...this };
    delete obj._collectionKey;
    obj.id = this._id ? this._id.toString() : this.id;
    return obj;
  }

  toObject() {
    return this.toJSON();
  }

  async save() {
    const list = storeData[this._collectionKey] || [];
    const idx = list.findIndex(item => item._id === this._id || item.id === this.id);
    const json = this.toJSON();
    if (idx >= 0) {
      list[idx] = json;
    } else {
      list.push(json);
    }
    storeData[this._collectionKey] = list;
    persistStore();
    return this;
  }
}

function matchesFilter(item, filter) {
  if (!filter || Object.keys(filter).length === 0) return true;

  for (const [key, val] of Object.entries(filter)) {
    if (key === '$or' && Array.isArray(val)) {
      const orMatched = val.some(subFilter => matchesFilter(item, subFilter));
      if (!orMatched) return false;
      continue;
    }

    if (val && typeof val === 'object' && val.$ne !== undefined) {
      if (item[key] === val.$ne) return false;
      continue;
    }

    if (val instanceof RegExp) {
      if (!val.test(item[key] || '')) return false;
      continue;
    }

    if (typeof val === 'string') {
      if ((item[key] || '').toLowerCase() !== val.toLowerCase()) return false;
      continue;
    }

    if (item[key] !== val) return false;
  }
  return true;
}

function createModelAdapter(collectionKey, RealMongooseModel) {
  return {
    async findOne(filter) {
      if (mongoose.connection.readyState === 1) {
        try { return await RealMongooseModel.findOne(filter); } catch (e) {}
      }
      const list = storeData[collectionKey] || [];
      const item = list.find(it => matchesFilter(it, filter));
      return item ? new MockDocument(item, collectionKey) : null;
    },

    async findById(id) {
      if (mongoose.connection.readyState === 1) {
        try { return await RealMongooseModel.findById(id); } catch (e) {}
      }
      const list = storeData[collectionKey] || [];
      const item = list.find(it => (it._id === id || it.id === id || String(it._id) === String(id)));
      return item ? new MockDocument(item, collectionKey) : null;
    },

    find(filter = {}) {
      if (mongoose.connection.readyState === 1) {
        try { return RealMongooseModel.find(filter); } catch (e) {}
      }
      const list = storeData[collectionKey] || [];
      const matched = list.filter(it => matchesFilter(it, filter));
      const docs = matched.map(it => new MockDocument(it, collectionKey));

      return {
        sort(sortObj = {}) {
          const sorted = [...docs];
          const sortKey = Object.keys(sortObj)[0];
          const sortDir = sortObj[sortKey];
          if (sortKey) {
            sorted.sort((a, b) => {
              if (a[sortKey] < b[sortKey]) return sortDir === -1 ? 1 : -1;
              if (a[sortKey] > b[sortKey]) return sortDir === -1 ? -1 : 1;
              return 0;
            });
          }
          return Promise.resolve(sorted);
        },
        then(resolve, reject) {
          return Promise.resolve(docs).then(resolve, reject);
        }
      };
    },

    async create(data) {
      if (mongoose.connection.readyState === 1) {
        try { return await RealMongooseModel.create(data); } catch (e) {}
      }
      const doc = new MockDocument({
        ...data,
        created_at: new Date().toISOString()
      }, collectionKey);
      await doc.save();
      return doc;
    },

    async deleteOne(filter) {
      if (mongoose.connection.readyState === 1) {
        try { return await RealMongooseModel.deleteOne(filter); } catch (e) {}
      }
      const list = storeData[collectionKey] || [];
      const idx = list.findIndex(it => matchesFilter(it, filter));
      if (idx >= 0) {
        list.splice(idx, 1);
        persistStore();
      }
      return { deletedCount: idx >= 0 ? 1 : 0 };
    },

    async deleteMany(filter) {
      if (mongoose.connection.readyState === 1) {
        try { return await RealMongooseModel.deleteMany(filter); } catch (e) {}
      }
      const list = storeData[collectionKey] || [];
      const remaining = list.filter(it => !matchesFilter(it, filter));
      const deletedCount = list.length - remaining.length;
      storeData[collectionKey] = remaining;
      persistStore();
      return { deletedCount };
    },

    async countDocuments(filter = {}) {
      if (mongoose.connection.readyState === 1) {
        try { return await RealMongooseModel.countDocuments(filter); } catch (e) {}
      }
      const list = storeData[collectionKey] || [];
      return list.filter(it => matchesFilter(it, filter)).length;
    },

    async updateMany(filter, updateData) {
      if (mongoose.connection.readyState === 1) {
        try { return await RealMongooseModel.updateMany(filter, updateData); } catch (e) {}
      }
      const list = storeData[collectionKey] || [];
      let updatedCount = 0;
      for (const item of list) {
        if (matchesFilter(item, filter)) {
          Object.assign(item, updateData);
          updatedCount++;
        }
      }
      if (updatedCount > 0) persistStore();
      return { modifiedCount: updatedCount };
    }
  };
}

const User = createModelAdapter('users', RealUser);
const Room = createModelAdapter('rooms', RealRoom);
const QueueItem = createModelAdapter('queue_items', RealQueueItem);
const Message = createModelAdapter('messages', RealMessage);

// ----------------------------------------------------------------------------
// MongoDB Non-Blocking Connection Attempt (Instant, never blocks the app)
// ----------------------------------------------------------------------------
let isConnecting = false;

async function connectDb() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  // Only attempt MongoDB connection if URI is configured and looks valid
  if (!MONGODB_URI || MONGODB_URI.includes('127.0.0.1') || MONGODB_URI.includes('localhost')) {
    // Local dev: check quickly in background without blocking requests
    if (isConnecting) return null;
    isConnecting = true;
    mongoose.connect(MONGODB_URI || 'mongodb://127.0.0.1:27017/unitogether', {
      serverSelectionTimeoutMS: 800,
      bufferCommands: false
    }).then(() => {
      console.log('[MongoDB] Connected to local MongoDB instance.');
    }).catch(() => {
      // Offline: ultra-fast local store is automatically active
    }).finally(() => {
      isConnecting = false;
    });
    return null;
  }

  // Remote / Vercel MongoDB Atlas URI (mongodb+srv://)
  if (!isConnecting) {
    isConnecting = true;
    console.log('[MongoDB] Connecting to remote MongoDB Atlas cluster...');
    try {
      await mongoose.connect(MONGODB_URI, {
        serverSelectionTimeoutMS: 5000,
        bufferCommands: false
      });
      console.log('[MongoDB] Connected successfully to remote MongoDB Database!');
    } catch (err) {
      console.warn('[MongoDB] Remote connection failed, running on fast store fallback:', err.message);
    } finally {
      isConnecting = false;
    }
  }

  return mongoose.connection;
}

// Background connect trigger
connectDb().catch(() => {});

module.exports = {
  connectDb,
  mongoose,
  User,
  Room,
  QueueItem,
  Message
};
