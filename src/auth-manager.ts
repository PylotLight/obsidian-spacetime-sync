import { Notice } from 'obsidian';
import type { SpacetimeSyncSettings } from './types';
import type { LogManager } from './logger';

/**
 * Manages OIDC browser-redirect authentication for the SpacetimeDB proxy.
 *
 * Flow:
 *  1. User clicks "Login" → login() opens the auth provider URL in the system browser.
 *  2. Proxy/IdP authenticates the user, then redirects to:
 *       obsidian://spacetime-sync-auth?token=JWT[&expires=EPOCH_MS]
 *  3. Plugin's protocol handler calls handleCallback() which stores the token.
 *  4. SyncManager calls getToken() to retrieve the token before connecting.
 *
 * A mock OIDC server (test/mock-oidc-server.ts) simulates step 2 locally.
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
     * Opens the configured auth provider URL in the system browser.
     * The provider must redirect back to obsidian://spacetime-sync-auth?token=...
     */
    public login() {
        if (!this.settings.authProviderUrl) {
            new Notice('SpacetimeDB: Auth Provider URL is not configured.');
            return;
        }

        this.logger.info(`Opening auth provider: ${this.settings.authProviderUrl}`);

        // Build callback redirect URI
        const callbackUri = encodeURIComponent('obsidian://spacetime-sync-auth');

        // Append redirect_uri as a query parameter so the provider knows where to send the user back.
        const separator = this.settings.authProviderUrl.includes('?') ? '&' : '?';
        const url = `${this.settings.authProviderUrl}${separator}redirect_uri=${callbackUri}&client_id=obsidian-spacetime-sync`;

        window.open(url, '_blank');
        new Notice('SpacetimeDB: Browser opened — please complete login.');
    }

    /**
     * Called by the Obsidian protocol handler when the browser redirects back.
     * Expected params: { token: string, expires?: string }
     */
    public async handleCallback(params: Record<string, string>) {
        const token = params['token'];
        if (!token) {
            this.logger.error('Auth callback received without token', params);
            new Notice('SpacetimeDB: Auth failed — no token received.');
            return;
        }

        // Optional expiry in epoch ms
        const expires = params['expires'] ? parseInt(params['expires'], 10) : 0;

        this.settings.authToken = token;
        this.settings.authTokenExpiry = expires;
        await this.saveSettings();

        this.logger.info(`Auth token received. Expires: ${expires ? new Date(expires).toISOString() : 'not set'}`);
        new Notice('SpacetimeDB: Authentication successful! ✓');

        this.onAuthChange();
    }

    /**
     * Returns the stored token if valid, null if missing or expired.
     */
    public getToken(): string | null {
        if (!this.settings.authToken) return null;

        const expiry = this.settings.authTokenExpiry;
        if (expiry && expiry > 0 && Date.now() > expiry) {
            this.logger.warn('Auth token has expired');
            return null;
        }

        return this.settings.authToken;
    }

    /**
     * Whether a valid, non-expired token is present.
     */
    public isAuthenticated(): boolean {
        return this.getToken() !== null;
    }

    /**
     * Clears the stored auth token.
     */
    public async logout() {
        this.settings.authToken = '';
        this.settings.authTokenExpiry = 0;
        await this.saveSettings();
        this.logger.info('Auth token cleared (logged out)');
        new Notice('SpacetimeDB: Logged out.');
        this.onAuthChange();
    }

    /**
     * Returns a human-readable status string for display in the settings UI.
     */
    public getStatusText(): string {
        if (!this.settings.authEnabled) return 'Auth disabled';
        if (!this.settings.authToken) return 'Not authenticated';

        const expiry = this.settings.authTokenExpiry;
        if (expiry && expiry > 0) {
            if (Date.now() > expiry) return 'Token expired';
            const remaining = Math.round((expiry - Date.now()) / 1000 / 60);
            return `Authenticated ✓ (expires in ${remaining}m)`;
        }
        return 'Authenticated ✓';
    }
}
