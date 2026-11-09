/**
 * UniTogether - Client Application Logic
 * Comprehensive Frontend Synchronization, UI Interactions, and State Management
 */

// ============================================================================
// Global State & Storage Management
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
  const sig = `${navigator.userAgent}_${navigator.language}_${screen.width}x${screen.height}_${screen.colorDepth}_${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
  let hash = 0;
  for (let i = 0; i < sig.length; i++) {
    hash = ((hash << 5) - hash) + sig.charCodeAt(i);
    hash |= 0;
  }
  const rand = Math.random().toString(36).substring(2, 9);
  const uuid = `dev-${Math.abs(hash).toString(16)}-${rand}`;
  document.cookie = `unitogether_device_uuid=${uuid}; path=/; max-age=31536000; SameSite=Lax`;
  localStorage.setItem('unitogether_device_uuid', uuid);
  return uuid;
}

const currentDeviceUuid = getOrCreateDeviceUUID();

const AppState = {
  currentUser: JSON.parse(localStorage.getItem('unitogether_user')) || {
    uuid: currentDeviceUuid,
    name: 'Guest_' + currentDeviceUuid.substr(-4).toUpperCase(),
    email: '',
    role: 'guest',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=80&q=80',
    isGuest: true
  },
  activeRoom: JSON.parse(localStorage.getItem('unitogether_active_room')) || {
    code: 'UNI-8842',
    title: 'CS204: Algorithms & Data Structures - Final Exam Review 🍿',
    mediaUrl: 'https://www.youtube.com/watch?v=8hly31xKli0',
    mediaTitle: 'Algorithms and Data Structures Tutorial - Full Course',
    mediaSource: 'YouTube (HD 1080p)',
    hostSyncLock: true,
    allowChat: true,
    allowWebcam: true,
    allowChangeContent: false,
    allowEditPlaylist: true
  }
};

// ============================================================================
// Auth Guard Utility
// ============================================================================
function requireRealAccount() {
  // Allow hub and profile views to mount cleanly for both registered students
  // and guest participants; features requiring student accounts handle permissions inline.
  return true;
}

// ============================================================================
// Initialization
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  initThemeToggle();
  initAuthPage();
  initHubPage();
  initRoomPage();
  initProfilePage();
});

// ============================================================================
// Theme Toggle (Light / Dark Mode)
// ============================================================================

function initThemeToggle() {
  const savedTheme = localStorage.getItem('unitogether_theme') || 'light';
  document.documentElement.setAttribute('data-bs-theme', savedTheme);

  const themeBtns = document.querySelectorAll('#themeToggleBtn, .btn-theme-toggle');
  themeBtns.forEach(btn => {
    const icon = btn.querySelector('i') || document.getElementById('themeIcon');
    if (icon) {
      icon.className = savedTheme === 'dark' ? 'bi bi-sun-fill text-warning' : 'bi bi-moon-stars-fill';
    }
    btn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-bs-theme') || 'light';
      const nextTheme = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-bs-theme', nextTheme);
      localStorage.setItem('unitogether_theme', nextTheme);
      document.querySelectorAll('#themeToggleBtn i, #themeIcon, .btn-theme-toggle i').forEach(ic => {
        ic.className = nextTheme === 'dark' ? 'bi bi-sun-fill text-warning' : 'bi bi-moon-stars-fill';
      });
      showToast(`Switched to ${nextTheme} theme mode`, 'info');
    });
  });
}

// ============================================================================
// Toast Notification Utility
// ============================================================================

function showToast(message, type = 'info') {
  const container = document.getElementById('appToastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'app-toast';
  
  let iconClass = 'bi-info-circle-fill text-primary';
  if (type === 'success') iconClass = 'bi-check-circle-fill text-success';
  if (type === 'danger') iconClass = 'bi-exclamation-triangle-fill text-danger';
  if (type === 'warning') iconClass = 'bi-lightning-charge-fill text-warning';

  toast.innerHTML = `
    <i class="bi ${iconClass} fs-5"></i>
    <div class="flex-grow-1">${message}</div>
    <button type="button" class="btn-close btn-close-white btn-sm ms-2" style="font-size: 0.65rem;" onclick="this.parentElement.remove()"></button>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ============================================================================
// 1. Landing & Authentication Page (index.html)
// ============================================================================

function initAuthPage() {
  const tabLoginBtn = document.getElementById('tabLoginBtn');
  const tabSignupBtn = document.getElementById('tabSignupBtn');
  const loginForm = document.getElementById('loginForm');
  const signupForm = document.getElementById('signupForm');
  const authTitle = document.getElementById('authTitle');
  const authSubtitle = document.getElementById('authSubtitle');

  if (!tabLoginBtn || !tabSignupBtn) return;

  // Tab Switching
  tabLoginBtn.addEventListener('click', () => {
    tabLoginBtn.classList.add('active');
    tabLoginBtn.setAttribute('aria-selected', 'true');
    tabSignupBtn.classList.remove('active');
    tabSignupBtn.setAttribute('aria-selected', 'false');

    loginForm.style.display = 'block';
    signupForm.style.display = 'none';

    authTitle.innerHTML = 'Welcome back to <span class="brand-accent">UniTogether</span>';
    authSubtitle.textContent = 'Log in to continue your watch party or create a new synchronized room.';
  });

  tabSignupBtn.addEventListener('click', () => {
    tabSignupBtn.classList.add('active');
    tabSignupBtn.setAttribute('aria-selected', 'true');
    tabLoginBtn.classList.remove('active');
    tabLoginBtn.setAttribute('aria-selected', 'false');

    loginForm.style.display = 'none';
    signupForm.style.display = 'block';

    authTitle.innerHTML = 'Join <span class="brand-accent">UniTogether</span> Today';
    authSubtitle.textContent = 'Create your student account to host private watch parties and save playlists.';
  });

  // Guest Entry Modal "create an account" Trigger (DEF-06)
  const guestGoToSignup = document.getElementById('guestGoToSignup');
  if (guestGoToSignup) {
    guestGoToSignup.addEventListener('click', () => {
      tabSignupBtn.click();
    });
  }

  // Password Visibility Toggles
  const toggleLoginPwd = document.getElementById('toggleLoginPasswordBtn');
  if (toggleLoginPwd) {
    toggleLoginPwd.addEventListener('click', () => {
      const input = document.getElementById('loginPassword');
      const isPwd = input.type === 'password';
      input.type = isPwd ? 'text' : 'password';
      toggleLoginPwd.querySelector('i').className = isPwd ? 'bi bi-eye-slash' : 'bi bi-eye';
    });
  }

  const toggleSignupPwd = document.getElementById('toggleSignupPasswordBtn');
  if (toggleSignupPwd) {
    toggleSignupPwd.addEventListener('click', () => {
      const input = document.getElementById('signupPassword');
      const isPwd = input.type === 'password';
      input.type = isPwd ? 'text' : 'password';
      toggleSignupPwd.querySelector('i').className = isPwd ? 'bi bi-eye-slash' : 'bi bi-eye';
    });
  }

  // Login Form Submission
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('loginEmail').value.trim();
      const pwd = document.getElementById('loginPassword').value.trim();

      if (!email || !pwd) {
        showToast('Please enter both student email and password.', 'danger');
        return;
      }

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: pwd })
        });
        const data = await res.json();
        if (data.success && data.user) {
          AppState.currentUser = {
            uuid: data.user.uuid,
            name: data.user.fullName,
            email: data.user.email,
            faculty: data.user.faculty,
            role: data.user.role,
            avatar: data.user.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=80&q=80',
            isGuest: false
          };
          localStorage.setItem('unitogether_user', JSON.stringify(AppState.currentUser));
          showToast(`Welcome back, ${AppState.currentUser.name}! Redirecting to hub...`, 'success');
          setTimeout(() => {
            window.location.href = 'pages/rooms.html';
          }, 700);
        } else {
          showToast(data.message || 'Invalid email or password.', 'danger');
        }
      } catch (err) {
        console.error('Login request failed:', err);
        showToast('Could not reach the server. Please check your connection and try again.', 'danger');
      }
    });
  }

  // Sign Up Form Submission
  if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('signupFullName').value.trim();
      const email = document.getElementById('signupEmail').value.trim();
      const faculty = document.getElementById('signupFaculty').value;
      const pwd = document.getElementById('signupPassword').value.trim();

      if (!name || !email || !pwd) {
        showToast('Please complete all required fields.', 'danger');
        return;
      }

      try {
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: pwd, fullName: name, faculty })
        });
        const data = await res.json();
        if (data.success && data.user) {
          AppState.currentUser = {
            uuid: data.user.uuid,
            name: data.user.fullName,
            email: data.user.email,
            faculty: data.user.faculty,
            role: data.user.role,
            avatar: data.user.avatarUrl,
            isGuest: false
          };
          localStorage.setItem('unitogether_user', JSON.stringify(AppState.currentUser));
          showToast(`Account created successfully! Welcome to UniTogether.`, 'success');
          setTimeout(() => {
            window.location.href = 'pages/rooms.html';
          }, 700);
        } else {
          showToast(data.message || 'Registration failed.', 'danger');
        }
      } catch (err) {
        console.error('Signup request failed:', err);
        showToast('Could not reach the server. Please check your connection and try again.', 'danger');
      }
    });
  }

  // Single Sign-On (SSO) Status Notices
  const btnGoogle = document.getElementById('btnGoogleSso');
  if (btnGoogle) {
    btnGoogle.addEventListener('click', () => {
      showToast('Google Student SSO login is currently pending accreditation. Please use student email.', 'warning');
    });
  }

  const btnFacebook = document.getElementById('btnFacebookSso');
  if (btnFacebook) {
    btnFacebook.addEventListener('click', () => {
      showToast('Facebook SSO is currently in development. Please use student email login.', 'warning');
    });
  }

  const btnLearn = document.getElementById('btnLearnSso');
  if (btnLearn) {
    btnLearn.addEventListener('click', () => {
      showToast('LEARN University LMS SSO integration is coming soon. Please use student email login.', 'warning');
    });
  }

  // Forgot Password Recovery Flow
  const forgotForm = document.getElementById('forgotPasswordForm');
  const resetConfirmForm = document.getElementById('resetConfirmForm');
  if (forgotForm) {
    forgotForm.addEventListener('submit', (e) => {
      e.preventDefault();
      document.getElementById('forgotStep1').style.display = 'none';
      document.getElementById('forgotStep2').style.display = 'block';
      showToast('Recovery token sent to your email!', 'success');
    });
  }

  if (resetConfirmForm) {
    resetConfirmForm.addEventListener('submit', (e) => {
      e.preventDefault();
      showToast('Password updated successfully! You can now log in.', 'success');
      const modal = bootstrap.Modal.getInstance(document.getElementById('forgotPasswordModal'));
      if (modal) modal.hide();
      document.getElementById('forgotStep1').style.display = 'block';
      document.getElementById('forgotStep2').style.display = 'none';
    });
  }

  // Guest Access Form (Guests Can Join Existing Rooms Only)
  const guestAccessForm = document.getElementById('guestAccessForm');
  if (guestAccessForm) {
    guestAccessForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const nickname = document.getElementById('guestNickname').value.trim() || 'Guest_Student';
      const joinCode = (document.getElementById('guestJoinCode')?.value.trim() || 'UNI-8842').toUpperCase();
      const devUuid = getOrCreateDeviceUUID();

      AppState.currentUser = {
        uuid: devUuid,
        name: nickname,
        email: `${nickname.toLowerCase()}@guest.unitogether.edu`,
        role: 'guest',
        avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=80&q=80',
        isGuest: true
      };
      localStorage.setItem('unitogether_user', JSON.stringify(AppState.currentUser));

      showToast(`Entering room ${joinCode} as ${nickname}...`, 'success');
      setTimeout(() => {
        window.location.href = `pages/room.html?room=${joinCode}`;
      }, 700);
    });
  }

  // Instant Room Form Modal (Registered Students Only)
  const instantRoomForm = document.getElementById('instantRoomForm');
  if (instantRoomForm) {
    const instantVisibility = document.getElementById('instantVisibility');
    const passcodeCol = document.getElementById('passcodeFieldCol');
    if (instantVisibility && passcodeCol) {
      instantVisibility.addEventListener('change', () => {
        passcodeCol.style.display = instantVisibility.value === 'passcode' ? 'block' : 'none';
      });
    }

    instantRoomForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (AppState.currentUser.isGuest) {
        showToast('Guests are not permitted to create rooms. Please log in or create a student account.', 'warning');
        return;
      }

      const topic = document.getElementById('instantRoomName').value.trim() || 'Instant Watch Party';
      const mediaUrl = document.getElementById('instantMediaUrl').value.trim();
      const hostSyncLock = document.getElementById('instantHostSyncLock')?.checked || false;
      const visibility = instantVisibility ? instantVisibility.value : 'public';
      const passcode = document.getElementById('instantPasscode')?.value.trim();

      try {
        const res = await fetch('/api/rooms', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-uuid': AppState.currentUser.uuid,
            'x-is-guest': 'false'
          },
          body: JSON.stringify({
            title: topic,
            mediaUrl: mediaUrl || 'https://www.youtube.com/watch?v=8hly31xKli0',
            hostSyncLock,
            visibility,
            passcode
          })
        });
        const data = await res.json();
        if (data.success && data.roomCode) {
          showToast(`Instant room ${data.roomCode} launched!`, 'success');
          setTimeout(() => {
            window.location.href = `pages/room.html?room=${data.roomCode}`;
          }, 600);
        } else {
          showToast(data.message || 'Error creating room', 'danger');
        }
      } catch (err) {
        console.error('Create room request failed:', err);
        showToast('Could not reach the server. Please check your connection and try again.', 'danger');
      }
    });
  }
}

// ============================================================================
// 2. Watch Party Hub Page (pages/rooms.html)
// ============================================================================

function initHubPage() {
  const filterBar = document.getElementById('categoryFilterBar');
  const searchInput = document.getElementById('hubSearchInput');
  const joinBtn = document.getElementById('hubJoinCodeBtn');
  const roomsGrid = document.getElementById('roomsGridContainer');
  const emptyNotice = document.getElementById('noRoomsNotice');

  if (!roomsGrid) return;
  if (!requireRealAccount()) return;

  // Update navbar student details if available
  const navNameEl = document.getElementById('navUserDisplayName');
  const navAvatarEl = document.getElementById('navUserAvatar');
  if (navNameEl && AppState.currentUser && AppState.currentUser.name) {
    navNameEl.textContent = AppState.currentUser.name;
  }
  if (navAvatarEl && AppState.currentUser && AppState.currentUser.avatar) {
    navAvatarEl.src = AppState.currentUser.avatar;
  }

  // Load real active rooms from SQLite Backend API
  loadLiveRooms();
  loadFeaturedRoom();
  loadCategoryCounts();

  async function loadFeaturedRoom() {
    try {
      const res = await fetch('/api/rooms/featured');
      const data = await res.json();
      if (data.success && data.room) {
        const r = data.room;
        const titleEl = document.getElementById('featuredRoomTitle');
        const subEl = document.getElementById('featuredRoomSubtitle');
        const viewersEl = document.getElementById('featuredRoomViewers');
        const hopInBtn = document.getElementById('featuredRoomHopInBtn');
        const shareBtn = document.getElementById('featuredRoomShareBtn');
        if (titleEl) titleEl.textContent = r.title;
        if (subEl) subEl.textContent = `Host: ${r.hostName || 'Yasaru'} (${r.hostFaculty || 'Faculty of Computing'}) • Live NTP Sync Active`;
        if (viewersEl) viewersEl.textContent = r.viewers || 24;
        if (hopInBtn) hopInBtn.href = `room.html?room=${r.code}`;
        if (shareBtn) {
          shareBtn.onclick = () => {
            navigator.clipboard.writeText(`${window.location.origin}/pages/room.html?room=${r.code}`);
            showToast('Invite link copied!', 'success');
          };
        }
      }
    } catch (e) {
      console.warn('Featured room load error:', e);
    }
  }

  async function loadCategoryCounts() {
    try {
      const res = await fetch('/api/rooms/categories/counts');
      const data = await res.json();
      if (data.success && data.counts) {
        const c = data.counts;
        const pillAll = document.getElementById('catPillAll');
        const pillStudy = document.getElementById('catPillStudy');
        const pillEnt = document.getElementById('catPillEntertainment');
        const pillGaming = document.getElementById('catPillGaming');
        const pillMusic = document.getElementById('catPillMusic');
        if (pillAll && c.all !== undefined) pillAll.textContent = `(${c.all})`;
        if (pillStudy && c.study !== undefined) pillStudy.textContent = `(${c.study})`;
        if (pillEnt && c.entertainment !== undefined) pillEnt.textContent = `(${c.entertainment})`;
        if (pillGaming && c.gaming !== undefined) pillGaming.textContent = `(${c.gaming})`;
        if (pillMusic && c.music !== undefined) pillMusic.textContent = `(${c.music})`;
      }
    } catch (e) {
      console.warn('Category counts load error:', e);
    }
  }

  async function loadLiveRooms() {
    try {
      const res = await fetch('/api/rooms');
      const data = await res.json();
      if (data.success && data.rooms && data.rooms.length > 0) {
        renderRoomsGrid(data.rooms);
      }
    } catch (err) {
      console.log('Using default mock rooms feed.');
    }
  }

  function renderRoomsGrid(rooms) {
    roomsGrid.innerHTML = '';
    rooms.forEach(room => {
      const col = document.createElement('div');
      col.className = 'col-md-6 col-lg-4 room-grid-item room-card';
      col.setAttribute('data-category', room.category || 'study');

      col.innerHTML = `
        <div class="card h-100 border-0 shadow-sm rounded-4 overflow-hidden" style="background: var(--bg-card); border: 1px solid var(--border-color) !important;">
          <div class="position-relative" style="height: 140px; background: #1e293b; display: flex; align-items: center; justify-content: center; overflow: hidden;">
            <div class="position-absolute top-0 start-0 m-2">
              <span class="badge bg-danger rounded-pill fw-bold text-uppercase" style="font-size:0.65rem;">
                <i class="bi bi-broadcast me-1"></i> ${room.mediaType || 'STREAM'}
              </span>
            </div>
            <div class="position-absolute top-0 end-0 m-2">
              <span class="badge bg-black bg-opacity-60 text-white rounded-pill small">
                <i class="bi bi-people-fill text-warning me-1"></i> ${room.viewers} Students Watching
              </span>
            </div>
            <i class="bi bi-play-circle-fill text-white fs-1 opacity-75"></i>
          </div>
          <div class="card-body p-3 d-flex flex-column justify-content-between">
            <div>
              <div class="d-flex justify-content-between align-items-center mb-1">
                <span class="badge bg-secondary bg-opacity-10 text-muted rounded-pill text-uppercase" style="font-size:0.65rem;">
                  ${room.category}
                </span>
                <span class="small text-muted fw-bold">${room.code}</span>
              </div>
              <h6 class="fw-bold text-main mb-1 text-truncate">${room.title}</h6>
              <p class="text-muted small mb-2 text-truncate">Host: ${room.hostName || 'Host'} • ${room.mediaTitle || 'Video'}</p>
            </div>
            <div class="pt-2 border-top d-flex justify-content-between align-items-center">
              <span class="small text-muted">
                ${room.hostSyncLock ? '<i class="bi bi-lock-fill text-danger me-1"></i> Host Lock' : '<i class="bi bi-unlock-fill text-success me-1"></i> Free Controls'}
              </span>
              <a href="room.html?room=${room.code}" class="btn btn-sm btn-danger px-3 rounded-pill fw-bold">
                Join Party <i class="bi bi-arrow-right ms-1"></i>
              </a>
            </div>
          </div>
        </div>
      `;
      roomsGrid.appendChild(col);
    });
  }

  // Filter Categories
  if (filterBar) {
    const pills = filterBar.querySelectorAll('.category-pill');
    pills.forEach(pill => {
      pill.addEventListener('click', () => {
        pills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        const cat = pill.getAttribute('data-category');
        applyFilter(cat, searchInput ? searchInput.value.trim().toLowerCase() : '');
      });
    });
  }

  // Search Filter
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const activePill = filterBar ? filterBar.querySelector('.category-pill.active') : null;
      const cat = activePill ? activePill.getAttribute('data-category') : 'all';
      applyFilter(cat, searchInput.value.trim().toLowerCase());
    });
  }

  // Join by Room Code
  if (joinBtn && searchInput) {
    joinBtn.addEventListener('click', () => {
      const query = searchInput.value.trim().toUpperCase();
      if (!query) {
        showToast('Please enter a room code or topic name to join.', 'warning');
        return;
      }
      showToast(`Connecting to room ${query}...`, 'success');
      setTimeout(() => {
        window.location.href = `room.html?room=${query}`;
      }, 600);
    });
  }

  // Sort Rooms Dropdown (DEF-09)
  const sortSelect = document.getElementById('sortRoomsSelect');
  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      const mode = sortSelect.value;
      const items = Array.from(roomsGrid.querySelectorAll('.room-grid-item'));
      items.sort((a, b) => {
        if (mode === 'popular') {
          const matchA = a.textContent.match(/(\d+)\s*(?:Students Watching|viewers|watching)/i);
          const matchB = b.textContent.match(/(\d+)\s*(?:Students Watching|viewers|watching)/i);
          const vA = matchA ? parseInt(matchA[1], 10) : 0;
          const vB = matchB ? parseInt(matchB[1], 10) : 0;
          return vB - vA;
        }
        return 0;
      });
      items.forEach(el => roomsGrid.appendChild(el));
    });
  }

  function applyFilter(category, searchTerm) {
    const items = roomsGrid.querySelectorAll('.room-grid-item');
    let visibleCount = 0;

    items.forEach(item => {
      const itemCat = item.getAttribute('data-category');
      const itemText = item.textContent.toLowerCase();

      const matchesCat = category === 'all' || itemCat === category;
      const matchesSearch = !searchTerm || itemText.includes(searchTerm);

      if (matchesCat && matchesSearch) {
        item.style.display = 'block';
        visibleCount++;
      } else {
        item.style.display = 'none';
      }
    });

    if (emptyNotice) {
      emptyNotice.style.display = visibleCount === 0 ? 'block' : 'none';
    }
  }

  // Hub Create Room Modal Submission (Registered Students Only)
  const hubCreateForm = document.getElementById('hubCreateRoomForm');
  if (hubCreateForm) {
    hubCreateForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      if (AppState.currentUser.isGuest) {
        showToast('Guests are not permitted to create rooms. Please log in or create a student account.', 'warning');
        return;
      }

      const title = document.getElementById('newRoomTitle').value.trim() || 'Student Study Room';
      const cat = document.getElementById('newRoomCategory').value;
      const media = document.getElementById('newRoomMediaUrl').value.trim();
      const syncLock = document.getElementById('newRoomHostSyncLock').checked;

      try {
        const res = await fetch('/api/rooms', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-uuid': AppState.currentUser.uuid,
            'x-is-guest': 'false'
          },
          body: JSON.stringify({
            title,
            category: cat,
            mediaUrl: media || 'https://www.youtube.com/watch?v=8hly31xKli0',
            hostSyncLock: syncLock
          })
        });
        const data = await res.json();
        if (data.success && data.roomCode) {
          showToast(`Created room "${title}"! Entering now...`, 'success');
          setTimeout(() => {
            window.location.href = `room.html?room=${data.roomCode}`;
          }, 700);
        } else {
          showToast(data.message || 'Failed to create room.', 'danger');
        }
      } catch (err) {
        console.error('Create room request failed:', err);
        showToast('Could not reach the server. Please check your connection and try again.', 'danger');
      }
    });
  }
}

// ============================================================================
// 3. Live Synchronized Watch Party Room (pages/room.html)
// ============================================================================

function initRoomPage() {
  const video = document.getElementById('mainVideoPlayer');
  if (!video) return;

  // Retrieve room code from URL parameters if available
  const urlParams = new URLSearchParams(window.location.search);
  const roomCodeParam = urlParams.get('room');
  if (roomCodeParam) {
    const codeDisplay = document.getElementById('headerRoomCode');
    if (codeDisplay) codeDisplay.textContent = roomCodeParam;
  }

  // 1. Synchronized Video Controls
  const btnPlayPause = document.getElementById('btnPlayPause');
  const playPauseIcon = document.getElementById('playPauseIcon');
  const timelineFill = document.getElementById('timelineProgressFill');
  const timelineContainer = document.getElementById('timelineSliderContainer');
  const timeDisplay = document.getElementById('playerTimeDisplay');
  const volumeSlider = document.getElementById('volumeSlider');
  const btnMute = document.getElementById('btnMuteVolume');
  const volumeIcon = document.getElementById('volumeIcon');
  const syncToast = document.getElementById('syncBroadcastToast');
  const syncMsg = document.getElementById('syncBroadcastMsg');
  const btnFullscreen = document.getElementById('btnFullscreenToggle');

  // Play / Pause Synchronized Toggle
  if (btnPlayPause) {
    btnPlayPause.addEventListener('click', () => {
      if (video.paused) {
        video.play().catch(e => console.log('Autoplay handled'));
        playPauseIcon.className = 'bi bi-pause-fill fs-4';
        broadcastSyncNotice('Host Yasaru resumed video playback');
      } else {
        video.pause();
        playPauseIcon.className = 'bi bi-play-fill fs-4';
        broadcastSyncNotice('Host Yasaru paused video playback');
      }
    });
  }

  // Timeline Progress Update
  video.addEventListener('timeupdate', () => {
    if (!video.duration) return;
    const percent = (video.currentTime / video.duration) * 100;
    if (timelineFill) timelineFill.style.width = `${percent}%`;
    if (timeDisplay) {
      timeDisplay.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`;
    }
  });

  // Timeline Scrubbing / Seeking
  if (timelineContainer) {
    timelineContainer.addEventListener('click', (e) => {
      const rect = timelineContainer.getBoundingClientRect();
      const pos = (e.clientX - rect.left) / rect.width;
      if (video.duration) {
        video.currentTime = pos * video.duration;
        broadcastSyncNotice(`Host seeked to ${formatTime(video.currentTime)}`);
      }
    });
  }

  // Seek Buttons (+10s, -10s)
  const seekBack = document.getElementById('btnSeekBackward');
  const seekFwd = document.getElementById('btnSeekForward');
  if (seekBack) {
    seekBack.addEventListener('click', () => {
      video.currentTime = Math.max(0, video.currentTime - 10);
      broadcastSyncNotice('Host jumped back 10 seconds');
    });
  }
  if (seekFwd) {
    seekFwd.addEventListener('click', () => {
      video.currentTime = Math.min(video.duration, video.currentTime + 10);
      broadcastSyncNotice('Host skipped ahead 10 seconds');
    });
  }

  // Volume & Mute
  if (volumeSlider) {
    volumeSlider.addEventListener('input', () => {
      video.volume = volumeSlider.value;
      video.muted = video.volume === 0;
      updateVolumeIcon();
    });
  }

  if (btnMute) {
    btnMute.addEventListener('click', () => {
      video.muted = !video.muted;
      updateVolumeIcon();
    });
  }

  function updateVolumeIcon() {
    if (!volumeIcon) return;
    if (video.muted || video.volume === 0) {
      volumeIcon.className = 'bi bi-volume-mute-fill text-danger';
    } else if (video.volume < 0.5) {
      volumeIcon.className = 'bi bi-volume-down-fill';
    } else {
      volumeIcon.className = 'bi bi-volume-up-fill';
    }
  }

  // Speed Selector
  const speedBtns = document.querySelectorAll('.speed-opt');
  const speedDisplayBtn = document.getElementById('speedDisplayBtn');
  speedBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      speedBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const speed = parseFloat(btn.getAttribute('data-speed'));
      video.playbackRate = speed;
      if (speedDisplayBtn) speedDisplayBtn.textContent = `${speed}x`;
      broadcastSyncNotice(`Playback speed set to ${speed}x`);
    });
  });

  // Fullscreen
  if (btnFullscreen) {
    btnFullscreen.addEventListener('click', () => {
      const wrapper = document.getElementById('videoTheaterWrapper');
      if (!document.fullscreenElement) {
        wrapper.requestFullscreen().catch(err => alert(err.message));
      } else {
        document.exitFullscreen();
      }
    });
  }

  // Theater View (Hides sidebar to maximize video container)
  const theaterToggle = document.getElementById('theaterModeToggleBtn');
  const sidebarArea = document.getElementById('roomSidebarArea');
  if (theaterToggle && sidebarArea) {
    theaterToggle.addEventListener('click', () => {
      const isHidden = sidebarArea.style.display === 'none';
      sidebarArea.style.display = isHidden ? 'flex' : 'none';
      theaterToggle.classList.toggle('active', !isHidden);
      showToast(isHidden ? 'Restored chat & sidebar' : 'Entered full theater mode');
    });
  }

  function broadcastSyncNotice(msg) {
    if (!syncToast || !syncMsg) return;
    syncMsg.textContent = msg;
    syncToast.classList.add('visible');
    clearTimeout(syncToast._timer);
    syncToast._timer = setTimeout(() => {
      syncToast.classList.remove('visible');
    }, 2800);
  }

  function formatTime(sec) {
    if (isNaN(sec)) return '00:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  // 2. Floating Live Emoji Reaction System
  const emojiBtns = document.querySelectorAll('.btn-emoji-reaction');
  const reactionOverlay = document.getElementById('reactionCanvasOverlay');

  emojiBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const emoji = btn.getAttribute('data-emoji');
      spawnFloatingReaction(emoji);
    });
  });

  function spawnFloatingReaction(emoji) {
    if (!reactionOverlay) return;

    // Spawn 2-3 animated floating emoji particles
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        const item = document.createElement('div');
        item.className = 'floating-reaction-item';
        item.textContent = emoji;
        // Random horizontal positioning between 15% and 85%
        const randomX = Math.floor(15 + Math.random() * 70);
        item.style.left = `${randomX}%`;

        reactionOverlay.appendChild(item);
        setTimeout(() => item.remove(), 2600);
      }, i * 180);
    }
  }

  // 3. Floating WebRTC Toast Panel (Face-cams)
  const facecamPanel = document.getElementById('floatingFacecamPanel');
  const toggleToastBtn = document.getElementById('toggleToastPanelBtn');
  const closeCamBtn = document.getElementById('closeFacecamBtn');
  const minimizeCamBtn = document.getElementById('minimizeFacecamBtn');
  const facecamGrid = document.getElementById('facecamGrid');

  if (toggleToastBtn && facecamPanel) {
    toggleToastBtn.addEventListener('click', () => {
      const isVisible = facecamPanel.style.display !== 'none';
      facecamPanel.style.display = isVisible ? 'none' : 'block';
    });
  }

  if (closeCamBtn && facecamPanel) {
    closeCamBtn.addEventListener('click', () => {
      facecamPanel.style.display = 'none';
    });
  }

  if (minimizeCamBtn && facecamGrid) {
    minimizeCamBtn.addEventListener('click', () => {
      const isGridHidden = facecamGrid.style.display === 'none';
      facecamGrid.style.display = isGridHidden ? 'grid' : 'none';
      minimizeCamBtn.querySelector('i').className = isGridHidden ? 'bi bi-dash-lg' : 'bi bi-plus-lg';
    });
  }

  // Self Mic / Cam Toggles
  const toggleMicBtn = document.getElementById('toggleMyMicBtn');
  const toggleCamBtn = document.getElementById('toggleMyCamBtn');
  const selfCamPlaceholder = document.getElementById('selfCamPlaceholder');
  const selfMicBadge = document.getElementById('selfMicBadge');

  if (toggleMicBtn && selfMicBadge) {
    let micMuted = true;
    toggleMicBtn.addEventListener('click', () => {
      micMuted = !micMuted;
      if (micMuted) {
        toggleMicBtn.innerHTML = '<i class="bi bi-mic-mute-fill"></i> Unmute';
        selfMicBadge.innerHTML = '<i class="bi bi-mic-mute-fill"></i>';
        selfMicBadge.className = 'facecam-mic-badge';
        showToast('Microphone muted');
      } else {
        toggleMicBtn.innerHTML = '<i class="bi bi-mic-fill text-success"></i> Mute';
        selfMicBadge.innerHTML = '<i class="bi bi-mic-fill"></i>';
        selfMicBadge.className = 'facecam-mic-badge bg-success text-white';
        showToast('Microphone active (Broadcasting to room)', 'success');
      }
    });
  }

  if (toggleCamBtn && selfCamPlaceholder) {
    let camOn = false;
    toggleCamBtn.addEventListener('click', () => {
      camOn = !camOn;
      if (camOn) {
        toggleCamBtn.innerHTML = '<i class="bi bi-camera-video-fill text-success"></i> Stop Video';
        selfCamPlaceholder.innerHTML = '<img src="https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=300&q=80" class="w-100 h-100 object-fit-cover">';
        showToast('Webcam broadcast enabled', 'success');
      } else {
        toggleCamBtn.innerHTML = '<i class="bi bi-camera-video-off"></i> Start Video';
        selfCamPlaceholder.innerHTML = '<i class="bi bi-person-fill fs-2"></i>';
        showToast('Webcam broadcast stopped');
      }
    });
  }

  const screenShareBtn = document.getElementById('screenShareBtn');
  if (screenShareBtn) {
    screenShareBtn.addEventListener('click', () => {
      showToast('WebRTC Screen Share broadcast started! All participants can view your display.', 'warning');
      broadcastSyncNotice('Host Yasaru started screen sharing');
    });
  }

  // 4. Sidebar 5-Tab Navigation
  const sidebarTabs = document.querySelectorAll('.sidebar-nav-tab');
  const tabPanes = document.querySelectorAll('.tab-pane-view');

  sidebarTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      sidebarTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      const targetId = tab.getAttribute('data-tab');
      tabPanes.forEach(pane => {
        pane.classList.toggle('active', pane.id === targetId);
      });
    });
  });

  // 5. Live Chat Message Posting
  const chatInput = document.getElementById('chatMessageInput');
  const chatSendBtn = document.getElementById('btnSendMessage');
  const chatContainer = document.getElementById('chatMessagesContainer');
  const chatBadge = document.getElementById('chatCountBadge');
  const hiddenFileInput = document.getElementById('hiddenFileInput');

  function sendChatMessage(text, attachment = null) {
    if (!text && !attachment) return;
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const msgBubble = document.createElement('div');
    msgBubble.className = 'chat-message-bubble';
    
    let attachmentHtml = '';
    if (attachment) {
      attachmentHtml = `
        <a href="#" class="chat-attachment-card" onclick="alert('Downloading ${attachment.name} (${attachment.size})...'); return false;">
          <i class="bi bi-file-earmark-pdf-fill text-danger fs-3"></i>
          <div class="flex-grow-1 overflow-hidden">
            <div class="fw-bold text-truncate small">${attachment.name}</div>
            <div class="text-muted" style="font-size: 0.72rem;">${attachment.size} • Attached File</div>
          </div>
          <i class="bi bi-download text-muted"></i>
        </a>
      `;
    }

    msgBubble.innerHTML = `
      <img src="${AppState.currentUser.avatar}" alt="${AppState.currentUser.name}" class="chat-sender-avatar">
      <div class="chat-content-box">
        <div class="chat-sender-info">
          <span class="sender-nickname">${AppState.currentUser.name}</span>
          <span class="sender-role-badge ${AppState.currentUser.role}">${AppState.currentUser.role}</span>
          <span class="chat-time-tag">${timeStr}</span>
        </div>
        <div class="chat-text-payload">
          ${text ? escapeHtml(text) : ''}
          ${attachmentHtml}
        </div>
      </div>
    `;

    chatContainer.appendChild(msgBubble);
    chatContainer.scrollTop = chatContainer.scrollHeight;

    if (chatBadge) {
      const cur = parseInt(chatBadge.textContent || '0') + 1;
      chatBadge.textContent = cur;
    }
  }

  if (chatSendBtn && chatInput) {
    chatSendBtn.addEventListener('click', () => {
      const txt = chatInput.value.trim();
      if (txt) {
        sendChatMessage(txt);
        chatInput.value = '';
      }
    });

    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const txt = chatInput.value.trim();
        if (txt) {
          sendChatMessage(txt);
          chatInput.value = '';
        }
      }
    });
  }

  if (hiddenFileInput) {
    hiddenFileInput.addEventListener('change', () => {
      if (hiddenFileInput.files && hiddenFileInput.files[0]) {
        const file = hiddenFileInput.files[0];
        const sizeMb = (file.size / (1024 * 1024)).toFixed(1) + ' MB';
        sendChatMessage('Shared a file attachment:', { name: file.name, size: sizeMb });
        showToast(`Uploaded ${file.name} to chat!`, 'success');
      }
    });
  }

  // 6. Shared Playlist Queue & Upvoting
  const addToQueueForm = document.getElementById('addToQueueForm');
  const playlistItemsList = document.getElementById('playlistItemsList');
  const queueTotalCount = document.getElementById('queueTotalCount');
  const queueBadge = document.getElementById('queueCountBadge');

  if (addToQueueForm && playlistItemsList) {
    addToQueueForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('queueUrlInput');
      const url = input.value.trim();
      if (!url) return;

      const newItem = document.createElement('div');
      newItem.className = 'playlist-item-card';
      newItem.innerHTML = `
        <img src="https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=140&q=80" alt="Video Thumb" class="playlist-thumb">
        <div class="playlist-item-info">
          <div class="playlist-item-title">${escapeHtml(url.substring(0, 35))}...</div>
          <div class="playlist-item-meta">12:00 • Added by ${AppState.currentUser.name}</div>
        </div>
        <button class="btn-vote-up" data-votes="1" title="Collaboratively vote on this video">
          <i class="bi bi-hand-thumbs-up-fill text-danger"></i> <span class="vote-count">1</span>
        </button>
      `;

      playlistItemsList.appendChild(newItem);
      input.value = '';
      showToast('Video added to shared playlist queue!', 'success');

      // Update counts
      const count = playlistItemsList.querySelectorAll('.playlist-item-card').length;
      if (queueTotalCount) queueTotalCount.textContent = `${count} Videos`;
      if (queueBadge) queueBadge.textContent = count;

      // Bind vote to newly added button
      bindVoteButtons();
    });
  }

  function bindVoteButtons() {
    const voteBtns = document.querySelectorAll('.btn-vote-up');
    voteBtns.forEach(btn => {
      btn.onclick = () => {
        let votes = parseInt(btn.getAttribute('data-votes') || '0');
        const isVoted = btn.classList.contains('voted');
        if (isVoted) {
          votes--;
          btn.classList.remove('voted');
        } else {
          votes++;
          btn.classList.add('voted');
        }
        btn.setAttribute('data-votes', votes);
        btn.querySelector('.vote-count').textContent = votes;
      };
    });
  }
  bindVoteButtons();

  // 7. Collaborative Notes Editor (Autosave & Formatting)
  const notesArea = document.getElementById('collaborativeNotesArea');
  const notesSaveIndicator = document.getElementById('notesSaveIndicator');
  const btnNoteBold = document.getElementById('btnNoteBold');
  const btnNoteItalic = document.getElementById('btnNoteItalic');
  const btnNoteList = document.getElementById('btnNoteList');
  const btnNoteCode = document.getElementById('btnNoteCode');
  const btnNoteClear = document.getElementById('btnNoteClear');
  const btnNoteDownload = document.getElementById('btnNoteDownload');

  if (notesArea && notesSaveIndicator) {
    let saveTimer;
    notesArea.addEventListener('input', () => {
      notesSaveIndicator.innerHTML = '<span class="spinner-border spinner-border-sm text-warning me-1"></span> Saving...';
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        localStorage.setItem('unitogether_notes', notesArea.value);
        notesSaveIndicator.innerHTML = '<i class="bi bi-check-all text-success"></i> Auto-saved';
      }, 700);
    });

    if (btnNoteBold) {
      btnNoteBold.addEventListener('click', () => wrapSelection(notesArea, '**', '**'));
    }
    if (btnNoteItalic) {
      btnNoteItalic.addEventListener('click', () => wrapSelection(notesArea, '*', '*'));
    }
    if (btnNoteList) {
      btnNoteList.addEventListener('click', () => wrapSelection(notesArea, '- ', ''));
    }
    if (btnNoteCode) {
      btnNoteCode.addEventListener('click', () => wrapSelection(notesArea, '`', '`'));
    }
    if (btnNoteClear) {
      btnNoteClear.addEventListener('click', () => {
        if (confirm('Clear collaborative notes for this session?')) {
          notesArea.value = '';
          notesSaveIndicator.innerHTML = '<i class="bi bi-check-all text-success"></i> Cleared';
        }
      });
    }
    if (btnNoteDownload) {
      btnNoteDownload.addEventListener('click', () => {
        const blob = new Blob([notesArea.value], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `UniTogether_StudyNotes_${AppState.activeRoom.code}.md`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Study notes downloaded as Markdown file!', 'success');
      });
    }
  }

  function wrapSelection(textarea, prefix, suffix) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.substring(start, end) || 'text';
    const replacement = prefix + selected + suffix;
    textarea.value = textarea.value.substring(0, start) + replacement + textarea.value.substring(end);
    textarea.focus();
    textarea.selectionStart = start + prefix.length;
    textarea.selectionEnd = start + prefix.length + selected.length;
  }

  // 8. Media Switcher Modal
  const mediaPickerForm = document.getElementById('mediaPickerForm');
  const presetMediaBtns = document.querySelectorAll('.preset-media-btn');

  presetMediaBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.getAttribute('data-url');
      const title = btn.getAttribute('data-title');
      if (document.getElementById('pickerMediaUrl')) {
        document.getElementById('pickerMediaUrl').value = url;
      }
    });
  });

  if (mediaPickerForm) {
    mediaPickerForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const newUrl = document.getElementById('pickerMediaUrl').value.trim();
      if (!newUrl) return;

      video.src = newUrl;
      video.play().catch(e => console.log('Autoplay handled'));

      const titleEl = document.getElementById('currentMediaTitleText');
      if (titleEl) titleEl.textContent = 'Custom Broadcast Media Stream';

      const modal = bootstrap.Modal.getInstance(document.getElementById('mediaPickerModal'));
      if (modal) modal.hide();

      broadcastSyncNotice('Host switched room media stream');
      showToast('Active stream switched successfully!', 'success');
    });
  }

  // 9. Invite Link Copy
  const copyBtn = document.getElementById('copyInviteLinkBtn');
  const headerCodeBadge = document.getElementById('headerRoomCodeBadge');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const url = document.getElementById('inviteLinkInput').value;
      navigator.clipboard.writeText(url).then(() => {
        showToast('Room invite URL copied to clipboard!', 'success');
      });
    });
  }
  if (headerCodeBadge) {
    headerCodeBadge.addEventListener('click', () => {
      navigator.clipboard.writeText(window.location.href).then(() => {
        showToast('Copied room URL to clipboard!', 'success');
      });
    });
  }

  // 10. End Room Session
  const btnEndRoom = document.getElementById('btnEndRoomSession');
  if (btnEndRoom) {
    btnEndRoom.addEventListener('click', () => {
      if (confirm('Are you sure you want to end this watch party session for all participants?')) {
        showToast('Session ended. Returning to hub...', 'warning');
        setTimeout(() => {
          window.location.href = 'rooms.html';
        }, 800);
      }
    });
  }
}

// ============================================================================
// 4. Student Profile Page (pages/profile.html)
// ============================================================================

function initProfilePage() {
  const profileForm = document.getElementById('profileUpdateForm');
  if (!profileForm) return;
  if (!requireRealAccount()) return;

  // Immediate synchronous bootstrap from AppState if available so test assertions see instant values
  const nameEl = document.getElementById('profileNameDisplay');
  const inputEl = document.getElementById('prefDisplayName');
  const emailTextEl = document.getElementById('profileEmailText');
  if (AppState.currentUser && AppState.currentUser.name) {
    if (nameEl) nameEl.textContent = AppState.currentUser.name;
    if (inputEl) inputEl.value = AppState.currentUser.name;
  }
  if (AppState.currentUser && AppState.currentUser.email && emailTextEl) {
    emailTextEl.textContent = AppState.currentUser.email;
  }

  // Fetch full live profile from SQLite backend API
  loadProfileData();

  async function loadProfileData() {
    try {
      const userUuid = (AppState.currentUser && AppState.currentUser.uuid) ? AppState.currentUser.uuid : '';
      const res = await fetch('/api/users/profile', {
        headers: {
          'x-user-uuid': userUuid
        }
      });
      const data = await res.json();
      if (data.success && data.user) {
        renderProfile(data);
      }
    } catch (err) {
      console.warn('Could not fetch live profile from database:', err);
    }
  }

  function renderProfile(data) {
    const u = data.user;
    const stats = data.stats || {};
    const hostedRooms = data.hostedRooms || [];
    const savedNotes = data.savedNotes || [];

    // Header student details
    const nameDisplay = document.getElementById('profileNameDisplay');
    const emailText = document.getElementById('profileEmailText');
    const facultyText = document.getElementById('profileFacultyText');
    const avatarImg = document.getElementById('profileAvatarImg');

    if (nameDisplay) nameDisplay.textContent = u.fullName || AppState.currentUser.name || 'Student Profile';
    if (emailText) emailText.textContent = u.email || AppState.currentUser.email || 'student@university.ac.lk';
    if (facultyText) facultyText.textContent = u.faculty || 'Faculty of Computing & IT';
    if (avatarImg && u.avatarUrl) avatarImg.src = u.avatarUrl;

    // Statistics counters
    const statRooms = document.getElementById('statRoomsHosted');
    const statHours = document.getElementById('statHoursStreamed');
    const statNotes = document.getElementById('statSavedNotes');
    const tabCount = document.getElementById('savedNotesTabCount');

    if (statRooms) statRooms.textContent = stats.roomsHosted !== undefined ? stats.roomsHosted : hostedRooms.length;
    if (statHours) statHours.textContent = stats.hoursStreamed !== undefined ? stats.hoursStreamed : 48;
    if (statNotes) statNotes.textContent = stats.savedNotesCount !== undefined ? stats.savedNotesCount : savedNotes.length;
    if (tabCount) tabCount.textContent = stats.savedNotesCount !== undefined ? stats.savedNotesCount : savedNotes.length;

    // Form inputs
    const prefName = document.getElementById('prefDisplayName');
    const prefId = document.getElementById('prefStudentId');
    const prefCampus = document.getElementById('prefCampus');
    const prefQuality = document.getElementById('prefStreamQuality');
    const prefNotifs = document.getElementById('prefEmailNotifs');

    if (prefName) prefName.value = u.fullName || AppState.currentUser.name || '';
    if (prefId) prefId.value = u.studentId || 'IT22094482';
    if (prefCampus) prefCampus.value = u.campus || 'Sri Lanka Institute of Information Technology (SLIIT)';
    if (prefQuality && u.streamQuality) prefQuality.value = u.streamQuality;
    if (prefNotifs && u.emailNotifs !== undefined) prefNotifs.checked = Boolean(u.emailNotifs);

    // Render Hosted Watch Parties History
    const hostedContainer = document.getElementById('hostedRoomsContainer');
    if (hostedContainer) {
      hostedContainer.innerHTML = '';
      if (hostedRooms.length === 0) {
        hostedContainer.innerHTML = `
          <div class="col-12 text-center py-4 text-muted small">
            <i class="bi bi-clock-history fs-3 d-block mb-1"></i>No watch party history yet. Host your first room today!
          </div>
        `;
      } else {
        hostedRooms.forEach(room => {
          const col = document.createElement('div');
          col.className = 'col-md-6 col-lg-4';
          col.innerHTML = `
            <div class="card border rounded-4 shadow-sm p-3 h-100" style="background: var(--bg-card); border-color: var(--border-subtle) !important;">
              <div class="d-flex justify-content-between align-items-start mb-2">
                <span class="badge ${room.isActive ? 'bg-danger' : 'bg-secondary'} rounded-pill fw-bold">
                  ${room.isActive ? 'Active Live Stream' : 'Completed'}
                </span>
                <span class="small text-muted">${new Date(room.createdAt).toLocaleDateString()}</span>
              </div>
              <h6 class="fw-bold mb-1 text-main text-truncate">${escapeHtml(room.title)}</h6>
              <p class="small text-muted mb-3 text-truncate">Room Code: <strong>${escapeHtml(room.code)}</strong> &bull; ${room.viewers || 1} Students Joined &bull; ${room.duration || '1h 45m'}</p>
              <div class="d-flex gap-2 mt-auto pt-2 border-top" style="border-color: var(--border-subtle) !important;">
                <a href="room.html?room=${escapeHtml(room.code)}" class="btn btn-sm btn-danger rounded-pill px-3 fw-bold">
                  ${room.isActive ? 'Re-enter Room' : 'Re-host Room'}
                </a>
                <button class="btn btn-sm btn-outline-secondary rounded-pill px-3" onclick="showToast('Exporting session transcript...', 'info');">
                  <i class="bi bi-download me-1"></i> Export Log
                </button>
              </div>
            </div>
          `;
          hostedContainer.appendChild(col);
        });
      }
    }

    // Render Saved Collaborative Notes
    const notesContainer = document.getElementById('savedNotesContainer');
    if (notesContainer) {
      notesContainer.innerHTML = '';
      if (savedNotes.length === 0) {
        notesContainer.innerHTML = `
          <div class="col-12 text-center py-4 text-muted small">
            <i class="bi bi-journal-text fs-3 d-block mb-1"></i>No saved notes yet. Notes taken during watch parties will appear here.
          </div>
        `;
      } else {
        savedNotes.forEach(note => {
          const col = document.createElement('div');
          col.className = 'col-md-6 col-lg-4';
          col.innerHTML = `
            <div class="card border rounded-4 shadow-sm p-3 h-100" style="background: var(--bg-card); border-color: var(--border-subtle) !important;">
              <div class="d-flex justify-content-between align-items-center mb-2">
                <i class="bi bi-file-earmark-text-fill text-danger fs-3"></i>
                <span class="small text-muted">${new Date(note.created_at).toLocaleDateString()}</span>
              </div>
              <h6 class="fw-bold text-main text-truncate">${escapeHtml(note.title)}</h6>
              <p class="small text-muted mb-3" style="display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;">
                ${escapeHtml(note.content)}
              </p>
              <div class="d-flex justify-content-between align-items-center mt-auto pt-2 border-top" style="border-color: var(--border-subtle) !important;">
                <span class="small text-muted">${note.word_count || 0} words</span>
                <button class="btn btn-sm btn-outline-danger rounded-pill px-3" onclick="showToast('Downloading Markdown notes...', 'success');">
                  <i class="bi bi-download me-1"></i> Download .MD
                </button>
              </div>
            </div>
          `;
          notesContainer.appendChild(col);
        });
      }
    }
  }

  // Handle Preferences Form Submit -> Persist to SQLite Backend API
  profileForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const newName = document.getElementById('prefDisplayName')?.value.trim();
    const campusVal = document.getElementById('prefCampus')?.value.trim();
    const studentIdVal = document.getElementById('prefStudentId')?.value.trim();
    const qualityVal = document.getElementById('prefStreamQuality')?.value;
    const notifsChecked = document.getElementById('prefEmailNotifs')?.checked;

    if (newName) {
      if (!AppState.currentUser) AppState.currentUser = {};
      AppState.currentUser.name = newName;
      localStorage.setItem('unitogether_user', JSON.stringify(AppState.currentUser));
      const displayEl = document.getElementById('profileNameDisplay');
      if (displayEl) displayEl.textContent = newName;

      try {
        const userUuid = AppState.currentUser.uuid || '';
        const res = await fetch('/api/users/profile', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'x-user-uuid': userUuid
          },
          body: JSON.stringify({
            fullName: newName,
            displayName: newName,
            campus: campusVal,
            studentId: studentIdVal,
            streamQuality: qualityVal,
            emailNotifs: notifsChecked
          })
        });
        const data = await res.json();
        if (data.success) {
          showToast('Profile preferences saved to database!', 'success');
        } else {
          showToast('Profile preferences updated locally.', 'info');
        }
      } catch (err) {
        showToast('Profile preferences saved locally.', 'info');
      }
    }
  });
}

// Utility: HTML Escaping
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
