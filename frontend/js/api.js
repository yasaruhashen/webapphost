/**
 * UniTogether - Frontend API Client
 * Seamless connection to SQLite Backend & Vercel Serverless API
 */

const ApiClient = (function () {
  // Determine API base URL
  const isLocalFile = window.location.protocol === 'file:';
  const API_BASE = isLocalFile ? 'http://localhost:5000/api' : '/api';

  function getToken() {
    return localStorage.getItem('unitogether_token') || '';
  }

  function getHeaders(includeAuth = true) {
    const headers = {
      'Content-Type': 'application/json'
    };
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    try {
      const raw = localStorage.getItem('unitogether_user');
      if (raw) {
        const u = JSON.parse(raw);
        if (u.uuid) headers['x-user-uuid'] = u.uuid;
        if (u.isGuest !== undefined) headers['x-is-guest'] = String(u.isGuest);
      }
    } catch (e) {}

    return headers;
  }

  async function request(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    try {
      const res = await fetch(url, options);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Request failed with status ${res.status}`);
      }
      return data;
    } catch (err) {
      console.warn(`[ApiClient] Request to ${endpoint} failed:`, err.message);
      throw err;
    }
  }

  return {
    isLocalFile,
    API_BASE,

    // ------------------------------------------------------------------------
    // Authentication
    // ------------------------------------------------------------------------
    async login(email, password) {
      const data = await request('/auth/login', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ email, password })
      });
      if (data.token) {
        localStorage.setItem('unitogether_token', data.token);
      }
      return data;
    },

    async register(name, email, password, faculty) {
      const data = await request('/auth/register', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ name, email, password, faculty })
      });
      if (data.token) {
        localStorage.setItem('unitogether_token', data.token);
      }
      return data;
    },

    async getAuthConfig() {
      return request('/auth/config', {
        method: 'GET',
        headers: getHeaders(false)
      });
    },

    async saveAuthConfig(config) {
      return request('/auth/config', {
        method: 'POST',
        headers: getHeaders(false),
        body: JSON.stringify(config)
      });
    },

    async loginGoogle(payload) {
      const data = await request('/auth/google', {
        method: 'POST',
        headers: getHeaders(false),
        body: JSON.stringify(payload)
      });
      if (data.token) {
        localStorage.setItem('unitogether_token', data.token);
      }
      if (data.user) {
        localStorage.setItem('unitogether_user', JSON.stringify(data.user));
      }
      return data;
    },

    async loginFacebook(payload) {
      const data = await request('/auth/facebook', {
        method: 'POST',
        headers: getHeaders(false),
        body: JSON.stringify(payload)
      });
      if (data.token) {
        localStorage.setItem('unitogether_token', data.token);
      }
      if (data.user) {
        localStorage.setItem('unitogether_user', JSON.stringify(data.user));
      }
      return data;
    },

    async loginOAuth(provider, profileData) {
      const data = await request('/auth/oauth', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ provider, ...profileData })
      });
      if (data.token) {
        localStorage.setItem('unitogether_token', data.token);
      }
      if (data.user) {
        localStorage.setItem('unitogether_user', JSON.stringify(data.user));
      }
      return data;
    },

    async getMe() {
      return request('/auth/me', {
        method: 'GET',
        headers: getHeaders(true)
      });
    },

    async updateProfile(profileData) {
      const data = await request('/auth/profile', {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(profileData)
      });
      if (data && data.user) {
        localStorage.setItem('unitogether_user', JSON.stringify(data.user));
      }
      return data;
    },

    // ------------------------------------------------------------------------
    // Watch Rooms
    // ------------------------------------------------------------------------
    async getRooms(category = '', search = '', hostEmail = '', scope = '') {
      const params = new URLSearchParams();
      if (category && category !== 'All' && category !== 'all' && category !== 'my-rooms') params.append('category', category);
      if (search) params.append('search', search);
      if (hostEmail) params.append('host_email', hostEmail);
      if (scope) params.append('scope', scope);
      const queryStr = params.toString() ? `?${params.toString()}` : '';
      return request(`/rooms${queryStr}`);
    },

    async getRoom(code) {
      return request(`/rooms/${encodeURIComponent(code)}`);
    },

    async createRoom(roomData) {
      let user = null;
      try { user = JSON.parse(localStorage.getItem('unitogether_user')); } catch(e) {}
      if (user && user.email && !roomData.host_email) {
        roomData.host_email = user.email;
      }
      if (user && user.uuid && !roomData.host_uuid) {
        roomData.host_uuid = user.uuid;
      }
      if (user && user.name && (!roomData.host_name || roomData.host_name === 'Yasaru' || roomData.host_name === 'Guest Host')) {
        roomData.host_name = user.name;
      }
      return request('/rooms', {
        method: 'POST',
        headers: getHeaders(true),
        body: JSON.stringify(roomData)
      });
    },

    async updateRoom(code, roomData) {
      let user = null;
      try { user = JSON.parse(localStorage.getItem('unitogether_user')); } catch(e) {}
      if (user && user.email) roomData.host_email = user.email;
      return request(`/rooms/${encodeURIComponent(code)}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(roomData)
      });
    },

    async deleteRoom(code) {
      let user = null;
      try { user = JSON.parse(localStorage.getItem('unitogether_user')); } catch(e) {}
      const hostEmail = (user && user.email) ? user.email : '';
      return request(`/rooms/${encodeURIComponent(code)}?host_email=${encodeURIComponent(hostEmail)}`, {
        method: 'DELETE',
        headers: getHeaders()
      });
    },

    async syncRoom(code, syncData) {
      return request(`/rooms/${encodeURIComponent(code)}/sync`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(syncData)
      });
    },

    // ------------------------------------------------------------------------
    // Playlist Queue
    // ------------------------------------------------------------------------
    async getQueue(code) {
      return request(`/rooms/${encodeURIComponent(code)}/queue`);
    },

    async addQueueItem(code, itemData) {
      return request(`/rooms/${encodeURIComponent(code)}/queue`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(itemData)
      });
    },

    async deleteQueueItem(code, itemId) {
      return request(`/rooms/${encodeURIComponent(code)}/queue/${itemId}`, {
        method: 'DELETE',
        headers: getHeaders()
      });
    },

    // ------------------------------------------------------------------------
    // Chat Messages
    // ------------------------------------------------------------------------
    async getMessages(code) {
      return request(`/rooms/${encodeURIComponent(code)}/messages`);
    },

    async sendMessage(code, messageData) {
      return request(`/rooms/${encodeURIComponent(code)}/messages`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(messageData)
      });
    }
  };
})();

// Attach to window
window.ApiClient = ApiClient;

