# 🎓 UniTogether  "Watch Together" Web Application

<div align="center">

![UniTogether Logo](./images/Web%20site%20mainLogo.png)

**A real-time collaborative web platform for university students to study, stream, and connect together.**

![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat&logo=javascript&logoColor=black)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat&logo=nodedotjs&logoColor=white)
![Express.js](https://img.shields.io/badge/Express.js-000000?style=flat&logo=express&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=flat&logo=mongodb&logoColor=white)
![Render](https://img.shields.io/badge/Render-46E3B7?style=flat&logo=render&logoColor=black)
![Socket.io](https://img.shields.io/badge/Socket.io-010101?style=flat&logo=socketdotio&logoColor=white)

</div>

---

## 📋 Table of Contents

- [About the Project](#-about-the-project)
- [Key Features](#-key-features)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
- [Environment Variables](#-environment-variables)
- [Development Timeline](#-development-timeline)
- [Team](#-team)
- [License](#-license)

---

## 🧐 About the Project

**UniTogether** is a real-time web application designed for university students to **watch videos together**, **collaborate in study groups**, and **communicate** in a shared digital space — no matter where they are.

> 🗓 **Project Start:** November 03, 2025
> 🎯 **Target Completion:** November 22, 2025 *(3-Week Rapid Development Cycle)*

---

## ✨ Key Features

### 🔐 Authentication & Entry
- User **Login / Registration** system
- Option to **"Create a Room"** or **Join an existing room**

### 🖥 Room Layout & Media Selection
- Clean, **light-dark mode** toggle on a central video consumer with a sidebar
- YouTube, **YouTube link browsing**, screen sharing, and interactive games
- **Toast Panel**: A small movable box displaying everyone's video feed

### ⚡ Real-Time Synchronization Engine
- **Video Player**: Every user's click (play/pause/seek) broadcasts to all members instantly
- **Screen Sharing** via WebRTC
- **WebSockets** (`Socket.io`) for real-time event sync

### 💬 Group Member System
- Member **Profile Picture** display (Design mockups & complete HTML/CSS/JS)
- **Member List** panel
- **Admin Controls** for the room creator to manage members
- **Session Persistence** via `localStorage`

---

## 🛠 Tech Stack

| Layer      | Technology                                             |
|------------|--------------------------------------------------------|
| Frontend   | HTML5, CSS3, Bootstrap 5.3, Vanilla JavaScript (ES6+)  |
| Backend    | Node.js, Express.js (REST API & Real-Time Server)      |
| Database   | MongoDB (via Mongoose, MongoDB Atlas & Local)          |
| Deployment | Render.com Web Service (`render.yaml`)                 |
| Real-Time  | Socket.io (WebSockets) + REST Sync Fallback            |
| Env Config | dotenv                                                 |
| VCS        | Git & GitHub                                           |
| Dev Tools  | VS Code, Figma, MongoDB Compass                        |

---

## 📁 Project Structure

```
UniTogether/
├── backend/                    # Node.js + Express backend
│   ├── models/                 # Mongoose Data Models (User, Room, QueueItem, Message)
│   ├── db/                     # MongoDB connection & schema setup
│   │   └── database.js
│   ├── routes/                 # REST API endpoints (auth, rooms)
│   │   ├── auth.js
│   │   └── rooms.js
│   ├── data/                   # Persistent local fallback store
│   └── server.js               # Express application & Socket.io server
├── frontend/                   # Client-side files
│   ├── pages/                  # HTML views (room, rooms, login, profile, contact)
│   ├── css/                    # Custom styling & themes
│   ├── js/                     # Client application logic (api.js, app.js)
│   └── assest/                 # Static images, avatars & icons
├── package.json                # Root package & start scripts for Render
├── render.yaml                 # Render Blueprint deployment specification
└── README.md
```
│   │   └── rooms.js
│   ├── server.js               # Main Express app & Socket.io server
│   └── package.json
│
├── frontend/                   # Client-side web application
│   ├── assets/                 # Brand images and logos
│   ├── css/
│   │   └── style.css           # Global modern styling
│   ├── js/
│   │   ├── api.js              # REST API client
│   │   └── app.js              # State management & player logic
│   ├── pages/                  # Subpages (login, rooms, room, profile)
│   └── index.html              # Landing page
│
├── package.json                # Root package & start scripts for Render
├── render.yaml                 # Render Blueprint deployment specification
├── .gitignore
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites

Make sure you have the following installed:
- [Node.js](https://nodejs.org/) (v18 or later)
- [Git](https://git-scm.com/)

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/UniTogether.git
cd UniTogether
```

### 2. Local Backend & SQLite Setup

No separate database installation is needed! The project automatically initializes a local **SQLite** database (`backend/data/unitogether.db`) and seeds it with demo accounts and rooms on startup.

```bash
cd backend
npm install
node server.js
```

The server will run at **http://localhost:5000**.

### 3. Open the Frontend

You can simply open `frontend/index.html` in your browser, or run a local server:

```bash
# From the root folder:
npx serve frontend
```

---

## ☁️ Deployment to Render.com

The project is pre-configured for one-click deployment on **[Render.com](https://render.com/)**:

1. **Push your code to GitHub**.
2. **Create a new Web Service on Render**:
   - Connect your GitHub repository.
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node backend/server.js`
   - **Region**: `Singapore` (or nearest region)
3. **Set Environment Variables in Render Dashboard**:
   - `NODE_ENV`: `production`
   - `JWT_SECRET`: your secret key
   - `MONGODB_URI`: your MongoDB Atlas connection string
   - `GOOGLE_CLIENT_ID`: your Google Cloud Client ID
   - `GOOGLE_CLIENT_SECRET`: your Google Cloud Client Secret

---

## 🔐 Environment Variables

Create an optional `.env` file inside `backend/` for local configuration:

```env
# Server
PORT=5000
NODE_ENV=development

# Authentication
JWT_SECRET=unitogether_jwt_secret_key_2025

# Optional: Remote Turso SQLite (leave blank for local file SQLite)
# TURSO_DATABASE_URL=libsql://your-database.turso.io
# TURSO_AUTH_TOKEN=your_auth_token_here
```

> ⚠️ **Never commit your `.env` file to Git!** It is already listed in `.gitignore`.

---

## 📅 Development Timeline

| Week | Focus Area | Key Deliverables |
|------|-----------|-----------------|
| **Week 1** (Nov 3–9) | Foundation & Auth | Project setup, Login/Register UI & backend, SQLite schema, basic room creation |
| **Week 2** (Nov 10–16) | Core Features | Video sync engine (Socket.io), screen sharing (WebRTC), room layout, member list |
| **Week 3** (Nov 17–22) | Polish & Deployment | Admin controls, dark/light mode, final testing, bug fixes, Render.com deployment |

---

## 👥 Team

| Role | Responsibilities |
|------|----------------|
| **Frontend Developers** | HTML/CSS/JS UI, Figma mockups, complete page designs |
| **Backend Developers** | Express API, SQLite models, Socket.io integration |
| **Full-Stack / Integration** | WebRTC, session management, testing & QA |

---

## 📄 License

This project is developed as part of a university Web Application Programming module.

---

<div align="center">
Made with ❤️ by the UniTogether Team
</div>
