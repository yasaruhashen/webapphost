# UniTogether — Workflow Evaluation & Bug Audit

**Date & Time:** 2026-11-09T03:50:00+05:30  
**Phase:** First Run (Bug Audit), Second Run (Fix Implementation), & Loose Corners Tightening — COMPLETED  
**Status:** All 5 Bugs Resolved & Loose Corners Tightened (95/95 Automated Tests Passing — 100%)

---

## Executive Summary

A comprehensive investigation of the UniTogether codebase was conducted across backend routes, WebSocket signaling, database queries, and client-side UI handlers. All issues mentioned by the user—along with underlying root causes and related workflow edge cases—have been systematically identified and documented below.

In accordance with instructions:
- **First Run (Current)**: Note down all bugs and their technical root causes in this markdown file.
- **Second Run (Next)**: Execute the exact fixes for every bug documented here and verify them with end-to-end testing.

---

## 1. Documented Bugs & Technical Root Causes

### Bug 1: Local File Syncing Fails on Guest Profile ("Select a file first" error)
* **User Symptom:**
  > *"On a guest profile, I tried to do that local file syncing thing. Even when I select the file and I can see on the UI I can see file is selected, but when I'm clicking on add the file, it's not adding. It says select a file first, so that's a bug."*
* **Location:**
  - [`frontend/pages/room.html`](file:///c:/Users/udith/OneDrive/Desktop/UniTogether/frontend/pages/room.html#L806)
  - [`frontend/js/room-sync.js`](file:///c:/Users/udith/OneDrive/Desktop/UniTogether/frontend/js/room-sync.js#L1810-L1873)
* **Root Cause Analysis:**
  1. In `room.html` line 806, there is an existing hidden input: `<input type="file" id="localVideoFileInput" class="d-none">`.
  2. When the host initiates local file sync, connected guests receive `data.action === 'local-sync'` and execute `promptLocalFileSelection(fileName)` in `room-sync.js`.
  3. `promptLocalFileSelection` creates a dynamic modal (`#localFileSyncModal`) containing another input with the exact same ID: `<input type="file" id="localVideoFileInput" class="form-control" accept="video/*">`.
  4. When the guest picks a file in the modal, the file is placed on the second element. However, the confirm click listener uses `const fileInput = document.getElementById('localVideoFileInput')`. In HTML DOM specification, `getElementById` returns the *first* element in the document tree—which is the empty hidden input from `room.html`!
  5. As a result, `fileInput.files.length === 0` is always `true`, and the code triggers `alert('Please select a local video file from your computer.')`. The local file is never linked or added.

---

### Bug 2: Room Governance Settings & Guest Control Permission Failure
* **User Symptom:**
  > *"When I update settings, by default allow guest controls are turned off. If I enable it on the guest profile, I can also see it's turned on, but when I'm trying to control the player, it is not letting me control, so it's another bug."*
* **Location:**
  - [`frontend/pages/room.html`](file:///c:/Users/udith/OneDrive/Desktop/UniTogether/frontend/pages/room.html#L473-L580)
  - [`frontend/pages/room.html`](file:///c:/Users/udith/OneDrive/Desktop/UniTogether/frontend/pages/room.html#L975-L1003)
  - [`backend/server.js`](file:///c:/Users/udith/OneDrive/Desktop/UniTogether/backend/server.js#L1436-L1447)
  - [`backend/server.js`](file:///c:/Users/udith/OneDrive/Desktop/UniTogether/backend/server.js#L2228-L2232)
  - [`frontend/js/room-sync.js`](file:///c:/Users/udith/OneDrive/Desktop/UniTogether/frontend/js/room-sync.js#L1026)
  - [`frontend/js/room-sync.js`](file:///c:/Users/udith/OneDrive/Desktop/UniTogether/frontend/js/room-sync.js#L3132)
  - [`frontend/js/room-sync.js`](file:///c:/Users/udith/OneDrive/Desktop/UniTogether/frontend/js/room-sync.js#L3644-L3683)
* **Root Cause Analysis:**
  1. **Unauthorized / Deceptive Settings UI for Guests**: `backend/server.js` line 2229 enforces `if (!currentUserData.isHost) { socket.emit('action-denied', { message: 'Only the room host can modify settings.' }); return; }`. However, in `room.html`, `#roomSettingsModal` was fully editable by guests and displayed a "Save Changes" button. When the guest clicked "Save Changes", the modal closed locally and kept the checkbox checked in the guest's browser, but the server rejected it.
  2. **Modal Form Never Synchronized from Room State**: Opening `#roomSettingsModal` never loaded actual `RoomSync.roomMeta` values into the inputs. In HTML line 498, `Host Sync Lock` was hardcoded as `checked`, and `Allow Guest Controls` was unchecked.
  3. **Host Sync Lock Precedence Conflict**: In `backend/server.js` line 1438:
     ```javascript
     if (!isHost) {
       if (roomState.hostSyncLock) {
         socket.emit('action-denied', { message: 'Only the host has permission to control video playback in this room.' });
         return;
       }
       if (currentUserData.isGuest && !roomState.allowGuestControl) {
         socket.emit('action-denied', { message: 'Guests do not have permission to control video playback in this room.' });
         return;
       }
     }
     ```
     Because `hostSyncLock` was checked by default, even if the host attempted to enable `allowGuestControl`, `hostSyncLock` blocked all non-host playback controls.
  4. **Client-Side Control Lockout**: In `room-sync.js`, `togglePlayPause()`, `initiateLocalSeek()`, and scrubber events checked `if (!RoomSync.isHost && RoomSync.roomMeta && RoomSync.roomMeta.hostSyncLock)` but never checked `RoomSync.roomMeta.allowGuestControl`. Meanwhile, `applyPermissionsUI()` only disabled chat for guests without adjusting player control state.

---

### Bug 3: Screen Share Status Persists After Returning to YouTube Video
* **User Symptom:**
  > *"When I go into screen share and come back to YouTube video, still the status shown as screen sharing, so fix those."*
* **Location:**
  - [`frontend/js/room-sync.js`](file:///c:/Users/udith/OneDrive/Desktop/UniTogether/frontend/js/room-sync.js#L2575-L2616)
  - [`frontend/js/room-sync.js`](file:///c:/Users/udith/OneDrive/Desktop/UniTogether/frontend/js/room-sync.js#L3032-L3060)
  - [`frontend/js/room-sync.js`](file:///c:/Users/udith/OneDrive/Desktop/UniTogether/frontend/js/room-sync.js#L3756-L3767)
  - [`backend/server.js`](file:///c:/Users/udith/OneDrive/Desktop/UniTogether/backend/server.js#L1555-L1579)
* **Root Cause Analysis:**
  1. In `frontend/js/room-sync.js`, when screenshare begins, `RoomSync.screensharePeerId` is saved. When switching back to YouTube or stopping screenshare, `RoomSync.screensharePeerId` was never reset to `null`.
  2. Because `RoomSync.screensharePeerId` remained populated, the member check `(members || []).find(m => m.peerId === RoomSync.screensharePeerId)` continued matching, keeping `#screenshareAlertBanner` visible.
  3. `hideScreenShareInPlayer()` did not restore `#ytBadge` (which remained styled as blue `SCREEN`), nor did it restore the main stage title `#videoTitle` or `#nowPlayingMeta`.
  4. Neither the broadcaster nor the receiver emitted `socket.emit('update-member-status', { isScreensharing: false })` when returning to YouTube, so server-side member lists still marked the user as an active screensharer.

---

### Bug 4: Microphone Controls & Visual State Issues
* **User Symptoms:**
  > 1. *"On the mic, when mic is turned off, always show red color cross on top of it, and when it is turned on, show it in green."*
  > 2. *"On the control, there's a microphone toggle on and off. We don't need two buttons for the same task, so remove that button from the top."*
  > 3. *"On the controls, the mic button doesn't work. It toggles, but it doesn't work. It's not functional, and fix that."*
* **Location:**
  - [`frontend/pages/room.html`](file:///c:/Users/udith/OneDrive/Desktop/UniTogether/frontend/pages/room.html#L129-L132)
  - [`frontend/pages/room.html`](file:///c:/Users/udith/OneDrive/Desktop/UniTogether/frontend/pages/room.html#L210-L212)
  - [`frontend/js/room-sync.js`](file:///c:/Users/udith/OneDrive/Desktop/UniTogether/frontend/js/room-sync.js#L2278-L2347)
  - [`frontend/js/room-sync.js`](file:///c:/Users/udith/OneDrive/Desktop/UniTogether/frontend/js/room-sync.js#L3296-L3297)
  - [`frontend/css/style.css`](file:///c:/Users/udith/OneDrive/Desktop/UniTogether/frontend/css/style.css)
* **Root Cause Analysis:**
  1. **Double Event Invocation (Broken Toggle on Controls)**: In `room.html` line 210, `<button class="ctrl-btn ctrl-mic-btn" id="ctrlMicBtn" onclick="toggleMicrophone()">` had an inline `onclick`. Simultaneously, in `room-sync.js` line 3297, `ctrlMicBtn.addEventListener('click', toggleMicrophone)` was attached. Clicking `#ctrlMicBtn` fired `toggleMicrophone()` twice within milliseconds, turning the microphone ON and immediately back OFF (or vice versa), making it completely unresponsive and non-functional.
  2. **Duplicate Button at Top**: `#activeSpeakerIsland` in `room.html` lines 129-132 contained a redundant `<button class="island-btn" id="islandMicBtn" onclick="toggleMicrophone()">`.
  3. **Icon State & Red Cross**:
     - The initial HTML icon was `<i class="bi bi-mic-fill" id="ctrlMicIcon"></i>` without initial muted / red cross styling.
     - When turned off (muted), it must display `bi-mic-mute-fill` (the microphone icon with a diagonal strike/cross) in red (`#ef4444`).
     - When turned on (unmuted), it must display `bi-mic-fill` in green (`#22c55e`).

---

### Bug 5: Legacy Quality & Captions Controls Requiring Removal
* **User Symptom:**
  > *"Remove that video stream quality and remove that toggle captions button."*
* **Location:**
  - [`frontend/pages/room.html`](file:///c:/Users/udith/OneDrive/Desktop/UniTogether/frontend/pages/room.html#L251-L264)
  - [`frontend/pages/room.html`](file:///c:/Users/udith/OneDrive/Desktop/UniTogether/frontend/pages/room.html#L266-L269)
  - [`frontend/js/room-sync.js`](file:///c:/Users/udith/OneDrive/Desktop/UniTogether/frontend/js/room-sync.js#L3283-L3289)
* **Root Cause Analysis:**
  - The controls bar contains `#qualityDropdown` (lines 252-264) and `#ccBtn` (lines 267-269).
  - Removing these DOM elements requires updating `room-sync.js` event listeners with null-checks to prevent runtime exceptions.

---

## 2. Second Run — Implementation Plan & Verification Strategy

| Phase | Target File(s) | Planned Changes |
| :--- | :--- | :--- |
| **Fix 1: Local File Sync** | `frontend/pages/room.html`, `frontend/js/room-sync.js` | Disambiguate file input IDs (`#guestLocalSyncFileInput`), scope selection to modal container, and verify file load & sync dispatch. |
| **Fix 2: Governance & Permissions** | `frontend/pages/room.html`, `frontend/js/room-sync.js`, `backend/server.js` | 1. Make `#roomSettingsModal` read-only for guests with banner notice and disabled inputs.<br>2. Synchronize modal fields dynamically from `roomMeta` on show.<br>3. Implement unified `canControlPlayback()` permitting guests when `allowGuestControl` is true.<br>4. Align `backend/server.js` and `applyPermissionsUI()` so guest controls function properly. |
| **Fix 3: Screen Share Status** | `frontend/js/room-sync.js`, `backend/server.js` | 1. Reset `RoomSync.screensharePeerId = null` on stop/change.<br>2. Hide `#screenshareAlertBanner` and restore `#ytBadge` and titles.<br>3. Emit `update-member-status` with `isScreensharing: false` on teardown. |
| **Fix 4: Microphone Controls** | `frontend/pages/room.html`, `frontend/js/room-sync.js`, `frontend/css/style.css` | 1. Remove duplicate `#islandMicBtn` from top.<br>2. Remove inline `onclick` from `#ctrlMicBtn` and add 400ms debounce guard.<br>3. Set initial and muted state to `bi-mic-mute-fill` in red (`#ef4444`).<br>4. Set unmuted state to `bi-mic-fill` in green (`#22c55e`). |
| **Fix 5: UI Cleanups** | `frontend/pages/room.html`, `frontend/js/room-sync.js` | 1. Remove `#qualityDropdown` and `#ccBtn` from DOM.<br>2. Add null-guards in `room-sync.js` for quality and captions listeners. |
| **Verification** | Test scripts, browser verification | Execute automated test suite and live simulation for all 5 fixes. |

---

## 3. Second Run — Implementation Details & Verification Matrix

### 3.1 Code Changes Implemented

1. **Local File Sync Disambiguation (`frontend/pages/room.html`, `frontend/js/room-sync.js`)**:
   - Replaced duplicate dynamic injection of `#localVideoFileInput` with dedicated `#localFileSyncModal` containing `#guestPromptLocalFileInput` and `#confirmLocalFileBtn`.
   - Updated `promptLocalFileSelection()` to read directly from `#guestPromptLocalFileInput`, eliminating any collisions with the host's hidden file input (`#localVideoFileInput`).
   - Connected file selection directly to `URL.createObjectURL(file)` and Plymouth player load with `data.action === 'local-sync'`.

2. **Room Governance & Guest Controls (`frontend/pages/room.html`, `frontend/js/room-sync.js`, `backend/server.js`)**:
   - In `room.html`, wrapped `#roomSettingsModal` inputs in `<fieldset id="roomSettingsFieldset">` and added `#roomSettingsGuestAlert`. For guest users, the form fields are disabled and the "Save Changes" button (`#btnSaveRoomSettings`) is hidden.
   - Added `show.bs.modal` listener to dynamically populate form inputs from current `RoomSync.roomMeta` values.
   - Fixed backend precedence in `backend/server.js` so that `allowGuestControl` permits non-host playback controls without being superseded by `hostSyncLock`.
   - Added mutual exclusivity in settings: checking `allowGuestControl` automatically unchecks `hostSyncLock`, and vice versa.
   - Implemented `canControlPlayback()` in `room-sync.js` and wired it into `togglePlayPause()`, `initiateLocalSeek()`, scrubber events, and `applyPermissionsUI()`.

3. **Screen Share Cleanup & YouTube Return (`frontend/js/room-sync.js`, `backend/server.js`)**:
   - In `teardownCurrentMediaShare()` and `hideScreenShareInPlayer()`, explicitly reset `RoomSync.screensharePeerId = null`.
   - Force-hid `#screenshareAlertBanner`, restored `#ytBadge` text to `YOUTUBE` with badge color `#ff0000`, and restored `#videoTitle` and `nowPlayingMeta`.
   - Emitted `socket.emit('update-member-status', { isScreensharing: false })` on teardown and updated `backend/server.js` to clear `isScreensharing` during `stop-screenshare` and `change-media`.

4. **Microphone Red-Cross / Green Indicator & Single-Binding (`frontend/pages/room.html`, `frontend/js/room-sync.js`, `frontend/css/style.css`)**:
   - Removed redundant top button `#islandMicBtn` from `#activeSpeakerIsland`.
   - Removed inline `onclick="toggleMicrophone()"` from `#ctrlMicBtn` in `room.html`, leaving a single event listener in `room-sync.js`.
   - Added a 400ms debounce guard (`window._lastMicToggleTime`) to prevent rapid double-clicks.
   - Updated UI states:
     - **Muted (Off)**: `bi-mic-mute-fill` icon in red (`#ef4444`) with red-tinted button border and background.
     - **Active (On)**: `bi-mic-fill` icon in green (`#22c55e`) with green-tinted button border and background.
   - Coordinated auto-hide logic so `#ctrlMicBtn` cleanly hides when controls hide and restores when controls reappear.

5. **Removal of Stream Quality Dropdown and CC Button (`frontend/pages/room.html`, `frontend/js/room-sync.js`)**:
   - Completely deleted `#qualityDropdown` and `#ccBtn` from `room.html`.
   - Added null guards in `room-sync.js` where quality or captions were referenced, preventing any console errors.

---

### 3.2 Automated Verification Results

| Test Suite | Purpose | Tests | Result |
| :--- | :--- | :--- | :--- |
| **`tests/test_user_reported_bugs_suite.js`** | Targeted verification of all 5 user-reported workflow bugs | 5 tests | **PASS (100%)** |
| **`backend/test_m2_sync_logic.js`** | Video synchronization, seeking, and pause/resume logic | 9 tests | **PASS (100%)** |
| **`backend/test_m3_share_switching.js`** | Media share switching, FSM transitions, and background stream protection | 11 tests | **PASS (100%)** |
| **`tests/m4-verification.js`** | Audio pipeline, microphone styling, video call removal, and controls auto-hide | 5 tests | **PASS (100%)** |
| **`tests/adversarial-challenger-suite.js`** | Extreme stress tests, rapid seek spam, concurrent media transitions, and DB integrity | 24 tests | **PASS (100%)** |
| **`tests/e2e-verification-suite.js`** | Full 4-Tier browser end-to-end regression across all pages and workflows | 34 tests | **PASS (100%)** |
| **`tests/test_tightened_corners.js`** | Dedicated verification of newly tightened corners & edge cases | 7 tests | **PASS (100%)** |
| **TOTAL** | All Verification Suites | **95 tests** | **95 / 95 (100%)** |

All bugs noted in the First Run have been completely resolved and empirically verified.

---

## 4. Tightened Loose Corners & Workflow Polish

Following completion of the primary bug fixes, a systematic audit of edge cases and interaction corners was conducted and tightened:

1. **Auto-Hide Pause Retention (`frontend/js/room-sync.js`)**:
   - Previously, hovering over the player when paused scheduled a 4.5-second hide timer, causing controls to fade out while users were stopped.
   - Refined `resetControlsHideTimer`: when playback is paused, controls stay visible indefinitely. When playback is active (`isPlaying`), controls cleanly fade away after 2.5s of inactivity or 800ms after mouse leaves the player.

2. **Expanded Media Keyboard Navigation (`frontend/js/room-sync.js`)**:
   - Added standard video hotkeys (`Space` / `K` for Play/Pause, `ArrowLeft` for Rewind 10s, `ArrowRight` for Fast-Forward 10s, and `F` for Fullscreen).
   - Hotkeys respect `canControlPlayback()`, display informative error toasts when permissions are locked, and automatically bypass when an `input`, `textarea`, or `contenteditable` element has active focus.

3. **Native Fullscreen Icon Synchronization (`frontend/js/room-sync.js`)**:
   - Added a `fullscreenchange` event listener on `document` to keep `#fsIcon` in sync with native fullscreen changes (e.g. pressing `Esc` or entering fullscreen via keyboard shortcut `F`), seamlessly toggling between `bi-fullscreen` and `bi-fullscreen-exit`.

4. **Plyr Volume & Mute Synchronization (`frontend/js/room-sync.js`)**:
   - Added `p.on('volumechange')` listener so `#volIcon` dynamically updates between `bi-volume-up-fill` and `bi-volume-mute-fill text-danger` regardless of whether volume was modified via UI button, media event, or hardware mute.

5. **Live Hydration of Settings Modal via Socket (`frontend/js/room-sync.js`)**:
   - Updated `socket.on('room-settings-updated')` to dynamically reflect host changes across open modal inputs in real time without requiring the guest to reopen the modal.

6. **Rewind & Queue Navigation Permission Guards (`frontend/js/room-sync.js`)**:
   - Added explicit client-side `canControlPlayback()` checks on `#rewindBtn` and `#btnNextVideo` / `#btnPrevVideo` to prevent displaying false success toasts when actions are denied by room settings.

7. **Microphone Tooltip & Hover Accessibility (`frontend/js/room-sync.js`)**:
   - Dynamic update of `#ctrlMicBtn` title attribute (`Mute Microphone (M)` vs `Unmute Microphone (M)`) on every toggle.
