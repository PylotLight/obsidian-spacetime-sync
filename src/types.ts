export interface SpacetimeSyncSettings {
    deviceId: string;
    host: string;
    dbName: string;
    syncEnabled: boolean;
    syncMode: 'auto' | 'manual';
    pushDelay: number;
    debugLogging: boolean;
    // Auth proxy settings
    authEnabled: boolean;
    authProviderUrl: string;  // Login URL of the protecting proxy
    authToken: string;        // JWT/session token received from the proxy
    authTokenExpiry: number;  // Unix epoch ms; 0 = no expiry / not set
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
    authProviderUrl: '',
    authToken: '',
    authTokenExpiry: 0,
};

export type SyncStatusState = "Stopped" | "Connecting..." | "Connected" | "Disconnected" | "Offline" | "Error" | "Disconnected (Idle)";
