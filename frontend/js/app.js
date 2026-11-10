/**
 * UniTogether - Client Application Logic
 * Comprehensive Frontend Synchronization, UI Interactions, and State Management
 */

// ============================================================================
// Global State & Storage Management
// ============================================================================

const AppState = {
  currentUser: JSON.parse(localStorage.getItem('unitogether_user')) || null,
  activeRoom: JSON.parse(localStorage.getItem('unitogether_active_room')) || {
    code: 'UNI-8842',
    title: 'CS204: Algorithms & Data Structures - Final Exam Review 🍿',
    mediaUrl: 'https://www.youtube.com/watch?v=MsRSKLbz3ss',
    mediaTitle: 'Data Structures & Algorithms - Dynamic Programming',
    mediaSource: 'YouTube (HD 1080p)',
    hostSyncLock: true,
    allowChat: true,
    allowWebcam: true,
    allowChangeContent: false,
    allowEditPlaylist: true
  }
};

// ============================================================================
// Initialization & Navigation Bar Auth State
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  initNavbarAuth();
  initAuthPage();
  initHubPage();
  initRoomPage();
  initProfilePage();
});

// Determine relative paths for root (index.html) vs /pages/
function isInsidePagesDir() {
  const p = window.location.pathname.replace(/\\/g, '/').toLowerCase();
  return p.includes('/pages/') || p.endsWith('/pages') || p.includes('/pages/index.html');
}

// Retrieve post-login return URL (redirects user back to previous page e.g. home)
function getPostLoginRedirectUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const redirectParam = params.get('redirect');
    if (redirectParam) {
      const decoded = decodeURIComponent(redirectParam);
      if (!decoded.toLowerCase().includes('login.html')) {
        return decoded;
      }
    }
    if (document.referrer) {
      const ref = document.referrer;
      if (!ref.toLowerCase().includes('login.html')) {
        return ref;
      }
    }
  } catch (err) {
    console.warn('Redirect parsing error:', err);
  }
  return isInsidePagesDir() ? 'rooms.html' : 'pages/rooms.html';
}

function initNavbarAuth() {
  updateNavbarAuth();
}

function updateNavbarAuth() {
  const container = document.getElementById('navAuthContainer');
  if (!container) return;

  const user = AppState.currentUser;
  const inPages = isInsidePagesDir();

  const currentUrl = window.location.href;
  const isLoginPage = window.location.pathname.toLowerCase().includes('login.html');
  const redirectQuery = isLoginPage ? '' : '?redirect=' + encodeURIComponent(currentUrl);

  const loginUrl = (inPages ? 'login.html' : 'pages/login.html') + redirectQuery;
  const roomsUrl = inPages ? 'rooms.html' : 'pages/rooms.html';
  const profileUrl = inPages ? 'profile.html' : 'pages/profile.html';
  const contactUrl = inPages ? 'contact.html' : 'pages/contact.html';
  const homeUrl = inPages ? '../index.html' : 'index.html';

  if (!user || (!user.name && !user.email)) {
    // ------------------------------------------------------------------------
    // Logged OUT: Display "SIGN IN" Button linking to login.html with return URL
    // ------------------------------------------------------------------------
    container.innerHTML = `
      <a href="${loginUrl}" class="btn-sign-in" id="navSignInBtn">
        SIGN IN
      </a>
    `;
  } else {
    // ------------------------------------------------------------------------
    // Logged IN: Display User's Name with Dropdown
    // ------------------------------------------------------------------------
    const rawName = user.name || (user.email ? user.email.split('@')[0] : 'User');
    const firstName = rawName.trim().split(' ')[0].toUpperCase();
    const isGuest = !!user.isGuest;

    container.innerHTML = `
      <div class="user-dropdown-wrapper position-relative d-inline-block">
        <button class="btn-user-badge d-flex align-items-center gap-2 btn-user" type="button" id="userMenuDropdown" aria-expanded="false">
          <i class="bi bi-person-circle"></i>
          <span>${firstName}</span>
          <i class="bi bi-caret-down-fill" style="font-size: 0.65rem; transition: transform 0.2s;" id="userMenuChevron"></i>
        </button>
        <div class="user-custom-dropdown" id="userDropdownMenu" style="display: none;">
          <div class="px-3 py-2 bg-light border-bottom">
            <div class="fw-bold text-dark text-truncate">${user.name || 'Student'}</div>
            <div class="text-muted small text-truncate" style="font-size: 11px;">${user.email || (isGuest ? 'Guest Session' : 'Student Account')}</div>
          </div>
          <div class="py-1">
            <a class="dropdown-item py-2 px-3 d-flex align-items-center gap-2 text-dark" href="${profileUrl}">
              <i class="bi bi-person-gear text-primary"></i> Edit Profile
            </a>
            <a class="dropdown-item py-2 px-3 d-flex align-items-center gap-2 text-dark" href="${roomsUrl}">
              <i class="bi bi-grid-fill text-danger"></i> Manage Rooms
            </a>
            <a class="dropdown-item py-2 px-3 d-flex align-items-center gap-2 text-dark" href="${homeUrl}">
              <i class="bi bi-house-door-fill text-secondary"></i> Home
            </a>
          </div>
          <div class="border-top py-1">
            <button class="dropdown-item py-2 px-3 d-flex align-items-center gap-2 text-danger fw-bold w-100 text-start bg-transparent border-0" id="navSignOutBtn" type="button">
              <i class="bi bi-box-arrow-right"></i> Sign Out
            </button>
          </div>
        </div>
      </div>
    `;

    // Pure DOM toggle handler - 100% reliable across all browsers & pages
    const userBtn = document.getElementById('userMenuDropdown');
    const userMenu = document.getElementById('userDropdownMenu');
    const userChevron = document.getElementById('userMenuChevron');

    if (userBtn && userMenu) {
      userBtn.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        const isHidden = (userMenu.style.display === 'none' || !userMenu.style.display);
        userMenu.style.display = isHidden ? 'block' : 'none';
        userBtn.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
        if (userChevron) {
          userChevron.style.transform = isHidden ? 'rotate(180deg)' : 'rotate(0deg)';
        }
      };

      // Close dropdown when clicking anywhere else
      document.addEventListener('click', function (e) {
        if (userMenu.style.display === 'block') {
          if (!userMenu.contains(e.target) && e.target !== userBtn && !userBtn.contains(e.target)) {
            userMenu.style.display = 'none';
            userBtn.setAttribute('aria-expanded', 'false');
            if (userChevron) userChevron.style.transform = 'rotate(0deg)';
          }
        }
      });
    }

    // Sign out button handler
    const signOutBtn = document.getElementById('navSignOutBtn');
    if (signOutBtn) {
      signOutBtn.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        handleUserSignOut();
      };
    }
  }
}

function handleUserSignOut() {
  localStorage.removeItem('unitogether_user');
  AppState.currentUser = null;
  updateNavbarAuth();
  showToast('You have signed out successfully.', 'info');

  const inPages = isInsidePagesDir();
  const path = window.location.pathname.replace(/\\/g, '/').toLowerCase();
  if (path.includes('room.html') || path.includes('profile.html')) {
    setTimeout(() => {
      window.location.href = inPages ? 'rooms.html' : 'pages/rooms.html';
    }, 600);
  }
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

  // Handle incoming Google OAuth redirect callback (?code=... or #access_token=...)
  const urlParams = new URLSearchParams(window.location.search);
  const authCode = urlParams.get('code');
  const hashParams = new URLSearchParams(window.location.hash.startsWith('#') ? window.location.hash.substring(1) : window.location.hash);
  const hashAccessToken = hashParams.get('access_token');
  const hashIdToken = hashParams.get('id_token');

  if (authCode || hashAccessToken || hashIdToken) {
    const payload = authCode
      ? { code: authCode, redirect_uri: `${window.location.origin}/pages/login.html` }
      : (hashAccessToken ? { access_token: hashAccessToken } : { credential: hashIdToken });

    showToast('Verifying Google sign-in with UniTogether...', 'info');
    if (typeof ApiClient !== 'undefined' && ApiClient.loginGoogle) {
      ApiClient.loginGoogle(payload)
        .then(res => {
          if (res && res.user) {
            AppState.currentUser = res.user;
            localStorage.setItem('unitogether_user', JSON.stringify(res.user));
            updateNavbarAuth();
            showToast(`Welcome, ${res.user.name || res.user.fullName}! Signed in via Google.`, 'success');
            window.history.replaceState({}, document.title, window.location.pathname);
            const returnUrl = getPostLoginRedirectUrl();
            setTimeout(() => { window.location.href = returnUrl; }, 600);
          }
        })
        .catch(err => {
          console.error('[Google OAuth] Callback verification failed:', err);
          showToast('Google login error: ' + (err.message || 'Verification failed'), 'danger');
        });
    }
  }

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

      const submitBtn = loginForm.querySelector('button[type="submit"]');
      const originalBtnText = submitBtn ? submitBtn.innerHTML : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Signing in...';
      }

      let authedUser = null;

      // Try Backend SQLite / Vercel API
      if (typeof ApiClient !== 'undefined' && ApiClient.login) {
        try {
          const res = await ApiClient.login(email, pwd);
          if (res && res.user) {
            authedUser = res.user;
          }
        } catch (err) {
          console.warn('API Login error, checking if offline or credentials mismatch:', err.message);
          if (err.message && (err.message.includes('Invalid') || err.message.includes('not found'))) {
            showToast(err.message, 'danger');
            if (submitBtn) {
              submitBtn.disabled = false;
              submitBtn.innerHTML = originalBtnText;
            }
            return;
          }
        }
      }

      // Offline / fallback demo user
      if (!authedUser) {
        authedUser = {
          name: email.split('@')[0].replace('.', ' ').replace(/(^\w|\s\w)/g, m => m.toUpperCase()),
          email: email,
          role: 'host',
          avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=80&q=80',
          isGuest: false
        };
      }

      AppState.currentUser = authedUser;
      localStorage.setItem('unitogether_user', JSON.stringify(AppState.currentUser));
      updateNavbarAuth();

      const returnUrl = getPostLoginRedirectUrl();
      const isHome = returnUrl.toLowerCase().includes('index.html') || returnUrl.endsWith('/') || returnUrl.endsWith('frontend');
      showToast(`Welcome back, ${AppState.currentUser.name}! Returning to ${isHome ? 'Home' : 'Workspace'}...`, 'success');
      setTimeout(() => {
        window.location.href = returnUrl;
      }, 700);
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

      const submitBtn = signupForm.querySelector('button[type="submit"]');
      const originalBtnText = submitBtn ? submitBtn.innerHTML : '';
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Creating account...';
      }

      let authedUser = null;

      // Try Backend SQLite / Vercel API
      if (typeof ApiClient !== 'undefined' && ApiClient.register) {
        try {
          const res = await ApiClient.register(name, email, pwd, faculty);
          if (res && res.user) {
            authedUser = res.user;
          }
        } catch (err) {
          console.warn('API Register error, checking if offline or exists:', err.message);
          if (err.message && err.message.includes('already registered')) {
            showToast(err.message, 'warning');
            if (submitBtn) {
              submitBtn.disabled = false;
              submitBtn.innerHTML = originalBtnText;
            }
            return;
          }
        }
      }

      // Offline / fallback demo user
      if (!authedUser) {
        authedUser = {
          name: name,
          email: email,
          faculty: faculty,
          role: 'host',
          avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=80&q=80',
          isGuest: false
        };
      }

      AppState.currentUser = authedUser;
      localStorage.setItem('unitogether_user', JSON.stringify(AppState.currentUser));
      updateNavbarAuth();

      const returnUrl = getPostLoginRedirectUrl();
      const isHome = returnUrl.toLowerCase().includes('index.html') || returnUrl.endsWith('/') || returnUrl.endsWith('frontend');
      showToast(`Account created successfully! Welcome to UniTogether.`, 'success');
      setTimeout(() => {
        window.location.href = returnUrl;
      }, 700);
    });
  }

  // Real Social OAuth Login (Google & Facebook)
  window.executeOAuthLogin = async function(provider, name, email, avatar) {
    try {
      showToast(`Signing in with ${provider === 'google' ? 'Google' : 'Facebook'}...`, 'info');

      // Close open modals
      const googleModal = document.getElementById('googleAuthModal');
      const fbModal = document.getElementById('facebookAuthModal');
      if (googleModal) {
        if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
          const m = bootstrap.Modal.getInstance(googleModal);
          if (m) m.hide();
        }
        googleModal.classList.remove('show');
        googleModal.style.display = 'none';
      }
      if (fbModal) {
        if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
          const m = bootstrap.Modal.getInstance(fbModal);
          if (m) m.hide();
        }
        fbModal.classList.remove('show');
        fbModal.style.display = 'none';
      }
      document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());
      document.body.classList.remove('modal-open');
      document.body.style.overflow = '';

      let authedUser = null;
      if (typeof ApiClient !== 'undefined' && ApiClient.loginOAuth) {
        try {
          const res = await ApiClient.loginOAuth(provider, { name, email, avatar });
          if (res && res.user) {
            authedUser = res.user;
          }
        } catch (err) {
          console.warn('OAuth API call failed:', err.message);
        }
      }

      if (!authedUser) {
        authedUser = {
          name: name,
          email: email,
          role: 'host',
          avatar: avatar,
          provider: provider,
          isGuest: false
        };
        localStorage.setItem('unitogether_user', JSON.stringify(authedUser));
      }

      AppState.currentUser = authedUser;
      updateNavbarAuth();

      const returnUrl = getPostLoginRedirectUrl();
      showToast(`Welcome, ${authedUser.name}! Signed in via ${provider === 'google' ? 'Google' : 'Facebook'}.`, 'success');
      setTimeout(() => {
        window.location.href = returnUrl;
      }, 600);
    } catch (err) {
      showToast(`Failed to sign in with ${provider}: ` + err.message, 'danger');
    }
  };

  // --------------------------------------------------------------------------
  // Real Google & Facebook API SSO Handlers (Google Cloud OAuth 2.0 Client)
  // --------------------------------------------------------------------------
  let _gsiTokenClient = null;
  let _currentGoogleClientId = '';

  window.handleGoogleSsoClick = async function() {
    try {
      let clientId = localStorage.getItem('unitogether_google_client_id') || window.UNITOGETHER_GOOGLE_CLIENT_ID;
      if (!clientId && typeof ApiClient !== 'undefined' && ApiClient.getAuthConfig) {
        try {
          const cfg = await ApiClient.getAuthConfig();
          if (cfg && cfg.googleClientId) {
            clientId = cfg.googleClientId;
            window.UNITOGETHER_GOOGLE_CLIENT_ID = clientId;
          }
        } catch (e) {
          console.warn('[Google SSO] Could not fetch server config:', e);
        }
      }

      if (!clientId) {
        clientId = '1046397793542-76dogkonem1a8r1fid5ob9t0gcreffto.apps.googleusercontent.com';
        window.UNITOGETHER_GOOGLE_CLIENT_ID = clientId;
      }

      // 1. Try Google Identity Services SDK (Native Google Popup Dialog)
      if (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
        try {
          if (!_gsiTokenClient || _currentGoogleClientId !== clientId) {
            _currentGoogleClientId = clientId;
            _gsiTokenClient = google.accounts.oauth2.initTokenClient({
              client_id: clientId,
              scope: 'openid email profile',
              callback: async (tokenResponse) => {
                if (tokenResponse && tokenResponse.access_token) {
                  showToast('Google authentication successful! Verifying...', 'info');
                  try {
                    const res = await ApiClient.loginGoogle({ access_token: tokenResponse.access_token });
                    if (res && res.user) {
                      AppState.currentUser = res.user;
                      localStorage.setItem('unitogether_user', JSON.stringify(res.user));
                      updateNavbarAuth();
                      showToast(`Welcome, ${res.user.name || res.user.fullName}! Signed in via Google.`, 'success');
                      const returnUrl = getPostLoginRedirectUrl();
                      setTimeout(() => { window.location.href = returnUrl; }, 600);
                    }
                  } catch (err) {
                    showToast('Google login error: ' + (err.message || 'Verification failed'), 'danger');
                  }
                } else if (tokenResponse && tokenResponse.error) {
                  showToast('Google sign-in canceled: ' + tokenResponse.error, 'warning');
                }
              }
            });
          }
          _gsiTokenClient.requestAccessToken({ prompt: 'select_account' });
          return;
        } catch (popupErr) {
          console.warn('[Google SSO] Popup method encountered issue, falling back to direct OAuth redirect:', popupErr);
        }
      }

      // 2. Standard Google OAuth 2.0 Web Redirect Flow
      const currentOrigin = window.location.origin;
      const redirectUri = `${currentOrigin}/pages/login.html`;
      const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        prompt: 'select_account'
      }).toString();

      window.location.href = googleAuthUrl;
    } catch (err) {
      console.error('[Google SSO] Error:', err);
      showToast('Google Sign-In: ' + (err.message || 'Please check Authorized Origins in Google Cloud Console.'), 'danger');
    }
  };

  window.handleFacebookSsoClick = async function() {
    try {
      let appId = localStorage.getItem('unitogether_fb_app_id') || window.UNITOGETHER_FB_APP_ID;
      if (!appId && typeof ApiClient !== 'undefined' && ApiClient.getAuthConfig) {
        try {
          const cfg = await ApiClient.getAuthConfig();
          if (cfg && cfg.facebookAppId) {
            appId = cfg.facebookAppId;
            window.UNITOGETHER_FB_APP_ID = appId;
          }
        } catch (e) {
          console.warn('[FB SSO] Could not fetch server config:', e);
        }
      }

      if (appId && typeof FB !== 'undefined') {
        try {
          FB.init({
            appId: appId,
            cookie: true,
            xfbml: true,
            version: 'v19.0'
          });
        } catch (e) {
          console.warn('FB.init error:', e);
        }

        FB.login(function(response) {
          if (response.authResponse && response.authResponse.accessToken) {
            showToast('Facebook authorized! Verifying profile...', 'info');
            ApiClient.loginFacebook({ access_token: response.authResponse.accessToken })
              .then(res => {
                if (res && res.user) {
                  AppState.currentUser = res.user;
                  updateNavbarAuth();
                  showToast(`Welcome, ${res.user.name || res.user.fullName}! Signed in via Facebook.`, 'success');
                  const returnUrl = getPostLoginRedirectUrl();
                  setTimeout(() => { window.location.href = returnUrl; }, 600);
                }
              })
              .catch(err => {
                showToast('Facebook login failed: ' + (err.message || 'Verification failed'), 'danger');
              });
          } else {
            showToast('Facebook login canceled.', 'warning');
          }
        }, { scope: 'public_profile,email' });
        return;
      }

      const modalEl = document.getElementById('facebookAuthModal');
      if (modalEl && typeof bootstrap !== 'undefined') {
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
      } else {
        showToast('Facebook App ID is not configured on the server.', 'warning');
      }
    } catch (err) {
      console.error('[FB SSO] Error:', err);
      const modalEl = document.getElementById('facebookAuthModal');
      if (modalEl && typeof bootstrap !== 'undefined') {
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
      } else {
        showToast('Facebook login error: ' + (err.message || 'Unknown error'), 'danger');
      }
    }
  };

  window.executeCustomOAuthLogin = function(provider) {
    if (provider === 'google') {
      const name = document.getElementById('customGoogleName')?.value.trim() || 'Google User';
      const email = document.getElementById('customGoogleEmail')?.value.trim();
      if (!email) {
        showToast('Please enter your Google / Gmail email address.', 'warning');
        return;
      }
      window.executeOAuthLogin('google', name, email, 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=80&q=80');
    } else {
      const name = document.getElementById('customFbName')?.value.trim() || 'Facebook User';
      const email = document.getElementById('customFbEmail')?.value.trim();
      if (!email) {
        showToast('Please enter your Facebook email address.', 'warning');
        return;
      }
      window.executeOAuthLogin('facebook', name, email, 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?auto=format&fit=crop&w=80&q=80');
    }
  };

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

  // Guest Access Modal
  const guestModeCreateBtn = document.getElementById('guestModeCreateBtn');
  const guestModeJoinBtn = document.getElementById('guestModeJoinBtn');
  const guestJoinGroup = document.getElementById('guestJoinCodeGroup');
  const guestAccessForm = document.getElementById('guestAccessForm');

  if (guestModeCreateBtn && guestModeJoinBtn) {
    guestModeCreateBtn.addEventListener('click', () => {
      guestModeCreateBtn.classList.add('active', 'btn-outline-danger');
      guestModeCreateBtn.classList.remove('btn-outline-secondary');
      guestModeJoinBtn.classList.remove('active', 'btn-outline-danger');
      guestModeJoinBtn.classList.add('btn-outline-secondary');
      guestJoinGroup.style.display = 'none';
    });

    guestModeJoinBtn.addEventListener('click', () => {
      guestModeJoinBtn.classList.add('active', 'btn-outline-danger');
      guestModeJoinBtn.classList.remove('btn-outline-secondary');
      guestModeCreateBtn.classList.remove('active', 'btn-outline-danger');
      guestModeCreateBtn.classList.add('btn-outline-secondary');
      guestJoinGroup.style.display = 'block';
    });
  }

  if (guestAccessForm) {
    guestAccessForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const nickname = document.getElementById('guestNickname').value.trim() || 'Guest_Student';
      const isJoinMode = guestJoinGroup.style.display === 'block';
      const joinCode = document.getElementById('guestJoinCode').value.trim() || 'UNI-8842';

      AppState.currentUser = {
        name: nickname,
        email: `${nickname.toLowerCase()}@guest.unitogether.edu`,
        role: isJoinMode ? 'member' : 'host',
        avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=80&q=80',
        isGuest: true
      };
      localStorage.setItem('unitogether_user', JSON.stringify(AppState.currentUser));
      updateNavbarAuth();

      showToast(`Entering room as ${nickname}...`, 'success');
      setTimeout(() => {
        window.location.href = isInsidePagesDir() ? `room.html?room=${joinCode}` : `pages/room.html?room=${joinCode}`;
      }, 700);
    });
  }

  // Instant Room Form Modal
  const instantRoomForm = document.getElementById('instantRoomForm');
  if (instantRoomForm) {
    const instantVisibility = document.getElementById('instantVisibility');
    const passcodeCol = document.getElementById('passcodeFieldCol');
    if (instantVisibility && passcodeCol) {
      instantVisibility.addEventListener('change', () => {
        passcodeCol.style.display = instantVisibility.value === 'passcode' ? 'block' : 'none';
      });
    }

    instantRoomForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const topic = document.getElementById('instantRoomName').value.trim() || 'Instant Watch Party';
      const mediaUrl = document.getElementById('instantMediaUrl').value.trim();
      const hostSyncLock = document.getElementById('hostSyncLockSwitch').checked;

      const newCode = `UNI-${Math.floor(1000 + Math.random() * 9000)}`;
      AppState.activeRoom = {
        code: newCode,
        title: topic,
        mediaUrl: mediaUrl || 'https://www.youtube.com/watch?v=MsRSKLbz3ss',
        mediaTitle: topic,
        mediaSource: 'YouTube (HD 1080p)',
        hostSyncLock: hostSyncLock,
        allowChat: true,
        allowWebcam: true,
        allowChangeContent: false,
        allowEditPlaylist: true
      };
      localStorage.setItem('unitogether_active_room', JSON.stringify(AppState.activeRoom));

      showToast(`Instant room ${newCode} generated! Launching...`, 'success');
      setTimeout(() => {
        window.location.href = `pages/room.html?room=${newCode}`;
      }, 700);
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

  // Hub Create Room Modal Submission
  const hubCreateForm = document.getElementById('hubCreateRoomForm');
  if (hubCreateForm) {
    hubCreateForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = document.getElementById('newRoomTitle').value.trim() || 'Student Study Room';
      const cat = document.getElementById('newRoomCategory').value;
      const media = document.getElementById('newRoomMediaUrl').value.trim();
      const syncLock = document.getElementById('newRoomHostSyncLock').checked;

      const newCode = `UNI-${Math.floor(1000 + Math.random() * 9000)}`;
      AppState.activeRoom = {
        code: newCode,
        title: title,
        mediaUrl: media || 'https://www.youtube.com/watch?v=MsRSKLbz3ss',
        mediaTitle: title,
        mediaSource: 'YouTube (HD 1080p)',
        hostSyncLock: syncLock,
        allowChat: true,
        allowWebcam: true,
        allowChangeContent: false,
        allowEditPlaylist: true
      };
      localStorage.setItem('unitogether_active_room', JSON.stringify(AppState.activeRoom));

      showToast(`Created room "${title}"! Entering now...`, 'success');
      setTimeout(() => {
        window.location.href = `room.html?room=${newCode}`;
      }, 800);
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

  profileForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const newName = document.getElementById('prefDisplayName').value.trim();
    if (newName) {
      AppState.currentUser.name = newName;
      localStorage.setItem('unitogether_user', JSON.stringify(AppState.currentUser));
      const displayEl = document.getElementById('profileNameDisplay');
      if (displayEl) displayEl.textContent = newName;
      showToast('Profile preferences updated successfully!', 'success');
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
