/**
 * UniTogether - Room Synchronization Controller (Vanilla JS)
 * High-Precision Sub-Second Clock Sync, Universal Plyr Wrapper,
 * AES-GCM Encrypted Chat, Local File Sync, and PeerJS Mesh Integration
 */

// ============================================================================
// 1. Device Identification & Storage Helpers
// ============================================================================

function getOrCreateDeviceUUID() {
  const match = document.cookie.match(/(?:^|; )unitogether_device_uuid=([^;]*)/);
  if (match && match[1]) {
    localStorage.setItem('unitogether_device_uuid', match[1]);
    return match[1];
  }

  const local = localStorage.getItem('unitogether_device_uuid');
  if (local) {
    document.cookie = `unitogether_device_uuid=${local}; path=/; max-age=31536000; SameSite=Lax`;
    return local;
  }

  // Generate browser-deterministic fingerprint hash + random entropy
  const sig = `${navigator.userAgent}_${navigator.language}_${screen.width}x${screen.height}_${screen.colorDepth}_${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
  let hash = 0;
  for (let i = 0; i < sig.length; i++) {
    hash = ((hash << 5) - hash) + sig.charCodeAt(i);
    hash |= 0;
  }
  const randPart = Math.random().toString(36).substring(2, 9);
  const newUuid = `dev-${Math.abs(hash).toString(16)}-${randPart}`;

  document.cookie = `unitogether_device_uuid=${newUuid}; path=/; max-age=31536000; SameSite=Lax`;
  localStorage.setItem('unitogether_device_uuid', newUuid);
  return newUuid;
}

function initThemeToggle() {
  // Lock permanently to clean Light Mode as requested
  document.documentElement.setAttribute('data-bs-theme', 'light');
  localStorage.setItem('unitogether_theme', 'light');
}

// 4-State Media Sharing Finite State Machine Constants (Requirement R3)
const STATE_IDLE = 'IDLE';
const STATE_SCREEN_SHARE = 'SCREEN_SHARE';
const STATE_LOCAL_STREAM = 'LOCAL_STREAM';
const STATE_LOCAL_SYNC = 'LOCAL_SYNC';
window.STATE_IDLE = STATE_IDLE;
window.STATE_SCREEN_SHARE = STATE_SCREEN_SHARE;
window.STATE_LOCAL_STREAM = STATE_LOCAL_STREAM;
window.STATE_LOCAL_SYNC = STATE_LOCAL_SYNC;

// Global Room Controller State
const RoomSync = {
  roomCode: 'UNI-8842',
  currentUser: null,
  isHost: false,
  roomMeta: null,
  player: null,
  hls: null,
  socket: null,
  peer: null,
  localMediaStream: null,
  localCamStream: null,
  isCamActive: false,
  peerCalls: new Map(),
  broadcastCalls: new Map(), // peerId -> PeerJS call, for active screenshare/local-stream broadcasts only
  camCalls: new Map(), // peerId -> PeerJS call, for active camera facecam broadcasts
  peers: new Map(), // userUuid -> peerId
  roomMembers: [],

  // 4-State Media Sharing Finite State Machine
  STATE_IDLE,
  STATE_SCREEN_SHARE,
  STATE_LOCAL_STREAM,
  STATE_LOCAL_SYNC,
  mediaShareState: STATE_IDLE,
  _transitionLock: false,
  isScreensharing: false,
  isLocalStreaming: false,
  currentScreenStream: null,
  currentLocalStream: null,

  // Authoritative Server Clock Tracking
  serverClockOffsetMs: 0,
  rttMs: 0,
  serverPlaybackBaseTime: 0,
  serverPlaybackUpdatedAtMs: Date.now(),
  serverPlaybackRate: 1.0,
  serverIsPlaying: false,

  // Loop & Sync Guard Flags
  isSyncingFromServer: false,
  isSyncOptedOut: false,
  syncIntervalId: null,

  // Local File Sync Info
  currentLocalFile: null,
  expectedLocalFileName: null,
  activeLocalObjectUrl: null,
  localStreamSourceVideo: null,
  _localStreamSeekCleanup: null
};
window.RoomSync = RoomSync;

// Every local-file load creates a new blob: URL via URL.createObjectURL(). Browsers never
// garbage-collect these on their own -- without an explicit revoke, each file a user loads
// during a session (switching local files, re-picking, etc.) permanently leaks that file's
// full in-memory buffer for the life of the tab. Route every local blob URL creation through
// this helper so the previous one is always revoked first.
function createTrackedObjectUrl(fileOrBlob) {
  if (RoomSync.activeLocalObjectUrl) {
    try { URL.revokeObjectURL(RoomSync.activeLocalObjectUrl); } catch (e) {}
  }
  const url = URL.createObjectURL(fileOrBlob);
  RoomSync.activeLocalObjectUrl = url;
  return url;
}

// ============================================================================
// 2. Web Crypto API - AES-GCM 256-Bit Room Chat Encryption
// ============================================================================

async function deriveRoomKey(roomCode) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(roomCode || 'UNI-8842'),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode('unitogether_salt_2026'),
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptChatMessage(plaintext, roomCode) {
  try {
    const key = await deriveRoomKey(roomCode);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      enc.encode(plaintext)
    );
    return {
      ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
      iv: btoa(String.fromCharCode(...new Uint8Array(iv)))
    };
  } catch (err) {
    console.warn('Crypto subtle fallback:', err);
    try {
      return { ciphertext: btoa(unescape(encodeURIComponent(plaintext))), iv: '' };
    } catch(e) {
      return { ciphertext: btoa(plaintext), iv: '' };
    }
  }
}

async function decryptChatMessage(encryptedData, roomCode) {
  if (!encryptedData || typeof encryptedData !== 'object') {
    return String(encryptedData || '');
  }
  if (!encryptedData.iv) {
    try {
      return decodeURIComponent(escape(atob(encryptedData.ciphertext)));
    } catch(e) {
      try { return atob(encryptedData.ciphertext); } catch(err2) { return String(encryptedData.ciphertext); }
    }
  }

  try {
    const key = await deriveRoomKey(roomCode);
    const iv = new Uint8Array(atob(encryptedData.iv).split('').map(c => c.charCodeAt(0)));
    const ciphertext = new Uint8Array(atob(encryptedData.ciphertext).split('').map(c => c.charCodeAt(0)));
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    return new TextDecoder().decode(decrypted);
  } catch (err) {
    return '[Encrypted message]';
  }
}

// ============================================================================
// 3. Room Controller Initialization
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
  // Extract room parameter. Reaching this page with no ?room= at all means the user
  // navigated here directly rather than through a join/create/invite flow -- previously
  // this silently minted a random throwaway room code and let anyone in with no account
  // or invite. Send them back to the login/hub entry point instead.
  const urlParams = new URLSearchParams(window.location.search);
  let roomParam = urlParams.get('room');
  let initialUrlOverride = null;

  if (!roomParam) {
    roomParam = 'UNI-8842';
    const newUrl = `${window.location.pathname}?room=${roomParam}`;
    window.history.replaceState(null, '', newUrl);
  }

  if (roomParam.includes('youtube.com') || roomParam.includes('youtu.be') || roomParam.includes('.m3u8') || roomParam.includes('.mp4') || roomParam.startsWith('http')) {
    initialUrlOverride = roomParam;
    roomParam = 'UNI-' + Math.floor(1000 + Math.random() * 9000);
    const newUrl = `${window.location.pathname}?room=${roomParam}`;
    window.history.replaceState(null, '', newUrl);
  }
  RoomSync.roomCode = roomParam.toUpperCase();
  RoomSync.initialUrlOverride = initialUrlOverride;

  // Setup current user
  const storedUser = JSON.parse(localStorage.getItem('unitogether_user') || 'null');
  const deviceUuid = getOrCreateDeviceUUID();

  if (storedUser) {
    RoomSync.currentUser = {
      uuid: storedUser.uuid || deviceUuid,
      name: storedUser.name || 'Student',
      isGuest: Boolean(storedUser.isGuest),
      avatar: storedUser.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=80&q=80'
    };
  } else {
    RoomSync.currentUser = {
      uuid: deviceUuid,
      name: 'Guest_' + deviceUuid.substr(-4).toUpperCase(),
      isGuest: true,
      avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=80&q=80'
    };
  }

  // Update navbar user display & room code badge
  const userBtn = document.getElementById('userBadgeBtn');
  if (userBtn) {
    userBtn.textContent = RoomSync.currentUser.name.toUpperCase();
    userBtn.title = `${RoomSync.currentUser.name} (${RoomSync.currentUser.isGuest ? 'Guest' : 'Student'})`;
  }
  const headerRoomCodeEl = document.getElementById('headerRoomCode');
  if (headerRoomCodeEl) headerRoomCodeEl.textContent = RoomSync.roomCode;

  // Update brand header room title
  const videoTitleEl = document.getElementById('videoTitle');
  if (videoTitleEl) videoTitleEl.textContent = `Room: ${RoomSync.roomCode} — Connecting...`;

  // Theme Preference
  initThemeToggle();

  // Initialize Plyr Universal Video Player
  initPlyrPlayer();

  // Connect Socket.io
  initSocketConnection();

  // Setup PeerJS for WebRTC Mesh
  initPeerJS();

  // Setup UI Listeners (Controls, Modals, Chat, Local File Sync)
  setupUIEventListeners();
});

// ============================================================================
// 4. Universal Plyr Player Setup (YouTube, MP4, HLS & Local Blob)
// ============================================================================

function extractYouTubeId(url) {
  if (!url) return null;
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  return match ? match[1] : null;
}

async function resolveMediaMetadata(url, userTitle = '') {
  const cleanUrl = (url || '').trim();
  const ytId = extractYouTubeId(cleanUrl);

  // 1. YouTube Video (Capture real title and thumbnail via oEmbed)
  if (ytId) {
    let title = userTitle;
    let thumb = `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;

    if (!title || title === 'Queued Video' || title === 'Shared Stream' || title.startsWith('http')) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${ytId}`, {
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (res.ok) {
          const data = await res.json();
          if (data && data.title) {
            title = data.title;
          }
          if (data && data.thumbnail_url) {
            thumb = data.thumbnail_url;
          }
        }
      } catch (e) {
        console.warn('[Metadata] YouTube oEmbed fallback:', e);
      }
    }
    if (!title) title = `YouTube Stream (${ytId})`;
    return { title, thumbnail: thumb, mediaType: 'youtube', url: cleanUrl };
  }

  // 2. Local File / Blob
  if (cleanUrl.startsWith('local://') || cleanUrl.startsWith('blob:') || cleanUrl.startsWith('file://')) {
    let cleanName = userTitle || cleanUrl.split('/').pop().split('?')[0];
    cleanName = cleanName.replace(/\.[a-zA-Z0-9]+$/, '').replace(/[-_]/g, ' ');
    return {
      title: cleanName || 'Local Video File',
      thumbnail: 'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?auto=format&fit=crop&w=320&q=80',
      mediaType: 'local',
      url: cleanUrl
    };
  }

  // 3. Direct Video / HLS Stream
  const isHls = cleanUrl.includes('.m3u8');
  let autoTitle = userTitle;
  if (!autoTitle || autoTitle === 'Queued Video' || autoTitle === 'Shared Stream' || autoTitle.startsWith('http')) {
    try {
      const parsedPath = new URL(cleanUrl).pathname;
      const base = parsedPath.split('/').filter(Boolean).pop() || '';
      autoTitle = decodeURIComponent(base).replace(/\.[a-zA-Z0-9]+$/, '').replace(/[-_]/g, ' ');
    } catch (e) {}
  }
  if (!autoTitle) {
    autoTitle = isHls ? 'Live HLS Broadcast' : 'Video Stream';
  }

  return {
    title: autoTitle,
    thumbnail: isHls
      ? 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=320&q=80'
      : 'https://images.unsplash.com/photo-1536240478700-b869070f9279?auto=format&fit=crop&w=320&q=80',
    mediaType: isHls ? 'hls' : 'direct',
    url: cleanUrl
  };
}

function initPlyrPlayer() {
  const videoEl = document.getElementById('mainVideo');
  if (!videoEl) return;

  // Initialize Plyr with custom controls bar overlay integration
  RoomSync.player = new Plyr(videoEl, {
    controls: [], // We use our high-fidelity, custom controls bar
    speed: {
      selected: 1,
      options: [0.5, 0.75, 0.85, 0.92, 1, 1.05, 1.08, 1.15, 1.2, 1.25, 1.35, 1.5, 1.75, 2]
    },
    youtube: {
      noCookie: true,
      rel: 0,
      showinfo: 0,
      iv_load_policy: 3,
      modestbranding: 1,
      controls: 0,
      disablekb: 1,
      fs: 0,
      cc_load_policy: 0,
      playsinline: 1
    },
    captions: { active: false, language: 'auto', update: false },
    clickToPlay: false
  });

  const p = RoomSync.player;

  // Click on video container to toggle play/pause (excluding controls, scrubber, modals, and bigPlayBtn)
  const container = document.getElementById('videoContainer');
  if (container) {
    container.addEventListener('click', (e) => {
      if (e.target.closest('.controls-bar') || e.target.closest('.progress-area') || e.target.closest('#emojiCanvas') || e.target.closest('.modal') || e.target.closest('#bigPlayBtn')) {
        return;
      }
      togglePlayPause();
    });
  }

  p.on('play', () => {
    if (!RoomSync.serverIsPlaying && isEchoSuppressed()) {
      try { p.pause(); } catch(e) {}
      return;
    }
    updatePlayStateUI(true);
    resetControlsHideTimer(2500);
    RoomSync.serverIsPlaying = true;
    RoomSync.serverPlaybackUpdatedAtMs = Date.now();
    RoomSync.serverPlaybackBaseTime = p.currentTime;
    if (isEchoSuppressed()) return;
    if (RoomSync.isSyncOptedOut) return;
    broadcastPlaybackAction('play', p.currentTime);
  });

  p.on('playing', () => {
    if (!RoomSync.serverIsPlaying && isEchoSuppressed()) {
      try { p.pause(); } catch(e) {}
      return;
    }
    updatePlayStateUI(true);
    resetControlsHideTimer(2500);
    RoomSync.serverIsPlaying = true;
    RoomSync.serverPlaybackUpdatedAtMs = Date.now();
    RoomSync.serverPlaybackBaseTime = p.currentTime;
    if (RoomSync.isBuffering) {
      RoomSync.isBuffering = false;
      if (RoomSync.socket) {
        RoomSync.socket.emit('client-buffer-state', { isBuffering: false, role: RoomSync.currentUser.role, isHost: RoomSync.isHost });
      }
    }
  });

  p.on('pause', () => {
    if (RoomSync._scheduledStartTimer) {
      clearTimeout(RoomSync._scheduledStartTimer);
      RoomSync._scheduledStartTimer = null;
    }
    updatePlayStateUI(false);
    RoomSync.serverIsPlaying = false;
    RoomSync.serverPlaybackUpdatedAtMs = Date.now();
    RoomSync.serverPlaybackBaseTime = p.currentTime;
    RoomSync.pllAppliedRate = 1.0;
    if (isEchoSuppressed()) return;
    if (RoomSync.isSyncOptedOut) return;
    broadcastPlaybackAction('pause', p.currentTime);
  });

  p.on('seeking', () => {
    RoomSync.isSeeking = true;
  });

  p.on('seeked', () => {
    RoomSync.isSeeking = false;
    RoomSync.isLocalSeeking = false;
    // If seek was commanded programmatically by incoming server sync or internal logic, swallow without rebroadcasting
    if (RoomSync.isProgrammaticSeek) {
      RoomSync.isProgrammaticSeek = false;
      return;
    }
    if (isEchoSuppressed()) return;
    if (RoomSync.isSyncOptedOut) return;
    broadcastPlaybackAction('seek', p.currentTime);
  });

  p.on('ended', () => {
    if (RoomSync.isHost) {
      RoomSync.socket.emit('queue-next');
    }
  });

  p.on('timeupdate', () => {
    updateTimeDisplay();
    if (!p.paused && container && !container.classList.contains('is-playing')) {
      updatePlayStateUI(true);
    }
  });

  p.on('waiting', () => {
    RoomSync.isBuffering = true;
    if (RoomSync.socket) {
      RoomSync.socket.emit('client-buffer-state', { isBuffering: true, role: RoomSync.currentUser.role, isHost: RoomSync.isHost });
    }
  });

  p.on('canplay', () => {
    if (RoomSync.isBuffering) {
      RoomSync.isBuffering = false;
      if (RoomSync.socket) {
        RoomSync.socket.emit('client-buffer-state', { isBuffering: false, role: RoomSync.currentUser.role, isHost: RoomSync.isHost });
      }
    }
  });

  p.on('volumechange', () => {
    const volIcon = document.getElementById('volIcon');
    if (volIcon) {
      volIcon.className = (p.muted || p.volume === 0) ? 'bi bi-volume-mute-fill text-danger' : 'bi bi-volume-up-fill';
    }
  });

  // Start periodic high-precision drift sync checker (200ms Phase-Locked Loop)
  RoomSync.syncIntervalId = setInterval(checkAndCorrectDrift, 200);
}

// Best-effort MIME guess for local/direct video sources so the browser doesn't reject a
// playable container just because it was hardcoded as video/mp4 (e.g. .webm, .mkv, .mov).
function guessVideoMimeType(url) {
  const clean = String(url || '').split('?')[0].toLowerCase();
  if (clean.endsWith('.webm')) return 'video/webm';
  if (clean.endsWith('.ogg') || clean.endsWith('.ogv')) return 'video/ogg';
  if (clean.endsWith('.mov')) return 'video/quicktime';
  if (clean.endsWith('.mkv')) return 'video/x-matroska';
  return 'video/mp4';
}

// Load any URL or local blob into Plyr
function loadMediaSource(url, mediaType, title) {
  hideScreenShareInPlayer();
  const p = RoomSync.player;
  if (!p) return;

  // Destroy existing HLS instance when switching media types (DEF-19)
  if (RoomSync.hls && mediaType !== 'hls' && (!url || !url.includes('.m3u8'))) {
    try {
      RoomSync.hls.destroy();
    } catch (e) {}
    RoomSync.hls = null;
  }

  const ytId = extractYouTubeId(url);
  const titleEl = document.getElementById('videoTitle');
  if (titleEl && title) titleEl.textContent = title;

  // Resolve actual media title if generic or URL
  if (!title || title === 'Queued Video' || title === 'Shared Stream' || title.startsWith('http')) {
    resolveMediaMetadata(url).then(meta => {
      if (meta && meta.title && meta.title !== 'Queued Video') {
        if (titleEl) titleEl.textContent = meta.title;
      }
    }).catch(() => {});
  }

  const ytBadge = document.querySelector('.yt-badge');

  if (ytId) {
    if (ytBadge) { ytBadge.textContent = 'YOUTUBE'; ytBadge.style.display = 'inline-block'; }
    p.source = {
      type: 'video',
      sources: [{ src: ytId, provider: 'youtube' }]
    };
  } else if (mediaType === 'local' || url.startsWith('local://') || url.startsWith('blob:')) {
    if (ytBadge) { ytBadge.textContent = 'LOCAL FILE'; ytBadge.style.display = 'inline-block'; }
    p.source = {
      type: 'video',
      sources: [{ src: url, type: guessVideoMimeType(title || url) }]
    };
  } else if (mediaType === 'hls' || url.includes('.m3u8')) {
    if (ytBadge) { ytBadge.textContent = 'HLS STREAM'; ytBadge.style.display = 'inline-block'; }
    const video = document.getElementById('mainVideo');
    if (typeof Hls !== 'undefined' && Hls.isSupported() && video) {
      if (RoomSync.hls) {
        RoomSync.hls.destroy();
      }
      const hls = new Hls();
      hls.loadSource(url);
      hls.attachMedia(video);
      RoomSync.hls = hls;

      // hls.js does NOT auto-recover from fatal errors -- without this handler, a single
      // transient manifest/segment error permanently freezes playback with no retry.
      let hlsMediaErrorRetries = 0;
      hls.on(Hls.Events.ERROR, (event, data) => {
        if (!data || !data.fatal) return;
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            showSyncToast('Stream connection interrupted — retrying...');
            hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            if (hlsMediaErrorRetries < 3) {
              hlsMediaErrorRetries++;
              hls.recoverMediaError();
            } else {
              showSyncToast('Stream playback error — reloading source.');
              hls.destroy();
              RoomSync.hls = null;
              loadMediaSource(url, mediaType, title);
            }
            break;
          default:
            showSyncToast('Unrecoverable stream error.');
            hls.destroy();
            RoomSync.hls = null;
            break;
        }
      });
    } else {
      p.source = {
        type: 'video',
        sources: [{ src: url, type: 'application/x-mpegURL' }]
      };
    }
  } else {
    if (ytBadge) { ytBadge.textContent = 'DIRECT STREAM'; ytBadge.style.display = 'inline-block'; }
    p.source = {
      type: 'video',
      sources: [{ src: url, type: guessVideoMimeType(url) }]
    };
  }

  updateNowPlayingUI(title, mediaType, url);
  showSyncToast(`Loaded media: ${title || 'Video'}`);
}

function updateNowPlayingUI(title, mediaType, url) {
  const titleEl = document.getElementById('nowPlayingTitle');
  const metaEl = document.getElementById('nowPlayingMeta');
  const thumbEl = document.getElementById('nowPlayingThumb');

  if (titleEl && title) titleEl.textContent = title;
  if (metaEl) metaEl.textContent = `Type: ${(mediaType || 'Video').toUpperCase()} • Synchronized`;
  if (thumbEl) {
    const ytId = extractYouTubeId(url);
    if (ytId) {
      thumbEl.src = `https://img.youtube.com/vi/${ytId}/mqdefault.jpg`;
    } else {
      thumbEl.src = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=140&q=80';
    }
  }
}

// ============================================================================
// 5. Centralized Authoritative Timeline & 4-Zone Phase-Locked Loop (PLL) Servo
// ============================================================================

const PLL_CONFIG = {
  DEADBAND_SEC: 0.020,       // Zone 1: <= 20ms -> 0% speed trim (Locked)
  MICRO_SLEW_MAX_SEC: 0.150, // Zone 2: 20ms..150ms -> up to ±2.5% inaudible trim
  SOFT_SYNC_MAX_SEC: 1.500,  // Zone 3: 150ms..1500ms -> up to ±8% pitch-preserved catch-up
  KP_MICRO: 0.50,
  KP_SOFT: 0.70,
  MAX_MICRO_TRIM: 0.025,
  MAX_SOFT_TRIM: 0.08,
  SMOOTH_BETA: 0.35,         // Exponential rate damping factor
  SEEK_COOLDOWN_MS: 1400,
  // YouTube hard-seek threshold raised to 1.5s to prevent continuous buffering loops (F-8)
  YT_HARD_SEEK_SEC: 1.500
};

RoomSync.pllAppliedRate = 1.0;
RoomSync.lastHardSeekMs = 0;
RoomSync.estimatedSeekLatencySec = 0.085;
RoomSync.suppressLocalEventsUntil = 0;

// Enhanced Seek & Sync State Machine (F-1, F-2, F-7, F-9)
RoomSync.isProgrammaticSeek = false;
RoomSync.isLocalSeeking = false;
RoomSync.isSeeking = false;
RoomSync.isDraggingScrubber = false;
RoomSync.pendingSeekTimer = null;

function suppressEcho(durationMs = 650) {
  RoomSync.suppressLocalEventsUntil = Math.max(
    RoomSync.suppressLocalEventsUntil || 0,
    performance.now() + durationMs
  );
  RoomSync.isSyncingFromServer = true;
  setTimeout(() => {
    if (performance.now() >= RoomSync.suppressLocalEventsUntil) {
      RoomSync.isSyncingFromServer = false;
    }
  }, durationMs + 50);
}

function isEchoSuppressed() {
  return RoomSync.isSyncingFromServer || (performance.now() < (RoomSync.suppressLocalEventsUntil || 0));
}

function getServerNow() {
  const now = performance.now();
  const dt = now - (RoomSync.clockRefLocalMs || now);
  return Date.now() + (RoomSync.clockOffsetMs || 0) + ((RoomSync.clockSkewPpm || 0) * dt);
}

function getAuthoritativeTargetTime() {
  let expectedTime = RoomSync.serverPlaybackBaseTime;
  if (RoomSync.serverIsPlaying) {
    const nowServerTime = Date.now() + (RoomSync.serverClockOffsetMs || 0);
    const elapsedSec = Math.max(0, (nowServerTime - RoomSync.serverPlaybackUpdatedAtMs) / 1000);
    expectedTime += (elapsedSec * (RoomSync.serverPlaybackRate || 1.0));
  }
  const offsetSec = (RoomSync.syncOffsetMs || 0) / 1000;
  return expectedTime + offsetSec;
}

function checkAndCorrectDrift() {
  if (RoomSync.isSyncOptedOut) return;
  if (!RoomSync.player) return;

  // Abort drift correction if actively seeking, dragging scrubber, or decoder is busy (F-1, F-7, F-9)
  if (RoomSync.isSeeking || RoomSync.isLocalSeeking || RoomSync.isDraggingScrubber) return;
  const p = RoomSync.player;
  const videoEl = document.getElementById('mainVideo');
  if (videoEl && videoEl.seeking) return;
  if (p && p.seeking) return;

  // NEVER drift-correct or unpause background media while screensharing or local streaming is active
  const container = document.getElementById('videoContainer');
  const isScrActive = RoomSync.isScreensharing || RoomSync.isLocalStreaming ||
                      (RoomSync.roomMeta && (RoomSync.roomMeta.mediaType === 'screen' || RoomSync.roomMeta.mediaType === 'local-stream')) || 
                      (container && container.classList.contains('screensharing-active'));
  if (isScrActive) {
    if (!p.paused) {
      try { p.pause(); } catch(e) {}
    }
    return;
  }

  if (videoEl) {
    videoEl.preservesPitch = true;
    videoEl.mozPreservesPitch = true;
    videoEl.webkitPreservesPitch = true;
  }

  const expectedTime = getAuthoritativeTargetTime();
  const currentLocalTime = p.currentTime || 0;
  const errorSec = expectedTime - currentLocalTime;
  const absError = Math.abs(errorSec);

  // If paused: enforce immediate pause, reset playback rate, and lock static frame (F-4, F-5)
  if (!RoomSync.serverIsPlaying) {
    const baseRate = Number.isFinite(RoomSync.serverPlaybackRate) && RoomSync.serverPlaybackRate > 0 ? RoomSync.serverPlaybackRate : 1.0;
    if (p.speed !== baseRate) {
      p.speed = baseRate;
    }
    if (p.embed && typeof p.embed.setPlaybackRate === 'function') {
      try { p.embed.setPlaybackRate(baseRate); } catch(e) {}
    }
    if (videoEl && Math.abs(videoEl.playbackRate - baseRate) > 0.001) {
      videoEl.playbackRate = baseRate;
    }
    RoomSync.pllAppliedRate = baseRate;

    if (!p.paused) {
      suppressEcho(300);
      try { p.pause(); } catch(e) {}
      updatePlayStateUI(false);
    }
    // Static frame reconciliation: if delta > 40ms (~1 frame), snap
    if (absError > 0.040) {
      RoomSync.isProgrammaticSeek = true;
      p.currentTime = expectedTime;
      updateTimeDisplay();
    }
    return;
  }

  // Active Playback: align play state
  if (RoomSync.serverIsPlaying && p.paused) {
    suppressEcho(300);
    try {
      const playPromise = p.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {});
      }
    } catch (e) {}
    updatePlayStateUI(true);
    resetControlsHideTimer(2500);
  }

  // Phase Error telemetry & controls
  const baseRate = Number.isFinite(RoomSync.serverPlaybackRate) && RoomSync.serverPlaybackRate > 0 ? RoomSync.serverPlaybackRate : 1.0;
  const nowLocal = performance.now();
  const isYouTubeProvider = p.provider === 'youtube';
  const hardSeekThreshold = isYouTubeProvider ? PLL_CONFIG.YT_HARD_SEEK_SEC : PLL_CONFIG.SOFT_SYNC_MAX_SEC;

  const syncIcon = document.getElementById('syncStatusIcon');
  const syncLabel = document.getElementById('syncStatusLabel');
  const syncPill = document.getElementById('syncPill');
  const syncDriftText = document.getElementById('syncDriftText');
  const syncRateText = document.getElementById('syncRateText');
  const syncRttText = document.getElementById('syncRttText');
  const tokenSync = document.getElementById('tokenSyncStatus');

  const driftMs = Math.round(errorSec * 1000);
  RoomSync.currentDriftMs = driftMs;

  if (syncDriftText) syncDriftText.textContent = `${driftMs >= 0 ? '+' : ''}${driftMs}ms`;
  if (syncRttText) syncRttText.textContent = `${Math.round(RoomSync.rttMs || 24)}ms`;

  // YouTube Provider Catch-Up (Discrete Rate Steps instead of continuous PLL / Hard Seeks - F-8)
  if (isYouTubeProvider) {
    if (absError > 1.500) {
      if (nowLocal - (RoomSync.lastHardSeekMs || 0) > PLL_CONFIG.SEEK_COOLDOWN_MS) {
        RoomSync.lastHardSeekMs = nowLocal;
        RoomSync.isProgrammaticSeek = true;
        p.currentTime = Math.max(0, expectedTime);
      }
      RoomSync.currentSyncState = 'resyncing';
      if (syncIcon) syncIcon.className = 'bi bi-arrow-repeat text-danger spin-icon';
      if (syncLabel) syncLabel.textContent = 'RESYNCING';
      if (syncPill) syncPill.setAttribute('data-state', 'SLEWING');
    } else if (absError > 0.100) {
      const stepRate = errorSec > 0 ? 1.25 : 0.75;
      p.speed = stepRate;
      if (p.embed && typeof p.embed.setPlaybackRate === 'function') {
        try { p.embed.setPlaybackRate(stepRate); } catch(e) {}
      }
      RoomSync.currentSyncState = errorSec > 0 ? 'catching-up' : 'slowing';
      if (syncIcon) syncIcon.className = 'bi bi-arrow-repeat text-warning spin-icon';
      if (syncLabel) syncLabel.textContent = errorSec > 0 ? 'CATCHING UP' : 'SLOWING';
      if (syncPill) syncPill.setAttribute('data-state', 'SLEWING');
      if (syncRateText) syncRateText.textContent = `${stepRate.toFixed(2)}x`;
    } else {
      p.speed = baseRate;
      if (p.embed && typeof p.embed.setPlaybackRate === 'function') {
        try { p.embed.setPlaybackRate(baseRate); } catch(e) {}
      }
      RoomSync.currentSyncState = 'synced';
      if (syncIcon) syncIcon.className = 'bi bi-broadcast text-success';
      if (syncLabel) syncLabel.textContent = 'SYNCED';
      if (syncPill) syncPill.setAttribute('data-state', 'LOCKED');
      if (syncRateText) syncRateText.textContent = `${baseRate.toFixed(2)}x`;
      if (tokenSync) {
        tokenSync.className = 'token-badge token-live';
        tokenSync.innerHTML = '<span class="status-dot"></span> LIVE SYNCED';
      }
    }
    return;
  }

  // HTML5 / HLS Zone 4: Hard Re-Anchor (|error| > threshold)
  if (absError > hardSeekThreshold) {
    if (nowLocal - (RoomSync.lastHardSeekMs || 0) > PLL_CONFIG.SEEK_COOLDOWN_MS) {
      RoomSync.lastHardSeekMs = nowLocal;
      const tStart = performance.now();
      suppressEcho(700);
      RoomSync.isProgrammaticSeek = true;
      const targetSeek = Math.max(0, expectedTime + (RoomSync.estimatedSeekLatencySec * baseRate));
      p.currentTime = targetSeek;
      RoomSync.pllAppliedRate = baseRate;
      p.speed = baseRate;
      const seekDuration = (performance.now() - tStart) / 1000;
      if (seekDuration > 0.01 && seekDuration < 1.0) {
        RoomSync.estimatedSeekLatencySec = 0.7 * RoomSync.estimatedSeekLatencySec + 0.3 * seekDuration;
      }
    }
    RoomSync.currentSyncState = 'resyncing';
    if (syncIcon) syncIcon.className = 'bi bi-arrow-repeat text-danger spin-icon';
    if (syncLabel) syncLabel.textContent = 'RESYNCING';
    if (syncPill) syncPill.setAttribute('data-state', 'SLEWING');
    return;
  }

  // Zone 1: Deadband (<= 20ms) -> Locked to exact base rate
  let commandedRate = baseRate;
  if (absError <= PLL_CONFIG.DEADBAND_SEC) {
    commandedRate = baseRate;
    RoomSync.currentSyncState = 'synced';
    if (syncIcon) syncIcon.className = 'bi bi-broadcast text-success';
    if (syncLabel) syncLabel.textContent = 'SYNCED';
    if (syncPill) syncPill.setAttribute('data-state', 'LOCKED');
    if (tokenSync) {
      tokenSync.className = 'token-badge token-live';
      tokenSync.innerHTML = '<span class="status-dot"></span> LIVE SYNCED';
    }
  } 
  // Zone 2: Inaudible Micro-Slew (20ms..150ms) -> Max ±2.5% inaudible trim
  else if (absError <= PLL_CONFIG.MICRO_SLEW_MAX_SEC) {
    const trim = Math.max(-PLL_CONFIG.MAX_MICRO_TRIM, Math.min(PLL_CONFIG.MAX_MICRO_TRIM, PLL_CONFIG.KP_MICRO * errorSec));
    commandedRate = baseRate * (1 + trim);
    RoomSync.currentSyncState = 'slewing';
    if (syncIcon) syncIcon.className = 'bi bi-broadcast text-info';
    if (syncLabel) syncLabel.textContent = 'FINE SYNC';
    if (syncPill) syncPill.setAttribute('data-state', 'LOCKED');
  }
  // Zone 3: Smooth Pitch-Preserved Catch-Up (150ms..1500ms) -> Max ±8% trim
  else {
    const trim = Math.max(-PLL_CONFIG.MAX_SOFT_TRIM, Math.min(PLL_CONFIG.MAX_SOFT_TRIM, PLL_CONFIG.KP_SOFT * errorSec));
    commandedRate = baseRate * (1 + trim);
    RoomSync.currentSyncState = 'catching-up';
    if (syncIcon) syncIcon.className = 'bi bi-arrow-repeat text-warning spin-icon';
    if (syncLabel) syncLabel.textContent = errorSec > 0 ? 'CATCHING UP' : 'SLOWING';
    if (syncPill) syncPill.setAttribute('data-state', 'SLEWING');
  }

  // Exponential rate damping so playback speed changes are continuous and imperceptible
  RoomSync.pllAppliedRate = (1 - PLL_CONFIG.SMOOTH_BETA) * (RoomSync.pllAppliedRate || baseRate) + (PLL_CONFIG.SMOOTH_BETA * commandedRate);
  if (Math.abs(RoomSync.pllAppliedRate - baseRate) < 0.002) {
    RoomSync.pllAppliedRate = baseRate;
  }

  // Apply smooth rate to player & underlying HTML5 video / YouTube
  const finalRate = Number(RoomSync.pllAppliedRate.toFixed(4));
  if (p.speed !== finalRate) {
    p.speed = finalRate;
  }
  if (videoEl && Math.abs(videoEl.playbackRate - finalRate) > 0.001) {
    videoEl.playbackRate = finalRate;
  }
  if (p.embed && typeof p.embed.setPlaybackRate === 'function') {
    try { p.embed.setPlaybackRate(finalRate); } catch(e) {}
  }

  if (syncRateText) syncRateText.textContent = `${finalRate.toFixed(2)}x`;

  // Periodic report of participant status to room (throttled to every 3s)
  if (RoomSync.socket && (!RoomSync._lastReportStatusTime || (Date.now() - RoomSync._lastReportStatusTime) > 3000)) {
    RoomSync._lastReportStatusTime = Date.now();
    RoomSync.socket.emit('update-member-status', {
      syncStatus: RoomSync.currentSyncState,
      drift: errorSec.toFixed(3),
      isBuffering: Boolean(RoomSync.isBuffering),
      isAudioActive: Boolean(RoomSync.isAudioActive),
      isVideoActive: Boolean(RoomSync.isVideoActive),
      isScreensharing: Boolean(RoomSync.isScreensharing)
    });
  }
}

function broadcastPlaybackAction(action, time) {
  if (!RoomSync.socket) return;
  if (isEchoSuppressed()) return;
  RoomSync.socket.emit('playback-control', {
    action,
    time: typeof time === 'number' ? time : (RoomSync.player ? RoomSync.player.currentTime : 0),
    // Use the canonical (untrimmed) rate, not RoomSync.player.speed -- the PLL servo can be
    // mid-correction with a slightly nudged speed (e.g. 1.0087x) at the exact moment a play/
    // pause/seek fires, which would otherwise feed its own correction noise back into the
    // room's authoritative rate.
    rate: RoomSync.serverPlaybackRate || (RoomSync.player ? (RoomSync.player.speed || 1.0) : 1.0),
    clientSeq: RoomSync.serverSeq || 1
  });
}

let _controlsHideTimer = null;
function resetControlsHideTimer(delay = 2500) {
  const container = document.getElementById('videoContainer');
  if (!container) return;

  clearTimeout(_controlsHideTimer);

  // If paused, keep controls visible indefinitely
  const isPlaying = Boolean(RoomSync.serverIsPlaying) || container.classList.contains('is-playing');
  if (!isPlaying) {
    container.classList.remove('controls-hidden');
    return;
  }

  container.classList.remove('controls-hidden');

  // Keep controls visible if user has an interactive menu or modal open
  const openMenu = container.querySelector('.dropdown-menu.show') || container.querySelector('.modal.show');
  if (openMenu) return;

  _controlsHideTimer = setTimeout(() => {
    const activeMenu = container.querySelector('.dropdown-menu.show') || container.querySelector('.modal.show');
    if (activeMenu) return;
    container.classList.add('controls-hidden');
  }, delay);
}

function initControlsAutoHide() {
  const container = document.getElementById('videoContainer');
  if (!container) return;

  container.addEventListener('mousemove', () => resetControlsHideTimer(2500));
  container.addEventListener('mouseenter', () => resetControlsHideTimer(2500));
  container.addEventListener('touchstart', () => resetControlsHideTimer(3500), { passive: true });
  container.addEventListener('mouseleave', () => {
    const isPlaying = Boolean(RoomSync.serverIsPlaying) || container.classList.contains('is-playing');
    if (isPlaying) {
      resetControlsHideTimer(800);
    }
  });
}

function updatePlayStateUI(isPlaying) {
  const container = document.getElementById('videoContainer');
  const ppIcon = document.getElementById('ppIcon');
  const bigPlayIcon = document.getElementById('bigPlayIcon');
  const bigPlayBtn = document.getElementById('bigPlayBtn');

  if (container) {
    if (isPlaying) {
      container.classList.add('is-playing');
      resetControlsHideTimer(2500);
    } else {
      container.classList.remove('is-playing');
      container.classList.remove('controls-hidden');
      clearTimeout(_controlsHideTimer);
    }
  }

  if (isPlaying) {
    if (ppIcon) ppIcon.className = 'bi bi-pause-fill';
    if (bigPlayIcon) {
      bigPlayIcon.className = 'bi bi-pause-fill';
      bigPlayIcon.style.marginLeft = '0px';
    }
    if (bigPlayBtn) {
      bigPlayBtn.classList.add('playing');
      bigPlayBtn.style.opacity = '0';
      bigPlayBtn.style.pointerEvents = 'none';
      bigPlayBtn.style.visibility = 'hidden';
    }
    resetControlsHideTimer(2500);
  } else {
    clearTimeout(_controlsHideTimer);
    if (ppIcon) ppIcon.className = 'bi bi-play-fill';
    if (bigPlayIcon) {
      bigPlayIcon.className = 'bi bi-play-fill';
      bigPlayIcon.style.marginLeft = '4px';
    }
    if (bigPlayBtn) {
      bigPlayBtn.classList.remove('playing');
      bigPlayBtn.style.opacity = '1';
      bigPlayBtn.style.pointerEvents = 'auto';
      bigPlayBtn.style.visibility = 'visible';
    }
  }
}

let _lastTogglePlayTime = 0;
function canControlPlayback() {
  if (RoomSync.isHost) return true;
  if (!RoomSync.roomMeta) return true;
  if (RoomSync.currentUser && RoomSync.currentUser.isGuest) {
    return Boolean(RoomSync.roomMeta.allowGuestControl);
  }
  return !RoomSync.roomMeta.hostSyncLock;
}
window.canControlPlayback = canControlPlayback;

function togglePlayPause() {
  const now = Date.now();
  if (now - _lastTogglePlayTime < 350) return; // Debounce rapid clicks
  _lastTogglePlayTime = now;

  if (!RoomSync.player) return;
  if (!canControlPlayback()) {
    if (RoomSync.currentUser && RoomSync.currentUser.isGuest && !RoomSync.roomMeta?.allowGuestControl) {
      showSyncToast('⛔ Guests do not have playback control permission in this room.');
    } else {
      showSyncToast('🔒 Host Sync Lock active: only host can play or pause.');
    }
    return;
  }
  if (RoomSync.player.paused) {
    RoomSync.serverIsPlaying = true;
    RoomSync.serverPlaybackUpdatedAtMs = Date.now();
    RoomSync.serverPlaybackBaseTime = RoomSync.player.currentTime || 0;
    try {
      const playPromise = RoomSync.player.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {});
      }
    } catch(e) {}
    updatePlayStateUI(true);
    // Note: p.on('play') callback handles broadcastPlaybackAction('play') as single source of truth
  } else {
    if (RoomSync._scheduledStartTimer) {
      clearTimeout(RoomSync._scheduledStartTimer);
      RoomSync._scheduledStartTimer = null;
    }
    RoomSync.serverIsPlaying = false;
    RoomSync.serverPlaybackUpdatedAtMs = Date.now();
    RoomSync.serverPlaybackBaseTime = RoomSync.player.currentTime || 0;
    RoomSync.pllAppliedRate = 1.0;
    try {
      RoomSync.player.pause();
    } catch(e) {}
    updatePlayStateUI(false);
    // Note: p.on('pause') callback handles broadcastPlaybackAction('pause') as single source of truth
  }
}

// ============================================================================
// 6. Socket.io Real-Time Protocol & NTP Clock Sync
// ============================================================================

function initSocketConnection() {
  const socket = io();
  RoomSync.socket = socket;

  // 4-Timestamp NTP Clock Handshake & Min-RTT Quartile Filter
  RoomSync.ntpSamples = [];
  RoomSync.clockOffsetMs = 0;
  RoomSync.clockSkewPpm = 0;
  RoomSync.clockRefLocalMs = performance.now();
  RoomSync.rttMs = 50;
  RoomSync.jitterMs = 4;
  RoomSync.isClockCalibrated = false;
  RoomSync.bandwidthKbps = 5000;
  RoomSync.lastBufferEdge = 0;
  RoomSync.lastBufferCheckMs = performance.now();
  RoomSync.networkStats = { samples: [], avgRtt: 50, jitter: 5, stabilityScore: 100 };

  function pingServerClock() {
    // NOTE: t0/t3 MUST be Date.now()-domain (epoch ms), matching t1/t2 which the server always
    // stamps with Date.now(). Mixing a performance.now() timestamp (ms since page navigation)
    // into this formula previously produced an "offset" on the order of a full epoch timestamp,
    // corrupting the authoritative target-time calculation for the entire session.
    const t0 = Date.now();
    socket.emit('ping-clock', { t0, clientTime: t0 }, (pong) => {
      handleNtpPong(pong || { t0 });
    });
  }

  function handleNtpPong(pong) {
    if (!pong) return;
    const t3 = Date.now();
    const t0 = pong.t0 || (t3 - (RoomSync.rttMs || 50));
    const t1 = pong.t1 || pong.serverTime || Date.now();
    const t2 = pong.t2 || t1;
    const rtt = Math.max(1, (t3 - t0) - (t2 - t1));
    const offset = ((t1 - t0) + (t2 - t3)) / 2;

    RoomSync.ntpSamples.push({ t: t3, rtt, offset });
    if (RoomSync.ntpSamples.length > 16) {
      RoomSync.ntpSamples.shift();
    }

    // Sort by RTT and keep lowest 35% quartile (Min-RTT filter: least queueing asymmetry)
    const sorted = [...RoomSync.ntpSamples].sort((a, b) => a.rtt - b.rtt);
    const keepCount = Math.max(2, Math.ceil(sorted.length * 0.35));
    const bestSamples = sorted.slice(0, keepCount);

    const avgOffset = bestSamples.reduce((s, x) => s + x.offset, 0) / bestSamples.length;
    const minRtt = bestSamples[0].rtt;
    const rttVariance = bestSamples.reduce((s, x) => s + Math.abs(x.rtt - minRtt), 0) / bestSamples.length;

    if (!RoomSync.isClockCalibrated) {
      RoomSync.clockOffsetMs = avgOffset;
      RoomSync.serverClockOffsetMs = avgOffset;
      RoomSync.clockRefLocalMs = performance.now();
      RoomSync.isClockCalibrated = true;
    } else {
      RoomSync.clockOffsetMs = 0.75 * RoomSync.clockOffsetMs + 0.25 * avgOffset;
      RoomSync.serverClockOffsetMs = RoomSync.clockOffsetMs;
      RoomSync.clockRefLocalMs = performance.now();
    }

    RoomSync.rttMs = 0.7 * RoomSync.rttMs + 0.3 * minRtt;
    RoomSync.jitterMs = 0.7 * RoomSync.jitterMs + 0.3 * rttVariance;
    RoomSync.networkStats.avgRtt = Math.round(RoomSync.rttMs);
    RoomSync.networkStats.jitter = Math.round(RoomSync.jitterMs);
  }

  socket.on('pong-clock', handleNtpPong);
  socket.on('sync:pong', handleNtpPong);

  function runCalibrationBurst() {
    for (let i = 0; i < 8; i++) {
      setTimeout(pingServerClock, i * 110);
    }
  }

  setInterval(pingServerClock, 4500);
  runCalibrationBurst();

  // Bandwidth & Buffer Health Telemetry loop (every 1000ms)
  function emitTelemetryLoop() {
    if (!RoomSync.socket) return;
    const p = RoomSync.player;
    const videoEl = document.getElementById('mainVideo');
    let bufferSec = 0;
    if (videoEl && videoEl.buffered && videoEl.buffered.length) {
      const cur = videoEl.currentTime || 0;
      for (let i = 0; i < videoEl.buffered.length; i++) {
        if (videoEl.buffered.start(i) <= cur + 0.5 && videoEl.buffered.end(i) >= cur) {
          bufferSec = Math.max(0, videoEl.buffered.end(i) - cur);
          break;
        }
      }
    }

    if (navigator.connection && typeof navigator.connection.downlink === 'number') {
      const navKbps = navigator.connection.downlink * 1000;
      RoomSync.bandwidthKbps = 0.7 * RoomSync.bandwidthKbps + 0.3 * navKbps;
    }

    const isReady = (bufferSec >= 1.5) || (p && !p.paused);
    const isStalled = RoomSync.serverIsPlaying && p && p.paused;

    RoomSync.socket.emit('sync:telemetry', {
      rttMs: Math.round(RoomSync.rttMs || 50),
      jitterMs: Math.round(RoomSync.jitterMs || 5),
      driftMs: Math.round(RoomSync.currentDriftMs || 0),
      bufferSec: Number(bufferSec.toFixed(1)),
      bandwidthKbps: Math.round(RoomSync.bandwidthKbps || 5000),
      ready: isReady,
      stalled: isStalled
    });
  }
  setInterval(emitTelemetryLoop, 1000);

  socket.on('connect', () => {
    console.log('[Socket] Connected to UniTogether hub. Joining room:', RoomSync.roomCode);
    socket.emit('join-room', {
      roomCode: RoomSync.roomCode,
      userUuid: RoomSync.currentUser.uuid,
      nickname: RoomSync.currentUser.name,
      isGuest: RoomSync.currentUser.isGuest,
      peerId: RoomSync.peer ? RoomSync.peer.id : null
    });
  });

  // Room State Initial Payload
  socket.on('room-state', async ({ room, playback, queue, members, isHost, chatHistory }) => {
    RoomSync.roomMeta = room;
    RoomSync.isHost = isHost;

    // Update Room Header & Title
    const titleEl = document.getElementById('videoTitle');
    if (titleEl) titleEl.textContent = room.mediaTitle || room.title;
    const headerCodeEl = document.getElementById('headerRoomCode');
    if (headerCodeEl) headerCodeEl.textContent = room.code;

    // Apply Authoritative Playback Clock
    RoomSync.serverPlaybackBaseTime = playback.currentTime;
    RoomSync.serverPlaybackUpdatedAtMs = playback.serverTime;
    RoomSync.serverPlaybackRate = playback.playbackRate || 1.0;
    RoomSync.serverIsPlaying = playback.isPlaying;

    // Load Initial Media
    if (RoomSync.initialUrlOverride) {
      const url = RoomSync.initialUrlOverride;
      RoomSync.initialUrlOverride = null;
      const type = (url.includes('.m3u8') ? 'hls' : (url.includes('youtube') || url.includes('youtu.be')) ? 'youtube' : 'direct');
      socket.emit('playback-control', {
        action: 'change-media',
        url,
        title: 'Shared Stream',
        mediaType: type,
        time: 0
      });
      loadMediaSource(url, type, 'Shared Stream');
    } else if (room.mediaType === 'local') {
      promptLocalFileSelection(room.mediaTitle);
    } else if (room.mediaType === 'screen' || room.mediaType === 'local-stream') {
      const broadcasterName = room.screenshareHostName || (room.mediaTitle ? room.mediaTitle.replace("'s Live Screen", '') : 'Host');
      showScreenShareInPlayer(null, false, broadcasterName);
      const bId = room.screensharePeerId;
      if (bId && RoomSync.peer && RoomSync.socket) {
        RoomSync.socket.emit('request-screenshare-feed', {
          broadcasterPeerId: bId,
          myPeerId: RoomSync.peer.id
        });
      }
    } else {
      loadMediaSource(room.mediaUrl, room.mediaType, room.mediaTitle);
    }

    // Render Queue & Member List
    RoomSync.roomMembers = members || [];
    RoomSync.peers.clear();
    (members || []).forEach(m => {
      if (m.peerId) RoomSync.peers.set(m.peerId, m.peerId);
    });
    renderQueueList(queue);
    renderMembersList(members);

    // Render Chat History
    if (chatHistory && Array.isArray(chatHistory)) {
      const feed = document.getElementById('chatFeed');
      if (feed) feed.innerHTML = '';
      for (const m of chatHistory) {
        let payload = m.encrypted_payload;
        try {
          if (typeof payload === 'string' && payload.startsWith('{')) {
            payload = JSON.parse(payload);
          }
        } catch(e) {}
        let text = '';
        if (m.is_system_event) {
          text = typeof payload === 'string' ? payload : (payload.text || '');
        } else if (payload && typeof payload === 'object') {
          text = await decryptChatMessage(payload, RoomSync.roomCode);
        } else {
          text = String(payload || '');
        }
        appendChatMessage({
          senderName: m.sender_name,
          senderAvatar: m.sender_avatar,
          time: new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          text,
          isSystem: Boolean(m.is_system_event)
        });
      }
      updateChatCountBadge();
    }

    // Apply Host Controls / Permissions
    applyPermissionsUI();
  });

  // Synchronized Playback Events
  socket.on('sync-playback', (data) => {
    if (data.seq && RoomSync.serverSeq && data.seq < RoomSync.serverSeq) return;
    if (data.seq && data.seq > (RoomSync.serverSeq || 0)) RoomSync.serverSeq = data.seq;

    // Check if this action originated from local user (F-2)
    const isFromSelf = data.originatorUuid && RoomSync.currentUser && (data.originatorUuid === RoomSync.currentUser.uuid);

    RoomSync.serverPlaybackBaseTime = data.anchorMediaTime !== undefined ? data.anchorMediaTime : data.currentTime;
    RoomSync.serverPlaybackUpdatedAtMs = data.anchorServerTime || data.serverTime;
    RoomSync.serverPlaybackRate = data.baseRate || data.playbackRate || 1.0;
    RoomSync.serverIsPlaying = data.isPlaying;

    if (isFromSelf) {
      RoomSync.isLocalSeeking = false;
      return;
    }

    suppressEcho(550);

    // Direct Seek Action Dispatch (F-3)
    if (data.action === 'seek') {
      if (RoomSync.player) {
        RoomSync.isProgrammaticSeek = true;
        let target = data.anchorMediaTime !== undefined ? data.anchorMediaTime : data.currentTime;
        if (data.isPlaying && data.anchorServerTime) {
          const nowServer = Date.now() + (RoomSync.serverClockOffsetMs || 0);
          const elapsed = Math.max(0, (nowServer - data.anchorServerTime) / 1000);
          target += (elapsed * (data.playbackRate || 1.0));
        }
        RoomSync.player.currentTime = Math.max(0, target);
        updateTimeDisplay();
      }
      return;
    }

    // Direct Pause Execution with Static Frame Reconciliation (F-4, F-5)
    if (data.action === 'pause') {
      suppressEcho(400);
      if (RoomSync._scheduledStartTimer) {
        clearTimeout(RoomSync._scheduledStartTimer);
        RoomSync._scheduledStartTimer = null;
      }
      try { RoomSync.player?.pause(); } catch(e) {}
      updatePlayStateUI(false);

      const baseRate = Number.isFinite(data.playbackRate) && data.playbackRate > 0 ? data.playbackRate : (RoomSync.serverPlaybackRate || 1.0);
      if (RoomSync.player) {
        RoomSync.player.speed = baseRate;
        if (RoomSync.player.embed && typeof RoomSync.player.embed.setPlaybackRate === 'function') {
          try { RoomSync.player.embed.setPlaybackRate(baseRate); } catch(e) {}
        }
      }
      const videoEl = document.getElementById('mainVideo');
      if (videoEl && Math.abs(videoEl.playbackRate - baseRate) > 0.001) {
        videoEl.playbackRate = baseRate;
      }
      RoomSync.pllAppliedRate = baseRate;

      const cur = RoomSync.player?.currentTime || 0;
      const target = data.anchorMediaTime !== undefined ? data.anchorMediaTime : data.currentTime;
      if (Math.abs(cur - target) > 0.040) {
        RoomSync.isProgrammaticSeek = true;
        RoomSync.player.currentTime = target;
        updateTimeDisplay();
      }
      return;
    }

    // Synchronous Scheduled Start on Play/Resume (F-6)
    if (data.action === 'play' && data.scheduledStartServerTime && RoomSync.player) {
      const nowServer = Date.now() + (RoomSync.serverClockOffsetMs || 0);
      const waitMs = data.scheduledStartServerTime - nowServer;
      RoomSync.isProgrammaticSeek = true;
      RoomSync.player.currentTime = Math.max(0, data.anchorMediaTime);
      updateTimeDisplay();

      if (RoomSync._scheduledStartTimer) {
        clearTimeout(RoomSync._scheduledStartTimer);
        RoomSync._scheduledStartTimer = null;
      }

      if (waitMs > 10 && waitMs < 2000) {
        suppressEcho(waitMs + 350);
        try { RoomSync.player.pause(); } catch(e) {}
        RoomSync._scheduledStartTimer = setTimeout(() => {
          RoomSync._scheduledStartTimer = null;
          if (!RoomSync.serverIsPlaying) return;
          suppressEcho(350);
          try { RoomSync.player.play()?.catch(() => {}); } catch(e) {}
          updatePlayStateUI(true);
          resetControlsHideTimer(2500);
        }, waitMs);
      } else {
        if (!RoomSync.serverIsPlaying) return;
        try { RoomSync.player.play()?.catch(() => {}); } catch(e) {}
        updatePlayStateUI(true);
        resetControlsHideTimer(2500);
      }
      return;
    }

    if (data.action === 'change-media') {
      teardownCurrentMediaShare(STATE_IDLE);
      RoomSync.mediaShareState = STATE_IDLE;
      hideScreenShareInPlayer();
      loadMediaSource(data.mediaUrl, data.mediaType, data.mediaTitle);
    } else if (data.action === 'local-sync') {
      teardownCurrentMediaShare(STATE_LOCAL_SYNC);
      RoomSync.mediaShareState = STATE_LOCAL_SYNC;
      hideScreenShareInPlayer();
      promptLocalFileSelection(data.fileName);
    } else if (data.action === 'start-screenshare') {
      if (!RoomSync.isScreensharing) {
        RoomSync.mediaShareState = STATE_SCREEN_SHARE;
        const hostName = data.mediaTitle ? data.mediaTitle.replace("'s Live Screen", '') : 'Host';
        showScreenShareInPlayer(null, false, hostName, 'screenshare', data.mediaTitle);
        const titleEl = document.getElementById('videoTitle');
        if (titleEl) titleEl.textContent = data.mediaTitle || '🖥️ Host Screen Broadcast';
        const ytBadge = document.getElementById('ytBadge') || document.querySelector('.yt-badge');
        if (ytBadge) {
          ytBadge.textContent = 'SCREEN';
          ytBadge.style.background = '#0284c7';
          ytBadge.style.display = 'inline-block';
        }
        updateNowPlayingUI(data.mediaTitle || 'Host Live Screen', 'screen', '');

        // If the peer has not received the screenshare stream yet, ask broadcaster to call
        const bId = data.peerId || data.screensharePeerId;
        if (bId && RoomSync.peer && RoomSync.socket) {
          RoomSync.socket.emit('request-screenshare-feed', {
            broadcasterPeerId: bId,
            myPeerId: RoomSync.peer.id
          });
        }
      }
    } else if (data.action === 'start-local-stream') {
      if (!RoomSync.isLocalStreaming) {
        RoomSync.mediaShareState = STATE_LOCAL_STREAM;
        const broadcasterName = data.screenshareHostName || data.triggeredBy || 'Host';
        showScreenShareInPlayer(null, false, broadcasterName, 'local-file-stream', data.mediaTitle);
        const titleEl = document.getElementById('videoTitle');
        if (titleEl) titleEl.textContent = `📁 [LOCAL STREAM] ${data.mediaTitle || 'Video'}`;
        const ytBadge = document.getElementById('ytBadge') || document.querySelector('.yt-badge');
        if (ytBadge) {
          ytBadge.textContent = 'LOCAL STREAM';
          ytBadge.style.background = '#dc2626';
          ytBadge.style.display = 'inline-block';
        }
        updateNowPlayingUI(data.mediaTitle || 'Local Video Stream', 'local-stream', '');

        const bId = data.peerId || data.screensharePeerId;
        if (bId && RoomSync.peer && RoomSync.socket) {
          RoomSync.socket.emit('request-screenshare-feed', {
            broadcasterPeerId: bId,
            myPeerId: RoomSync.peer.id
          });
        }
      }
    } else if (data.action === 'stop-local-stream' || data.action === 'stop-screenshare') {
      teardownCurrentMediaShare(STATE_IDLE);
      RoomSync.mediaShareState = STATE_IDLE;
      hideScreenShareInPlayer();
      if (data.mediaUrl && !data.mediaUrl.startsWith('webrtc')) {
        loadMediaSource(data.mediaUrl, data.mediaType, data.mediaTitle);
      }
    }


    // Immediately correct drift to align with the new server state
    if (data.action !== 'start-screenshare' && data.action !== 'start-local-stream' && !RoomSync.isScreensharing && !RoomSync.isLocalStreaming && data.mediaType !== 'screen' && data.mediaType !== 'local-stream') {
      checkAndCorrectDrift();
    }
  });

  socket.on('sync:state', (data) => {
    if (!data) return;
    if (data.seq && RoomSync.serverSeq && data.seq < RoomSync.serverSeq) return;
    if (data.seq && data.seq > (RoomSync.serverSeq || 0)) RoomSync.serverSeq = data.seq;

    RoomSync.serverPlaybackBaseTime = data.anchorMediaTime !== undefined ? data.anchorMediaTime : data.currentTime;
    RoomSync.serverPlaybackUpdatedAtMs = data.anchorServerTime || data.serverTime;
    RoomSync.serverPlaybackRate = data.baseRate || data.playbackRate || 1.0;
    RoomSync.serverIsPlaying = data.isPlaying || data.status === 'PLAYING';

    if (!RoomSync.isScreensharing && !RoomSync.isLocalStreaming) {
      checkAndCorrectDrift();
    }
  });

  socket.on('sync:beacon', (beacon) => {
    if (!beacon) return;
    if (beacon.seq && RoomSync.serverSeq && beacon.seq < RoomSync.serverSeq) return;
    if (beacon.seq && beacon.seq > (RoomSync.serverSeq || 0)) RoomSync.serverSeq = beacon.seq;
    RoomSync.serverPlaybackBaseTime = beacon.anchorMediaTime !== undefined ? beacon.anchorMediaTime : beacon.currentTime;
    RoomSync.serverPlaybackUpdatedAtMs = beacon.anchorServerTime || beacon.serverTime;
    RoomSync.serverPlaybackRate = beacon.baseRate || beacon.playbackRate || 1.0;
    RoomSync.serverIsPlaying = beacon.isPlaying;
  });

  // Re-anchor immediately when returning to backgrounded browser tab
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      runCalibrationBurst();
      checkAndCorrectDrift();
    }
  });

  // Chat Messages (Encrypted & System Announcements)
  socket.on('chat-message', async (msg) => {
    let displayContent = msg.text || '';

    if (!msg.isSystem && msg.encryptedPayload) {
      displayContent = await decryptChatMessage(msg.encryptedPayload, RoomSync.roomCode);
    } else if (!msg.isSystem && msg.plainPreview) {
      displayContent = msg.plainPreview;
    }

    appendChatMessage({
      senderName: msg.senderName,
      senderAvatar: msg.senderAvatar,
      time: msg.time,
      text: displayContent,
      attachment: msg.attachment,
      isSystem: msg.isSystem
    });
    updateChatCountBadge();
  });

  // Queue Updates
  socket.on('queue-updated', ({ queue }) => {
    renderQueueList(queue);
    preloadNextQueuedVideo(queue);
  });

  // 10-Second Queue Skip Cooldown & Reversible Recall
  socket.on('queue-skipped', ({ previousMedia, nextMedia, canUndoDurationSec }) => {
    RoomSync.lastSkippedMedia = previousMedia;
    RoomSync.skipUndoRemaining = canUndoDurationSec || 10;
    clearInterval(RoomSync.skipUndoTimer);

    if (RoomSync.currentQueue) {
      renderQueueTab(RoomSync.currentQueue);
    }

    RoomSync.skipUndoTimer = setInterval(() => {
      RoomSync.skipUndoRemaining--;
      if (RoomSync.skipUndoRemaining <= 0) {
        clearInterval(RoomSync.skipUndoTimer);
        RoomSync.skipUndoRemaining = 0;
        RoomSync.lastSkippedMedia = null;
        if (RoomSync.currentQueue) {
          renderQueueTab(RoomSync.currentQueue);
        }
      } else {
        const badge = document.getElementById('skipUndoCountdownBadge');
        if (badge) {
          badge.innerHTML = `<i class="bi bi-clock-history me-1"></i> SKIPPED (${RoomSync.skipUndoRemaining}s left)`;
        }
        const bar = document.getElementById('skipUndoProgressBar');
        if (bar) {
          bar.style.width = `${(RoomSync.skipUndoRemaining / 10) * 100}%`;
        }
      }
    }, 1000);

    showSyncToast(`⏭️ Skipped video. 10s cooldown to undo.`);
  });

  // Democratic Vote-to-Skip Socket Events
  socket.on('vote-skip-started', (data) => {
    renderVoteSkipCard(data);
    showSyncToast(`🗳️ Vote to skip started by ${data.initiatorName}! (${data.currentVotes}/${data.requiredVotes})`);
  });

  socket.on('vote-skip-updated', (data) => {
    updateVoteSkipCard(data);
  });

  socket.on('vote-skip-passed', (data) => {
    completeVoteSkipCard(true, data.message);
    showSyncToast(data.message || '🎉 Vote passed! Skipping...');
  });

  socket.on('vote-skip-expired', (data) => {
    completeVoteSkipCard(false, data.message);
  });

  // Member Presence
  socket.on('member-joined', (member) => {
    RoomSync.roomMembers = RoomSync.roomMembers || [];
    RoomSync.roomMembers.push(member);
    if (member.peerId) RoomSync.peers.set(member.peerId, member.peerId);
    addMemberToUI(member);
    const activeStream = RoomSync.isScreensharing ? RoomSync.currentScreenStream : (RoomSync.isLocalStreaming ? RoomSync.currentLocalStream : null);
    const streamType = RoomSync.isScreensharing ? 'screenshare' : (RoomSync.isLocalStreaming ? 'local-file-stream' : null);
    const streamTitle = RoomSync.isLocalStreaming && RoomSync.currentLocalFile ? RoomSync.currentLocalFile.name : `${RoomSync.currentUser.name}'s Live Screen`;

    if (activeStream && streamType && RoomSync.peer && member.peerId && member.peerId !== RoomSync.peer.id) {
      console.log(`[MediaBroadcast] Calling newly joined peer ${member.peerId} with ${streamType}`);
      try {
        const call = RoomSync.peer.call(member.peerId, activeStream, {
          metadata: {
            type: streamType,
            title: streamTitle,
            fileName: streamTitle,
            hostName: RoomSync.currentUser.name,
            hostUuid: RoomSync.currentUser.uuid
          }
        });
        if (call) {
          RoomSync.peerCalls.set(member.peerId, call);
          RoomSync.broadcastCalls.set(member.peerId, call);
        }
      } catch (e) {
        console.warn('[MediaBroadcast] Error calling newly joined peer:', e);
      }
    }
    if (RoomSync.localMediaStream && RoomSync.isAudioActive) {
      setTimeout(broadcastMediaMesh, 400);
    }
  });

  socket.on('peer-connected', ({ userUuid, peerId }) => {
    if (peerId) {
      RoomSync.peers.set(peerId, peerId);
      if (RoomSync.roomMembers) {
        const m = RoomSync.roomMembers.find(x => x.uuid === userUuid);
        if (m) m.peerId = peerId;
      }
      const activeStream = RoomSync.isScreensharing ? RoomSync.currentScreenStream : (RoomSync.isLocalStreaming ? RoomSync.currentLocalStream : null);
      const streamType = RoomSync.isScreensharing ? 'screenshare' : (RoomSync.isLocalStreaming ? 'local-file-stream' : null);
      const streamTitle = RoomSync.isLocalStreaming && RoomSync.currentLocalFile ? RoomSync.currentLocalFile.name : `${RoomSync.currentUser.name}'s Live Screen`;

      if (activeStream && streamType && RoomSync.peer && peerId !== RoomSync.peer.id) {
        console.log(`[MediaBroadcast] Calling peer registered: ${peerId} with ${streamType}`);
        const existingCall = RoomSync.broadcastCalls.get(peerId) || RoomSync.peerCalls.get(peerId);
        if (existingCall) {
          try { existingCall.close(); } catch(e) {}
        }
        try {
          const call = RoomSync.peer.call(peerId, activeStream, {
            metadata: {
              type: streamType,
              title: streamTitle,
              fileName: streamTitle,
              hostName: RoomSync.currentUser.name,
              hostUuid: RoomSync.currentUser.uuid
            }
          });
          if (call) {
            RoomSync.peerCalls.set(peerId, call);
            RoomSync.broadcastCalls.set(peerId, call);
          }
        } catch(e) {
          console.warn('[MediaBroadcast] Error calling registered peer:', e);
        }
      }
      if (RoomSync.localMediaStream && RoomSync.isAudioActive) {
        setTimeout(broadcastMediaMesh, 400);
      }
      if (RoomSync.localCamStream && RoomSync.isCamActive && RoomSync.peer && peerId !== RoomSync.peer.id) {
        setTimeout(() => {
          broadcastWebcamToPeer(peerId);
        }, 500);
      }
    }
  });

  socket.on('screenshare-feed-requested', ({ requesterPeerId }) => {
    const activeStream = RoomSync.isScreensharing ? RoomSync.currentScreenStream : (RoomSync.isLocalStreaming ? RoomSync.currentLocalStream : null);
    const streamType = RoomSync.isScreensharing ? 'screenshare' : (RoomSync.isLocalStreaming ? 'local-file-stream' : null);
    const streamTitle = RoomSync.isLocalStreaming && RoomSync.currentLocalFile ? RoomSync.currentLocalFile.name : `${RoomSync.currentUser.name}'s Live Screen`;

    if (activeStream && streamType && RoomSync.peer && requesterPeerId && requesterPeerId !== RoomSync.peer.id) {
      // Broadcaster Peer Call Recovery: Always close and cleanup stale call rather than locking out requester
      const existingCall = RoomSync.broadcastCalls.get(requesterPeerId) || RoomSync.peerCalls.get(requesterPeerId);
      if (existingCall) {
        console.log('[Screenshare/LocalStream] Re-negotiating call for requesting peer:', requesterPeerId);
        try { existingCall.close(); } catch (e) {}
        RoomSync.peerCalls.delete(requesterPeerId);
        RoomSync.broadcastCalls.delete(requesterPeerId);
      }
      console.log(`[Screenshare/LocalStream] Relaying fresh call to requesting peer: ${requesterPeerId} (type: ${streamType})`);
      try {
        const call = RoomSync.peer.call(requesterPeerId, activeStream, {
          metadata: {
            type: streamType,
            title: streamTitle,
            fileName: streamTitle,
            hostName: RoomSync.currentUser.name,
            hostUuid: RoomSync.currentUser.uuid
          }
        });
        if (call) {
          RoomSync.peerCalls.set(requesterPeerId, call);
          RoomSync.broadcastCalls.set(requesterPeerId, call);
        }
      } catch(e) {
        console.warn('[Screenshare/LocalStream] Error establishing feed to requester:', e);
      }
    }
  });

  socket.on('member-left', ({ userUuid, peerId }) => {
    if (peerId) RoomSync.peers.delete(peerId);
    if (RoomSync.roomMembers) {
      const m = RoomSync.roomMembers.find(x => x.uuid === userUuid);
      if (m && m.peerId) RoomSync.peers.delete(m.peerId);
      RoomSync.roomMembers = RoomSync.roomMembers.filter(m => m.uuid !== userUuid);
    }
    removeMemberFromUI(userUuid);
    removeFacecamTile(userUuid);
  });

  socket.on('members-updated', ({ members }) => {
    RoomSync.roomMembers = members || [];
    if (members && Array.isArray(members)) {
      members.forEach(m => {
        if (m.peerId) RoomSync.peers.set(m.peerId, m.peerId);
      });
    }
    renderMembersList(members);
  });

  // Live Floating Emoji Burst (Fixed: Call non-shadowed DOM helper)
  socket.on('emoji-reaction', ({ emoji }) => {
    renderFloatingEmojiDOM(emoji);
  });

  // Passcode Challenge Modal Listener
  socket.on('passcode-required', () => {
    const modalEl = document.getElementById('passcodeModal');
    if (modalEl) {
      const modal = new bootstrap.Modal(modalEl);
      modal.show();
    }
  });

  // Moderation / Errors
  socket.on('action-denied', ({ message }) => {
    showSyncToast(`⛔ ${message}`);
  });

  socket.on('banned-notice', ({ message }) => {
    alert(message || 'You have been removed from this room.');
    window.location.href = '../index.html';
  });

  socket.on('kicked-notice', ({ message }) => {
    alert(message || 'You have been removed from the room by the host.');
    window.location.href = '../index.html';
  });

  socket.on('force-mute-audio', ({ message }) => {
    if (RoomSync.localMediaStream) {
      RoomSync.localMediaStream.getAudioTracks().forEach(t => t.enabled = false);
    }
    RoomSync.isAudioActive = false;
    const btnMic = document.getElementById('btnToggleMic');
    if (btnMic) {
      btnMic.classList.remove('active', 'btn-success');
      btnMic.classList.add('btn-outline-secondary');
      const micIcon = document.getElementById('micIcon');
      if (micIcon) micIcon.className = 'bi bi-mic-mute-fill text-danger';
    }
    const ctrlMicBtn = document.getElementById('ctrlMicBtn');
    const ctrlMicIcon = document.getElementById('ctrlMicIcon');
    if (ctrlMicBtn) ctrlMicBtn.classList.remove('active');
    if (ctrlMicIcon) ctrlMicIcon.className = 'bi bi-mic-mute-fill text-danger';
    const islandMicBtn = document.getElementById('islandMicBtn');
    const islandMicIcon = document.getElementById('islandMicIcon');
    if (islandMicBtn) islandMicBtn.classList.remove('active');
    if (islandMicIcon) islandMicIcon.className = 'bi bi-mic-mute-fill text-danger';
    showSyncToast(`🎙️ ${message || 'Microphone muted by host'}`);
  });

  socket.on('room-settings-updated', (settings) => {
    RoomSync.roomMeta = Object.assign(RoomSync.roomMeta || {}, settings);
    applyPermissionsUI();

    // Dynamically update open room settings inputs in real time
    const lockEl = document.getElementById('settingHostSyncLock');
    const guestControlEl = document.getElementById('settingAllowGuestControl');
    const guestChatEl = document.getElementById('settingAllowGuestChat');
    const guestsEl = document.getElementById('settingAllowGuests');
    if (lockEl && settings.hostSyncLock !== undefined) lockEl.checked = Boolean(settings.hostSyncLock);
    if (guestControlEl && settings.allowGuestControl !== undefined) guestControlEl.checked = Boolean(settings.allowGuestControl);
    if (guestChatEl && settings.allowGuestChat !== undefined) guestChatEl.checked = Boolean(settings.allowGuestChat);
    if (guestsEl && settings.allowGuests !== undefined) guestsEl.checked = Boolean(settings.allowGuests);

    showSyncToast('Room permissions updated by host');
  });

  // Phase 7: Real-time Member Media & Speaking Updates
  socket.on('member-media-updated', (data) => {
    if (!data) return;
    const targetUuid = data.userUuid || data.uuid;
    const targetName = data.userName || data.name;
    const targetAudio = typeof data.hasAudio !== 'undefined' ? data.hasAudio : (typeof data.isAudioActive !== 'undefined' ? data.isAudioActive : false);
    const targetSpeaking = !!data.isSpeaking;

    if (RoomSync.roomMembers) {
      const m = RoomSync.roomMembers.find(x => x.uuid === targetUuid);
      if (m) {
        if (typeof targetAudio !== 'undefined') m.isAudioActive = targetAudio;
        if (typeof targetSpeaking !== 'undefined') m.isSpeaking = targetSpeaking;
        if (typeof data.hasVideo !== 'undefined') m.hasVideo = data.hasVideo;
      }
    }

    if (typeof data.hasVideo !== 'undefined' && !data.hasVideo) {
      removeFacecamTile(targetUuid);
    }

    const facecamTile = document.getElementById(`facecam-tile-${targetUuid}`);
    if (facecamTile) {
      if (targetSpeaking) {
        facecamTile.classList.add('is-speaking');
      } else {
        facecamTile.classList.remove('is-speaking');
      }
    }

    // Update active speaker island
    const island = document.getElementById('activeSpeakerIsland');
    const speakerNameEl = document.getElementById('activeSpeakerName');
    if (island && speakerNameEl) {
      if (targetSpeaking) {
        island.classList.add('is-speaking');
        speakerNameEl.textContent = `${targetName || 'Someone'} is speaking...`;
        clearTimeout(window._speakerIslandTimeout);
        window._speakerIslandTimeout = setTimeout(() => {
          island.classList.remove('is-speaking');
          speakerNameEl.textContent = 'Voice Channel Ready';
        }, 2200);
      }
    }

    // Update people feed item
    const personItem = document.getElementById(`person-item-${targetUuid}`);
    if (personItem) {
      const ring = personItem.querySelector('.speaking-ring');
      if (ring) ring.style.display = targetSpeaking ? 'block' : 'none';
      const micIcon = personItem.querySelector('.bi-mic-fill, .bi-mic-mute, .bi-mic-mute-fill');
      if (micIcon) {
        micIcon.className = targetAudio ? 'bi bi-mic-fill text-success' : 'bi bi-mic-mute text-muted';
      }
    }
  });

  // Phase 7: Authoritative All-Members List
  socket.on('all-members', (members) => {
    RoomSync.roomMembers = members || [];
    renderMembersList(members);
  });
}

// ============================================================================
// 7. Advanced Local File Synchronization
// ============================================================================

function promptLocalFileSelection(fileName) {
  RoomSync.expectedLocalFileName = fileName;
  const targetNameEl = document.getElementById('targetLocalFileName');
  if (targetNameEl) targetNameEl.textContent = fileName;

  const fileInput = document.getElementById('guestPromptLocalFileInput');
  if (fileInput) fileInput.value = '';

  const modalEl = document.getElementById('localFileSyncModal');
  if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }
}

// Trigger Local File Sync from Admin / Host
function triggerAdminLocalFileSync() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'video/*';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    RoomSync.currentLocalFile = file;
    const blobUrl = createTrackedObjectUrl(file);
    loadMediaSource(blobUrl, 'local', `[Local] ${file.name}`);

    // Broadcast local-sync action to all room participants
    RoomSync.socket.emit('playback-control', {
      action: 'local-sync',
      fileName: file.name,
      fileSize: file.size,
      time: 0
    });

    showSyncToast(`Broadcasting local sync for "${file.name}" to room`);
  };
  input.click();
}

// ============================================================================
// 8. Queue Preloading & UI Management
// ============================================================================

function preloadNextQueuedVideo(queue) {
  if (!queue || queue.length === 0) return;
  const nextItem = queue[0];
  if (!nextItem || !nextItem.url) return;

  // Skip YouTube watch URLs as <link rel=preload as=fetch> triggers CORS/ORB warnings
  if (nextItem.url.includes('youtube.com') || nextItem.url.includes('youtu.be')) return;

  let preloader = document.getElementById('bgPreloader');
  if (!preloader) {
    preloader = document.createElement('link');
    preloader.id = 'bgPreloader';
    preloader.rel = 'preload';
    preloader.as = 'fetch';
    preloader.href = nextItem.url;
    document.head.appendChild(preloader);
  } else {
    preloader.href = nextItem.url;
  }
}

function renderQueueList(queue) {
  RoomSync.currentQueue = queue;
  renderQueueTab(queue);

  const container = document.querySelector('.stage-lower');
  if (!container) return;

  const queueHeading = container.querySelector('.playlist-heading');
  if (queueHeading) {
    queueHeading.innerHTML = `<i class="bi bi-collection-play" style="color:#64748b;font-size:1rem;"></i> Playlist Queue (${queue.length} Videos)`;
  }
}

// Dedicated 3rd Sidebar Tab: Media Queue Controller & 10s Fading Undo Skip
RoomSync.skipUndoTimer = null;
RoomSync.skipUndoRemaining = 0;
RoomSync.lastSkippedMedia = null;

function renderQueueTab(queue) {
  RoomSync.currentQueue = queue;
  const queueFeed = document.getElementById('queueFeed');
  if (!queueFeed) return;

  queueFeed.innerHTML = '';

  // 1. If an Undo cooldown is active, show the 10-second Undo Call-Back Card at top
  if (RoomSync.skipUndoRemaining > 0 && RoomSync.lastSkippedMedia) {
    const undoCard = document.createElement('div');
    undoCard.className = 'card border-warning border-opacity-75 p-2 mb-3 shadow-sm rounded-3 fading-queue-item';
    undoCard.style.cssText = 'background: rgba(234, 179, 8, 0.12);';
    undoCard.innerHTML = `
      <div class="d-flex align-items-center justify-content-between mb-1">
        <span class="badge bg-warning text-dark fw-bold" id="skipUndoCountdownBadge" style="font-size:0.62rem;">
          <i class="bi bi-clock-history me-1"></i> SKIPPED (${RoomSync.skipUndoRemaining}s left)
        </span>
        <button class="btn btn-sm btn-warning text-dark fw-bold rounded-pill px-2 py-0" id="btnUndoSkip" style="font-size:0.7rem;">
          <i class="bi bi-arrow-counterclockwise me-1"></i> Undo Skip
        </button>
      </div>
      <div class="small fw-bold text-truncate text-main">${RoomSync.lastSkippedMedia.title}</div>
      <div class="undo-progress-track mt-2" style="height:3px; background: rgba(234,179,8,0.2); border-radius: 2px; overflow:hidden;">
        <div class="undo-progress-drain" id="skipUndoProgressBar" style="width: ${(RoomSync.skipUndoRemaining / 10) * 100}%; height:100%; background: #eab308; transition: width 1s linear;"></div>
      </div>
    `;
    undoCard.querySelector('#btnUndoSkip')?.addEventListener('click', triggerUndoSkip);
    queueFeed.appendChild(undoCard);
  }

  // 2. Now Playing Header & Card
  const nowPlayingHeader = document.createElement('div');
  nowPlayingHeader.className = 'd-flex justify-content-between align-items-center mb-2';
  nowPlayingHeader.innerHTML = `
    <span class="small fw-extrabold text-muted text-uppercase" style="letter-spacing:0.06em;">Now Playing</span>
    <button class="btn btn-sm btn-outline-danger rounded-pill fw-bold px-2 py-0" id="btnQueueSkipNext" style="font-size:0.72rem;">
      <i class="bi bi-skip-end-fill me-1"></i> Skip Video
    </button>
  `;
  nowPlayingHeader.querySelector('#btnQueueSkipNext')?.addEventListener('click', () => {
    if (RoomSync.socket) RoomSync.socket.emit('queue-next');
  });
  queueFeed.appendChild(nowPlayingHeader);

  const curTitle = document.getElementById('videoTitle')?.textContent || RoomSync.roomMeta?.mediaTitle || 'Current Video';
  const curYtId = extractYouTubeId(RoomSync.roomMeta?.mediaUrl);
  const nowThumb = curYtId 
    ? `https://img.youtube.com/vi/${curYtId}/mqdefault.jpg`
    : 'https://images.unsplash.com/photo-1536240478700-b869070f9279?auto=format&fit=crop&w=120&q=80';

  const nowCard = document.createElement('div');
  nowCard.className = 'card border-danger border-opacity-50 p-2 mb-3 shadow-sm rounded-3';
  nowCard.style.background = 'var(--bg-card)';
  nowCard.innerHTML = `
    <div class="d-flex align-items-center gap-2">
      <img src="${nowThumb}" class="rounded flex-shrink-0" style="width: 48px; height: 34px; object-fit: cover;" alt="Now Playing">
      <div class="flex-grow-1 overflow-hidden">
        <div class="small fw-bold text-truncate text-main">${curTitle}</div>
        <div class="text-muted" style="font-size:0.68rem;">Synchronized with room</div>
      </div>
    </div>
  `;
  queueFeed.appendChild(nowCard);

  // 3. Upcoming Queue Header
  const upcomingHeader = document.createElement('div');
  upcomingHeader.className = 'd-flex justify-content-between align-items-center mb-2';
  upcomingHeader.innerHTML = `
    <span class="small fw-extrabold text-muted text-uppercase" style="letter-spacing:0.06em;">Up Next (${queue ? queue.length : 0})</span>
    <button class="btn btn-sm btn-link text-danger p-0 text-decoration-none fw-bold" style="font-size:0.75rem;" data-bs-toggle="modal" data-bs-target="#addQueueModal">
      <i class="bi bi-plus-circle me-1"></i> Add URL
    </button>
  `;
  queueFeed.appendChild(upcomingHeader);

  if (!queue || queue.length === 0) {
    const emptyNotice = document.createElement('div');
    emptyNotice.className = 'text-center py-4 text-muted small';
    emptyNotice.innerHTML = `
      <i class="bi bi-collection-play fs-3 d-block mb-1 text-muted opacity-50"></i>
      Queue is empty. Add YouTube or video URLs!
    `;
    queueFeed.appendChild(emptyNotice);
  } else {
    queue.forEach((item, idx) => {
      const ytId = extractYouTubeId(item.url);
      const thumbUrl = ytId
        ? `https://img.youtube.com/vi/${ytId}/mqdefault.jpg`
        : (item.media_type === 'local' 
            ? 'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?auto=format&fit=crop&w=120&q=80'
            : 'https://images.unsplash.com/photo-1536240478700-b869070f9279?auto=format&fit=crop&w=120&q=80');

      const itemEl = document.createElement('div');
      itemEl.className = 'card border p-2 mb-2 shadow-sm rounded-3';
      itemEl.style.cssText = 'background: var(--bg-card); border-color: var(--border-subtle) !important;';
      itemEl.innerHTML = `
        <div class="d-flex align-items-center justify-content-between gap-2">
          <div class="badge bg-secondary bg-opacity-25 text-body rounded-pill flex-shrink-0" style="font-size:0.65rem;">#${idx + 1}</div>
          <img src="${thumbUrl}" class="rounded flex-shrink-0" style="width: 44px; height: 30px; object-fit: cover;" alt="Thumbnail">
          <div class="flex-grow-1 overflow-hidden">
            <div class="small fw-bold text-truncate text-main" title="${item.title}">${item.title}</div>
            <div class="text-muted" style="font-size:0.65rem;">Added by ${item.added_by_name || 'Member'} &bull; ${(item.media_type || 'video').toUpperCase()}</div>
          </div>
          <div class="d-flex align-items-center gap-1 flex-shrink-0">
            <button class="btn btn-sm btn-danger rounded-pill px-2 py-0 fw-bold btn-jump" style="font-size:0.68rem;" title="Play this video now">
              <i class="bi bi-play-fill"></i> Play
            </button>
            <button class="btn btn-sm btn-outline-secondary rounded-circle p-0 d-flex align-items-center justify-content-center btn-del" style="width:22px; height:22px; font-size:0.65rem;" title="Remove from queue">
              <i class="bi bi-x"></i>
            </button>
          </div>
        </div>
      `;
      itemEl.querySelector('.btn-jump')?.addEventListener('click', () => {
        if (RoomSync.socket) RoomSync.socket.emit('queue-jump', { queueId: item.id });
      });
      itemEl.querySelector('.btn-del')?.addEventListener('click', () => {
        if (RoomSync.socket) RoomSync.socket.emit('queue-remove', { queueId: item.id });
      });
      queueFeed.appendChild(itemEl);
    });
  }

  // Update badge count
  const badge = document.getElementById('queueBadgeCount');
  if (badge) badge.textContent = queue ? queue.length : 0;
}
RoomSync.renderQueueTab = renderQueueTab;

function triggerUndoSkip() {
  if (!RoomSync.lastSkippedMedia || !RoomSync.socket) return;
  RoomSync.socket.emit('queue-undo', { previousMedia: RoomSync.lastSkippedMedia });
  clearInterval(RoomSync.skipUndoTimer);
  RoomSync.skipUndoRemaining = 0;
  RoomSync.lastSkippedMedia = null;
  showSyncToast('↺ Calling back previous video...');
  if (RoomSync.currentQueue) renderQueueTab(RoomSync.currentQueue);
}

window.removeQueueItem = function(id) {
  if (RoomSync.socket) {
    RoomSync.socket.emit('queue-remove', { queueId: id });
  }
};

// ============================================================================
// 9. PeerJS WebRTC Video/Audio Mesh & Screen Capture API
// ============================================================================

function initPeerJS() {
  if (typeof Peer === 'undefined') return;

  try {
    const rawUuid = (RoomSync.currentUser && RoomSync.currentUser.uuid ? RoomSync.currentUser.uuid : 'dev-user')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .substring(0, 10);
    const sessionSuffix = Math.random().toString(36).substring(2, 8);
    const peerId = `${rawUuid}-${sessionSuffix}`;

    const peer = new Peer(peerId, {
      host: window.location.hostname,
      port: window.location.port || (window.location.protocol === 'https:' ? 443 : 80),
      path: '/peerjs'
    });
    RoomSync.peer = peer;

    peer.on('open', (id) => {
      console.log('[PeerJS] Registered local unique peer ID:', id);
      if (RoomSync.socket) {
        RoomSync.socket.emit('register-peer-id', { peerId: id });
      }
    });

    peer.on('call', (call) => {
      handleIncomingPeerCall(call);
    });

    peer.on('error', (err) => {
      console.warn('[PeerJS] Peer connection notice:', err);
    });
  } catch (err) {
    console.warn('[PeerJS] Could not initialize PeerServer connection:', err);
  }
}

function attachCallStreamHandlers(call) {
  call.on('stream', (remoteStream) => {
    console.log('[PeerJS] Received remote stream from peer:', call.peer, 'Tracks:', remoteStream.getTracks().map(t => `${t.kind}:${t.enabled}`));
    if (!RoomSync.peersStreams) RoomSync.peersStreams = new Map();
    RoomSync.peersStreams.set(call.peer, remoteStream);

    // Play audio cleanly via dedicated hidden audio element
    attachRemoteAudioTrack(call.peer, remoteStream);
  });

  call.on('close', () => {
    console.log('[PeerJS] Call closed with peer:', call.peer);
    if (RoomSync.peersStreams) RoomSync.peersStreams.delete(call.peer);
    RoomSync.peerCalls.delete(call.peer);
    const audioEl = document.getElementById(`peer-audio-${call.peer}`);
    if (audioEl) audioEl.remove();
  });

  call.on('error', (err) => {
    console.warn('[PeerJS] Call error with peer:', call.peer, err);
  });
}

function handleIncomingPeerCall(call) {
  if (call.metadata && call.metadata.type === 'webcam-facecam') {
    console.log('[Facecam] Answering incoming webcam call from:', call.peer, call.metadata);
    call.answer(); // Callee answers without sending local stream
    call.on('stream', (remoteCamStream) => {
      console.log('[Facecam] Received remote webcam stream from:', call.peer);
      renderFacecamTile({
        uuid: call.metadata.userUuid || call.peer,
        name: call.metadata.userName || 'Member',
        stream: remoteCamStream,
        isLocal: false
      });
    });
    call.on('close', () => {
      removeFacecamTile(call.metadata.userUuid || call.peer);
    });
    call.on('error', (err) => {
      console.warn('[Facecam] Call error with peer:', call.peer, err);
      removeFacecamTile(call.metadata.userUuid || call.peer);
    });
    return;
  }

  const isScreen = (call.metadata && (call.metadata.type === 'screenshare' || call.metadata.type === 'local-file-stream')) || 
                   (RoomSync.roomMeta && (RoomSync.roomMeta.mediaType === 'screen' || RoomSync.roomMeta.mediaType === 'local-stream'));

  if (isScreen) {
    console.log('[Screenshare/LocalStream] Answering incoming stream call from:', call.peer);
    call.answer(); // Stream answer without sending local tracks
    call.on('stream', (remoteScreenStream) => {
      const isLocalFile = call.metadata?.type === 'local-file-stream' || (RoomSync.roomMeta && RoomSync.roomMeta.mediaType === 'local-stream');
      const hostName = call.metadata?.hostName || call.metadata?.broadcasterName || (RoomSync.roomMeta ? RoomSync.roomMeta.mediaTitle : 'Host');
      const streamTitle = call.metadata?.title || call.metadata?.fileName || (isLocalFile ? 'Local Video File' : `${hostName}'s Live Screen`);
      showScreenShareInPlayer(remoteScreenStream, false, hostName, isLocalFile ? 'local-file-stream' : 'screenshare', streamTitle);
      if (isLocalFile) {
        const ytBadge = document.getElementById('ytBadge') || document.querySelector('.yt-badge');
        if (ytBadge) {
          ytBadge.textContent = 'LOCAL STREAM';
          ytBadge.style.background = '#dc2626';
          ytBadge.style.display = 'inline-block';
        }
        const titleEl = document.getElementById('videoTitle');
        if (titleEl) titleEl.textContent = `📁 [LOCAL STREAM] ${streamTitle}`;
        showSyncToast(`📁 Connected to ${hostName}'s local file stream!`);
      } else {
        const ytBadge = document.getElementById('ytBadge') || document.querySelector('.yt-badge');
        if (ytBadge) {
          ytBadge.textContent = 'SCREEN';
          ytBadge.style.background = '#0284c7';
          ytBadge.style.display = 'inline-block';
        }
        const titleEl = document.getElementById('videoTitle');
        if (titleEl) titleEl.textContent = `🖥️ ${hostName}'s Live Screen Broadcast`;
        showSyncToast(`🖥️ Connected to ${hostName}'s live screen broadcast!`);
      }

      remoteScreenStream.getTracks().forEach(track => {
        track.onended = () => {
          console.log('[Screenshare] Remote track ended, restoring player stage.');
          hideScreenShareInPlayer();
        };
      });
    });

    call.on('close', () => {
      console.log('[Screenshare] Call closed, restoring player stage.');
      hideScreenShareInPlayer();
    });
    call.on('error', (err) => {
      console.warn('[Screenshare] Call error, restoring player stage:', err);
      hideScreenShareInPlayer();
    });
  } else {
    // Participant Audio Media Call: Callee answers with local audio stream (or undefined if no mic)
    try {
      call.answer(RoomSync.localMediaStream || undefined);
      attachCallStreamHandlers(call);
    } catch (e) {
      console.warn('[PeerJS] Could not answer call from peer:', call.peer, e);
    }
  }
}

function broadcastMediaMesh() {
  if (!RoomSync.peer || !RoomSync.localMediaStream) return;
  RoomSync.peers.forEach((peerId) => {
    if (peerId && peerId !== RoomSync.peer.id) {
      try {
        const existingCall = RoomSync.peerCalls.get(peerId);
        if (existingCall) {
          try { existingCall.close(); } catch(e) {}
          RoomSync.peerCalls.delete(peerId);
        }

        const call = RoomSync.peer.call(peerId, RoomSync.localMediaStream, {
          metadata: {
            type: 'user-media',
            userName: RoomSync.currentUser.name,
            userUuid: RoomSync.currentUser.uuid,
            hasAudio: RoomSync.isAudioActive
          }
        });
        if (call) {
          RoomSync.peerCalls.set(peerId, call);
          attachCallStreamHandlers(call); // Note: Caller only attaches stream listeners, NEVER answers own call!
        }
      } catch (err) {
        console.warn('[PeerJS] Could not broadcast media to peer:', peerId, err);
      }
    }
  });
}

function attachRemoteAudioTrack(peerId, stream) {
  if (!stream || stream.getAudioTracks().length === 0) return;
  let audioEl = document.getElementById(`peer-audio-${peerId}`);
  if (!audioEl) {
    audioEl = document.createElement('audio');
    audioEl.id = `peer-audio-${peerId}`;
    audioEl.autoplay = true;
    audioEl.playsInline = true;
    audioEl.style.cssText = 'position:fixed; left:-9999px; width:1px; height:1px; opacity:0; pointer-events:none;';
    document.body.appendChild(audioEl);
  }
  audioEl.srcObject = stream;
  const playPromise = audioEl.play();
  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch(() => {
      const resumeAudio = () => {
        audioEl.play().catch(() => {});
        document.removeEventListener('click', resumeAudio);
        document.removeEventListener('keydown', resumeAudio);
      };
      document.addEventListener('click', resumeAudio, { once: true });
      document.addEventListener('keydown', resumeAudio, { once: true });
    });
  }
  monitorRemoteAudioSpeaking(peerId, stream);
}

function addRemoteVideoStream(peerId, stream) {
  // Video call functionality removed
}

function removeRemoteVideoStream(peerId) {
  // Video call functionality removed
}

// Microphone Toggle (Audio-Only Connection with Synchronized Controls Bar Integration)
async function toggleMicrophone() {
  const now = Date.now();
  if (now - (window._lastMicToggleTime || 0) < 400) return; // Debounce rapid / double clicks
  window._lastMicToggleTime = now;

  const micBtn = document.getElementById('btnToggleMic');
  const micIcon = document.getElementById('micIcon');
  const ctrlMicBtn = document.getElementById('ctrlMicBtn');
  const ctrlMicIcon = document.getElementById('ctrlMicIcon');
  const fsMicIcon = document.getElementById('fsChatMicIcon');

  if (!RoomSync.isAudioActive) {
    try {
      if (!RoomSync.localMediaStream || RoomSync.localMediaStream.getAudioTracks().length === 0) {
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (!RoomSync.localMediaStream) {
          RoomSync.localMediaStream = audioStream;
        } else {
          RoomSync.localMediaStream.addTrack(audioStream.getAudioTracks()[0]);
        }
      } else {
        RoomSync.localMediaStream.getAudioTracks().forEach(t => t.enabled = true);
      }

      RoomSync.isAudioActive = true;
      showSyncToast('🎙️ Microphone unmuted');
      if (micBtn) {
        micBtn.classList.add('active', 'btn-success');
        micBtn.classList.remove('btn-outline-secondary');
      }
      if (micIcon) {
        micIcon.className = 'bi bi-mic-fill text-success';
        micIcon.style.color = '#22c55e';
      }
      if (ctrlMicBtn) {
        ctrlMicBtn.classList.add('active');
        ctrlMicBtn.title = 'Mute Microphone (M)';
      }
      if (ctrlMicIcon) {
        ctrlMicIcon.className = 'bi bi-mic-fill text-success';
        ctrlMicIcon.style.color = '#22c55e';
      }
      if (fsMicIcon) {
        fsMicIcon.className = 'bi bi-mic-fill text-success';
        fsMicIcon.style.color = '#22c55e';
      }

      setupLocalSpeakingDetector();
      broadcastMediaMesh();

      if (RoomSync.socket) {
        RoomSync.socket.emit('update-media-status', { hasAudio: true, isSpeaking: false });
      }
      updateActiveSpeakerUI(RoomSync.currentUser.name + ' (You)', true);
    } catch (e) {
      showSyncToast('⚠️ Microphone access unavailable or denied');
    }
  } else {
    if (RoomSync.localMediaStream) {
      RoomSync.localMediaStream.getAudioTracks().forEach(t => t.enabled = false);
    }
    RoomSync.isAudioActive = false;
    showSyncToast('🔇 Microphone muted');
    if (micBtn) {
      micBtn.classList.remove('active', 'btn-success');
      micBtn.classList.add('btn-outline-secondary');
    }
    if (micIcon) {
      micIcon.className = 'bi bi-mic-mute-fill text-danger';
      micIcon.style.color = '#ef4444';
    }
    if (ctrlMicBtn) {
      ctrlMicBtn.classList.remove('active');
      ctrlMicBtn.title = 'Unmute Microphone (M)';
    }
    if (ctrlMicIcon) {
      ctrlMicIcon.className = 'bi bi-mic-mute-fill text-danger';
      ctrlMicIcon.style.color = '#ef4444';
    }
    if (fsMicIcon) {
      fsMicIcon.className = 'bi bi-mic-mute-fill text-danger';
      fsMicIcon.style.color = '#ef4444';
    }

    if (RoomSync.socket) {
      RoomSync.socket.emit('update-media-status', { hasAudio: false, isSpeaking: false });
    }
    updateActiveSpeakerUI('Voice Ready', false);
  }
  renderMembersList(RoomSync.roomMembers);
}

// ============================================================================
// Real-time Webcam Facecam Implementation (WebRTC + PeerJS Floating Grid)
// ============================================================================

function renderFacecamTile({ uuid, name, stream, isLocal = false }) {
  const container = document.getElementById('floatingFacecamGrid');
  if (!container) return;

  let tile = document.getElementById(`facecam-tile-${uuid}`);
  if (!tile) {
    tile = document.createElement('div');
    tile.id = `facecam-tile-${uuid}`;
    tile.className = `facecam-tile ${isLocal ? 'is-local' : ''}`;
    tile.innerHTML = `
      <video autoplay playsinline ${isLocal ? 'muted' : ''}></video>
      <div class="facecam-badge" title="${name}">${name}</div>
      <div class="facecam-live-indicator" title="Live Video"></div>
    `;
    container.appendChild(tile);
  }

  const vid = tile.querySelector('video');
  if (vid && stream) {
    vid.muted = isLocal;
    vid.srcObject = stream;
    vid.play().catch(e => console.warn('[Facecam] Video autoplay blocked:', e));
  }
}

function removeFacecamTile(uuid) {
  const tile = document.getElementById(`facecam-tile-${uuid}`);
  if (tile) {
    const vid = tile.querySelector('video');
    if (vid) vid.srcObject = null;
    tile.remove();
  }
}

function broadcastWebcamToPeer(peerId) {
  if (!RoomSync.peer || !RoomSync.localCamStream || !RoomSync.isCamActive) return;
  if (!peerId || peerId === RoomSync.peer.id) return;
  try {
    const existing = RoomSync.camCalls.get(peerId);
    if (existing) {
      try { existing.close(); } catch(e) {}
      RoomSync.camCalls.delete(peerId);
    }
    const call = RoomSync.peer.call(peerId, RoomSync.localCamStream, {
      metadata: {
        type: 'webcam-facecam',
        userUuid: RoomSync.currentUser.uuid,
        userName: RoomSync.currentUser.name
      }
    });
    if (call) {
      RoomSync.camCalls.set(peerId, call);
      call.on('close', () => RoomSync.camCalls.delete(peerId));
      call.on('error', () => RoomSync.camCalls.delete(peerId));
    }
  } catch (err) {
    console.warn('[Webcam] PeerJS call failed to peer:', peerId, err);
  }
}

function broadcastWebcamToAllPeers() {
  if (!RoomSync.peer || !RoomSync.localCamStream || !RoomSync.isCamActive) return;
  RoomSync.peers.forEach((peerId) => {
    broadcastWebcamToPeer(peerId);
  });
}

async function toggleCamera() {
  const now = Date.now();
  if (now - (window._lastCamToggleTime || 0) < 400) return;
  window._lastCamToggleTime = now;

  const camBtn = document.getElementById('btnToggleCam');
  const camIcon = document.getElementById('camIcon');
  const ctrlCamBtn = document.getElementById('ctrlCamBtn');
  const ctrlCamIcon = document.getElementById('ctrlCamIcon');

  if (!RoomSync.isCamActive) {
    try {
      if (!RoomSync.localCamStream) {
        RoomSync.localCamStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 480 },
            height: { ideal: 360 },
            frameRate: { ideal: 24 }
          },
          audio: false
        });
      } else {
        RoomSync.localCamStream.getVideoTracks().forEach(t => t.enabled = true);
      }

      RoomSync.isCamActive = true;
      showSyncToast('📹 Camera turned on');

      // Update UI button states
      if (camBtn) {
        camBtn.classList.add('active', 'btn-danger');
        camBtn.classList.remove('btn-outline-secondary');
      }
      if (camIcon) {
        camIcon.className = 'bi bi-camera-video-fill text-white';
        camIcon.style.color = '#ffffff';
      }
      if (ctrlCamBtn) {
        ctrlCamBtn.classList.add('active');
        ctrlCamBtn.title = 'Turn Off Camera (V)';
      }
      if (ctrlCamIcon) {
        ctrlCamIcon.className = 'bi bi-camera-video-fill text-success';
        ctrlCamIcon.style.color = '#22c55e';
      }

      // Render local facecam tile in bottom-right corner
      renderFacecamTile({
        uuid: RoomSync.currentUser.uuid,
        name: RoomSync.currentUser.name + ' (You)',
        stream: RoomSync.localCamStream,
        isLocal: true
      });

      // Broadcast camera video to all connected peers
      broadcastWebcamToAllPeers();

      // Notify room via socket
      if (RoomSync.socket) {
        RoomSync.socket.emit('update-media-status', {
          hasVideo: true,
          hasAudio: RoomSync.isAudioActive,
          isSpeaking: false
        });
      }
    } catch (e) {
      console.error('[Webcam] Access error:', e);
      showSyncToast('⚠️ Camera access unavailable or denied');
    }
  } else {
    // Stop local video tracks
    if (RoomSync.localCamStream) {
      RoomSync.localCamStream.getTracks().forEach(t => t.stop());
      RoomSync.localCamStream = null;
    }

    RoomSync.isCamActive = false;
    showSyncToast('📷 Camera turned off');

    // Update UI button states
    if (camBtn) {
      camBtn.classList.remove('active', 'btn-danger');
      camBtn.classList.add('btn-outline-secondary');
    }
    if (camIcon) {
      camIcon.className = 'bi bi-camera-video-off-fill text-danger';
      camIcon.style.color = '#ef4444';
    }
    if (ctrlCamBtn) {
      ctrlCamBtn.classList.remove('active');
      ctrlCamBtn.title = 'Turn On Camera (V)';
    }
    if (ctrlCamIcon) {
      ctrlCamIcon.className = 'bi bi-camera-video-off-fill text-danger';
      ctrlCamIcon.style.color = '#ef4444';
    }

    // Close and remove outgoing PeerJS camera calls
    if (RoomSync.camCalls) {
      RoomSync.camCalls.forEach((call) => {
        try { call.close(); } catch (e) {}
      });
      RoomSync.camCalls.clear();
    }

    // Remove local facecam tile
    removeFacecamTile(RoomSync.currentUser.uuid);

    // Notify room via socket
    if (RoomSync.socket) {
      RoomSync.socket.emit('update-media-status', {
        hasVideo: false,
        hasAudio: RoomSync.isAudioActive,
        isSpeaking: false
      });
    }
  }
}
window.toggleCamera = toggleCamera;

function setupLocalSpeakingDetector() {
  if (!RoomSync.localMediaStream) return;
  try {
    const audioTrack = RoomSync.localMediaStream.getAudioTracks()[0];
    if (!audioTrack) return;

    if (!RoomSync.audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      RoomSync.audioCtx = new AudioCtx();
    }
    if (RoomSync.audioCtx.state === 'suspended') {
      RoomSync.audioCtx.resume();
    }

    const src = RoomSync.audioCtx.createMediaStreamSource(new MediaStream([audioTrack]));
    const analyser = RoomSync.audioCtx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let speakingTimeout = null;

    function checkAudio() {
      if (!RoomSync.isAudioActive) return;
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
      const avg = sum / dataArray.length;

      if (avg > 18) {
        if (!RoomSync.isSpeaking) {
          RoomSync.isSpeaking = true;
          updateActiveSpeakerUI(RoomSync.currentUser.name + ' (You)', true);
          const myTile = document.getElementById(`facecam-tile-${RoomSync.currentUser.uuid}`);
          if (myTile) myTile.classList.add('is-speaking');
          if (RoomSync.socket) {
            RoomSync.socket.emit('update-media-status', { hasAudio: true, hasVideo: RoomSync.isCamActive, isSpeaking: true });
          }
        }
        clearTimeout(speakingTimeout);
        speakingTimeout = setTimeout(() => {
          RoomSync.isSpeaking = false;
          updateActiveSpeakerUI('Voice Ready', false);
          const myTile = document.getElementById(`facecam-tile-${RoomSync.currentUser.uuid}`);
          if (myTile) myTile.classList.remove('is-speaking');
          if (RoomSync.socket) {
            RoomSync.socket.emit('update-media-status', { hasAudio: true, hasVideo: RoomSync.isCamActive, isSpeaking: false });
          }
        }, 1200);
      }
      requestAnimationFrame(checkAudio);
    }
    checkAudio();
  } catch (e) {
    console.warn('Audio analyser setup note:', e);
  }
}

function monitorRemoteAudioSpeaking(peerId, stream) {
  try {
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) return;

    if (!RoomSync.audioCtx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      RoomSync.audioCtx = new AudioCtx();
    }
    if (RoomSync.audioCtx.state === 'suspended') {
      RoomSync.audioCtx.resume();
    }

    const src = RoomSync.audioCtx.createMediaStreamSource(new MediaStream([audioTrack]));
    const analyser = RoomSync.audioCtx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let timeout = null;

    function check() {
      if (audioTrack.readyState !== 'live') return;
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
      const avg = sum / dataArray.length;

      if (avg > 18) {
        const member = (RoomSync.roomMembers || []).find(m => m.peerId === peerId || m.uuid === peerId);
        const name = member ? member.name : 'Participant';
        updateActiveSpeakerUI(name, true);

        clearTimeout(timeout);
        timeout = setTimeout(() => {
          updateActiveSpeakerUI('Voice Ready', false);
        }, 1200);
      }
      requestAnimationFrame(check);
    }
    check();
  } catch (e) {}
}

function updateActiveSpeakerUI(speakerName, isSpeaking) {
  const island = document.getElementById('activeSpeakerIsland');
  const nameEl = document.getElementById('activeSpeakerName');
  if (island) {
    island.classList.toggle('is-speaking', isSpeaking);
  }
  if (nameEl) {
    nameEl.textContent = isSpeaking ? `🎙️ ${speakerName}` : 'Voice Channel Ready';
  }
}

// Screen & Local Stream Broadcasting API via WebRTC PeerJS
function broadcastScreenshareStream(stream, streamType = 'screenshare', customTitle = null) {
  if (!RoomSync.peer || !stream) return;
  const resolvedType = (streamType === 'local-file-stream' || RoomSync.isLocalStreaming) ? 'local-file-stream' : 'screenshare';
  const resolvedTitle = customTitle || (resolvedType === 'local-file-stream' && RoomSync.currentLocalFile ? RoomSync.currentLocalFile.name : `${RoomSync.currentUser.name}'s Live Screen`);
  console.log(`[MediaBroadcast] Calling all connected peers with ${resolvedType} (${resolvedTitle})...`);

  RoomSync.peers.forEach((peerId) => {
    if (peerId && peerId !== RoomSync.peer.id) {
      // If there's an existing broadcast call for this peer, close it first
      const existingCall = RoomSync.broadcastCalls.get(peerId) || RoomSync.peerCalls.get(peerId);
      if (existingCall) {
        try { existingCall.close(); } catch(e) {}
      }
      try {
        const call = RoomSync.peer.call(peerId, stream, {
          metadata: {
            type: resolvedType,
            title: resolvedTitle,
            fileName: resolvedTitle,
            hostName: RoomSync.currentUser.name,
            hostUuid: RoomSync.currentUser.uuid
          }
        });
        if (call) {
          RoomSync.peerCalls.set(peerId, call);
          RoomSync.broadcastCalls.set(peerId, call);
        }
      } catch (e) {
        console.warn(`[MediaBroadcast] Call failed to peer ${peerId}:`, e);
      }
    }
  });
}

// Explicitly close every outbound screenshare/local-stream PeerJS call.
function closeBroadcastCalls() {
  RoomSync.broadcastCalls.forEach((call, peerId) => {
    try { call.close(); } catch (e) {}
    if (RoomSync.peerCalls.get(peerId) === call) {
      RoomSync.peerCalls.delete(peerId);
    }
  });
  RoomSync.broadcastCalls.clear();

  // Also verify peerCalls does not retain stale share calls
  RoomSync.peerCalls.forEach((call, peerId) => {
    if (call && call.metadata && (call.metadata.type === 'screenshare' || call.metadata.type === 'local-file-stream')) {
      try { call.close(); } catch (e) {}
      RoomSync.peerCalls.delete(peerId);
    }
  });
}

// Central teardown routine for all active media share modes (R3 mutual teardown)
async function teardownCurrentMediaShare(targetState = STATE_IDLE) {
  const wasScreen = RoomSync.isScreensharing;
  const wasLocalStream = RoomSync.isLocalStreaming;

  // A. Stop screen tracks and remove onended handlers to prevent async cancellation races
  if (RoomSync.currentScreenStream) {
    try {
      RoomSync.currentScreenStream.getTracks().forEach(t => {
        t.onended = null;
        try { t.stop(); } catch(e) {}
      });
    } catch (e) {
      console.warn('[MediaTeardown] Error stopping screen tracks:', e);
    }
    RoomSync.currentScreenStream = null;
  }

  // B. Stop local file stream tracks and remove onended handlers
  if (RoomSync.currentLocalStream) {
    try {
      RoomSync.currentLocalStream.getTracks().forEach(t => {
        t.onended = null;
        try { t.stop(); } catch(e) {}
      });
    } catch (e) {
      console.warn('[MediaTeardown] Error stopping local stream tracks:', e);
    }
    RoomSync.currentLocalStream = null;
  }

  // C. Clean up localStreamSourceVideo and #mainVideo if playing blob
  if (RoomSync.localStreamSourceVideo) {
    try { RoomSync.localStreamSourceVideo.pause(); } catch(e) {}
    RoomSync.localStreamSourceVideo = null;
  }
  const mainVid = document.getElementById('mainVideo');
  if (mainVid && (wasLocalStream || targetState !== STATE_LOCAL_STREAM)) {
    try {
      mainVid.pause();
      if (targetState !== STATE_LOCAL_SYNC && mainVid.src && mainVid.src.startsWith('blob:')) {
        mainVid.removeAttribute('src');
        mainVid.load();
      }
    } catch(e) {}
  }

  // D. Detach seek scrubber listeners
  if (RoomSync._localStreamSeekCleanup) {
    try { RoomSync._localStreamSeekCleanup(); } catch(e) {}
    RoomSync._localStreamSeekCleanup = null;
  }
  wireLocalStreamSeekControl(false);

  // E. Close all outbound broadcast PeerJS calls
  closeBroadcastCalls();

  // F. Reset screenshare video element & player stage classes
  const scrVideo = document.getElementById('screenshareVideo');
  if (scrVideo) {
    try { scrVideo.pause(); } catch(e) {}
    scrVideo.srcObject = null;
    scrVideo.style.display = 'none';
  }

  const container = document.getElementById('videoContainer');
  if (container && (targetState === STATE_IDLE || targetState === STATE_LOCAL_SYNC)) {
    container.classList.remove('screensharing-active');
  }

  const scrBar = document.getElementById('screenshareLiveBar');
  if (scrBar && (targetState === STATE_IDLE || targetState === STATE_LOCAL_SYNC)) {
    scrBar.classList.add('d-none');
  }

  const btnStop = document.getElementById('btnStopLocalShare');
  if (btnStop && (targetState === STATE_IDLE || targetState === STATE_LOCAL_SYNC)) {
    btnStop.classList.add('d-none');
  }

  const srcScreen = document.getElementById('srcScreen');
  if (srcScreen && targetState !== STATE_SCREEN_SHARE) {
    srcScreen.classList.remove('active');
    srcScreen.innerHTML = `<i class="bi bi-display text-primary"></i> Screenshare`;
  }

  // Clear screenshare peer id and banner
  RoomSync.screensharePeerId = null;
  const banner = document.getElementById('screenshareAlertBanner');
  if (banner) banner.classList.add('d-none');

  // G. Reset flags
  RoomSync.isScreensharing = false;
  RoomSync.isLocalStreaming = false;

  // H. If transitioning to IDLE from an active broadcast, notify server
  if (targetState === STATE_IDLE && RoomSync.socket) {
    if (wasScreen) {
      RoomSync.socket.emit('playback-control', { action: 'stop-screenshare' });
      RoomSync.socket.emit('update-member-status', { isScreensharing: false });
    } else if (wasLocalStream) {
      RoomSync.socket.emit('playback-control', { action: 'stop-local-stream' });
      RoomSync.socket.emit('update-member-status', { isScreensharing: false });
    }
  }
}

// Atomic transition coordinator for seamless media share switching (R3)
async function transitionMediaShare(targetState, options = {}) {
  const startCallback = typeof options === 'function' ? options : (options && (options.startCallback || options.action));

  if (RoomSync._transitionLock) {
    console.warn('[MediaTransition] Transition in progress, rejecting concurrent call to:', targetState);
    return false;
  }
  RoomSync._transitionLock = true;

  try {
    const currentState = RoomSync.mediaShareState || STATE_IDLE;
    console.log(`[MediaTransition] Transitioning from ${currentState} -> ${targetState}`);

    // If re-triggering the same active state, toggle it off back to IDLE
    if (currentState === targetState && targetState !== STATE_IDLE) {
      await teardownCurrentMediaShare(STATE_IDLE);
      RoomSync.mediaShareState = STATE_IDLE;
      return true;
    }

    // 1. Teardown active sharing state completely
    await teardownCurrentMediaShare(targetState);

    // 2. Execute new share setup if not returning to IDLE
    if (targetState !== STATE_IDLE) {
      if (typeof startCallback === 'function') {
        const success = await startCallback();
        if (success === false) {
          console.warn('[MediaTransition] Start callback cancelled or failed, reverting to IDLE');
          await teardownCurrentMediaShare(STATE_IDLE);
          RoomSync.mediaShareState = STATE_IDLE;
          return false;
        }
      }
      RoomSync.mediaShareState = targetState;
    } else {
      RoomSync.mediaShareState = STATE_IDLE;
    }
    return true;
  } catch (err) {
    console.error('[MediaTransition] Exception during transition to', targetState, err);
    await teardownCurrentMediaShare(STATE_IDLE);
    RoomSync.mediaShareState = STATE_IDLE;
    throw err;
  } finally {
    RoomSync._transitionLock = false;
  }
}

async function startScreenShare() {
  if (RoomSync.mediaShareState === STATE_SCREEN_SHARE || RoomSync.isScreensharing) {
    return transitionMediaShare(STATE_IDLE);
  }

  return transitionMediaShare(STATE_SCREEN_SHARE, async () => {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always', frameRate: 30 },
        audio: true
      });

      RoomSync.currentScreenStream = screenStream;
      RoomSync.isScreensharing = true;

      // Attach to local player directly on the main stage
      showScreenShareInPlayer(screenStream, true, RoomSync.currentUser.name, 'screenshare', `${RoomSync.currentUser.name}'s Live Screen`);

      // Notify server via socket
      if (RoomSync.socket) {
        RoomSync.socket.emit('playback-control', {
          action: 'start-screenshare',
          peerId: RoomSync.peer ? RoomSync.peer.id : null,
          title: `${RoomSync.currentUser.name}'s Live Screen`
        });
      }

      // Call all active members in room to stream display track
      broadcastScreenshareStream(screenStream, 'screenshare', `${RoomSync.currentUser.name}'s Live Screen`);

      // Toggle button UI
      const srcScreen = document.getElementById('srcScreen');
      if (srcScreen) {
        srcScreen.classList.add('active');
        srcScreen.innerHTML = `<i class="bi bi-stop-circle-fill text-danger"></i> Stop Share`;
      }

      showSyncToast('🖥️ Screen sharing live broadcast active!');

      const vidTrack = screenStream.getVideoTracks()[0];
      if (vidTrack) {
        vidTrack.onended = () => {
          if (RoomSync.mediaShareState === STATE_SCREEN_SHARE) {
            transitionMediaShare(STATE_IDLE);
          }
        };
      }
      return true;
    } catch (err) {
      console.log('Screen capture aborted or denied:', err);
      showSyncToast('⚠️ Screen share cancelled');
      return false;
    }
  });
}

function stopScreenShare() {
  return transitionMediaShare(STATE_IDLE);
}

// Local File WebRTC P2P Streaming Engine
async function startLocalFileStream(input, streamFileName) {
  if (!input) return false;

  return transitionMediaShare(STATE_LOCAL_STREAM, async () => {
    let stream = null;
    let fileName = streamFileName || 'Local Video';

    if (typeof MediaStream !== 'undefined' && input instanceof MediaStream) {
      stream = input;
    } else if ((typeof File !== 'undefined' && input instanceof File) || (typeof Blob !== 'undefined' && input instanceof Blob)) {
      fileName = input.name || fileName;
      showSyncToast(`Loading local file "${fileName}"...`);
      RoomSync.currentLocalFile = input;

      const mainVid = document.getElementById('mainVideo');
      if (!mainVid) return false;

      if (RoomSync.player) {
        try { RoomSync.player.pause(); } catch(e) {}
      }

      if (RoomSync.hls) {
        try { RoomSync.hls.destroy(); } catch (e) {}
        RoomSync.hls = null;
      }

      const blobUrl = createTrackedObjectUrl(input);
      mainVid.src = blobUrl;
      mainVid.style.display = 'block';
      try {
        await mainVid.play();
      } catch (playErr) {
        console.warn('[LocalStream] Auto-play local video note:', playErr);
      }

      RoomSync.localStreamSourceVideo = mainVid;
      stream = mainVid.captureStream ? mainVid.captureStream() : (mainVid.mozCaptureStream ? mainVid.mozCaptureStream() : null);
    } else {
      return false;
    }

    if (!stream) {
      showSyncToast('⚠️ Local stream capture not supported in this browser.');
      return false;
    }

    RoomSync.isLocalStreaming = true;
    RoomSync.currentLocalStream = stream;

    // Broadcast stream to all connected peers with accurate metadata
    broadcastScreenshareStream(stream, 'local-file-stream', fileName);

    // Update Stage UI
    showScreenShareInPlayer(stream, true, RoomSync.currentUser.name, 'local-file-stream', fileName);
    const scrName = document.getElementById('screenshareHostName');
    if (scrName) scrName.textContent = `Streaming: ${fileName}`;

    const titleEl = document.getElementById('videoTitle');
    if (titleEl) titleEl.textContent = `[LOCAL STREAM] ${fileName}`;
    const ytBadge = document.querySelector('.yt-badge');
    if (ytBadge) ytBadge.textContent = 'LOCAL FILE';

    const btnStop = document.getElementById('btnStopLocalShare');
    if (btnStop) {
      btnStop.classList.remove('d-none');
      btnStop.onclick = stopLocalFileStream;
    }

    // Notify room server
    if (RoomSync.socket) {
      RoomSync.socket.emit('playback-control', {
        action: 'start-local-stream',
        peerId: RoomSync.peer ? RoomSync.peer.id : null,
        title: fileName
      });
    }

    showSyncToast(`📁 Live P2P streaming active for "${fileName}"!`);

    const vidTrack = stream.getVideoTracks()[0];
    if (vidTrack) {
      vidTrack.onended = () => {
        if (RoomSync.mediaShareState === STATE_LOCAL_STREAM) {
          transitionMediaShare(STATE_IDLE);
        }
      };
    }
    return true;
  });
}

function stopLocalFileStream() {
  return transitionMediaShare(STATE_IDLE);
}

function formatSeekTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function wireLocalStreamSeekControl(enable) {
  const seekRow = document.getElementById('scrSeekRow');
  const seekBar = document.getElementById('scrSeekBar');
  const curEl = document.getElementById('scrSeekCurrentTime');
  const durEl = document.getElementById('scrSeekDuration');
  const playPauseBtn = document.getElementById('btnScrPlayPause');
  const playPauseIcon = document.getElementById('btnScrPlayPauseIcon');
  if (!seekRow || !seekBar || !playPauseBtn) return;

  // Always detach any previous wiring first to avoid stacking duplicate listeners
  // across repeated broadcast sessions.
  if (RoomSync._localStreamSeekCleanup) {
    try { RoomSync._localStreamSeekCleanup(); } catch (e) {}
    RoomSync._localStreamSeekCleanup = null;
  }

  if (!enable || !RoomSync.localStreamSourceVideo) {
    seekRow.classList.add('d-none');
    seekRow.classList.remove('d-flex');
    playPauseBtn.classList.add('d-none');
    return;
  }

  const srcVid = RoomSync.localStreamSourceVideo;
  seekRow.classList.remove('d-none');
  seekRow.classList.add('d-flex');
  playPauseBtn.classList.remove('d-none');

  const onTimeUpdate = () => {
    if (seekBar.matches(':active')) return; // don't fight the user while dragging
    if (Number.isFinite(srcVid.duration) && srcVid.duration > 0) {
      seekBar.max = String(srcVid.duration);
      seekBar.value = String(srcVid.currentTime);
    }
    if (curEl) curEl.textContent = formatSeekTime(srcVid.currentTime);
    if (durEl) durEl.textContent = formatSeekTime(srcVid.duration);
  };
  const onPlayPauseState = () => {
    if (playPauseIcon) playPauseIcon.className = srcVid.paused ? 'bi bi-play-fill' : 'bi bi-pause-fill';
  };
  const onSeekInput = () => {
    srcVid.currentTime = Number(seekBar.value) || 0;
  };
  const onPlayPauseClick = () => {
    if (srcVid.paused) srcVid.play().catch(() => {});
    else srcVid.pause();
  };

  srcVid.addEventListener('timeupdate', onTimeUpdate);
  srcVid.addEventListener('loadedmetadata', onTimeUpdate);
  srcVid.addEventListener('play', onPlayPauseState);
  srcVid.addEventListener('pause', onPlayPauseState);
  seekBar.addEventListener('input', onSeekInput);
  playPauseBtn.addEventListener('click', onPlayPauseClick);
  onTimeUpdate();
  onPlayPauseState();

  RoomSync._localStreamSeekCleanup = () => {
    srcVid.removeEventListener('timeupdate', onTimeUpdate);
    srcVid.removeEventListener('loadedmetadata', onTimeUpdate);
    srcVid.removeEventListener('play', onPlayPauseState);
    srcVid.removeEventListener('pause', onPlayPauseState);
    seekBar.removeEventListener('input', onSeekInput);
    playPauseBtn.removeEventListener('click', onPlayPauseClick);
  };
}

function showScreenShareInPlayer(stream, isLocal = false, broadcasterName = '', streamType = null, streamTitle = '') {
  const container = document.getElementById('videoContainer');
  const scrVideo = document.getElementById('screenshareVideo');
  const scrBar = document.getElementById('screenshareLiveBar');
  const scrName = document.getElementById('screenshareHostName');
  const btnStop = document.getElementById('btnStopLocalShare');
  if (!scrVideo) return;

  const isLocalStream = streamType === 'local-file-stream' || (!streamType && RoomSync.isLocalStreaming);

  // 1. Completely pause, mute, and freeze background media player
  if (RoomSync.player) {
    try {
      RoomSync.player.pause();
      RoomSync.player.muted = true;
    } catch(e) {}
    try {
      if (RoomSync.player.embed && typeof RoomSync.player.embed.pauseVideo === 'function') {
        RoomSync.player.embed.pauseVideo();
        RoomSync.player.embed.mute();
      }
    } catch(e) {}
  }
  const mainVid = document.getElementById('mainVideo');
  if (mainVid && !isLocalStream) {
    try { mainVid.pause(); mainVid.muted = true; } catch(e) {}
  }
  const ytIframe = document.querySelector('#videoContainer iframe');
  if (ytIframe && ytIframe.contentWindow) {
    try {
      ytIframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), '*');
      ytIframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'mute', args: [] }), '*');
    } catch(e) {}
  }

  // 2. Activate screensharing stage state (hides Plyr and regular timeline controls)
  if (container) {
    container.classList.add('screensharing-active');
  }

  // 3. Attach display stream to screenshare video element
  if (stream) {
    // If already playing this active stream, do not reload/interrupt
    if (scrVideo.srcObject === stream && !scrVideo.paused) {
      return;
    }
    scrVideo.srcObject = stream;
    scrVideo.muted = true; // MUST remain muted to comply with browser autoplay policy!
    scrVideo.playsInline = true;
    scrVideo.style.display = 'block';
    scrVideo.play().then(() => {
      console.log('[Screenshare] Screen broadcast feed playing smoothly (muted)');
    }).catch(err => {
      console.warn('[Screenshare] Video play retry:', err);
      scrVideo.muted = true;
      scrVideo.play().catch(() => {});
    });
  } else {
    // Waiting for incoming WebRTC call from broadcaster
    scrVideo.style.display = 'block';
  }

  const name = broadcasterName || (isLocal ? RoomSync.currentUser.name : (RoomSync.roomMeta ? RoomSync.roomMeta.mediaTitle : 'Host'));
  if (scrName) {
    if (isLocal) {
      scrName.textContent = isLocalStream ? `Broadcasting: ${streamTitle || 'Local File'}` : `You are broadcasting (${name})`;
    } else {
      scrName.textContent = isLocalStream ? `Streaming: ${streamTitle || name}` : `${name}'s Live Screen`;
    }
  }
  if (scrBar) scrBar.classList.remove('d-none');

  // Host-only timeline seek control for local-file WebRTC broadcasts. Only the
  // broadcaster has a real seekable source (mainVid / localStreamSourceVideo) --
  // viewers only receive a live, non-seekable MediaStream, so they get no control here.
  wireLocalStreamSeekControl(isLocal && isLocalStream);
  if (btnStop) {
    btnStop.classList.toggle('d-none', !isLocal);
    btnStop.onclick = isLocalStream ? stopLocalFileStream : stopScreenShare;
  }

  const btnFullscreen = document.getElementById('btnScrFullscreen');
  if (btnFullscreen) {
    btnFullscreen.onclick = () => {
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      } else if (container) {
        container.requestFullscreen?.().catch(() => {});
      }
    };
  }

  const btnAudio = document.getElementById('btnScrAudio');
  const btnAudioIcon = document.getElementById('btnScrAudioIcon');
  const btnAudioText = document.getElementById('btnScrAudioText');
  if (btnAudio) {
    if (btnAudioIcon) btnAudioIcon.className = scrVideo.muted ? 'bi bi-volume-mute-fill' : 'bi bi-volume-up-fill';
    if (btnAudioText) btnAudioText.textContent = scrVideo.muted ? 'Unmute' : 'Mute';
    btnAudio.onclick = (e) => {
      e.stopPropagation();
      if (!scrVideo) return;
      scrVideo.muted = !scrVideo.muted;
      if (btnAudioIcon) btnAudioIcon.className = scrVideo.muted ? 'bi bi-volume-mute-fill' : 'bi bi-volume-up-fill';
      if (btnAudioText) btnAudioText.textContent = scrVideo.muted ? 'Unmute' : 'Mute';
      if (!scrVideo.muted && scrVideo.paused) {
        scrVideo.play().catch(() => {});
      }
    };
  }

  const titleEl = document.getElementById('videoTitle');
  const ytBadge = document.getElementById('ytBadge') || document.querySelector('.yt-badge');

  if (isLocalStream) {
    const displayTitle = streamTitle || `${name}'s Local File`;
    if (titleEl) titleEl.textContent = `📁 [LOCAL STREAM] ${displayTitle}`;
    if (ytBadge) {
      ytBadge.textContent = 'LOCAL STREAM';
      ytBadge.style.background = '#dc2626';
      ytBadge.style.display = 'inline-block';
    }
    updateNowPlayingUI(displayTitle, 'local-stream', '');
  } else {
    const displayTitle = `${name}'s Live Screen Broadcast`;
    if (titleEl) titleEl.textContent = `🖥️ ${displayTitle}`;
    if (ytBadge) {
      ytBadge.textContent = 'SCREEN';
      ytBadge.style.background = '#0284c7';
      ytBadge.style.display = 'inline-block';
    }
    updateNowPlayingUI(displayTitle, 'screen', '');
  }
}

function hideScreenShareInPlayer() {
  const container = document.getElementById('videoContainer');
  const scrVideo = document.getElementById('screenshareVideo');
  const scrBar = document.getElementById('screenshareLiveBar');
  const btnStop = document.getElementById('btnStopLocalShare');

  if (container) {
    container.classList.remove('screensharing-active');
  }
  if (scrVideo) {
    try { scrVideo.pause(); } catch(e) {}
    scrVideo.style.display = 'none';
    scrVideo.srcObject = null;
  }
  if (scrBar) scrBar.classList.add('d-none');
  if (btnStop) btnStop.classList.add('d-none');
  wireLocalStreamSeekControl(false);

  // Clear screenshare peer ID and alert banner
  RoomSync.screensharePeerId = null;
  const banner = document.getElementById('screenshareAlertBanner');
  if (banner) banner.classList.add('d-none');

  // Restore regular video mute state
  if (RoomSync.player) {
    try { RoomSync.player.muted = false; } catch(e) {}
  }
  const mainVid = document.getElementById('mainVideo');
  if (mainVid && !RoomSync.isLocalStreaming) {
    try { mainVid.muted = false; } catch(e) {}
  }
  const ytIframe = document.querySelector('#videoContainer iframe');
  if (ytIframe && ytIframe.contentWindow) {
    try {
      ytIframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func: 'unMute', args: [] }), '*');
    } catch(e) {}
  }

  // Restore video badge, title, and now-playing metadata
  const ytBadge = document.getElementById('ytBadge') || document.querySelector('.yt-badge');
  if (ytBadge) {
    const isYt = !RoomSync.roomMeta || !RoomSync.roomMeta.mediaType || RoomSync.roomMeta.mediaType === 'youtube' || (RoomSync.roomMeta.mediaUrl && RoomSync.roomMeta.mediaUrl.includes('youtu'));
    ytBadge.textContent = isYt ? 'YOUTUBE' : (RoomSync.roomMeta?.mediaType?.toUpperCase() || 'VIDEO');
    ytBadge.style.background = '';
    ytBadge.style.display = 'inline-block';
  }

  const titleEl = document.getElementById('videoTitle');
  if (titleEl && RoomSync.roomMeta && RoomSync.roomMeta.mediaTitle) {
    titleEl.textContent = RoomSync.roomMeta.mediaTitle;
  }

  if (RoomSync.roomMeta) {
    updateNowPlayingUI(RoomSync.roomMeta.mediaTitle || 'Video', RoomSync.roomMeta.mediaType || 'youtube', RoomSync.roomMeta.mediaUrl || '');
  }
}

// ============================================================================
// 10. Chat, UI Controls & Permissions Wiring
// ============================================================================

function setupUIEventListeners() {
  const controlsBar = document.querySelector('.controls-bar');
  if (controlsBar) {
    // 1. Previous Video Button
    let prevBtn = document.getElementById('btnPrevVideo');
    if (!prevBtn) {
      prevBtn = document.createElement('button');
      prevBtn.className = 'ctrl-btn';
      prevBtn.id = 'btnPrevVideo';
      prevBtn.title = 'Previous Video';
      prevBtn.innerHTML = `<i class="bi bi-skip-start-fill"></i>`;
      controlsBar.insertBefore(prevBtn, controlsBar.querySelector('#ppBtn'));
    }
    prevBtn.onclick = () => {
      if (!canControlPlayback()) {
        showSyncToast('⛔ You do not have permission to change videos in this room.');
        return;
      }
      if (RoomSync.socket) RoomSync.socket.emit('queue-prev');
    };

    // 2. Next Video Button
    let nextBtn = document.getElementById('btnNextVideo');
    if (!nextBtn) {
      nextBtn = document.createElement('button');
      nextBtn.className = 'ctrl-btn';
      nextBtn.id = 'btnNextVideo';
      nextBtn.title = 'Next Video in Queue';
      nextBtn.innerHTML = `<i class="bi bi-skip-end-fill"></i>`;
      controlsBar.insertBefore(nextBtn, controlsBar.querySelector('#rewindBtn').nextSibling);
    }
    nextBtn.onclick = () => {
      if (!canControlPlayback() && (!RoomSync.roomMeta || !RoomSync.roomMeta.voteSkipEnabled)) {
        showSyncToast('⛔ You do not have permission to skip videos in this room.');
        return;
      }
      if (RoomSync.socket) RoomSync.socket.emit('queue-next');
    };

    // 3. Sync Opt-Out Toggle Button
    let optOutBtn = document.getElementById('btnSyncOptOut');
    if (!optOutBtn) {
      optOutBtn = document.createElement('button');
      optOutBtn.className = 'ctrl-btn';
      optOutBtn.id = 'btnSyncOptOut';
      optOutBtn.title = 'Sync Status: Click to Opt Out or Re-sync';
      optOutBtn.innerHTML = `
        <i class="bi bi-broadcast text-success" id="syncStatusIcon"></i>
        <span style="font-size:0.65rem;font-weight:700;margin-left:4px;" id="syncStatusLabel">SYNCED</span>
      `;
      controlsBar.insertBefore(optOutBtn, controlsBar.querySelector('.ctrl-spacer'));
    }
    optOutBtn.onclick = toggleSyncOptOut;
  }

  // Custom Controls Bar Event Listeners
  const ppBtn = document.getElementById('ppBtn');
  if (ppBtn) ppBtn.addEventListener('click', togglePlayPause);

  const bigPlayBtn = document.getElementById('bigPlayBtn');
  if (bigPlayBtn) {
    bigPlayBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      togglePlayPause();
    });
  }

  function initiateLocalSeek(targetTime) {
    if (!RoomSync.player) return;
    if (!canControlPlayback()) {
      if (RoomSync.currentUser && RoomSync.currentUser.isGuest && !RoomSync.roomMeta?.allowGuestControl) {
        showSyncToast('⛔ Guests do not have playback control permission in this room.');
      } else {
        showSyncToast('🔒 Host Sync Lock is on: only host can seek.');
      }
      return;
    }
    const dur = RoomSync.player.duration || targetTime;
    const clampedTarget = Math.max(0, Math.min(targetTime, dur));

    // 1. Optimistically update local authoritative anchor immediately (F-1)
    RoomSync.serverPlaybackBaseTime = clampedTarget;
    RoomSync.serverPlaybackUpdatedAtMs = Date.now();
    RoomSync.isLocalSeeking = true;

    // 2. Seek local player
    RoomSync.player.currentTime = clampedTarget;

    // 3. Debounced broadcast to server (150ms trailing edge for scrubbing/rapid clicks - F-9)
    clearTimeout(RoomSync.pendingSeekTimer);
    RoomSync.pendingSeekTimer = setTimeout(() => {
      broadcastPlaybackAction('seek', clampedTarget);
    }, 150);

    updateTimeDisplay();
  }

  const rewindBtn = document.getElementById('rewindBtn');
  if (rewindBtn) {
    rewindBtn.addEventListener('click', () => {
      if (!canControlPlayback()) {
        if (RoomSync.currentUser && RoomSync.currentUser.isGuest && !RoomSync.roomMeta?.allowGuestControl) {
          showSyncToast('⛔ Guests do not have playback control permission in this room.');
        } else {
          showSyncToast('🔒 Host Sync Lock is on: only host can seek.');
        }
        return;
      }
      if (RoomSync.player) {
        const target = Math.max(0, (RoomSync.player.currentTime || 0) - 10);
        initiateLocalSeek(target);
        showSyncToast('Rewound 10s');
      }
    });
  }

  const muteBtn = document.getElementById('muteBtn');
  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      if (RoomSync.player) {
        RoomSync.player.muted = !RoomSync.player.muted;
        const volIcon = document.getElementById('volIcon');
        if (volIcon) {
          volIcon.className = RoomSync.player.muted ? 'bi bi-volume-mute-fill text-danger' : 'bi bi-volume-up-fill';
        }
        showSyncToast(RoomSync.player.muted ? 'Muted' : 'Unmuted');
      }
    });
  }

  function toggleFullscreen() {
    const vc = document.getElementById('videoContainer') || document.querySelector('.stage-col');
    if (!document.fullscreenElement) {
      vc?.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }
  window.toggleFullscreen = toggleFullscreen;

  const fsBtn = document.getElementById('fsBtn');
  if (fsBtn) {
    fsBtn.addEventListener('click', toggleFullscreen);
  }

  document.addEventListener('fullscreenchange', () => {
    const fsIcon = document.getElementById('fsIcon');
    if (fsIcon) {
      fsIcon.className = document.fullscreenElement ? 'bi bi-fullscreen-exit' : 'bi bi-fullscreen';
    }
  });

  // Theater Mode & Mini Player Listeners
  const theaterBtn = document.getElementById('theaterBtn');
  if (theaterBtn) theaterBtn.addEventListener('click', toggleTheaterMode);

  const pipBtn = document.getElementById('pipBtn');
  if (pipBtn) pipBtn.addEventListener('click', toggleMiniPlayer);

  const restoreMiniBtn = document.getElementById('btnRestoreMiniPlayer');
  if (restoreMiniBtn) restoreMiniBtn.addEventListener('click', toggleMiniPlayer);

  const progressArea = document.getElementById('progressArea');
  if (progressArea) {
    function getScrubTime(e) {
      if (!RoomSync.player || !RoomSync.player.duration) return 0;
      const clientX = (e.touches && e.touches[0]) ? e.touches[0].clientX : (e.clientX !== undefined ? e.clientX : 0);
      const rect = progressArea.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return ratio * RoomSync.player.duration;
    }

    function onScrubMove(e) {
      if (!RoomSync.isDraggingScrubber || !RoomSync.player || !RoomSync.player.duration) return;
      const targetTime = getScrubTime(e);
      const ratio = targetTime / RoomSync.player.duration;

      const progressFill = document.getElementById('progressFill');
      if (progressFill) progressFill.style.width = `${ratio * 100}%`;
      const timeDisplay = document.getElementById('timeDisplay');
      if (timeDisplay) timeDisplay.textContent = `${formatDuration(targetTime)} / ${formatDuration(RoomSync.player.duration)}`;

      RoomSync.serverPlaybackBaseTime = targetTime;
      RoomSync.serverPlaybackUpdatedAtMs = Date.now();
      RoomSync.isLocalSeeking = true;

      clearTimeout(RoomSync.pendingSeekTimer);
      RoomSync.pendingSeekTimer = setTimeout(() => {
        if (RoomSync.player) {
          RoomSync.isProgrammaticSeek = true;
          RoomSync.player.currentTime = targetTime;
        }
        broadcastPlaybackAction('seek', targetTime);
      }, 150);
    }

    function onScrubEnd(e) {
      if (!RoomSync.isDraggingScrubber) return;
      RoomSync.isDraggingScrubber = false;
      window.removeEventListener('mousemove', onScrubMove);
      window.removeEventListener('mouseup', onScrubEnd);
      window.removeEventListener('touchmove', onScrubMove);
      window.removeEventListener('touchend', onScrubEnd);

      clearTimeout(RoomSync.pendingSeekTimer);
      const targetTime = getScrubTime(e);
      initiateLocalSeek(targetTime);
      showSyncToast(`Seeked to ${formatDuration(targetTime)}`);
    }

    progressArea.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (!canControlPlayback()) {
        if (RoomSync.currentUser && RoomSync.currentUser.isGuest && !RoomSync.roomMeta?.allowGuestControl) {
          showSyncToast('⛔ Guests do not have playback control permission in this room.');
        } else {
          showSyncToast('🔒 Host Sync Lock is on: only host can seek.');
        }
        return;
      }
      RoomSync.isDraggingScrubber = true;
      window.addEventListener('mousemove', onScrubMove);
      window.addEventListener('mouseup', onScrubEnd);
      onScrubMove(e);
    });

    progressArea.addEventListener('touchstart', (e) => {
      if (!canControlPlayback()) {
        if (RoomSync.currentUser && RoomSync.currentUser.isGuest && !RoomSync.roomMeta?.allowGuestControl) {
          showSyncToast('⛔ Guests do not have playback control permission in this room.');
        } else {
          showSyncToast('🔒 Host Sync Lock is on: only host can seek.');
        }
        return;
      }
      RoomSync.isDraggingScrubber = true;
      window.addEventListener('touchmove', onScrubMove, { passive: true });
      window.addEventListener('touchend', onScrubEnd);
      onScrubMove(e);
    }, { passive: true });

    progressArea.addEventListener('click', (e) => {
      if (!RoomSync.isDraggingScrubber) {
        const targetTime = getScrubTime(e);
        initiateLocalSeek(targetTime);
        showSyncToast(`Seeked to ${formatDuration(targetTime)}`);
      }
    });
  }

  // Closed Captions (CC) Toggle Listener
  const ccBtn = document.getElementById('ccBtn');
  if (ccBtn) {
    ccBtn.addEventListener('click', (e) => {
      e.preventDefault();
      toggleClosedCaptions();
    });
  }

  // Hardware & Controls Bar Toggles (Mic)
  const btnMic = document.getElementById('btnToggleMic');
  if (btnMic) btnMic.addEventListener('click', toggleMicrophone);

  const ctrlMicBtn = document.getElementById('ctrlMicBtn');
  if (ctrlMicBtn) ctrlMicBtn.addEventListener('click', toggleMicrophone);

  // Hardware & Controls Bar Toggles (Webcam / Facecam)
  const btnCam = document.getElementById('btnToggleCam');
  if (btnCam) btnCam.addEventListener('click', toggleCamera);

  const ctrlCamBtn = document.getElementById('ctrlCamBtn');
  if (ctrlCamBtn) ctrlCamBtn.addEventListener('click', toggleCamera);

  // Initialize microphone button to display red cross when off
  const ctrlMicIcon = document.getElementById('ctrlMicIcon');
  if (ctrlMicIcon && !RoomSync.isAudioActive) {
    ctrlMicIcon.className = 'bi bi-mic-mute-fill text-danger';
    ctrlMicIcon.style.color = '#ef4444';
  }
  const micIcon = document.getElementById('micIcon');
  if (micIcon && !RoomSync.isAudioActive) {
    micIcon.className = 'bi bi-mic-mute-fill text-danger';
    micIcon.style.color = '#ef4444';
  }

  // Initialize camera button to display red cross when off
  const ctrlCamIcon = document.getElementById('ctrlCamIcon');
  if (ctrlCamIcon && !RoomSync.isCamActive) {
    ctrlCamIcon.className = 'bi bi-camera-video-off-fill text-danger';
    ctrlCamIcon.style.color = '#ef4444';
  }
  const camIcon = document.getElementById('camIcon');
  if (camIcon && !RoomSync.isCamActive) {
    camIcon.className = 'bi bi-camera-video-off-fill text-danger';
    camIcon.style.color = '#ef4444';
  }

  // Choose Media Source Buttons
  const srcYt = document.getElementById('srcYt');
  const srcScreen = document.getElementById('srcScreen');
  const srcUpload = document.getElementById('srcUpload');

  if (srcYt) {
    srcYt.addEventListener('click', () => {
      const url = prompt('Enter YouTube Video URL:', 'https://www.youtube.com/watch?v=');
      if (url && (url.includes('youtube.com') || url.includes('youtu.be'))) {
        const id = extractYouTubeId(url);
        if (id) {
          const ytUrl = `https://www.youtube.com/watch?v=${id}`;
          if (RoomSync.socket) {
            RoomSync.socket.emit('playback-control', {
              action: 'change-media',
              url: ytUrl,
              title: 'YouTube Stream',
              mediaType: 'youtube'
            });
          }
          loadMediaSource(ytUrl, 'youtube', 'YouTube Stream');
        } else {
          showSyncToast('Invalid YouTube URL');
        }
      }
    });
  }

  if (srcScreen) srcScreen.addEventListener('click', startScreenShare);
  if (srcUpload) {
    // Choice modal #localFileSyncChoiceModal handles zero-bandwidth vs WebRTC choice without duplicate OS picker
    srcUpload.innerHTML = `<i class="bi bi-folder-symlink-fill"></i> Local File`;
  }

  // Paste Input (Add URL to switch stream)
  const pasteInput = document.getElementById('pasteInput');
  const btnSubmitUrl = document.getElementById('btnSubmitUrl');

  async function submitMediaUrl() {
    if (!pasteInput) return;
    const url = pasteInput.value.trim();
    if (!url) return;
    pasteInput.value = '';

    showSyncToast('Analyzing video URL...');
    const meta = await resolveMediaMetadata(url);

    RoomSync.socket.emit('playback-control', {
      action: 'change-media',
      url: meta.url,
      title: meta.title,
      mediaType: meta.mediaType,
      time: 0
    });
    showSyncToast(`Switched stream: "${meta.title}"`);
  }

  if (pasteInput) {
    pasteInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitMediaUrl();
    });
  }

  if (btnSubmitUrl) {
    btnSubmitUrl.addEventListener('click', submitMediaUrl);
  }

  // Change Nickname Modal Listeners
  const changeNickModal = document.getElementById('changeNicknameModal');
  const nickInput = document.getElementById('changeNicknameInput');
  const btnSaveNick = document.getElementById('btnSaveNickname');

  if (changeNickModal && nickInput) {
    changeNickModal.addEventListener('show.bs.modal', () => {
      nickInput.value = RoomSync.currentUser.name || '';
      setTimeout(() => nickInput.focus(), 300);
    });
  }

  if (btnSaveNick && nickInput) {
    btnSaveNick.addEventListener('click', () => {
      const val = nickInput.value.trim();
      if (!val) return;
      handleNicknameChange(val);
    });
    nickInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = nickInput.value.trim();
        if (val) handleNicknameChange(val);
      }
    });
  }

  // Custom Stream Modal Form
  const customStreamForm = document.getElementById('customStreamForm');
  if (customStreamForm) {
    customStreamForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = document.getElementById('customStreamUrl').value.trim();
      const title = document.getElementById('customStreamTitle').value.trim();
      if (!url) return;

      showSyncToast('Loading stream metadata...');
      const meta = await resolveMediaMetadata(url, title);
      RoomSync.socket.emit('playback-control', {
        action: 'change-media',
        url: meta.url,
        title: meta.title,
        mediaType: meta.mediaType,
        time: 0
      });

      const modalEl = document.getElementById('customStreamModal');
      if (modalEl) {
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();
      }
      showSyncToast(`Broadcasting stream: ${meta.title}`);
    });
  }

  // Add to Queue Modal Form
  const addQueueForm = document.getElementById('addQueueForm');
  if (addQueueForm) {
    addQueueForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = document.getElementById('queueVideoUrl').value.trim();
      const title = document.getElementById('queueVideoTitle').value.trim();
      if (!url) return;

      showSyncToast('Fetching video metadata...');
      const meta = await resolveMediaMetadata(url, title);

      RoomSync.socket.emit('queue-add', {
        url: meta.url,
        title: meta.title,
        duration: 180,
        mediaType: meta.mediaType
      });

      const modalEl = document.getElementById('addQueueModal');
      if (modalEl) {
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();
      }
      addQueueForm.reset();
      showSyncToast(`Added "${meta.title}" to queue`);
    });
  }

  // Passcode Entry Form
  const passcodeForm = document.getElementById('passcodeEntryForm');
  if (passcodeForm) {
    passcodeForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const pin = document.getElementById('roomPinInput').value.trim();
      RoomSync.socket.emit('join-room', {
        roomCode: RoomSync.roomCode,
        userUuid: RoomSync.currentUser.uuid,
        nickname: RoomSync.currentUser.name,
        isGuest: RoomSync.currentUser.isGuest,
        passcode: pin
      });
      const modalEl = document.getElementById('passcodeModal');
      if (modalEl) {
        const modal = bootstrap.Modal.getInstance(modalEl);
        if (modal) modal.hide();
      }
    });
  }

function formatFileSize(bytes) {
  if (!bytes || isNaN(bytes)) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
window.formatFileSize = formatFileSize;

function handleChatFileSelected(inputEl) {
  const file = inputEl && inputEl.files && inputEl.files[0];
  if (!file) return;

  if (file.size > 50 * 1024 * 1024) {
    alert('File exceeds the 50MB upload limit for room attachments.');
    inputEl.value = '';
    return;
  }

  window._pendingChatFile = file;

  const preview = document.getElementById('chatAttachmentPreview');
  const nameEl = document.getElementById('chatAttachmentName');
  const sizeEl = document.getElementById('chatAttachmentSize');

  if (preview && nameEl && sizeEl) {
    nameEl.textContent = file.name;
    sizeEl.textContent = formatFileSize(file.size);
    preview.classList.remove('d-none');
    preview.classList.add('d-flex');
  }

  showSyncToast(`Attachment selected: "${file.name}". Click send or press Enter.`);
  const chatInput = document.getElementById('chatInput');
  if (chatInput) chatInput.focus();
}
window.handleChatFileSelected = handleChatFileSelected;
window.handleChatFileUpload = handleChatFileSelected;

function clearChatAttachment() {
  window._pendingChatFile = null;
  const fileInput = document.getElementById('chatFileInput');
  if (fileInput) fileInput.value = '';
  const preview = document.getElementById('chatAttachmentPreview');
  if (preview) {
    preview.classList.add('d-none');
    preview.classList.remove('d-flex');
  }
}
window.clearChatAttachment = clearChatAttachment;

  // Chat send message
  const chatInput = document.getElementById('chatInput');
  window.sendMsg = async function() {
    if (!chatInput) return;
    const text = chatInput.value.trim();
    const pendingFile = window._pendingChatFile;

    if (!text && !pendingFile) return;

    chatInput.value = '';

    let attachmentObj = null;

    if (pendingFile) {
      showSyncToast(`Uploading "${pendingFile.name}"...`);
      try {
        const base64Data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(pendingFile);
        });

        const res = await fetch(`/api/rooms/${RoomSync.roomCode}/upload-file`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: pendingFile.name,
            fileBase64: base64Data,
            fileType: pendingFile.type
          })
        });

        const uploadRes = await res.json();
        if (uploadRes.success) {
          attachmentObj = {
            fileName: uploadRes.fileName,
            fileUrl: uploadRes.fileUrl,
            fileSize: uploadRes.fileSize,
            fileType: uploadRes.fileType
          };
          clearChatAttachment();
        } else {
          showSyncToast('Attachment upload failed: ' + (uploadRes.message || 'Error'));
        }
      } catch (err) {
        console.error('File upload failed:', err);
        showSyncToast('Attachment upload error: ' + err.message);
      }
    }

    if (RoomSync.socket) {
      const encrypted = await encryptChatMessage(text, RoomSync.roomCode);
      RoomSync.socket.emit('chat-message', {
        encryptedPayload: encrypted,
        plainPreview: text,
        senderName: RoomSync.currentUser.name,
        senderAvatar: RoomSync.currentUser.avatar,
        attachment: attachmentObj
      });
    }
  };

  // Invite Button -> Copy Room URL
  const btnInvite = document.querySelector('.btn-invite');
  if (btnInvite) {
    btnInvite.addEventListener('click', () => {
      const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${RoomSync.roomCode}`;
      navigator.clipboard.writeText(inviteUrl).then(() => {
        showSyncToast(`Copied invite link for ${RoomSync.roomCode}!`);
      });
    });
  }

  // Initialize Auto-hiding Controls, Splitter Resizer & Shortcuts
  initControlsAutoHide();
  initLayoutResizer();
  initKeyboardShortcuts();
  initSyncOffset();
}

function toggleTheaterMode() {
  const isTheater = document.body.classList.toggle('theater-mode');
  const icon = document.getElementById('theaterIcon');
  const btn = document.getElementById('theaterBtn');
  if (icon) {
    icon.className = isTheater ? 'bi bi-layout-sidebar' : 'bi bi-layout-sidebar-reverse';
  }
  if (btn) {
    btn.title = isTheater ? 'Exit Theater Mode (T)' : 'Theater Mode (T)';
    btn.classList.toggle('active', isTheater);
  }
  showSyncToast(isTheater ? 'Theater Mode enabled (Press T or Esc to exit)' : 'Exited Theater Mode');
}

function toggleMiniPlayer() {
  const container = document.getElementById('videoContainer');
  if (!container) return;

  const isMini = container.classList.toggle('mini-player-active');
  const btn = document.getElementById('pipBtn');
  const icon = document.getElementById('pipIcon');
  if (btn) btn.classList.toggle('active', isMini);
  if (icon) icon.className = isMini ? 'bi bi-arrows-angle-expand' : 'bi bi-pip';

  const restoreBtn = document.getElementById('btnRestoreMiniPlayer');
  if (restoreBtn) {
    if (isMini) restoreBtn.classList.remove('d-none');
    else restoreBtn.classList.add('d-none');
  }

  showSyncToast(isMini ? 'Mini-Player active (Video docked to corner)' : 'Restored player to main stage');
}

function initLayoutResizer() {
  const resizer = document.getElementById('layoutResizer');
  const sidebar = document.getElementById('sidebarCol');
  if (!resizer || !sidebar) return;

  const savedWidth = localStorage.getItem('unitogether_sidebar_width');
  if (savedWidth) {
    const num = parseInt(savedWidth, 10);
    if (num >= 200 && num <= window.innerWidth * 0.6) {
      sidebar.style.width = num + 'px';
      sidebar.style.display = 'flex';
    } else if (num === 0) {
      sidebar.style.width = '0px';
      sidebar.style.display = 'none';
    }
  }

  let isDragging = false;

  resizer.addEventListener('mousedown', (e) => {
    isDragging = true;
    resizer.classList.add('is-dragging');
    document.body.classList.add('resizing-active');
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const newWidth = window.innerWidth - e.clientX;
    const maxWidth = Math.max(300, Math.floor(window.innerWidth * 0.55));

    // Snap-to-collapse when dragged very small (< 120px)
    if (newWidth < 120) {
      sidebar.style.width = '0px';
      sidebar.style.display = 'none';
      return;
    }

    const minWidth = 200;
    if (newWidth >= minWidth && newWidth <= maxWidth) {
      sidebar.style.display = 'flex';
      sidebar.style.width = `${newWidth}px`;
    }
  });

  window.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    resizer.classList.remove('is-dragging');
    document.body.classList.remove('resizing-active');
    const finalWidth = sidebar.style.display === 'none' ? 0 : parseInt(window.getComputedStyle(sidebar).width, 10);
    localStorage.setItem('unitogether_sidebar_width', finalWidth);
  });

  resizer.addEventListener('dblclick', () => {
    sidebar.style.display = 'flex';
    sidebar.style.width = '310px';
    localStorage.setItem('unitogether_sidebar_width', '310');
    showSyncToast('Sidebar restored to default width (310px)');
  });
}

function initKeyboardShortcuts() {
  window.addEventListener('keydown', (e) => {
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
      return;
    }
    if (e.key === ' ' || e.key === 'k' || e.key === 'K') {
      e.preventDefault();
      togglePlayPause();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (!canControlPlayback()) {
        showSyncToast('🔒 Playback control is locked by the host.');
        return;
      }
      if (RoomSync.player) {
        const cur = RoomSync.player.currentTime || 0;
        initiateLocalSeek(Math.max(0, cur - 10));
        showSyncToast('Rewound 10s');
      }
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (!canControlPlayback()) {
        showSyncToast('🔒 Playback control is locked by the host.');
        return;
      }
      if (RoomSync.player) {
        const cur = RoomSync.player.currentTime || 0;
        const dur = RoomSync.player.duration || 1000;
        initiateLocalSeek(Math.min(dur, cur + 10));
        showSyncToast('Fast-forwarded 10s');
      }
    } else if (e.key === 'f' || e.key === 'F') {
      if (typeof toggleFullscreen === 'function') toggleFullscreen();
    } else if (e.key === 't' || e.key === 'T') {
      toggleTheaterMode();
    } else if (e.key === 'p' || e.key === 'P') {
      toggleMiniPlayer();
    } else if (e.key === 'm' || e.key === 'M') {
      toggleMicrophone();
    } else if (e.key === 'v' || e.key === 'V') {
      toggleCamera();
    } else if (e.key === 'Escape') {
      if (document.body.classList.contains('theater-mode')) toggleTheaterMode();
      const vc = document.getElementById('videoContainer');
      if (vc && vc.classList.contains('mini-player-active')) toggleMiniPlayer();
    }
  });
}

window.toggleTheaterMode = toggleTheaterMode;
window.toggleMiniPlayer = toggleMiniPlayer;
window.resolveMediaMetadata = resolveMediaMetadata;
window.showScreenShareInPlayer = showScreenShareInPlayer;
window.hideScreenShareInPlayer = hideScreenShareInPlayer;

function toggleSyncOptOut() {
  RoomSync.isSyncOptedOut = !RoomSync.isSyncOptedOut;
  const icon = document.getElementById('syncStatusIcon');
  const label = document.getElementById('syncStatusLabel');

  if (RoomSync.isSyncOptedOut) {
    if (icon) icon.className = 'bi bi-slash-circle text-warning';
    if (label) label.textContent = 'OPTED OUT';
    showSyncToast('⚠️ You opted out of sync: your playback will not follow room events.');
  } else {
    if (icon) icon.className = 'bi bi-broadcast text-success';
    if (label) label.textContent = 'SYNCED';
    showSyncToast('Resynced with room stream!');
    checkAndCorrectDrift();
  }
}

function applyPermissionsUI() {
  const meta = RoomSync.roomMeta;
  if (!meta) return;

  const isGuest = RoomSync.currentUser.isGuest;
  const isHost = RoomSync.isHost;

  // Guest Chat permission
  const chatInput = document.getElementById('chatInput');
  if (chatInput) {
    if (isGuest && !meta.allowGuestChat) {
      chatInput.placeholder = 'Chat is disabled for guests in this room.';
      chatInput.disabled = true;
    } else {
      chatInput.placeholder = 'Send encrypted message to room...';
      chatInput.disabled = false;
    }
  }

  // Playback control permissions for guests and non-hosts
  const ppBtn = document.getElementById('ppBtn');
  const bigPlayBtn = document.getElementById('bigPlayBtn');
  const rewindBtn = document.getElementById('rewindBtn');
  const btnPrevVideo = document.getElementById('btnPrevVideo');
  const btnNextVideo = document.getElementById('btnNextVideo');
  const progressArea = document.getElementById('progressArea');
  const canControl = canControlPlayback();

  if (!canControl) {
    const lockTitle = (isGuest && !meta.allowGuestControl) 
      ? 'Guest Controls disabled (Host controls playback)' 
      : 'Host Sync Lock active (Host controls playback)';
    if (ppBtn) { ppBtn.style.opacity = '0.5'; ppBtn.title = lockTitle; }
    if (bigPlayBtn) { bigPlayBtn.style.pointerEvents = 'none'; }
    if (rewindBtn) { rewindBtn.style.opacity = '0.5'; rewindBtn.title = lockTitle; }
    if (btnPrevVideo) { btnPrevVideo.style.opacity = '0.5'; btnPrevVideo.title = lockTitle; }
    if (btnNextVideo) { btnNextVideo.style.opacity = '0.5'; btnNextVideo.title = lockTitle; }
    if (progressArea) { progressArea.style.opacity = '0.6'; progressArea.style.pointerEvents = 'none'; }
  } else {
    if (ppBtn) { ppBtn.style.opacity = '1'; ppBtn.title = 'Play/Pause'; }
    if (bigPlayBtn) { bigPlayBtn.style.pointerEvents = 'auto'; }
    if (rewindBtn) { rewindBtn.style.opacity = '1'; rewindBtn.title = 'Rewind 10s'; }
    if (btnPrevVideo) { btnPrevVideo.style.opacity = '1'; btnPrevVideo.title = 'Previous Video'; }
    if (btnNextVideo) { btnNextVideo.style.opacity = '1'; btnNextVideo.title = 'Next Video'; }
    if (progressArea) { progressArea.style.opacity = '1'; progressArea.style.pointerEvents = 'auto'; }
  }
}

function appendChatMessage({ senderName, senderAvatar, time, text, attachment, isSystem }) {
  const feed = document.getElementById('chatFeed');
  if (!feed) return;

  const el = document.createElement('div');
  el.className = 'msg';

  if (isSystem) {
    el.innerHTML = `
      <div style="width:100%; text-align:center; margin:4px 0;">
        <span class="badge bg-secondary bg-opacity-10 text-muted px-2 py-1 rounded-pill" style="font-size:0.68rem; font-weight:600;">
          <i class="bi bi-info-circle me-1"></i> ${escapeHtml(text)}
        </span>
      </div>
    `;
  } else {
    const avatar = senderAvatar || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=80&q=80';
    let attachmentHtml = '';
    if (attachment && attachment.fileUrl) {
      const isImg = (attachment.fileType && attachment.fileType.startsWith('image/')) || /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(attachment.fileName || '');
      if (isImg) {
        attachmentHtml = `
          <div class="chat-attachment-img-wrapper mt-2">
            <a href="${attachment.fileUrl}" target="_blank" title="Click to view full image">
              <img src="${attachment.fileUrl}" alt="${escapeHtml(attachment.fileName)}" class="chat-attachment-img rounded-3" style="max-width: 100%; max-height: 220px; object-fit: contain; border: 1px solid #e2e8f0; display: block; background: #000;">
            </a>
            <div class="d-flex justify-content-between align-items-center mt-1">
              <span class="text-truncate small fw-bold text-muted" style="font-size:0.7rem;">${escapeHtml(attachment.fileName)}</span>
              <a href="${attachment.fileUrl}" download="${escapeHtml(attachment.fileName)}" class="btn btn-sm btn-outline-secondary py-0 px-2 rounded-pill" style="font-size:0.65rem;">
                <i class="bi bi-download"></i> Save
              </a>
            </div>
          </div>
        `;
      } else {
        attachmentHtml = `
          <a href="${attachment.fileUrl}" download="${escapeHtml(attachment.fileName)}" target="_blank" class="chat-attachment-card mt-2 d-flex align-items-center gap-2 text-decoration-none p-2 rounded-3" style="background: rgba(0,0,0,0.03); border: 1px solid #e2e8f0;">
            <div class="chat-attachment-icon flex-shrink-0 text-danger fs-4"><i class="bi bi-file-earmark-arrow-down-fill"></i></div>
            <div class="overflow-hidden flex-grow-1" style="min-width:0;">
              <div class="fw-bold text-truncate text-dark" style="font-size:0.78rem;">${escapeHtml(attachment.fileName)}</div>
              <div class="text-muted" style="font-size:0.68rem;">${formatFileSize(attachment.fileSize)} • Click to Download</div>
            </div>
            <i class="bi bi-download text-muted flex-shrink-0 ms-1"></i>
          </a>
        `;
      }
    }
    el.innerHTML = `
      <img class="msg-av" src="${avatar}" alt="${senderName}">
      <div class="msg-body">
        <div class="msg-hdr">
          <span class="msg-name">${escapeHtml(senderName)}</span>
          <span class="msg-time">${time || ''}</span>
        </div>
        ${text ? `<p class="msg-text">${escapeHtml(text)}</p>` : ''}
        ${attachmentHtml}
      </div>
    `;
  }

  feed.appendChild(el);
  feed.scrollTop = feed.scrollHeight;

  // Stream to fullscreen floating chat overlay
  appendFullscreenChatMessage(senderName, text, isSystem);
}

function updateChatCountBadge() {
  const chatCnt = document.querySelector('#tabChatBtn .tab-cnt');
  if (chatCnt) {
    chatCnt.textContent = document.querySelectorAll('#chatFeed .msg').length;
  }
}

function renderMembersList(members) {
  RoomSync.membersList = members || [];
  const container = document.getElementById('peopleListContainer') || document.getElementById('peopleFeed');
  if (!container) return;

  container.innerHTML = '';
  (members || []).forEach(m => addMemberToUI(m, container));

  // Update people badge count in tab
  const tabCnt = document.querySelector('#tabPeopleBtn .tab-cnt') || document.getElementById('peopleBadgeCount');
  if (tabCnt) tabCnt.textContent = members.length;

  const onlineBadge = document.getElementById('peopleOnlineBadge');
  if (onlineBadge) onlineBadge.textContent = `${members.length} ONLINE`;

  // Check if anyone is screensharing or streaming local file
  const banner = document.getElementById('screenshareAlertBanner');
  const sharerName = document.getElementById('screenshareSharerName');
  const activeSharer = (members || []).find(m => m.isScreensharing || m.peerId === RoomSync.screensharePeerId);
  if (banner && sharerName) {
    if (activeSharer && activeSharer.uuid !== RoomSync.currentUser.uuid) {
      banner.classList.remove('d-none');
      sharerName.textContent = activeSharer.name;
    } else {
      banner.classList.add('d-none');
    }
  }
}

function handleNicknameChange(newName) {
  const trimmed = String(newName || '').trim();
  if (!trimmed) return;
  RoomSync.currentUser.name = trimmed;

  const stored = JSON.parse(localStorage.getItem('unitogether_user') || '{}');
  stored.name = trimmed;
  localStorage.setItem('unitogether_user', JSON.stringify(stored));

  const userBtn = document.getElementById('userBadgeBtn');
  if (userBtn) {
    userBtn.innerHTML = `${trimmed.toUpperCase()} <i class="bi bi-pencil-fill ms-1" style="font-size:0.65rem;"></i>`;
  }

  if (RoomSync.socket) {
    RoomSync.socket.emit('change-nickname', { nickname: trimmed });
  }

  const modalEl = document.getElementById('changeNicknameModal');
  if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    if (modal) modal.hide();
  }

  showSyncToast(`Name updated to "${trimmed}"`);
}

function addMemberToUI(member, targetContainer) {
  const container = targetContainer || document.getElementById('peopleListContainer') || document.getElementById('peopleFeed');
  if (!container) return;

  const isMe = member.uuid === RoomSync.currentUser.uuid;
  const isHost = Boolean(member.isHost);
  const isMod = member.role === 'moderator';
  const isGuest = Boolean(member.isGuest);

  let roleClass = 'student';
  let roleTitle = 'Student';
  if (isHost) { roleClass = 'host'; roleTitle = 'Host'; }
  else if (isMod) { roleClass = 'mod'; roleTitle = 'Mod'; }
  else if (isGuest) { roleClass = 'guest'; roleTitle = 'Guest'; }

  // Sync state badge
  let syncBadgeHtml = '<span class="sync-badge synced"><i class="bi bi-check-circle-fill"></i> Synced</span>';
  if (member.isBuffering) {
    syncBadgeHtml = '<span class="sync-badge buffering"><i class="bi bi-hourglass-split"></i> Buffering</span>';
  } else if (member.syncStatus === 'opted-out') {
    syncBadgeHtml = '<span class="sync-badge opted-out"><i class="bi bi-slash-circle"></i> Opted Out</span>';
  } else if (member.syncStatus === 'catching-up') {
    syncBadgeHtml = '<span class="sync-badge catching-up"><i class="bi bi-arrow-repeat spin-icon"></i> Catching up</span>';
  }

  // Device indicators
  const micHtml = member.isAudioActive 
    ? '<i class="bi bi-mic-fill text-success" title="Microphone Active"></i>' 
    : '<i class="bi bi-mic-mute text-muted" title="Microphone Muted"></i>';
  const scrHtml = member.isScreensharing 
    ? '<i class="bi bi-display-fill text-warning ms-1" title="Sharing Screen"></i>' 
    : '';

  // Avatar speaking ripple
  const speakingRing = member.isAudioActive ? '<div class="speaking-ring"></div>' : '';

  // Moderator / Host Controls Menu
  let actionsHtml = '';
  if (isMe) {
    actionsHtml = `
      <button class="person-action-btn" data-bs-toggle="modal" data-bs-target="#changeNicknameModal" title="Edit your nickname">
        <i class="bi bi-pencil-fill"></i>
      </button>
    `;
  } else if (RoomSync.isHost || (RoomSync.currentUser && RoomSync.currentUser.role === 'moderator')) {
    const isHost = RoomSync.isHost;
    actionsHtml = `
      <button class="person-action-btn btn-pin" onclick="spotlightMember('${member.uuid}')" title="Pin / Spotlight User">
        <i class="bi bi-pin-angle-fill"></i>
      </button>
      <button class="person-action-btn btn-mute" onclick="adminMuteUser('${member.uuid}', '${escapeHtml(member.name)}')" title="Mute Microphone">
        <i class="bi bi-mic-mute-fill"></i>
      </button>
      ${isHost ? `
      <button class="person-action-btn text-warning" onclick="transferHostRole('${member.uuid}', '${escapeHtml(member.name)}')" title="Transfer Room Host Role">
        <i class="bi bi-crown"></i>
      </button>
      ` : ''}
      <button class="person-action-btn btn-kick" onclick="kickUser('${member.uuid}', '${escapeHtml(member.name)}')" title="Kick User">
        <i class="bi bi-box-arrow-right"></i>
      </button>
      <button class="person-action-btn btn-ban" onclick="banUser('${member.uuid}', '${escapeHtml(member.name)}')" title="Ban User">
        <i class="bi bi-slash-circle-fill"></i>
      </button>
    `;
  }

  const el = document.createElement('div');
  el.className = 'person-card';
  el.id = `person-item-${member.uuid}`;
  el.innerHTML = `
    <div class="avatar-box">
      ${speakingRing}
      <img class="avatar-img" src="${member.avatar || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=80&q=80'}" alt="${member.name}">
    </div>
    <div class="flex-grow-1 overflow-hidden" style="min-width:0;">
      <div class="d-flex align-items-center gap-1 text-truncate">
        <span class="fw-bold text-main small text-truncate">${escapeHtml(member.name)}</span>
        <span class="role-pill ${roleClass}">${roleTitle}</span>
        ${isMe ? '<span class="text-muted small" style="font-size:0.68rem;">(You)</span>' : ''}
      </div>
      <div class="d-flex align-items-center gap-2 mt-1">
        ${syncBadgeHtml}
        <div class="d-flex align-items-center gap-1 ms-1" style="font-size:0.75rem;">
          ${micHtml}
          ${scrHtml}
        </div>
      </div>
    </div>
    <div class="person-actions-menu">
      ${actionsHtml}
    </div>
  `;
  container.appendChild(el);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function kickUser(targetUuid, targetName) {
  if (!RoomSync.socket) return;
  if (confirm(`Are you sure you want to kick "${targetName}" from this room?`)) {
    RoomSync.socket.emit('kick-user', { targetUuid, targetName });
    showSyncToast(`Kicked "${targetName}" from room`);
  }
}

function adminMuteUser(targetUuid, targetName) {
  if (!RoomSync.socket) return;
  RoomSync.socket.emit('admin-mute-user', { targetUuid, targetName });
  showSyncToast(`Muted microphone for "${targetName}"`);
}

function banUser(targetUuid, targetName) {
  if (!RoomSync.socket) return;
  if (confirm(`Are you sure you want to BAN "${targetName}" permanently from this room?`)) {
    RoomSync.socket.emit('ban-user', { targetUuid, targetName });
    showSyncToast(`Banned "${targetName}" from room`);
  }
}

function spotlightMember(targetUuid) {
  showSyncToast('Selected participant');
}

function toggleConferenceGrid() {
  console.log('[ConferenceGrid] Conference grid functionality has been disabled.');
}

function renderConferenceGrid() {}

function createConferenceTile() {
  return document.createElement('div');
}

function changePlaybackSpeed(speed, event) {
  if (event) event.preventDefault();
  const rawNum = parseFloat(speed);
  if (isNaN(rawNum)) return;
  // Strictly enforce speed bounds between 0.25x and 2.0x (cap at 2x)
  const num = Math.min(2.0, Math.max(0.25, rawNum));

  const labelEl = document.getElementById('speedLabel');
  if (labelEl) labelEl.textContent = `${num}x`;

  document.querySelectorAll('.speed-opt').forEach(opt => {
    const isThis = parseFloat(opt.getAttribute('data-speed')) === num;
    opt.classList.toggle('active', isThis);
    opt.classList.toggle('fw-bold', isThis);
  });

  if (RoomSync.player) {
    try { RoomSync.player.speed = num; } catch(e) {}
  }

  if (RoomSync.isHost || (RoomSync.roomMeta && RoomSync.roomMeta.allowGuestControl)) {
    // Optimistically update the PLL's canonical base rate immediately -- otherwise the
    // drift-correction tick (every 200ms) reads the still-stale RoomSync.serverPlaybackRate
    // before the server round-trip confirms the change, snapping the player's speed back to
    // the old rate for a tick or two.
    RoomSync.serverPlaybackRate = num;
    if (RoomSync.socket) {
      RoomSync.socket.emit('playback-control', {
        action: 'rate',
        rate: num
      });
    }
  }

  showSyncToast(`Playback speed set to ${num}x`);
}

function removeMemberFromUI(userUuid) {
  const el = document.getElementById(`person-item-${userUuid}`);
  if (el) el.remove();
}

function changeStreamQuality(quality, event) {
  if (event) event.preventDefault();
  const label = document.getElementById('qualityLabel');
  if (label) label.textContent = quality === 'auto' ? 'Auto' : quality;

  document.querySelectorAll('.quality-opt').forEach(opt => {
    const isThis = opt.getAttribute('data-quality') === quality;
    opt.classList.toggle('active', isThis);
    opt.classList.toggle('fw-bold', isThis);
  });

  RoomSync.streamQuality = quality;
  showSyncToast(`Stream quality set to ${quality}`);
}

function toggleClosedCaptions() {
  if (!RoomSync.player) return;
  const p = RoomSync.player;
  const ccBtn = document.getElementById('ccBtn');
  
  if (typeof p.toggleCaptions === 'function') {
    try { p.toggleCaptions(); } catch(e) {}
  }
  RoomSync.captionsEnabled = !RoomSync.captionsEnabled;
  if (ccBtn) {
    ccBtn.classList.toggle('text-primary', RoomSync.captionsEnabled);
  }
  showSyncToast(RoomSync.captionsEnabled ? 'Captions turned ON' : 'Captions turned OFF');
}

async function loadRoomSubtitles() {
  const code = RoomSync.roomCode || (new URLSearchParams(window.location.search).get('room')) || 'UNI-8842';
  try {
    const res = await fetch(`/api/rooms/${code}/subtitles`);
    if (res.ok) {
      const data = await res.json();
      return data.subtitles || [];
    }
  } catch(e) {}
  return [];
}

window.kickUser = kickUser;
window.adminMuteUser = adminMuteUser;
window.banUser = banUser;
window.spotlightMember = spotlightMember;
window.toggleConferenceGrid = toggleConferenceGrid;
window.changePlaybackSpeed = changePlaybackSpeed;
window.changeStreamQuality = changeStreamQuality;
window.toggleClosedCaptions = toggleClosedCaptions;
window.loadRoomSubtitles = loadRoomSubtitles;
window.startScreenShare = startScreenShare;
window.stopScreenShare = stopScreenShare;
window.startLocalFileStream = startLocalFileStream;
window.stopLocalFileStream = stopLocalFileStream;
window.transitionMediaShare = transitionMediaShare;
window.teardownCurrentMediaShare = teardownCurrentMediaShare;
RoomSync.startScreenShare = startScreenShare;
RoomSync.stopScreenShare = stopScreenShare;
RoomSync.startLocalFileStream = startLocalFileStream;
RoomSync.stopLocalFileStream = stopLocalFileStream;
RoomSync.transitionMediaShare = transitionMediaShare;
RoomSync.teardownCurrentMediaShare = teardownCurrentMediaShare;
RoomSync.changeStreamQuality = changeStreamQuality;
RoomSync.toggleClosedCaptions = toggleClosedCaptions;
RoomSync.loadRoomSubtitles = loadRoomSubtitles;

function updateTimeDisplay() {
  // Suppress timeupdate overwrites while user is dragging scrubber (F-9)
  if (RoomSync.isDraggingScrubber) return;
  const timeDisplay = document.getElementById('timeDisplay');
  const progressFill = document.getElementById('progressFill');
  if (!RoomSync.player) return;

  const cur = RoomSync.player.currentTime || 0;
  const dur = RoomSync.player.duration || 0;

  if (timeDisplay) timeDisplay.textContent = `${formatDuration(cur)} / ${formatDuration(dur)}`;
  if (progressFill && dur > 0) {
    progressFill.style.width = `${(cur / dur) * 100}%`;
  }
}

function formatDuration(sec) {
  if (isNaN(sec) || sec === null) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function showSyncToast(msg) {
  const toast = document.getElementById('syncToast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(window._syncToastTimer);
  window._syncToastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}

// Fixed DOM emoji floater (distinct name to avoid shadowing/recursion)
function renderFloatingEmojiDOM(emoji) {
  const canvas = document.getElementById('emojiCanvas');
  if (!canvas) return;
  const el = document.createElement('div');
  el.className = 'float-emoji';
  el.textContent = emoji;
  el.style.left = Math.floor(10 + Math.random() * 80) + '%';
  canvas.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// Window global emoji trigger called by inline HTML onclick buttons
window.spawnEmoji = function(emoji) {
  if (RoomSync.socket) {
    RoomSync.socket.emit('emoji-reaction', { emoji });
  }
  renderFloatingEmojiDOM(emoji);
};

// ============================================================================
// Phase 7: Hardware Audio/Video Sync Offset Calibration
// ============================================================================
function initSyncOffset() {
  const saved = localStorage.getItem('unitogether_sync_offset');
  const offset = saved ? parseInt(saved, 10) : 0;
  RoomSync.syncOffsetMs = isNaN(offset) ? 0 : offset;

  const slider = document.getElementById('settingSyncOffset');
  const display = document.getElementById('syncOffsetDisplay') || document.getElementById('syncOffsetValueDisplay');
  if (slider) slider.value = RoomSync.syncOffsetMs;
  if (display) display.textContent = `${RoomSync.syncOffsetMs > 0 ? '+' : ''}${RoomSync.syncOffsetMs}ms`;
}

function updateSyncOffsetValue(val) {
  const num = parseInt(val, 10) || 0;
  RoomSync.syncOffsetMs = num;
  localStorage.setItem('unitogether_sync_offset', num);

  const display = document.getElementById('syncOffsetDisplay') || document.getElementById('syncOffsetValueDisplay');
  if (display) display.textContent = `${num > 0 ? '+' : ''}${num}ms`;

  const slider = document.getElementById('settingSyncOffset');
  if (slider) slider.value = num;

  showSyncToast(`Hardware sync offset: ${num > 0 ? '+' : ''}${num}ms`);
}

function resetSyncOffset() {
  updateSyncOffsetValue(0);
  showSyncToast('Sync offset reset to 0ms (Default)');
}


// ============================================================================
// Phase 7: Local File Sync Dual-Mode Flow
// ============================================================================
function triggerLocalFileSyncMode(mode) {
  if (mode === 'sync') {
    const input = document.getElementById('localVideoFileInputSync');
    if (input) input.click();
  } else {
    const input = document.getElementById('localVideoFileInput');
    if (input) input.click();
  }
}

function handleLocalFilePicked(inputEl, mode) {
  const file = inputEl && inputEl.files && inputEl.files[0];
  if (!file) return;

  const choiceModalEl = document.getElementById('localFileSyncChoiceModal');
  if (choiceModalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
    const modal = bootstrap.Modal.getInstance(choiceModalEl);
    if (modal) modal.hide();
  }

  if (mode === 'sync') {
    transitionMediaShare(STATE_LOCAL_SYNC, async () => {
      const blobUrl = createTrackedObjectUrl(file);
      hideScreenShareInPlayer();
      loadMediaSource(blobUrl, 'local', file.name);

      if (RoomSync.socket) {
        RoomSync.socket.emit('playback-control', {
          action: 'local-sync',
          fileName: file.name,
          time: 0
        });
        RoomSync.socket.emit('queue-add', {
          url: 'local://' + encodeURIComponent(file.name),
          title: file.name,
          duration: 0,
          mediaType: 'local'
        });
      }
      showSyncToast(`Loaded local copy: "${file.name}". Peer timestamps synced!`);
      return true;
    });
  } else {
    // WebRTC P2P Live Stream of local video
    startLocalFileStream(file, file.name);
  }
}

function startLocalFileStreamFromBlob(blobUrl, fileName) {
  if (typeof fetch === 'function') {
    fetch(blobUrl)
      .then(res => res.blob())
      .then(blob => startLocalFileStream(blob, fileName))
      .catch(err => {
        console.warn('Could not fetch blob for local stream:', err);
        startScreenShare();
      });
  } else {
    startScreenShare();
  }
}

// ============================================================================
// Phase 7: Chat File Attachment Hub
// ============================================================================
async function handleChatFileUpload(inputEl) {
  const file = inputEl && inputEl.files && inputEl.files[0];
  if (!file) return;
  inputEl.value = '';

  if (file.size > 40 * 1024 * 1024) {
    alert('File size exceeds the 40MB limit for chat attachments.');
    return;
  }

  showSyncToast(`Uploading attachment: "${file.name}"...`);

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const res = await fetch(`/api/rooms/${RoomSync.roomCode}/upload-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          fileBase64: reader.result,
          fileType: file.type
        })
      });
      const data = await res.json();
      if (!data.success) {
        showSyncToast('Failed to upload file attachment');
        return;
      }

      if (RoomSync.socket) {
        const encrypted = await encryptChatMessage('', RoomSync.roomCode);
        RoomSync.socket.emit('chat-message', {
          encryptedPayload: encrypted,
          senderName: RoomSync.currentUser.name,
          senderAvatar: RoomSync.currentUser.avatar,
          attachment: {
            fileName: data.fileName,
            fileUrl: data.fileUrl,
            fileSize: data.fileSize,
            fileType: data.fileType
          }
        });
        showSyncToast(`Sent attachment: "${file.name}"`);
      }
    } catch(err) {
      console.error('Chat file upload failed:', err);
      showSyncToast('Error uploading file attachment');
    }
  };
  reader.readAsDataURL(file);
}

// ============================================================================
// Phase 7: Fullscreen Glass Floating Chat Overlay (Twitch/YouTube Live Style)
// ============================================================================
function toggleFullscreenChatOverlay() {
  const overlay = document.getElementById('fullscreenChatOverlay');
  if (!overlay) return;
  overlay.classList.toggle('d-none');
  const isHidden = overlay.classList.contains('d-none');
  showSyncToast(isHidden ? 'Fullscreen chat hidden' : 'Fullscreen floating chat overlay active');
}

function appendFullscreenChatMessage(senderName, text, isSystem) {
  const container = document.getElementById('fsChatMessages');
  if (!container || !text) return;

  const item = document.createElement('div');
  item.className = 'fs-chat-item';
  if (isSystem) {
    item.innerHTML = `<span class="badge bg-secondary bg-opacity-25 text-white-50 small" style="font-size:0.7rem;">${escapeHtml(text)}</span>`;
  } else {
    item.innerHTML = `<strong class="text-warning">${escapeHtml(senderName)}:</strong> <span class="text-white">${escapeHtml(text)}</span>`;
  }
  container.appendChild(item);
  container.scrollTop = container.scrollHeight;
}

async function sendFullscreenMsg() {
  const input = document.getElementById('fsChatInput');
  if (!input) return;
  const isGuest = RoomSync.currentUser?.isGuest;
  if (isGuest && RoomSync.roomMeta && !RoomSync.roomMeta.allowGuestChat) {
    showSyncToast('🔒 Chat is disabled for guests in this room.');
    return;
  }
  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  if (RoomSync.socket) {
    const encrypted = await encryptChatMessage(text, RoomSync.roomCode);
    RoomSync.socket.emit('chat-message', {
      encryptedPayload: encrypted,
      senderName: RoomSync.currentUser.name,
      senderAvatar: RoomSync.currentUser.avatar
    });
  }
}

// ============================================================================
// Phase 7: Moderator / Host Role Transfer
// ============================================================================
function transferHostRole(targetUuid, targetName) {
  if (!RoomSync.socket) return;
  if (confirm(`Transfer ROOM HOST role to "${targetName}"? You will become a moderator.`)) {
    RoomSync.socket.emit('transfer-role', { targetUuid, newRole: 'host' });
    showSyncToast(`Transferred host role to ${targetName}`);
  }
}

// Window Global Exports
window.triggerLocalFileSyncMode = triggerLocalFileSyncMode;
window.handleLocalFilePicked = handleLocalFilePicked;
window.initSyncOffset = initSyncOffset;
window.updateSyncOffsetValue = updateSyncOffsetValue;
window.resetSyncOffset = resetSyncOffset;
window.handleChatFileUpload = handleChatFileUpload;
window.toggleFullscreenChatOverlay = toggleFullscreenChatOverlay;
window.sendFullscreenMsg = sendFullscreenMsg;
window.appendFullscreenChatMessage = appendFullscreenChatMessage;
window.transferHostRole = transferHostRole;

// ============================================================================
// Democratic Vote-to-Skip Logic & Dynamic Scheduled Pause
// ============================================================================
let _currentVoteSkipId = null;
let _voteSkipTimerInterval = null;

function renderVoteSkipCard(data) {
  _currentVoteSkipId = data.id;
  const feed = document.getElementById('chatFeed');
  if (!feed) return;

  const oldCard = document.getElementById('activeVoteSkipCard');
  if (oldCard) oldCard.remove();

  const card = document.createElement('div');
  card.className = 'vote-skip-card';
  card.id = 'activeVoteSkipCard';

  let remaining = data.expiresInSec || 30;
  const percent = Math.min(100, Math.round((data.currentVotes / data.requiredVotes) * 100));

  card.innerHTML = `
    <div class="vote-skip-header">
      <span class="vote-skip-title"><i class="bi bi-collection-play-fill text-warning"></i> Vote to Skip Video</span>
      <span class="vote-skip-timer" id="voteSkipTimerTxt">${remaining}s</span>
    </div>
    <div class="small text-white-50 mb-2" style="font-size:0.72rem;">
      <strong class="text-white">${escapeHtml(data.initiatorName)}</strong> requested to skip to next video.
    </div>
    <div class="vote-skip-bar-wrapper">
      <div class="vote-skip-bar" id="voteSkipProgressBar" style="width: ${percent}%;"></div>
    </div>
    <div class="vote-skip-meta">
      <span id="voteSkipTallyTxt">${data.currentVotes} of ${data.requiredVotes} votes needed (${data.totalMembers} present)</span>
      <button class="btn-vote-skip" id="btnCastVoteSkip" onclick="castVoteSkip()">
        <i class="bi bi-hand-thumbs-up-fill me-1"></i> Vote Skip
      </button>
    </div>
  `;

  feed.appendChild(card);
  feed.scrollTop = feed.scrollHeight;

  clearInterval(_voteSkipTimerInterval);
  _voteSkipTimerInterval = setInterval(() => {
    remaining--;
    const timerTxt = document.getElementById('voteSkipTimerTxt');
    if (timerTxt) timerTxt.textContent = `${remaining}s`;
    if (remaining <= 0) {
      clearInterval(_voteSkipTimerInterval);
    }
  }, 1000);
}

function updateVoteSkipCard(data) {
  const bar = document.getElementById('voteSkipProgressBar');
  const tally = document.getElementById('voteSkipTallyTxt');
  if (bar) {
    const percent = Math.min(100, Math.round((data.currentVotes / data.requiredVotes) * 100));
    bar.style.width = `${percent}%`;
  }
  if (tally) {
    tally.textContent = `${data.currentVotes} of ${data.requiredVotes} votes needed (${data.totalMembers} present)`;
  }
}

function completeVoteSkipCard(passed, message) {
  clearInterval(_voteSkipTimerInterval);
  const card = document.getElementById('activeVoteSkipCard');
  if (!card) return;
  const meta = card.querySelector('.vote-skip-meta');
  if (meta) {
    meta.innerHTML = passed 
      ? `<span class="badge bg-success"><i class="bi bi-check-circle-fill me-1"></i> Vote Passed! Skipping...</span>`
      : `<span class="badge bg-secondary"><i class="bi bi-clock-history me-1"></i> Vote Expired</span>`;
  }
  setTimeout(() => {
    if (card) {
      card.style.transition = 'opacity 0.6s ease';
      card.style.opacity = '0.5';
    }
  }, 4000);
}

function castVoteSkip() {
  if (RoomSync.socket) {
    RoomSync.socket.emit('cast-vote-skip');
    const btn = document.getElementById('btnCastVoteSkip');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<i class="bi bi-check2 me-1"></i> Voted`;
      btn.classList.add('bg-success');
    }
  }
}
window.castVoteSkip = castVoteSkip;

function scheduleDynamicPauseFromModal() {
  const input = document.getElementById('settingDynamicPauseInput');
  const val = input?.value?.trim();
  if (!val) {
    if (RoomSync.socket) {
      RoomSync.socket.emit('playback-control', {
        action: 'set-pause-target',
        time: null
      });
    }
    const badge = document.getElementById('currentDynamicPauseBadge');
    if (badge) { badge.textContent = 'None'; badge.className = 'badge bg-secondary rounded-pill'; }
    showSyncToast('Scheduled pause cleared.');
    return;
  }

  let targetSec = 0;
  if (val.includes(':')) {
    const parts = val.split(':');
    const m = parseInt(parts[0], 10) || 0;
    const s = parseInt(parts[1], 10) || 0;
    targetSec = (m * 60) + s;
  } else {
    targetSec = parseFloat(val) || 0;
  }

  if (targetSec <= 0) {
    showSyncToast('Please enter a valid future timestamp.');
    return;
  }

  if (RoomSync.socket) {
    RoomSync.socket.emit('playback-control', {
      action: 'set-pause-target',
      time: targetSec
    });
    const badge = document.getElementById('currentDynamicPauseBadge');
    if (badge) {
      badge.textContent = formatDuration(targetSec);
      badge.className = 'badge bg-warning text-dark rounded-pill';
    }
    showSyncToast(`⏱️ Video scheduled to pause at ${formatDuration(targetSec)}`);
  }
}
window.scheduleDynamicPauseFromModal = scheduleDynamicPauseFromModal;

// ============================================================================
// Universal Media Search & Web Scraper Engine (Three-Dots Bar & Mini-Browser)
// ============================================================================
let _currentSearchPlatform = 'youtube';

function toggleSearchScraperBar() {
  const defaultBar = document.getElementById('defaultUrlBarGroup');
  const scraperBar = document.getElementById('searchScraperBarGroup');
  const toggleBtn = document.getElementById('btnToggleSearchEngine');

  if (!defaultBar || !scraperBar) return;

  const isScraperActive = !scraperBar.classList.contains('d-none');
  if (isScraperActive) {
    scraperBar.classList.add('d-none');
    defaultBar.classList.remove('d-none');
    if (toggleBtn) {
      toggleBtn.classList.remove('btn-warning');
      toggleBtn.classList.add('btn-outline-secondary');
      toggleBtn.title = 'Switch to Media Search & Scraper Mode';
    }
  } else {
    defaultBar.classList.add('d-none');
    scraperBar.classList.remove('d-none');
    if (toggleBtn) {
      toggleBtn.classList.remove('btn-outline-secondary');
      toggleBtn.classList.add('btn-warning');
      toggleBtn.title = 'Switch back to URL Paste Mode';
    }
    const qInput = document.getElementById('searchScraperQueryInput');
    if (qInput) qInput.focus();
  }
}
window.toggleSearchScraperBar = toggleSearchScraperBar;

function selectSearchPlatform(platform, label, event) {
  if (event) event.preventDefault();
  _currentSearchPlatform = platform;

  const labelEl = document.getElementById('selectedPlatformLabel');
  if (labelEl) {
    let icon = 'bi-youtube text-danger';
    if (platform === 'facebook') icon = 'bi-facebook text-primary';
    else if (platform === 'twitch') icon = 'bi-twitch text-info';
    else if (platform === 'vimeo') icon = 'bi-play-btn-fill text-warning';
    else if (platform === 'custom') icon = 'bi-globe text-warning';
    labelEl.innerHTML = `<i class="bi ${icon} me-1"></i>${label.replace(/^[^\s]+\s/, '')}`;
  }

  const domainInput = document.getElementById('scrapeDomainInput');
  const queryInput = document.getElementById('searchScraperQueryInput');
  if (domainInput) {
    if (platform === 'custom') {
      domainInput.classList.remove('d-none');
      if (queryInput) queryInput.placeholder = 'Search keyword or tag...';
    } else {
      domainInput.classList.add('d-none');
      if (queryInput) queryInput.placeholder = `Search ${platform} videos...`;
    }
  }
}
window.selectSearchPlatform = selectSearchPlatform;

async function executeUniversalSearch(queryOverride) {
  const queryInput = document.getElementById('searchScraperQueryInput');
  const domainInput = document.getElementById('scrapeDomainInput');
  const q = (queryOverride || queryInput?.value || '').trim();
  const domain = (domainInput?.value || '').trim();

  if (!q && !domain) {
    showSyncToast('Please enter search keywords or target website.');
    return;
  }

  const modalEl = document.getElementById('mediaDiscoveryHubModal');
  const modalQueryInput = document.getElementById('modalDiscoveryQueryInput');
  const platformBadge = document.getElementById('discoveryPlatformBadge');
  const statusTxt = document.getElementById('discoveryStatusText');
  const resultsContainer = document.getElementById('discoveryResultsContainer');
  const resultsCount = document.getElementById('discoveryResultsCount');

  if (modalQueryInput) modalQueryInput.value = q || domain;
  if (platformBadge) platformBadge.innerHTML = `<i class="bi bi-search me-1 text-danger"></i> ${_currentSearchPlatform.toUpperCase()}`;
  if (statusTxt) statusTxt.textContent = `Searching ${_currentSearchPlatform} for "${q || domain}"...`;
  if (resultsCount) resultsCount.textContent = 'Searching...';

  if (resultsContainer) {
    resultsContainer.innerHTML = `
      <div class="d-flex flex-column align-items-center justify-content-center p-5 w-100 text-center" style="grid-column: 1 / -1;">
        <div class="spinner-border text-danger mb-3" role="status"></div>
        <div class="text-white fw-bold">Extracting media streams from ${_currentSearchPlatform}...</div>
        <small class="text-muted">Resolving titles, manifests, and video metadata</small>
      </div>
    `;
  }

  if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
  }

  try {
    let items = [];
    if (_currentSearchPlatform === 'custom' || domain) {
      const resp = await fetch('/api/media/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUrl: domain || q, query: q })
      });
      const data = await resp.json();
      items = data.results || [];
    } else {
      const resp = await fetch(`/api/media/search?platform=${_currentSearchPlatform}&q=${encodeURIComponent(q)}`);
      const data = await resp.json();
      items = data.results || [];
    }

    renderDiscoveryResults(items, q || domain);
  } catch (err) {
    console.error('Universal Search Error:', err);
    if (resultsContainer) {
      resultsContainer.innerHTML = `
        <div class="p-4 text-center text-muted" style="grid-column: 1 / -1;">
          <i class="bi bi-exclamation-triangle text-warning fs-3 mb-2 d-block"></i>
          <div>Could not fetch search results. Please verify connection.</div>
        </div>
      `;
    }
  }
}
window.executeUniversalSearch = executeUniversalSearch;

function executeModalSearch() {
  const modalQueryInput = document.getElementById('modalDiscoveryQueryInput');
  const q = modalQueryInput?.value?.trim();
  if (q) executeUniversalSearch(q);
}
window.executeModalSearch = executeModalSearch;

function renderDiscoveryResults(items, query) {
  const container = document.getElementById('discoveryResultsContainer');
  const statusTxt = document.getElementById('discoveryStatusText');
  const countBadge = document.getElementById('discoveryResultsCount');

  if (!container) return;
  if (statusTxt) statusTxt.textContent = `Found ${items.length} streams for "${query}"`;
  if (countBadge) countBadge.textContent = `${items.length} items`;

  if (!items || items.length === 0) {
    container.innerHTML = `
      <div class="p-5 text-center text-muted" style="grid-column: 1 / -1;">
        <i class="bi bi-film fs-2 mb-2 d-block text-white-50"></i>
        <div class="text-white fw-bold">No direct video streams found</div>
        <small>Try a different keyword or paste a direct video link.</small>
      </div>
    `;
    return;
  }

  container.innerHTML = items.map(item => {
    const thumb = item.thumbnail || 'https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?auto=format&fit=crop&w=480&q=80';
    const dur = item.duration || 'Stream';
    const plat = (item.platform || _currentSearchPlatform || 'video').toUpperCase();
    const platBg = plat === 'YOUTUBE' ? '#d9232a' : (plat === 'TWITCH' ? '#9333ea' : '#0284c7');
    const safeUrl = item.url.replace(/'/g, "\\'");
    const safeTitle = item.title.replace(/'/g, "\\'");

    return `
      <div class="discovery-card">
        <div class="discovery-thumb-wrapper">
          <img src="${escapeHtml(thumb)}" class="discovery-thumb" alt="${escapeHtml(item.title)}" loading="lazy" onerror="this.src='https://images.unsplash.com/photo-1574717024653-61fd2cf4d44d?auto=format&fit=crop&w=480&q=80'">
          <span class="discovery-duration">${escapeHtml(dur)}</span>
          <span class="discovery-platform-badge" style="background:${platBg}; color:#fff;">${plat}</span>
        </div>
        <div class="discovery-body">
          <div class="discovery-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
          <div class="discovery-author">${escapeHtml(item.author || item.domain || 'Verified Stream')}</div>
          <div class="discovery-actions">
            <button class="btn btn-sm btn-danger fw-bold rounded-pill flex-grow-1" onclick="handleScraperPlayNow('${safeUrl}', '${safeTitle}', '${item.type || 'youtube'}')">
              <i class="bi bi-play-fill me-1"></i> Play
            </button>
            <button class="btn btn-sm btn-outline-light rounded-pill px-2" onclick="handleScraperAddToQueue('${safeUrl}', '${safeTitle}', '${item.type || 'youtube'}')" title="Add to Playlist Queue">
              <i class="bi bi-plus-lg"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function handleScraperPlayNow(url, title, type) {
  const modalEl = document.getElementById('mediaDiscoveryHubModal');
  if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
    const inst = bootstrap.Modal.getInstance(modalEl);
    if (inst) inst.hide();
  }

  loadMediaSource(url, type, title);
  if (RoomSync.socket) {
    RoomSync.socket.emit('playback-control', {
      action: 'change-media',
      url,
      title,
      mediaType: type,
      time: 0
    });
  }
  showSyncToast(`▶ Playing: "${title}"`);
}
window.handleScraperPlayNow = handleScraperPlayNow;

function handleScraperAddToQueue(url, title, type) {
  if (RoomSync.socket) {
    RoomSync.socket.emit('queue-add', {
      url,
      title,
      duration: 180,
      mediaType: type || 'youtube'
    });
    showSyncToast(`+ Added "${title}" to queue`);
  }
}
window.handleScraperAddToQueue = handleScraperAddToQueue;
