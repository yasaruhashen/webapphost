# 🎓 UniTogether — Real-Time Collaborative Watch Party & Study Room Platform

<div align="center">

![UniTogether Banner](./images/Web%20site%20mainLogo.png)

**A high-precision, sub-second synchronized web platform engineered for university students to watch lectures, study together, stream screens, and connect in real time.**

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-5.x-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![Socket.io](https://img.shields.io/badge/Socket.io-4.8%2B-010101?style=for-the-badge&logo=socketdotio&logoColor=white)](https://socket.io/)
[![SQLite3](https://img.shields.io/badge/SQLite-WAL%20Mode-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![WebRTC](https://img.shields.io/badge/WebRTC-PeerJS-333333?style=for-the-badge&logo=webrtc&logoColor=white)](https://webrtc.org/)
[![Plyr](https://img.shields.io/badge/Plyr-HTML5%20Player-00B3FF?style=for-the-badge&logo=youtube&logoColor=white)](https://plyr.io/)
[![Tests Passing](https://img.shields.io/badge/Tests-95%2F95%20PASS%20(100%25)-22c55e?style=for-the-badge&logo=checkmarx&logoColor=white)](#-testing--automated-verification-suite)

</div>

---

## 📋 Table of Contents

- [About the Project](#-about-the-project)
- [Key Architectural Features](#-key-architectural-features)
  - [1. Sub-Second NTP Synchronization & 4-Zone PLL Engine](#1-sub-second-ntp-synchronization--4-zone-pll-engine)
  - [2. Multi-Source Playback Engine](#2-multi-source-playback-engine)
  - [3. Real-Time Audio Mesh & Active Speaker Island](#3-real-time-audio-mesh--active-speaker-island)
  - [4. Room Governance & Permission Matrix](#4-room-governance--permission-matrix)
  - [5. Study Hub & Student Profile System](#5-study-hub--student-profile-system)
  - [6. Media Hotkeys & Keyboard Navigation](#6-media-hotkeys--keyboard-navigation)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Database Schema & Seed Data](#-database-schema--seed-data)
- [REST API & WebSocket Protocol](#-rest-api--websocket-protocol)
- [Getting Started](#-getting-started)
- [Testing & Automated Verification Suite](#-testing--automated-verification-suite)
- [License](#-license)

---

## 🧐 About the Project

**UniTogether** is an interactive, real-time collaboration application built specifically for university study cohorts. Whether studying course modules, reviewing exam review recordings, or hosting synchronized video watch sessions, UniTogether provides sub-second playback parity, zero-latency local video sync, real-time audio voice channels, floating emoji reactions, encrypted live discussion feeds, and personal study note authoring.

Unlike standard screen-sharing software that suffers from heavy video encoding lag, frame drops, and audio desynchronization, UniTogether leverages **authoritative server timestamp anchors**, **4-packet NTP round-trip time (RTT) clock calibration**, and **client-side Phase-Locked Loop (PLL) rate slewing** to keep every participant frame-accurate.

---

## ✨ Key Architectural Features

### 1. Sub-Second NTP Synchronization & 4-Zone PLL Engine
* **4-Timestamp NTP Clock Calibration**: Performs a periodic 4-timestamp handshake (`t0`, `t1`, `t2`, `t3`) to establish true clock skew and network offset between client and server, filtering jitter with a minimum-RTT quartile filter.
* **4-Zone Phase-Locked Loop (PLL)**:
  - **Zone 1 (In Sync: < 120ms drift)**: Normal playback speed (1.00x).
  - **Zone 2 (Soft Drift: 120ms – 500ms drift)**: Micro-rate slewing (`0.95x` or `1.05x`) imperceptibly realigns audio/video without audible pitch shifts.
  - **Zone 3 (Moderate Drift: 500ms – 1500ms drift)**: Proportional catch-up rate slewing (`0.85x` or `1.15x`).
  - **Zone 4 (Severe Drift: > 1500ms drift)**: Hard programmatic seek to the authoritative target frame.
* **Static Frame Snap on Pause**: When playback is paused, the PLL rate slewing is bypassed and the player snaps directly to the authoritative millisecond frame.
* **Auto-Hide Controls Coordination**: Video controls stay permanently visible while paused, and smoothly auto-hide after 2.5 seconds of inactivity (or 800ms upon mouse exit) during active playback.

### 2. Multi-Source Playback Engine
* **YouTube Playlists & URLs**: Native Plymouth integration embedding YouTube streams with customized controls bar overlays.
* **Direct MP4 / WebM / HLS**: Built-in support for hosted lecture MP4 files and live HLS HTTP Live Streaming.
* **Synchronized Local File Mode (Zero-Bandwidth Sync)**:
  - When all students have downloaded the same lecture file (e.g. university LMS download), UniTogether links the local file copy using `URL.createObjectURL(file)`.
  - The host broadcasts timestamps and controls; peers play their local file copy directly from disk with **0% server bandwidth and zero video compression artifacts**.
* **WebRTC P2P Screen Share & Local Video Streaming**:
  - Direct peer-to-peer screen broadcasting via WebRTC.
  - A robust 4-state Finite State Machine (`STATE_IDLE`, `STATE_SCREENSHARE`, `STATE_LOCAL_STREAM`, `STATE_LOCAL_SYNC`) with mutual teardown prevents stream collisions and automatically restores the genuine background video upon disconnect.

### 3. Real-Time Audio Mesh & Active Speaker Island
* **Audio-Only Voice Mesh**: Lightweight WebRTC audio channel connecting all room participants with minimal resource overhead.
* **Dynamic Active Speaker Island (`#activeSpeakerIsland`)**:
  - Live audio analysis via Web Audio API `AudioContext` and `ScriptProcessorNode`.
  - Visual dynamic pill displaying animated sound waves and announcing `"Yasaru is speaking..."` when audio exceeds the vocal threshold.
* **Integrated Controls Bar Microphone**:
  - High-visibility status indicator: **Green microphone (`bi-mic-fill`, `#22c55e`)** when unmuted; **Red diagonal cross (`bi-mic-mute-fill`, `#ef4444`)** when muted.
  - Single-bound event listener with 400ms debounce protection against rapid double-clicks.
  - Clean auto-hide: fades out with the controls bar during playback and reappears on interaction.

### 4. Room Governance & Permission Matrix
* **Host Sync Lock**: When enabled, restricts Play, Pause, Seek, and Queue actions exclusively to the room host.
* **Allow Guest Controls**: When enabled by the host, guests are granted full permissions to play, pause, seek, and navigate media.
* **Read-Only Guest Settings**: Guests viewing `#roomSettingsModal` see a disabled view-only form with an informative host-governance alert banner; inputs dynamically reflect host updates in real time via WebSockets.
* **Democratic Vote-to-Skip**: Room members can trigger a vote-to-skip. When the configurable threshold (e.g. 50%) is reached, the next queue item automatically loads, with a 10-second undo cooldown window.
* **Room Moderation**: Host can kick users, admin-mute microphones, and permanently ban offending accounts with SQLite persistence.

### 5. Study Hub & Student Profile System
* **Watch Party Discovery Hub (`rooms.html`)**: Browse public study rooms filtered by category (Study, Coding, Exam Review, Gaming), search by title/host, and sort by viewer count or recency.
* **Student Profile (`profile.html`)**: View study statistics, enrolled faculty, university campus, stream quality preference, and notification settings.
* **Personal Study Notes**: Create, edit, and categorize personal lecture notes with an automatic live word counter, saved to SQLite.

### 6. Media Hotkeys & Keyboard Navigation
| Hotkey | Action | Notes |
| :---: | :--- | :--- |
| **`Space`** or **`K`** | Play / Pause | Prevents default page scroll; enforces room permissions |
| **`ArrowLeft`** | Rewind 10s | Enforces room permissions; shows sync toast |
| **`ArrowRight`** | Fast-Forward 10s | Enforces room permissions; shows sync toast |
| **`F`** | Fullscreen Toggle | Synchronizes native `fullscreenchange` icon (`bi-fullscreen` vs `bi-fullscreen-exit`) |
| **`T`** | Theater Mode | Expands stage container across viewport |
| **`P`** | Mini Player (PiP) | Shrinks player into draggable floating corner viewport |
| **`M`** | Microphone Toggle | Toggles mic on/off with audio mesh broadcast |
| **`Escape`** | Exit Modes | Closes theater mode or mini player |

*(All hotkeys are automatically bypassed when typing in inputs, textareas, or modal fields)*

---

## 🛠 Tech Stack

| Layer | Technologies Used |
| :--- | :--- |
| **Frontend** | HTML5, CSS3, Vanilla JavaScript (ES6+), Plyr Player, Bootstrap 5 Icons & Modals |
| **Backend** | Node.js (v18+), Express.js (v5.x) |
| **Database** | Embedded SQLite via `better-sqlite3` (WAL Mode enabled) |
| **Real-Time Signaling** | Socket.io (v4.8+) |
| **WebRTC & Streaming** | PeerJS (PeerServer integrated), Browser Screen Capture API, Web Audio API |
| **Security & Auth** | Bcrypt.js (Password & Passcode Hashing), Device UUID Fingerprinting, LocalStorage |
| **Testing Engine** | Puppeteer Core, Node.js Assert Suite |

---

## 📁 Project Structure

```
UniTogether/
├── backend/                               # Server Application & Data Layer
│   ├── database.js                        # SQLite schema, indexes & self-seeding engine
│   ├── server.js                          # Express API, Socket.io signaling & PeerServer
│   ├── seed_sample_data.js                # Demo student accounts, study rooms & playlist queues
│   ├── generate_pdf.js                    # Architecture specification PDF generator
│   ├── test_m2_sync_logic.js              # Unit tests for sync & NTP math
│   ├── test_m3_share_switching.js         # Unit tests for WebRTC FSM transitions
│   ├── package.json                       # Backend dependencies & runtime scripts
│   ├── uploads/                           # Uploaded presentation decks & subtitles
│   └── unitogether.db                     # Clean, consolidated SQLite database (WAL checkpointed)
│
├── frontend/                              # Client Application (Vanilla HTML5 / CSS3 / JS)
│   ├── index.html                         # Landing page, student signup/login & guest access modal
│   ├── css/
│   │   └── style.css                      # Unified modern glassmorphism design system
│   ├── js/
│   │   ├── app.js                         # Auth guard, hub discovery & study notes manager
│   │   └── room-sync.js                   # High-precision NTP sync, Plyr engine & WebRTC audio mesh
│   ├── pages/
│   │   ├── room.html                      # Watch room stage, custom controls bar & live chat
│   │   ├── rooms.html                     # Study rooms hub & search explorer
│   │   └── profile.html                   # Student profile, academic stats & study notes
│   └── assets/
│       └── images/                        # Logos and static badges
│
├── tests/                                 # Automated Verification & Quality Assurance Suites
│   ├── test_tightened_corners.js          # Auto-hide, hotkeys, fullscreen sync, volume sync (7 checks)
│   ├── test_user_reported_bugs_suite.js   # Regression suite for user-reported workflow bugs (5 checks)
│   ├── m4-verification.js                 # Audio pipeline, mic indicator & auto-hide suite (5 checks)
│   ├── adversarial-challenger-suite.js    # Stress tests, seek spam, FSM re-entry & DB integrity (24 checks)
│   └── e2e-verification-suite.js          # 4-tier comprehensive end-to-end browser test (34 checks)
│
├── docs/                                  # Documentation & Architecture Specifications
│   ├── ARCHITECTURE_AND_FEATURE_TREE.md   # System architecture & feature specification
│   └── UniTogether_Architecture_and_Features_Specification.pdf
│
├── images/                                # Project branding assets & logos
│   ├── Web site mainLogo.png
│   └── LEARN LOGO.jpeg
│
├── package.json                           # Root convenience scripts (start, test, test:all)
├── .gitignore                             # Clean Git ignore rules (node_modules, logs, journals)
├── BUGS_AND_EVALUATION.md                 # Detailed bug audit, root causes & resolution log
└── README.md                              # Main documentation file
```

---

## 🗄 Database Schema & Seed Data

The embedded SQLite database (`backend/unitogether.db`) uses Write-Ahead Logging (`PRAGMA journal_mode = WAL`) and foreign key constraints.

### Core Tables
1. **`users`**: Student and lecturer accounts (`uuid`, `email`, `password_hash`, `full_name`, `faculty`, `campus`, `student_id`, `stream_quality`, `avatar_url`).
2. **`rooms`**: Study rooms (`code`, `title`, `category`, `host_uuid`, `visibility`, `passcode_hash`, `host_sync_lock`, `allow_guests`, `allow_guest_chat`, `allow_guest_control`, `media_url`, `media_type`, `media_title`, `vote_skip_enabled`, `vote_skip_threshold`).
3. **`room_queue`**: Playlist queues per room (`room_code`, `url`, `title`, `duration`, `media_type`, `added_by_name`, `order_index`, `is_played`).
4. **`room_history`**: History of played videos for undo and backward queue navigation.
5. **`chat_messages`**: Real-time room chat messages with encrypted payload support and attachment URLs.
6. **`study_notes`**: Student study notes with word counter, category tags, and timestamps.
7. **`room_banned_users`**: Moderation ban list per room.

### Default Seed Accounts & Flagship Room
- **Default Student Login**:
  - **Email**: `student@university.ac.lk`
  - **Password**: `password123`
  - **Student Name**: Yasaru Bandara (Computing & IT, SLIIT)
- **Flagship Room**:
  - **Room Code**: `UNI-8842`
  - **Room Title**: `CS204: Algorithms & Data Structures - Final Exam Review 🍿`
  - **Default Media**: Algorithms and Data Structures Tutorial (YouTube) with pre-seeded playlist queue.

---

## 🔌 REST API & WebSocket Protocol

### REST API Endpoints
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/auth/register` | Register a new student account |
| `POST` | `/api/auth/login` | Authenticate student and issue session |
| `GET` | `/api/auth/profile` | Retrieve student profile metadata & study stats |
| `PUT` | `/api/auth/profile` | Update profile preferences (name, campus, faculty, stream quality) |
| `GET` | `/api/rooms` | Query active rooms with category filtering and search |
| `POST` | `/api/rooms` | Create a new watch room with governance options |
| `GET` | `/api/rooms/:code` | Retrieve room details, active media, and settings |
| `GET` | `/api/rooms/:code/queue` | Retrieve playlist queue for a room |
| `POST` | `/api/rooms/:code/queue` | Add new media item (YouTube / Direct MP4) to room queue |
| `GET` | `/api/notes` | Get personal study notes for the authenticated user |
| `POST` | `/api/notes` | Create a new study note |
| `PUT` | `/api/notes/:id` | Update an existing study note |
| `DELETE` | `/api/notes/:id` | Delete a study note |

### Real-Time WebSocket Events
- **`join-room`**: Subscribes client to room signaling channel, restores playback state, and announces presence.
- **`ping-clock`**: Client-server NTP clock exchange calculating RTT and skew.
- **`playback-control`**: Broadcasts `play`, `pause`, `seek`, `change-media`, `local-sync` actions across peers.
- **`sync-playback`**: Server-authoritative sync broadcast containing anchor media time and server epoch.
- **`chat-message`**: Live discussion message broadcast.
- **`cast-vote-skip`**: Democratic vote tallying to skip the current video.
- **`update-media-status`**: Broadcasts audio microphone status and speaking indicator to peer mesh.

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18.0.0 or higher recommended)
- [npm](https://www.npmjs.com/) (installed automatically with Node.js)
- A modern Chromium-based web browser (Google Chrome, Microsoft Edge, Brave)

### 1. Installation
Clone the repository and install backend dependencies:
```bash
git clone https://github.com/<your-username>/UniTogether.git
cd UniTogether/backend
npm install
```

### 2. Database Initialization (Automatic)
The SQLite database auto-initializes on startup. To explicitly re-seed sample demo data:
```bash
node seed_sample_data.js
```

### 3. Start the Server
Launch the application server:
```bash
npm start
```
*The server will start on port `5000` (e.g. `http://localhost:5000`).*

### 4. Open UniTogether in Your Browser
Open your browser and navigate to:
```
http://localhost:5000
```
- Click **"Sign In"** with the default credentials (`student@university.ac.lk` / `password123`), or click **"Join as Guest"** to test multi-user synchronization.
- Enter room code **`UNI-8842`** to enter the live study room stage!

---

## 🧪 Testing & Automated Verification Suite

UniTogether comes equipped with **7 comprehensive automated verification suites** covering **95 end-to-end and unit test checks (100% passing)**:

```bash
# Run all test suites sequentially
npm run test:all
```

### Individual Test Suites
1. **Tightened Corners & Edge Cases Suite**:
   ```bash
   node tests/test_tightened_corners.js
   ```
   *Verifies auto-hide pause retention, media keyboard hotkeys, native fullscreen icon sync, volume sync, and real-time settings form hydration.*
2. **User-Reported Bugs Regression Suite**:
   ```bash
   node tests/test_user_reported_bugs_suite.js
   ```
   *Verifies guest local file sync, read-only settings modal, guest playback permission grants, screenshare status reset, and red-cross/green mic toggle.*
3. **Milestone 2 Synchronization Logic**:
   ```bash
   node backend/test_m2_sync_logic.js
   ```
   *Verifies optimistic anchor updates, seek suppression, static frame snap, resume sync, and PLL discrete rate slewing.*
4. **Milestone 3 Media Share Switching**:
   ```bash
   node backend/test_m3_share_switching.js
   ```
   *Verifies background media preservation, 4-state FSM mutual teardown, concurrent transition mutex locks, and broadcaster disconnect recovery.*
5. **Milestone 4 Audio & UI Controls**:
   ```bash
   node tests/m4-verification.js
   ```
   *Verifies video call UI removal, audio-only WebRTC pipeline, controls-bar mic toggle, and auto-hide visibility.*
6. **Empirical Adversarial Challenger Suite**:
   ```bash
   node tests/adversarial-challenger-suite.js
   ```
   *Stress tests rapid seek spam, backward rewinds, pause/resume spam, static frame snaps, and SQLite schema integrity.*
7. **4-Tier Browser End-to-End Suite**:
   ```bash
   node tests/e2e-verification-suite.js
   ```
   *Full browser journey testing authentication, room exploration, player controls, live chat, vote-to-skip, subtitles modal, and responsive mobile boundaries (390px).*

---

## 👥 Authors & Acknowledgments

- **UniTogether Development Team**
- Designed for university students and study cohorts at **Sri Lanka Institute of Information Technology (SLIIT)**.

---

## 📄 License

This project is licensed under the [ISC License](LICENSE).
