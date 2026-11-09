/**
 * UniTogether Sample Data Seeder (backend/seed_sample_data.js)
 * 
 * Populates realistic student/faculty accounts, active watch/study rooms,
 * playlist queues, subtitles, and live chat history.
 */

const bcrypt = require('bcryptjs');

function seedSampleData(targetDb) {
  const db = targetDb || require('./database');
  console.log('--- Starting UniTogether Sample Data Seeding ---');

  const passwordHash = bcrypt.hashSync('password123', 10);

// 1. Sample Users
const sampleUsers = [
  {
    uuid: 'usr-yasaru-001',
    email: 'student@university.ac.lk',
    full_name: 'Yasaru Bandara',
    faculty: 'Computing & IT',
    role: 'student',
    avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80'
  },
  {
    uuid: 'usr-udith-002',
    email: 'udith.senanayake@university.ac.lk',
    full_name: 'Udith Senanayake',
    faculty: 'Computing & IT',
    role: 'student',
    avatar_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=120&q=80'
  },
  {
    uuid: 'usr-kavindi-003',
    email: 'kavindi.perera@university.ac.lk',
    full_name: 'Kavindi Perera',
    faculty: 'Engineering',
    role: 'student',
    avatar_url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=120&q=80'
  },
  {
    uuid: 'usr-dr-kamal-004',
    email: 'dr.kamal.gunasekara@university.ac.lk',
    full_name: 'Dr. Kamal Gunasekara',
    faculty: 'Computing & IT',
    role: 'lecturer',
    avatar_url: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=120&q=80'
  },
  {
    uuid: 'usr-malik-005',
    email: 'malik.fernando@university.ac.lk',
    full_name: 'Malik Fernando',
    faculty: 'Business & Management',
    role: 'student',
    avatar_url: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=120&q=80'
  },
  {
    uuid: 'usr-ananya-006',
    email: 'ananya.sharma@university.ac.lk',
    full_name: 'Ananya Sharma',
    faculty: 'Science & Math',
    role: 'student',
    avatar_url: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=120&q=80'
  },
  {
    uuid: 'usr-tariq-007',
    email: 'tariq.mansoor@university.ac.lk',
    full_name: 'Tariq Mansoor',
    faculty: 'Computing & IT',
    role: 'student',
    avatar_url: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=120&q=80'
  }
];

const insertUser = db.prepare(`
  INSERT INTO users (uuid, email, password_hash, full_name, faculty, role, avatar_url)
  VALUES (@uuid, @email, @password_hash, @full_name, @faculty, @role, @avatar_url)
  ON CONFLICT(email) DO UPDATE SET
    full_name = excluded.full_name,
    faculty = excluded.faculty,
    role = excluded.role,
    avatar_url = excluded.avatar_url
`);

let usersAdded = 0;
for (const u of sampleUsers) {
  try {
    insertUser.run({ ...u, password_hash: passwordHash });
    usersAdded++;
  } catch (err) {
    console.error(`User error ${u.email}:`, err.message);
  }
}
console.log(`✓ Processed ${usersAdded} sample users (Default password: "password123").`);

// 2. Sample Watch & Study Rooms
const sampleRooms = [
  {
    code: 'UNI-8842',
    title: 'CS204: Algorithms & Data Structures - Final Exam Review 🍿',
    category: 'study',
    host_uuid: 'usr-yasaru-001',
    visibility: 'public',
    host_sync_lock: 0,
    allow_guests: 1,
    allow_guest_chat: 1,
    allow_guest_control: 1,
    media_url: 'https://www.youtube.com/watch?v=8hly31xKli0',
    media_type: 'youtube',
    media_title: 'Algorithms and Data Structures Tutorial - Full Course',
    max_users: 50
  },
  {
    code: 'UNI-2024',
    title: 'SE301: Distributed Systems & Microservices Architecture 🚀',
    category: 'study',
    host_uuid: 'usr-dr-kamal-004',
    visibility: 'public',
    host_sync_lock: 1,
    allow_guests: 1,
    allow_guest_chat: 1,
    allow_guest_control: 0,
    media_url: 'https://www.youtube.com/watch?v=cQP8WApzIQQ',
    media_type: 'youtube',
    media_title: 'Distributed Systems 1.1: Introduction & Architecture Patterns',
    max_users: 75
  },
  {
    code: 'UNI-4102',
    title: 'MATH201: Neural Networks & Linear Algebra Deep Dive 🧠',
    category: 'study',
    host_uuid: 'usr-ananya-006',
    visibility: 'public',
    host_sync_lock: 0,
    allow_guests: 1,
    allow_guest_chat: 1,
    allow_guest_control: 1,
    media_url: 'https://www.youtube.com/watch?v=aircAruvnKk',
    media_type: 'youtube',
    media_title: '3Blue1Brown - But what is a neural network? | Chapter 1',
    max_users: 40
  },
  {
    code: 'UNI-1090',
    title: 'Blender Open Studio: 4K Animation & Cinema Lounge 🌌',
    category: 'entertainment',
    host_uuid: 'usr-udith-002',
    visibility: 'public',
    host_sync_lock: 0,
    allow_guests: 1,
    allow_guest_chat: 1,
    allow_guest_control: 1,
    media_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    media_type: 'direct',
    media_title: 'Big Buck Bunny (Blender Foundation 4K Direct Stream)',
    max_users: 100
  },
  {
    code: 'UNI-6520',
    title: 'Cybersecurity Lab: Ethical Hacking & Web Defense Workshop 🛡️',
    category: 'workshop',
    host_uuid: 'usr-tariq-007',
    visibility: 'public',
    host_sync_lock: 1,
    allow_guests: 1,
    allow_guest_chat: 1,
    allow_guest_control: 0,
    media_url: 'https://www.youtube.com/watch?v=fNZpcB7ODWU',
    media_type: 'youtube',
    media_title: 'Full Ethical Hacking Course - Network Penetration Testing',
    max_users: 60
  },
  {
    code: 'UNI-3088',
    title: 'Campus Dev Club: Real-Time Web Apps in Node.js & WebSockets 💻',
    category: 'study',
    host_uuid: 'usr-kavindi-003',
    visibility: 'public',
    host_sync_lock: 0,
    allow_guests: 1,
    allow_guest_chat: 1,
    allow_guest_control: 1,
    media_url: 'https://www.youtube.com/watch?v=ZKEqqIO7n-k',
    media_type: 'youtube',
    media_title: 'Socket.io Full Course - Real-Time Communication Mastery',
    max_users: 50
  }
];

const insertRoom = db.prepare(`
  INSERT INTO rooms (code, title, category, host_uuid, visibility, host_sync_lock, allow_guests, allow_guest_chat, allow_guest_control, media_url, media_type, media_title, max_users)
  VALUES (@code, @title, @category, @host_uuid, @visibility, @host_sync_lock, @allow_guests, @allow_guest_chat, @allow_guest_control, @media_url, @media_type, @media_title, @max_users)
  ON CONFLICT(code) DO UPDATE SET
    title = excluded.title,
    category = excluded.category,
    host_uuid = excluded.host_uuid,
    media_url = excluded.media_url,
    media_type = excluded.media_type,
    media_title = excluded.media_title,
    host_sync_lock = excluded.host_sync_lock
`);

let roomsAdded = 0;
for (const r of sampleRooms) {
  try {
    insertRoom.run(r);
    roomsAdded++;
  } catch (err) {
    console.error(`Room error ${r.code}:`, err.message);
  }
}
console.log(`✓ Processed ${roomsAdded} sample rooms.`);

// 3. Sample Queue Playlists
const sampleQueues = [
  // UNI-8842 Queue
  {
    room_code: 'UNI-8842',
    url: 'https://www.youtube.com/watch?v=8hly31xKli0',
    title: 'Algorithms and Data Structures Tutorial - Full Course',
    duration: 1800,
    media_type: 'youtube',
    added_by_name: 'Yasaru Bandara',
    added_by_uuid: 'usr-yasaru-001',
    order_index: 0
  },
  {
    room_code: 'UNI-8842',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    title: 'Open Source Demo Video (Direct MP4)',
    duration: 596,
    media_type: 'direct',
    added_by_name: 'Udith Senanayake',
    added_by_uuid: 'usr-udith-002',
    order_index: 1
  },
  {
    room_code: 'UNI-8842',
    url: 'https://www.youtube.com/watch?v=oBt53YbR9Kk',
    title: 'Dynamic Programming - Learn to Solve Algorithmic Problems',
    duration: 3600,
    media_type: 'youtube',
    added_by_name: 'Kavindi Perera',
    added_by_uuid: 'usr-kavindi-003',
    order_index: 2
  },
  // UNI-2024 Queue
  {
    room_code: 'UNI-2024',
    url: 'https://www.youtube.com/watch?v=cQP8WApzIQQ',
    title: 'Distributed Systems 1.1: Introduction & Architecture Patterns',
    duration: 2400,
    media_type: 'youtube',
    added_by_name: 'Dr. Kamal Gunasekara',
    added_by_uuid: 'usr-dr-kamal-004',
    order_index: 0
  },
  {
    room_code: 'UNI-2024',
    url: 'https://www.youtube.com/watch?v=Y6Ev8GKD3Hc',
    title: 'Raft Consensus Algorithm Explained Visually',
    duration: 1200,
    media_type: 'youtube',
    added_by_name: 'Tariq Mansoor',
    added_by_uuid: 'usr-tariq-007',
    order_index: 1
  },
  // UNI-4102 Queue
  {
    room_code: 'UNI-4102',
    url: 'https://www.youtube.com/watch?v=aircAruvnKk',
    title: '3Blue1Brown - But what is a neural network? | Chapter 1',
    duration: 1145,
    media_type: 'youtube',
    added_by_name: 'Ananya Sharma',
    added_by_uuid: 'usr-ananya-006',
    order_index: 0
  },
  {
    room_code: 'UNI-4102',
    url: 'https://www.youtube.com/watch?v=IHZwWFHWa-w',
    title: 'Gradient Descent, How Neural Networks Learn | Chapter 2',
    duration: 1260,
    media_type: 'youtube',
    added_by_name: 'Ananya Sharma',
    added_by_uuid: 'usr-ananya-006',
    order_index: 1
  }
];

// Clean existing queue to prevent duplicate key bloat
db.prepare('DELETE FROM room_queue').run();
const insertQueueItem = db.prepare(`
  INSERT INTO room_queue (room_code, url, title, duration, media_type, added_by_name, added_by_uuid, order_index)
  VALUES (@room_code, @url, @title, @duration, @media_type, @added_by_name, @added_by_uuid, @order_index)
`);

for (const q of sampleQueues) {
  insertQueueItem.run(q);
}
console.log(`✓ Seeded ${sampleQueues.length} playlist items across rooms.`);

// 5. Sample Live Chat Messages (with plaintext & Base64 fallbacks)
db.prepare('DELETE FROM chat_messages').run();
const sampleChats = [
  {
    room_code: 'UNI-8842',
    sender_uuid: 'usr-yasaru-001',
    sender_name: 'Yasaru Bandara',
    sender_avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=80&q=80',
    message: 'Welcome everyone to the exam revision session! Let us cover Trees & Dynamic Programming today.',
    is_system_event: 0
  },
  {
    room_code: 'UNI-8842',
    sender_uuid: 'usr-udith-002',
    sender_name: 'Udith Senanayake',
    sender_avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=80&q=80',
    message: 'Sound and video are perfectly synced on my end! The NTP telemetry pill is locked at ±0ms.',
    is_system_event: 0
  },
  {
    room_code: 'UNI-8842',
    sender_uuid: 'usr-kavindi-003',
    sender_name: 'Kavindi Perera',
    sender_avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=80&q=80',
    message: 'Can someone timestamp the AVL tree rotations section? Thanks!',
    is_system_event: 0
  },
  {
    room_code: 'UNI-8842',
    sender_uuid: 'usr-dr-kamal-004',
    sender_name: 'Dr. Kamal Gunasekara',
    sender_avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=80&q=80',
    message: 'Great participation students. Pay special attention to time complexity Big-O derivations for balanced search trees.',
    is_system_event: 0
  },
  {
    room_code: 'UNI-2024',
    sender_uuid: 'usr-dr-kamal-004',
    sender_name: 'Dr. Kamal Gunasekara',
    sender_avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=80&q=80',
    message: 'Welcome to Distributed Systems. We will explore CAP theorem and Raft consensus today.',
    is_system_event: 0
  },
  {
    room_code: 'UNI-2024',
    sender_uuid: 'usr-tariq-007',
    sender_name: 'Tariq Mansoor',
    sender_avatar: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=80&q=80',
    message: 'I added the visual Raft consensus lecture to the queue after this intro video!',
    is_system_event: 0
  }
];

const insertChat = db.prepare(`
  INSERT INTO chat_messages (room_code, sender_uuid, sender_name, sender_avatar, encrypted_payload, is_system_event)
  VALUES (@room_code, @sender_uuid, @sender_name, @sender_avatar, @encrypted_payload, @is_system_event)
`);

for (const c of sampleChats) {
  // Store as Base64 payload so decryptChatMessage() safely displays it seamlessly
  const encoded = Buffer.from(c.message, 'utf8').toString('base64');
  const payload = JSON.stringify({ ciphertext: encoded, iv: '' });
  insertChat.run({
    room_code: c.room_code,
    sender_uuid: c.sender_uuid,
    sender_name: c.sender_name,
    sender_avatar: c.sender_avatar,
    encrypted_payload: payload,
    is_system_event: c.is_system_event
  });
}
  console.log(`✓ Seeded ${sampleChats.length} initial chat discussion entries.`);
  console.log('--- Sample Data Seeding Complete Successfully! ---');
}

module.exports = seedSampleData;

if (require.main === module) {
  seedSampleData();
}
