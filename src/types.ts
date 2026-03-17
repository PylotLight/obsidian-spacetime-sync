export interface SpacetimeSyncSettings {
    deviceId: string;
    host: string;           // Public server URL, e.g. https://my-proxy.example.com or ws://192.168.1.10:4000
    dbName: string;
    syncEnabled: boolean;
    syncMode: 'auto' | 'manual';
    pushDelay: number;
    debugLogging: boolean;
    // Auth proxy settings
    authEnabled: boolean;
    authToken: string;         // JWT/session token from the protecting proxy
    authTokenExpiry: number;   // Unix epoch ms; 0 = no expiry
    authCookieName: string;    // Cookie name the proxy expects (e.g. CF_Authorization for Cloudflare)
}

export const DEFAULT_SETTINGS: SpacetimeSyncSettings = {
    deviceId: '',
    host: '',
    dbName: '',
    syncEnabled: false,
    syncMode: 'auto',
    pushDelay: 2000,
    debugLogging: false,
    authEnabled: false,
    authToken: '',
    authTokenExpiry: 0,
    authCookieName: 'CF_Authorization',
};

export type SyncStatusState = "Stopped" | "Connecting..." | "Connected" | "Disconnected" | "Offline" | "Error" | "Disconnected (Idle)" | "Auth Required";
