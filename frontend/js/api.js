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

  function getHeaders(includeAuth = false) {
    const headers = {
      'Content-Type': 'application/json'
    };
    if (includeAuth) {
      const token = getToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }
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

    // ------------------------------------------------------------------------
    // Watch Rooms
    // ------------------------------------------------------------------------
    async getRooms(category = '', search = '') {
      const params = new URLSearchParams();
      if (category && category !== 'All') params.append('category', category);
      if (search) params.append('search', search);
      const queryStr = params.toString() ? `?${params.toString()}` : '';
      return request(`/rooms${queryStr}`);
    },

    async getRoom(code) {
      return request(`/rooms/${encodeURIComponent(code)}`);
    },

    async createRoom(roomData) {
      return request('/rooms', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(roomData)
      });
    },

    async updateRoom(code, roomData) {
      return request(`/rooms/${encodeURIComponent(code)}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(roomData)
      });
    },

    async deleteRoom(code) {
      return request(`/rooms/${encodeURIComponent(code)}`, {
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

