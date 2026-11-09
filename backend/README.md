# UniTogether — Backend Server & Signaling Engine

This directory contains the Node.js Express server, Socket.io real-time signaling engine, WebRTC PeerServer, and embedded SQLite database.

## Architecture

- **`server.js`**: Express server mounting REST endpoints, Socket.io room events, NTP ping-pong clock calibration, and PeerJS WebRTC broker on port `5000`.
- **`database.js`**: Embedded SQLite database (`better-sqlite3`) with WAL concurrency, schema initialization, and automatic seeder.
- **`seed_sample_data.js`**: Populates demo student accounts, active study rooms, playlist queues, and discussion history.
- **`generate_pdf.js`**: Generates the formal system architecture specification PDF into `docs/`.
- **`unitogether.db`**: Clean, pre-seeded SQLite database file.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start the server
npm start
```
The server will bind to `http://localhost:5000`.
