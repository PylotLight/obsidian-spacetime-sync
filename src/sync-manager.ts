import { App, Notice, TFile, TAbstractFile, Platform } from 'obsidian';
import { Identity, Timestamp } from 'spacetimedb';
import { DbConnection } from './module_bindings';
import { SpacetimeSyncSettings, SyncStatusState } from './types';
import type { LogManager } from './logger';
import type { AuthManager } from './auth-manager';

export class SyncManager {
    private app: App;
    private settings: SpacetimeSyncSettings;
    private logger: LogManager;
    private manifest: any;
    private saveSettings: () => Promise<void>;
    private authManager: AuthManager;

    private client: DbConnection | null = null;
    private isRemoteUpdate: boolean = false;
    private statusBarItem: HTMLElement | null = null;
    private pushTimeout: NodeJS.Timeout | null = null;
    private reconnectTimeout: NodeJS.Timeout | null = null;
    private disconnectTimeout: NodeJS.Timeout | null = null;
    private isConnecting: boolean = false;
    private pendingSyncPaths: Set<string> = new Set();
    private isSyncing: boolean = false;

    constructor(
        app: App,
        settings: SpacetimeSyncSettings,
        logger: LogManager,
        manifest: any,
        saveSettings: () => Promise<void>,
        authManager: AuthManager,
    ) {
        this.app = app;
        this.settings = settings;
        this.logger = logger;
        this.manifest = manifest;
        this.saveSettings = saveSettings;
        this.authManager = authManager;
    }

    public setStatusBarItem(item: HTMLElement) {
        this.statusBarItem = item;
        this.updateStatusBar("Stopped");
    }

    public init() {
        if (this.settings.syncEnabled) {
            this.initSpacetime();
        }
    }

    public cleanup() {
        if (this.pushTimeout) clearTimeout(this.pushTimeout);
        if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
        if (this.disconnectTimeout) clearTimeout(this.disconnectTimeout);
        this.pushTimeout = this.reconnectTimeout = this.disconnectTimeout = null;

        if (this.client) {
            this.client.disconnect();
            this.client = null;
        }
    }

    public updateStatusBar(text: SyncStatusState | string) {
        if (this.statusBarItem) {
            this.statusBarItem.setText(`📡 SpacetimeDB: ${text}`);
        }
    }

    private isMobile(): boolean {
        return Platform.isMobile || Platform.isAndroidApp;
    }

    public async initSpacetime() {
        if (this.isConnecting || this.client) return;

        const { dbName, deviceId, syncEnabled, authEnabled } = this.settings;

        // Resolve the WS URL — supports ws://, wss://, http://, https://, bare host:port
        const host = this.authManager.getWsUrl();

        if (!syncEnabled || !host || !dbName) {
            this.updateStatusBar("Stopped");
            return;
        }

        // If auth is enabled, require a valid token before connecting
        if (authEnabled && !this.authManager.isAuthenticated()) {
            this.logger.warn("Auth enabled but no valid token — open Settings → Authentication to login.");
            this.updateStatusBar("Auth Required");
            new Notice("SpacetimeDB: Login required. Open Settings → Authentication.");
            return;
        }

        if (!navigator.onLine) {
            this.updateStatusBar("Offline");
            return;
        }

        this.isConnecting = true;
        const cleanHost = host.replace(/\/$/, '');
        this.logger.info(`Connecting to ${cleanHost}/${this.settings.dbName} as ${deviceId}`);
        this.updateStatusBar("Connecting...");

        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        try {
            // If auth is enabled, inject the proxy token as a cookie BEFORE connecting.
            if (authEnabled && this.authManager.isAuthenticated()) {
                await this.authManager.injectCookie();
            }

            const authedHost = this.authManager.getAuthenticatedUrl(host);
            this.client = DbConnection.builder()
                .withUri(authedHost)
                .withDatabaseName(dbName)
                .onConnect((conn, identity: Identity) => {
                    this.isConnecting = false;
                    this.logger.info(`Connected. Identity: ${identity.toHexString()}`);
                    this.updateStatusBar("Connected");

                    if (conn.reducers.registerDevice) {
                        const os = this.isMobile() ? (Platform.isAndroidApp ? 'Android' : 'iOS') : 'Desktop';
                        const version = this.manifest.version;
                        this.logger.debug(`Registering device: ${deviceId} (${os} v${version})`);
                        conn.reducers.registerDevice({ deviceId, clientVersion: version, os });
                    }

                    conn.subscriptionBuilder()
                        .onApplied(() => {
                            this.logger.info("Subscription applied. Syncing files...");
                            this.syncAllFiles();
                        })
                        .subscribeToAllTables();
                })
                .onDisconnect(() => {
                    this.isConnecting = false;
                    this.logger.info("Disconnected from SpacetimeDB");
                    this.updateStatusBar(this.settings.syncEnabled ? "Disconnected" : "Stopped");
                    this.client = null;

                    if (this.settings.syncEnabled && navigator.onLine && !this.isMobile()) {
                        this.scheduleReconnect();
                    }
                })
                .onConnectError((_conn, error) => {
                    this.isConnecting = false;
                    this.logger.error("Connection error", error);
                    this.updateStatusBar("Error");
                    this.client = null;

                    if (this.settings.syncEnabled && navigator.onLine && !this.isMobile()) {
                        this.scheduleReconnect();
                    }
                })
                .build();

            this.client.db.document.onInsert((_ctx, row: any) => {
                this.handleRemoteChange(row);
            });
            this.client.db.document.onUpdate((_ctx, _oldRow: any, newRow: any) => {
                this.handleRemoteChange(newRow);
            });
            this.client.db.document.onDelete((_ctx, row: any) => {
                this.handleRemoteDelete(row);
            });
        } catch (e) {
            this.isConnecting = false;
            this.logger.error("Fatal error initializing SpacetimeDB", e);
        }
    }

    private scheduleReconnect() {
        if (this.reconnectTimeout) return;
        this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            this.initSpacetime();
        }, 5000);
    }

    private resetDisconnectTimeout() {
        if (this.disconnectTimeout) clearTimeout(this.disconnectTimeout);

        if (this.isMobile() || this.settings.syncMode === 'manual') {
            this.disconnectTimeout = setTimeout(() => {
                this.logger.info("Auto-disconnecting due to inactivity");
                this.cleanup();
                this.updateStatusBar("Disconnected (Idle)");
            }, 30000);
        }
    }

    public async syncAllFiles() {
        if (this.isSyncing) return;
        this.isSyncing = true;

        const files = this.app.vault.getFiles();
        const filesToSync = this.pendingSyncPaths.size > 0
            ? files.filter(f => this.pendingSyncPaths.has(f.path))
            : files;

        const total = filesToSync.length;
        if (total === 0) {
            this.finalizeSync("No changes", 0, files.length, 0);
            return;
        }

        this.updateSyncStatus("syncing", `Starting sync of ${total} files`, true);
        let updatedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;

        for (const file of filesToSync) {
            this.updateStatusBar(`Syncing [${updatedCount + skippedCount + errorCount + 1}/${total}]`);
            try {
                const wasUpdated = await this.handleLocalChange(file);
                if (wasUpdated) updatedCount++;
                else skippedCount++;
                this.pendingSyncPaths.delete(file.path);
            } catch (e) {
                this.logger.error(`Failed to sync file: ${file.path}`, e);
                errorCount++;
            }
            await new Promise(resolve => setTimeout(resolve, 5));
        }

        const details = `Completed: ${updatedCount} updated, ${skippedCount} skipped, ${errorCount} errors`;
        this.finalizeSync(details, updatedCount, skippedCount, errorCount);
    }

    private finalizeSync(details: string, updated: number, skipped: number, error: number) {
        this.logger.info(`Sync completed. ${details}`);
        this.updateSyncStatus("completed", details, false);
        this.updateStatusBar("Connected");
        this.isSyncing = false;

        if (updated > 0 || error > 0) {
            new Notice(`SpacetimeDB Sync: ${details}`);
        }

        this.resetDisconnectTimeout();
    }

    public debouncedHandleLocalChange(file: TFile) {
        if (!this.settings.syncEnabled) return;
        this.pendingSyncPaths.add(file.path);

        if (this.settings.syncMode !== 'auto') return;

        if (this.pushTimeout) clearTimeout(this.pushTimeout);

        this.pushTimeout = setTimeout(async () => {
            this.pushTimeout = null;
            if (this.client) {
                await this.handleLocalChange(file);
                this.resetDisconnectTimeout();
            } else if (navigator.onLine) {
                this.initSpacetime();
            }
        }, this.settings.pushDelay);
    }

    public async handleLocalChange(file: TFile): Promise<boolean> {
        if (this.isRemoteUpdate || !this.client) return false;

        try {
            const binary = await this.app.vault.readBinary(file);
            const bytes = new Uint8Array(binary);
            const hash = await this.calculateHash(bytes);

            const remoteDoc = this.client.db.document.path.find(file.path);
            if (remoteDoc && remoteDoc.hash === hash) {
                return false;
            }

            const content = await this.app.vault.read(file);
            const micros = BigInt(file.stat.mtime) * 1000n;
            const modifiedAt = new Timestamp(micros);

            if (this.client.reducers.upsertDocument) {
                this.client.reducers.upsertDocument({
                    path: file.path,
                    content: content,
                    contentBytes: bytes,
                    modifiedAt: modifiedAt,
                    hash: hash
                });
                return true;
            }
            return false;
        } catch (e) {
            this.logger.error(`Error in handleLocalChange for ${file.path}`, e);
            return false;
        }
    }

    private async calculateHash(bytes: Uint8Array): Promise<string> {
        // @ts-ignore
        const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    private updateSyncStatus(status: string, details: string, isStart: boolean) {
        if (this.client?.reducers.updateSyncStatus) {
            this.client.reducers.updateSyncStatus({
                deviceId: this.settings.deviceId,
                status,
                details,
                isStart
            });
        }
    }

    public handleLocalDelete(file: TAbstractFile) {
        if (this.isRemoteUpdate) return;
        this.client?.reducers.deleteDocument({ path: file.path });
    }

    public async handleLocalRename(file: TAbstractFile, oldPath: string) {
        if (this.isRemoteUpdate) return;
        this.client?.reducers.deleteDocument({ path: oldPath });
        if (file instanceof TFile) {
            await this.handleLocalChange(file);
        }
    }

    private async handleRemoteChange(row: any) {
        const localFile = this.app.vault.getAbstractFileByPath(row.path);

        this.isRemoteUpdate = true;
        try {
            if (localFile instanceof TFile) {
                const remoteMicros = row.lastModified.microsSinceUnixEpoch;
                const localMicros = BigInt(localFile.stat.mtime) * 1000n;

                if (remoteMicros > localMicros) {
                    if (this.isBinaryFile(row.path)) {
                        const buffer = row.contentBytes.buffer.slice(
                            row.contentBytes.byteOffset,
                            row.contentBytes.byteOffset + row.contentBytes.byteLength
                        ) as ArrayBuffer;
                        await this.app.vault.modifyBinary(localFile, buffer);
                    } else {
                        await this.app.vault.modify(localFile, row.content);
                    }
                }
            } else {
                const dir = row.path.split('/').slice(0, -1).join('/');
                if (dir && !this.app.vault.getAbstractFileByPath(dir)) {
                    await this.ensureDirectory(dir);
                }

                if (this.isBinaryFile(row.path)) {
                    const buffer = row.contentBytes.buffer.slice(
                        row.contentBytes.byteOffset,
                        row.contentBytes.byteOffset + row.contentBytes.byteLength
                    ) as ArrayBuffer;
                    await this.app.vault.createBinary(row.path, buffer);
                } else {
                    await this.app.vault.create(row.path, row.content);
                }
            }
        } catch (e) {
            this.logger.error(`Error applying remote change to ${row.path}`, e);
        } finally {
            this.isRemoteUpdate = false;
        }
    }

    private isBinaryFile(path: string): boolean {
        return !!path.match(/\.(png|jpg|jpeg|gif|pdf|zip|docx)$/i);
    }

    private async handleRemoteDelete(row: any) {
        const localFile = this.app.vault.getAbstractFileByPath(row.path);
        if (localFile) {
            this.isRemoteUpdate = true;
            try {
                await this.app.vault.delete(localFile);
            } finally {
                this.isRemoteUpdate = false;
            }
        }
    }

    private async ensureDirectory(path: string) {
        const folders = path.split('/');
        let currentPath = "";
        for (const folder of folders) {
            currentPath += (currentPath ? "/" : "") + folder;
            if (!this.app.vault.getAbstractFileByPath(currentPath)) {
                await this.app.vault.createFolder(currentPath);
            }
        }
    }

    public manualSync() {
        this.logger.info("Manual sync triggered");
        if (!this.settings.host || !this.settings.dbName) {
            new Notice("SpacetimeDB Plugin: Please configure Host and Database in settings before syncing.");
            return;
        }

        if (this.client) {
            this.syncAllFiles();
        } else {
            this.initSpacetime();
        }
    }
}
