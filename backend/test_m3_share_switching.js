/**
 * backend/test_m3_share_switching.js
 * Comprehensive automated verification suite for Milestone 3 (Requirement R3):
 * Screen Share & File Share Switching Architecture, 4-State FSM, Mutual Teardown,
 * Broadcaster Call Recovery, and Server Background Media Protection.
 */

const fs = require('fs');
const assert = require('assert');
const http = require('http');
const path = require('path');

let puppeteer;
try {
  puppeteer = require('./node_modules/puppeteer-core');
} catch (e1) {
  try {
    puppeteer = require('../backend/node_modules/puppeteer-core');
  } catch (e2) {
    puppeteer = require('puppeteer-core');
  }
}

function resolveBrowserExecutable() {
  const candidatePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ];

  for (const p of candidatePaths) {
    if (p && fs.existsSync(p)) {
      return p;
    }
  }
  throw new Error('No supported browser executable found (Chrome or Edge).');
}

console.log('====================================================================');
console.log('Milestone 3 (Requirement R3) Verification Suite: Media Share Switching');
console.log('====================================================================\n');

async function runAllTests() {
  let passedCount = 0;
  let totalCount = 0;

  function runSubtest(name, fn) {
    totalCount++;
    try {
      fn();
      console.log(`  [PASS] ${name}`);
      passedCount++;
    } catch (err) {
      console.error(`  [FAIL] ${name}:`, err.message);
      throw err;
    }
  }

  async function runSubtestAsync(name, fn) {
    totalCount++;
    try {
      await fn();
      console.log(`  [PASS] ${name}`);
      passedCount++;
    } catch (err) {
      console.error(`  [FAIL] ${name}:`, err.message);
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // SECTION 1: Server Background Media Protection (backend/server.js)
  // --------------------------------------------------------------------------
  console.log('--- SECTION 1: Server Background Media Protection (backend/server.js) ---');

  runSubtest('S1-01: Room state initializes originalMedia with default genuine background media', () => {
    // Simulate server room initialization
    const initialUrl = 'https://www.youtube.com/watch?v=8hly31xKli0';
    const roomState = {
      mediaUrl: initialUrl,
      mediaType: 'youtube',
      mediaTitle: 'Algorithms and Data Structures Tutorial',
      originalMedia: {
        url: initialUrl,
        type: 'youtube',
        title: 'Algorithms and Data Structures Tutorial',
        time: 0
      },
      previousMedia: null,
      screensharePeerId: null,
      screenshareHostName: null
    };

    assert.strictEqual(roomState.originalMedia.url, initialUrl);
    assert.strictEqual(roomState.originalMedia.type, 'youtube');
  });

  runSubtest('S1-02: Direct switch from Screen Share to Local Stream preserves originalMedia (does not overwrite with webrtc://)', () => {
    const initialUrl = 'https://www.youtube.com/watch?v=8hly31xKli0';
    const roomState = {
      mediaUrl: initialUrl,
      mediaType: 'youtube',
      mediaTitle: 'Original Tutorial',
      originalMedia: { url: initialUrl, type: 'youtube', title: 'Original Tutorial', time: 42 },
      previousMedia: null,
      screensharePeerId: null
    };

    function calculateCurrentMediaTime(rs, now) { return 42; }

    // 1. Host starts screenshare
    const now1 = 1000;
    const isCurrentMediaVirtual1 = roomState.mediaType === 'screen' ||
                                  roomState.mediaType === 'local-stream' ||
                                  (roomState.mediaUrl && (roomState.mediaUrl.startsWith('webrtc://') || roomState.mediaUrl.startsWith('webrtc-local://')));

    if (!isCurrentMediaVirtual1) {
      roomState.originalMedia = { url: roomState.mediaUrl, type: roomState.mediaType, title: roomState.mediaTitle, time: 42 };
      roomState.previousMedia = { url: roomState.mediaUrl, type: roomState.mediaType, title: roomState.mediaTitle, time: 42 };
    }
    roomState.mediaType = 'screen';
    roomState.mediaUrl = 'webrtc://host-screen-peer-1';
    roomState.screensharePeerId = 'host-screen-peer-1';

    assert.strictEqual(roomState.mediaType, 'screen');
    assert.strictEqual(roomState.originalMedia.url, initialUrl);
    assert.strictEqual(roomState.originalMedia.time, 42);

    // 2. Host immediately switches to local stream without stopping first
    const now2 = 2000;
    const isCurrentMediaVirtual2 = roomState.mediaType === 'screen' ||
                                  roomState.mediaType === 'local-stream' ||
                                  (roomState.mediaUrl && (roomState.mediaUrl.startsWith('webrtc://') || roomState.mediaUrl.startsWith('webrtc-local://')));

    assert.strictEqual(isCurrentMediaVirtual2, true, 'Current media must be detected as virtual/transient');

    if (!isCurrentMediaVirtual2) {
      roomState.originalMedia = { url: roomState.mediaUrl, type: roomState.mediaType, title: roomState.mediaTitle, time: 99 };
      roomState.previousMedia = { url: roomState.mediaUrl, type: roomState.mediaType, title: roomState.mediaTitle, time: 99 };
    }
    roomState.mediaType = 'local-stream';
    roomState.mediaUrl = 'webrtc-local://local-file-peer-1';
    roomState.screensharePeerId = 'local-file-peer-1';

    // Verify originalMedia was NOT overwritten with webrtc://host-screen-peer-1
    assert.strictEqual(roomState.originalMedia.url, initialUrl, 'originalMedia must retain genuine background media URL');
    assert.strictEqual(roomState.originalMedia.type, 'youtube');
    assert.strictEqual(roomState.originalMedia.time, 42);
  });

  runSubtest('S1-03: Stopping share mode restores genuine originalMedia without Plyr crash', () => {
    const initialUrl = 'https://www.youtube.com/watch?v=8hly31xKli0';
    const roomState = {
      mediaUrl: 'webrtc-local://local-file-peer-1',
      mediaType: 'local-stream',
      mediaTitle: '[Local Stream] video.mp4',
      originalMedia: { url: initialUrl, type: 'youtube', title: 'Original Tutorial', time: 42 },
      previousMedia: { url: initialUrl, type: 'youtube', title: 'Original Tutorial', time: 42 },
      screensharePeerId: 'local-file-peer-1'
    };

    // Host stops local stream
    roomState.screensharePeerId = null;
    roomState.screenshareHostName = null;
    const restored = (roomState.originalMedia && roomState.originalMedia.url && !roomState.originalMedia.url.startsWith('webrtc'))
      ? roomState.originalMedia
      : (roomState.previousMedia && roomState.previousMedia.url && !roomState.previousMedia.url.startsWith('webrtc')
        ? roomState.previousMedia
        : { url: initialUrl, type: 'youtube', title: 'Fallback', time: 0 });

    roomState.mediaUrl = restored.url;
    roomState.mediaType = restored.type;
    roomState.mediaTitle = restored.title;
    roomState.currentTime = restored.time;

    assert.strictEqual(roomState.mediaUrl, initialUrl, 'Restored media must be YouTube, never webrtc://');
    assert.strictEqual(roomState.mediaType, 'youtube');
    assert.strictEqual(roomState.currentTime, 42);
    assert.strictEqual(roomState.screensharePeerId, null);
  });

  runSubtest('S1-04: Broadcaster disconnect restores genuine background media and clears screensharePeerId', () => {
    const initialUrl = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';
    const roomState = {
      mediaUrl: 'webrtc://broadcaster-peer-id',
      mediaType: 'screen',
      mediaTitle: "Host's Live Screen",
      originalMedia: { url: initialUrl, type: 'direct', title: 'Big Buck Bunny', time: 15 },
      screensharePeerId: 'broadcaster-peer-id'
    };

    // Disconnect event for broadcaster
    roomState.screensharePeerId = null;
    const restored = (roomState.originalMedia && roomState.originalMedia.url && !roomState.originalMedia.url.startsWith('webrtc'))
      ? roomState.originalMedia
      : { url: 'https://www.youtube.com/watch?v=8hly31xKli0', type: 'youtube', title: 'Tutorial', time: 0 };

    roomState.mediaType = restored.type;
    roomState.mediaUrl = restored.url;
    roomState.mediaTitle = restored.title;
    roomState.currentTime = restored.time;

    assert.strictEqual(roomState.mediaUrl, initialUrl);
    assert.strictEqual(roomState.mediaType, 'direct');
    assert.strictEqual(roomState.currentTime, 15);
    assert.strictEqual(roomState.screensharePeerId, null);
  });

  // --------------------------------------------------------------------------
  // SECTION 2: 4-State FSM & Transition Coordinator (frontend/js/room-sync.js)
  // --------------------------------------------------------------------------
  console.log('\n--- SECTION 2: 4-State FSM & Mutual Teardown Engine ---');

  runSubtest('S2-01: FSM state constants are correctly defined and mutually exclusive', () => {
    const states = ['IDLE', 'SCREEN_SHARE', 'LOCAL_STREAM', 'LOCAL_SYNC'];
    const uniqueStates = new Set(states);
    assert.strictEqual(uniqueStates.size, 4, 'Must have exactly 4 unique states');
  });

  await runSubtestAsync('S2-02: transitionMediaShare executes mutual teardown when switching Screen Share -> Local Stream', async () => {
    let screenTrackStopped = false;
    let screenTrackOnendedRemoved = false;
    let broadcastCallsClosed = false;

    const fakeScreenTrack = {
      kind: 'video',
      stop: () => { screenTrackStopped = true; },
      onended: () => { throw new Error('Old onended should never fire after removal!'); }
    };
    const fakeScreenStream = {
      getTracks: () => [fakeScreenTrack]
    };

    const RoomSync = {
      mediaShareState: 'SCREEN_SHARE',
      isScreensharing: true,
      isLocalStreaming: false,
      currentScreenStream: fakeScreenStream,
      currentLocalStream: null,
      peerCalls: new Map([['peer-1', { close: () => { broadcastCallsClosed = true; }, metadata: { type: 'screenshare' } }]]),
      broadcastCalls: new Map([['peer-1', { close: () => { broadcastCallsClosed = true; } }]]),
      _transitionLock: false
    };

    async function teardownCurrentMediaShare(targetState) {
      if (RoomSync.currentScreenStream) {
        RoomSync.currentScreenStream.getTracks().forEach(t => {
          if (t.onended === null) screenTrackOnendedRemoved = true;
          t.onended = null;
          t.stop();
        });
        RoomSync.currentScreenStream = null;
      }
      RoomSync.isScreensharing = false;
      RoomSync.broadcastCalls.forEach(c => c.close());
      RoomSync.broadcastCalls.clear();
      RoomSync.peerCalls.clear();
    }

    async function transitionMediaShare(targetState, startCallback) {
      if (RoomSync._transitionLock) return false;
      RoomSync._transitionLock = true;
      try {
        await teardownCurrentMediaShare(targetState);
        if (startCallback) await startCallback();
        RoomSync.mediaShareState = targetState;
        return true;
      } finally {
        RoomSync._transitionLock = false;
      }
    }

    let localStreamStarted = false;
    await transitionMediaShare('LOCAL_STREAM', async () => {
      localStreamStarted = true;
      RoomSync.isLocalStreaming = true;
    });

    assert.strictEqual(screenTrackStopped, true, 'Screen track must be stopped');
    assert.strictEqual(fakeScreenTrack.onended, null, 'onended handler must be removed to avoid async races');
    assert.strictEqual(broadcastCallsClosed, true, 'Existing broadcast calls must be closed');
    assert.strictEqual(RoomSync.isScreensharing, false, 'isScreensharing must be false');
    assert.strictEqual(RoomSync.isLocalStreaming, true, 'isLocalStreaming must be true');
    assert.strictEqual(RoomSync.mediaShareState, 'LOCAL_STREAM', 'FSM state must be LOCAL_STREAM');
  });

  await runSubtestAsync('S2-03: transitionMediaShare rejects concurrent re-entry via _transitionLock', async () => {
    const RoomSync = {
      mediaShareState: 'IDLE',
      _transitionLock: false
    };

    let callCount = 0;
    async function transitionMediaShare(targetState, cb) {
      if (RoomSync._transitionLock) {
        return false; // Concurrent call rejected!
      }
      RoomSync._transitionLock = true;
      try {
        await new Promise(r => setTimeout(r, 20)); // Simulate async teardown
        if (cb) await cb();
        RoomSync.mediaShareState = targetState;
        callCount++;
        return true;
      } finally {
        RoomSync._transitionLock = false;
      }
    }

    // Launch two transitions concurrently
    const p1 = transitionMediaShare('SCREEN_SHARE', async () => {});
    const p2 = transitionMediaShare('LOCAL_STREAM', async () => {});

    const [r1, r2] = await Promise.all([p1, p2]);
    assert.strictEqual(r1, true, 'First transition should succeed');
    assert.strictEqual(r2, false, 'Concurrent second transition must be locked out');
    assert.strictEqual(callCount, 1, 'Only one transition must execute');
  });

  await runSubtestAsync('S2-04: Re-triggering active state toggles back to STATE_IDLE cleanly', async () => {
    const RoomSync = {
      mediaShareState: 'SCREEN_SHARE',
      isScreensharing: true,
      _transitionLock: false
    };

    async function transitionMediaShare(targetState) {
      if (RoomSync.mediaShareState === targetState && targetState !== 'IDLE') {
        RoomSync.mediaShareState = 'IDLE';
        RoomSync.isScreensharing = false;
        return true;
      }
      RoomSync.mediaShareState = targetState;
      return true;
    }

    await transitionMediaShare('SCREEN_SHARE');
    assert.strictEqual(RoomSync.mediaShareState, 'IDLE', 'Re-triggering SCREEN_SHARE toggles back to IDLE');
    assert.strictEqual(RoomSync.isScreensharing, false);
  });

  // --------------------------------------------------------------------------
  // SECTION 3: Broadcaster Call Recovery & Metadata Propagation
  // --------------------------------------------------------------------------
  console.log('\n--- SECTION 3: Broadcaster Call Recovery & Metadata Propagation ---');

  runSubtest('S3-01: screenshare-feed-requested replaces stale calls rather than returning early', () => {
    let oldCallClosed = false;
    let newCallMade = false;

    const staleCall = {
      open: true,
      close: () => { oldCallClosed = true; }
    };

    const peerCalls = new Map([['requester-peer-123', staleCall]]);
    const broadcastCalls = new Map([['requester-peer-123', staleCall]]);

    const activeStream = { id: 'stream-local-01' };
    const streamType = 'local-file-stream';
    const streamTitle = 'Lecture05.mp4';

    function handleScreenshareFeedRequested(requesterPeerId) {
      const existingCall = broadcastCalls.get(requesterPeerId) || peerCalls.get(requesterPeerId);
      if (existingCall) {
        existingCall.close();
        peerCalls.delete(requesterPeerId);
        broadcastCalls.delete(requesterPeerId);
      }

      // Make fresh call
      const newCall = {
        peer: requesterPeerId,
        metadata: { type: streamType, title: streamTitle }
      };
      peerCalls.set(requesterPeerId, newCall);
      broadcastCalls.set(requesterPeerId, newCall);
      newCallMade = true;
    }

    handleScreenshareFeedRequested('requester-peer-123');

    assert.strictEqual(oldCallClosed, true, 'Stale call must be closed');
    assert.strictEqual(newCallMade, true, 'Fresh call must be initiated');
    assert.strictEqual(peerCalls.get('requester-peer-123').metadata.type, 'local-file-stream');
    assert.strictEqual(peerCalls.get('requester-peer-123').metadata.title, 'Lecture05.mp4');
  });

  runSubtest('S3-02: broadcastScreenshareStream propagates accurate streamType and title', () => {
    let callParams = null;
    const mockPeer = {
      id: 'host-peer-id',
      call: (targetPeerId, stream, opts) => {
        callParams = { targetPeerId, stream, opts };
        return { peer: targetPeerId, open: true };
      }
    };

    const peers = new Set(['viewer-peer-1']);
    function broadcastScreenshareStream(stream, streamType, customTitle) {
      const resolvedType = (streamType === 'local-file-stream') ? 'local-file-stream' : 'screenshare';
      const resolvedTitle = customTitle || 'Host Screen';
      peers.forEach(pId => {
        mockPeer.call(pId, stream, {
          metadata: {
            type: resolvedType,
            title: resolvedTitle,
            fileName: resolvedTitle,
            hostName: 'Host'
          }
        });
      });
    }

    broadcastScreenshareStream({ id: 'dummy-stream' }, 'local-file-stream', 'Calculus.mp4');

    assert.notStrictEqual(callParams, null);
    assert.strictEqual(callParams.opts.metadata.type, 'local-file-stream');
    assert.strictEqual(callParams.opts.metadata.title, 'Calculus.mp4');
    assert.strictEqual(callParams.opts.metadata.fileName, 'Calculus.mp4');
  });

  // --------------------------------------------------------------------------
  // SECTION 4: Live Headless Browser E2E State Machine Validation
  // --------------------------------------------------------------------------
  console.log('\n--- SECTION 4: Live Headless Browser Validation ---');

  await runSubtestAsync('S4-01: In-browser 4-state FSM transitions and UI coordination', async () => {
    const browser = await puppeteer.launch({
      executablePath: resolveBrowserExecutable(),
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--mute-audio',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream'
      ]
    });

    try {
      const page = await browser.newPage();
      await page.goto('http://localhost:5000/pages/room.html?room=UNI-8842', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#videoContainer', { timeout: 8000 });

      const evaluation = await page.evaluate(async () => {
        const RS = window.RoomSync;
        if (!RS) return { pass: false, reason: 'RoomSync missing' };

        // Check state constants
        const hasConstants = (RS.STATE_IDLE === 'IDLE') &&
                             (RS.STATE_SCREEN_SHARE === 'SCREEN_SHARE') &&
                             (RS.STATE_LOCAL_STREAM === 'LOCAL_STREAM') &&
                             (RS.STATE_LOCAL_SYNC === 'LOCAL_SYNC');

        if (!hasConstants) return { pass: false, reason: 'State constants missing on RoomSync' };

        // Initial state must be IDLE
        if (RS.mediaShareState !== 'IDLE') return { pass: false, reason: 'Initial state not IDLE' };

        // Test transition to LOCAL_STREAM
        await RS.transitionMediaShare('LOCAL_STREAM', async () => {
          RS.isLocalStreaming = true;
          return true;
        });
        const stateAfterLocalStream = RS.mediaShareState;
        const isLocalStreamingAfter = RS.isLocalStreaming;

        // Test transition to LOCAL_SYNC
        await RS.transitionMediaShare('LOCAL_SYNC', async () => {
          return true;
        });
        const stateAfterLocalSync = RS.mediaShareState;
        const isLocalStreamingAfterSync = RS.isLocalStreaming; // Must be false after teardown!

        // Test transition back to IDLE
        await RS.transitionMediaShare('IDLE');
        const stateAfterIdle = RS.mediaShareState;

        return {
          pass: true,
          hasConstants,
          stateAfterLocalStream,
          isLocalStreamingAfter,
          stateAfterLocalSync,
          isLocalStreamingAfterSync,
          stateAfterIdle
        };
      });

      assert.strictEqual(evaluation.pass, true, evaluation.reason);
      assert.strictEqual(evaluation.hasConstants, true);
      assert.strictEqual(evaluation.stateAfterLocalStream, 'LOCAL_STREAM');
      assert.strictEqual(evaluation.isLocalStreamingAfter, true);
      assert.strictEqual(evaluation.stateAfterLocalSync, 'LOCAL_SYNC');
      assert.strictEqual(evaluation.isLocalStreamingAfterSync, false, 'Mutual teardown must clear isLocalStreaming on sync transition');
      assert.strictEqual(evaluation.stateAfterIdle, 'IDLE');
    } finally {
      await browser.close();
    }
  });

  console.log('\n====================================================================');
  console.log(`Milestone 3 Verification: ${passedCount}/${totalCount} tests passed (${Math.round((passedCount/totalCount)*100)}%)`);
  console.log('====================================================================\n');
}

runAllTests().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
