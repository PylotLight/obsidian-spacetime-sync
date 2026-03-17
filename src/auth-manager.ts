import { Notice } from 'obsidian';
import type { SpacetimeSyncSettings } from './types';
import type { LogManager } from './logger';

/**
 * Manages OIDC browser-redirect authentication for the SpacetimeDB proxy.
 *
 * Auth flow:
 *  1. login() → opens <host>/authorize in the system browser
 *  2. Proxy authenticates the user, then redirects to:
 *       obsidian://spacetime-sync-auth?token=JWT[&expires=EPOCH_MS]
 *  3. Plugin's protocol handler calls handleCallback() → token stored
 *  4. Before connecting, injectCookie() sets the token as a browser cookie
 *     so Electron automatically includes it in the WebSocket upgrade request.
 *
 * NOTE: The token is NOT passed via SpacetimeDB's .withToken() — that API is
 * for SpacetimeDB identity auth, not proxy auth. Proxy auth is cookie-based.
 */
export class AuthManager {
    private settings: SpacetimeSyncSettings;
    private logger: LogManager;
    private saveSettings: () => Promise<void>;
    private onAuthChange: () => void;

    constructor(
        settings: SpacetimeSyncSettings,
        logger: LogManager,
        saveSettings: () => Promise<void>,
        onAuthChange: () => void,
    ) {
        this.settings = settings;
        this.logger = logger;
        this.saveSettings = saveSettings;
        this.onAuthChange = onAuthChange;
    }

    /**
     * Derive the auth login URL from the configured host.
     * The login page lives on the same host as the proxy, at /authorize
     * (or just the root, for proxies that handle it automatically).
     */
    private getLoginUrl(): string {
        const host = this.settings.host.trim();
        if (!host) return '';

        // Convert WS URLs to HTTP for the browser login page:
        //   ws://host  → http://host
        //   wss://host → https://host
        //   http(s)://host → as-is
        //   192.168.x.x:port (no scheme) → http://host
        let httpUrl = host
            .replace(/^wss:\/\//, 'https://')
            .replace(/^ws:\/\//, 'http://');

        if (!/^https?:\/\//.test(httpUrl)) {
            httpUrl = 'http://' + httpUrl;
        }

        // Strip trailing slash and path — the login page is at the root
        try {
            const u = new URL(httpUrl);
            return u.origin;
        } catch {
            return httpUrl;
        }
    }

    /**
     * Derive the WebSocket URL from the configured host.
     * Converts https:// → wss://, http:// → ws://
     */
    public getWsUrl(): string {
        const host = this.settings.host.trim();
        if (!host) return host;

        // Already a WS URL — return as-is
        if (host.startsWith('ws://') || host.startsWith('wss://')) return host;

        // Convert HTTP scheme
        return host
            .replace(/^https:\/\//, 'wss://')
            .replace(/^http:\/\//, 'ws://');
    }

    /**
     * Opens the proxy login page in the system browser.
     * The proxy must redirect back to obsidian://spacetime-sync-auth?token=...
     */
    public login() {
        const loginUrl = this.getLoginUrl();
        if (!loginUrl) {
            new Notice('SpacetimeDB: Configure the Server URL in settings first.');
            return;
        }

        const callbackUri = encodeURIComponent('obsidian://spacetime-sync-auth');
        const url = `${loginUrl}?redirect_uri=${callbackUri}&client_id=obsidian-spacetime-sync`;

        this.logger.info(`Opening auth provider: ${url}`);
        window.open(url, '_blank');
        new Notice('SpacetimeDB: Browser opened — please complete login.');
    }

    /**
     * Called by the Obsidian protocol handler on callback.
     * Expected params: { token: string, expires?: string }
     */
    public async handleCallback(params: Record<string, string>) {
        const token = params['token'];
        if (!token) {
            this.logger.error('Auth callback received without token', params);
            new Notice('SpacetimeDB: Auth failed — no token received.');
            return;
        }

        const expires = params['expires'] ? parseInt(params['expires'], 10) : 0;

        this.settings.authToken = token;
        this.settings.authTokenExpiry = expires;
        await this.saveSettings();

        this.logger.info(`Auth token received. Expires: ${expires ? new Date(expires).toISOString() : 'not set'}`);
        new Notice('SpacetimeDB: Authentication successful! ✓');

        this.onAuthChange();
    }

    /**
     * Injects the auth token as a browser cookie before WebSocket connection.
     * Electron includes cookies automatically in WS upgrade requests to the same origin,
     * which lets the protecting proxy (Pangolin, Cloudflare Access, etc.) validate the session.
     */
    public injectCookie() {
        const token = this.getToken();
        if (!token) return;

        try {
            const cookieName = this.settings.authCookieName || 'CF_Authorization';
            const expires = this.settings.authTokenExpiry
                ? new Date(this.settings.authTokenExpiry).toUTCString()
                : '';

            const expiryPart = expires ? `; expires=${expires}` : '';
            document.cookie = `${cookieName}=${encodeURIComponent(token)}; path=/${expiryPart}; SameSite=Lax`;

            this.logger.debug(`Injected auth cookie "${cookieName}"`);
        } catch (e) {
            this.logger.error('Failed to inject auth cookie', e);
        }
    }

    /**
     * Clears the auth cookie and stored token.
     */
    public async logout() {
        const cookieName = this.settings.authCookieName || 'CF_Authorization';
        // Expire the cookie
        document.cookie = `${cookieName}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;

        this.settings.authToken = '';
        this.settings.authTokenExpiry = 0;
        await this.saveSettings();
        this.logger.info('Auth token cleared (logged out)');
        new Notice('SpacetimeDB: Logged out.');
        this.onAuthChange();
    }

    /** Returns current valid token or null if missing/expired. */
    public getToken(): string | null {
        if (!this.settings.authToken) return null;
        const expiry = this.settings.authTokenExpiry;
        if (expiry && expiry > 0 && Date.now() > expiry) {
            this.logger.warn('Auth token has expired');
            return null;
        }
        return this.settings.authToken;
    }

    public isAuthenticated(): boolean {
        return this.getToken() !== null;
    }

    public getStatusText(): string {
        if (!this.settings.authEnabled) return 'Auth disabled';
        if (!this.settings.authToken) return 'Not authenticated';

        const expiry = this.settings.authTokenExpiry;
        if (expiry && expiry > 0) {
            if (Date.now() > expiry) return 'Token expired — please login again';
            const remaining = Math.round((expiry - Date.now()) / 1000 / 60);
            return `Authenticated (expires in ${remaining}m)`;
        }
        return 'Authenticated';
    }
}
