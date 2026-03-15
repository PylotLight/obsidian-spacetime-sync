export interface SpacetimeSyncSettings {
    deviceId: string;
    host: string;
    dbName: string;
    syncEnabled: boolean;
    syncMode: 'auto' | 'manual';
    pushDelay: number;
    debugLogging: boolean;
}

export const DEFAULT_SETTINGS: SpacetimeSyncSettings = {
    deviceId: '',
    host: '',
    dbName: '',
    syncEnabled: false,
    syncMode: 'auto',
    pushDelay: 2000,
    debugLogging: false
};

export type SyncStatusState = "Stopped" | "Connecting..." | "Connected" | "Disconnected" | "Offline" | "Error" | "Disconnected (Idle)";
