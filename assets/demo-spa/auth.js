import { CONFIG } from './config.js';

const STORAGE_KEY = 'ta_session';

/* ─── helpers ─── */

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomBytes(n) {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return b64url(buf);
}

async function pkceChallenge(verifier) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(hash));
}

function b64decode(str) {
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function parseJwtPayload(token) {
  const payload = token.split('.')[1];
  return JSON.parse(b64decode(payload));
}

function clearAuthTemp() {
  sessionStorage.removeItem('pkce_verifier');
  sessionStorage.removeItem('oauth_state');
  sessionStorage.removeItem('oauth_nonce');
}

/* ─── auth module ─── */

export const auth = {
  /** Redirect the user to the authorization server. */
  async signIn() {
    clearAuthTemp(); // defensive: remove any stale values

    const verifier = randomBytes(64); // 86 chars, 512-bit entropy
    const state    = randomBytes(16);
    const nonce    = randomBytes(32);

    sessionStorage.setItem('pkce_verifier', verifier);
    sessionStorage.setItem('oauth_state', state);
    sessionStorage.setItem('oauth_nonce', nonce);

    try {
      const challenge = await pkceChallenge(verifier);
      const params = new URLSearchParams({
        client_id:             CONFIG.clientId,
        redirect_uri:          CONFIG.redirectUri,
        response_type:         'code',
        scope:                 CONFIG.scopes,
        code_challenge:        challenge,
        code_challenge_method: 'S256',
        state,
        nonce,
        resource:              CONFIG.apiResource,
      });
      const authUrl = `${CONFIG.openPlatformEndpoint}/oidc/auth?${params}`;
      console.debug('[auth] authorization URL:', authUrl);
      window.location.href = authUrl;
    } catch (err) {
      clearAuthTemp();
      throw err;
    }
  },

  /** Exchange the authorization code for tokens after redirect back. */
  async handleCallback(url) {
    const u     = new URL(url);
    const code  = u.searchParams.get('code');
    const state = u.searchParams.get('state');
    const error = u.searchParams.get('error');

    if (error) {
      clearAuthTemp();
      throw new Error(`OAuth error: ${error}`);
    }
    if (!code) {
      clearAuthTemp();
      throw new Error('Missing authorization code');
    }
    if (state !== sessionStorage.getItem('oauth_state')) {
      clearAuthTemp();
      throw new Error('Invalid state parameter');
    }

    try {
      const res = await fetch(`${CONFIG.openPlatformEndpoint}/oidc/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type:    'authorization_code',
          client_id:     CONFIG.clientId,
          redirect_uri:  CONFIG.redirectUri,
          code,
          code_verifier: sessionStorage.getItem('pkce_verifier'),
          resource:      CONFIG.apiResource,
        }),
      });

      if (!res.ok) {
        throw new Error(`Token exchange failed: ${await res.text()}`);
      }

      const data = await res.json();

      // Validate nonce in id_token
      if (data.id_token) {
        const payload = parseJwtPayload(data.id_token);
        const expectedNonce = sessionStorage.getItem('oauth_nonce');
        if (payload.nonce !== expectedNonce) {
          throw new Error('Invalid nonce in id_token');
        }
      }

      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        accessToken:  data.access_token,
        refreshToken: data.refresh_token,
        idToken:      data.id_token,
        expiresAt:    Date.now() + (data.expires_in * 1000),
      }));
    } finally {
      clearAuthTemp();
    }
  },

  /** Refresh the access token using the stored refresh token. */
  async refreshAccessToken() {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error('Not authenticated');

    const session = JSON.parse(raw);
    if (!session.refreshToken) {
      this.signOutLocal();
      throw new Error('No refresh token available');
    }

    const res = await fetch(`${CONFIG.openPlatformEndpoint}/oidc/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'refresh_token',
        refresh_token: session.refreshToken,
        client_id:     CONFIG.clientId,
        resource:      CONFIG.apiResource,
      }),
    });

    if (!res.ok) {
      this.signOutLocal();
      throw new Error(`Token refresh failed: ${await res.text()}`);
    }

    const data = await res.json();
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      accessToken:  data.access_token,
      refreshToken: data.refresh_token ?? session.refreshToken,
      idToken:      data.id_token ?? session.idToken,
      expiresAt:    Date.now() + (data.expires_in * 1000),
    }));
  },

  /** Is there a valid, non-expired session? */
  async isAuthenticated() {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    try {
      const session = JSON.parse(raw);
      return !!session.accessToken && session.expiresAt > Date.now();
    } catch {
      return false;
    }
  },

  /** Return the current access token, refreshing if it expires within 60 s. */
  async getAccessToken() {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error('Not authenticated');

    const session = JSON.parse(raw);

    // Refresh if expired or within 60 s of expiry (clock-skew buffer)
    if (session.expiresAt - Date.now() < 60000) {
      await this.refreshAccessToken();
      return this.getAccessToken(); // re-read after refresh
    }
    return session.accessToken;
  },

  /** Clear the local session only (no server sign-out). */
  signOutLocal() {
    sessionStorage.removeItem(STORAGE_KEY);
  },

  /** Clear the local session and reload the SPA.
   *  We intentionally skip the OP end-session endpoint so the user never
   *  lands on a branded logout page (and we don’t leak the auth provider). */
  async signOut() {
    this.signOutLocal();
    window.location.reload();
  },
};
