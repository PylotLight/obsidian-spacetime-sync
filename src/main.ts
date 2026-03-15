import { Plugin, TFile, TAbstractFile, PluginSettingTab, App, Setting, Notice, Platform } from 'obsidian';
import { Identity, Timestamp } from 'spacetimedb'; 
import { DbConnection } from './module_bindings';

interface SpacetimeSyncSettings {
    deviceId: string;
    host: string;
    dbName: string;
    syncEnabled: boolean;
    syncMode: 'auto' | 'manual';
    pushDelay: number;
    debugLogging: boolean;
}

const DEFAULT_SETTINGS: SpacetimeSyncSettings = {
    deviceId: '',
    host: '',
    dbName: '',
    syncEnabled: false,
    syncMode: 'auto',
    pushDelay: 2000,
    debugLogging: false
}

export default class SpacetimeSyncPlugin extends Plugin {
    settings!: SpacetimeSyncSettings;
    private client: DbConnection | null = null;
    private isRemoteUpdate: boolean = false;
    private statusBarItem: HTMLElement | null = null;
    private logger!: import('./logger').LogManager;
    private pushTimeout: NodeJS.Timeout | null = null;
    private reconnectTimeout: NodeJS.Timeout | null = null;
    private disconnectTimeout: NodeJS.Timeout | null = null;
    private isConnecting: boolean = false;
    private pendingSyncPaths: Set<string> = new Set();
    private isSyncing: boolean = false;

    async onload() {
        // @ts-ignore
        const { LogManager } = await import('./logger');
        this.logger = new LogManager(this.app, this);
        
        await this.loadSettings();
        this.logger.setEnabled(this.settings.debugLogging);
        this.logger.info("Plugin loading...");

        if (!this.settings.deviceId) {
            this.settings.deviceId = 'device-' + Math.random().toString(36).substring(2, 11);
            await this.saveSettings();
        }

        this.addSettingTab(new SpacetimeSyncSettingTab(this.app, this));

        // Add ribbon icon for manual sync
        this.addRibbonIcon('refresh-cw', 'Sync with SpacetimeDB', () => {
            this.manualSync();
        });

        // Add command palette
        this.addCommand({
            id: 'spacetime-manual-sync',
            name: 'Manual Sync with SpacetimeDB',
            callback: () => {
                this.manualSync();
            }
        });

        // Initialize status bar
        this.statusBarItem = this.addStatusBarItem();
        this.updateStatusBar("Stopped");

        if (this.settings.syncEnabled) {
            this.initSpacetime();
        }

        this.registerEvent(this.app.vault.on('modify', (file) => file instanceof TFile && this.debouncedHandleLocalChange(file)));
        this.registerEvent(this.app.vault.on('create', (file) => file instanceof TFile && this.debouncedHandleLocalChange(file)));
        this.registerEvent(this.app.vault.on('delete', (file) => this.handleLocalDelete(file)));
        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.handleLocalRename(file, oldPath)));

        this.setupCommands();
        this.setupNetworkHandlers();
    }

    private setupCommands() {
        this.addCommand({
            id: 'spacetime-show-logs',
            name: 'Show Debug Logs',
            callback: async () => {
                const file = await this.logger.getLogFile();
                if (file) {
                    this.app.workspace.getLeaf().openFile(file);
                } else {
                    new Notice("No log file found.");
                }
            }
        });

        this.addCommand({
            id: 'spacetime-clear-logs',
            name: 'Clear Debug Logs',
            callback: () => {
                this.logger.clearLogs();
                new Notice("SpacetimeDB: Logs cleared.");
            }
        });

        this.addCommand({
            id: 'spacetime-copy-connection-url',
            name: 'Copy Connection URL',
            callback: () => {
                const url = `spacetimedb://${this.settings.host}?db=${this.settings.dbName}`;
                navigator.clipboard.writeText(url);
                new Notice("SpacetimeDB: Connection URL copied to clipboard.");
            }
        });

        this.addCommand({
            id: 'spacetime-apply-connection-url',
            name: 'Apply Connection URL from Clipboard',
            callback: async () => {
                try {
                    const text = await navigator.clipboard.readText();
                    if (text.startsWith('spacetimedb://')) {
                        const url = new URL(text.replace('spacetimedb://', 'http://'));
                        const host = `ws://${url.host}${url.pathname === '/' ? '' : url.pathname}`;
                        const dbName = url.searchParams.get('db');
                        
                        if (host && dbName) {
                            this.settings.host = host;
                            this.settings.dbName = dbName;
                            await this.saveSettings();
                            new Notice(`SpacetimeDB: Applied settings for ${dbName}`);
                            if (this.settings.syncEnabled) this.initSpacetime();
                        } else {
                            new Notice("SpacetimeDB: Invalid Connection URL format.");
                        }
                    } else {
                        new Notice("SpacetimeDB: Clipboard does not contain a valid SpacetimeDB URL.");
                    }
                } catch (e) {
                    new Notice("SpacetimeDB: Failed to read clipboard.");
                    this.logger.error("Failed to read clipboard", e);
                }
            }
        });
    }

    private setupNetworkHandlers() {
        window.addEventListener('online', () => {
            this.logger.info("Device online, attempting reconnect...");
            if (this.settings.syncEnabled) this.initSpacetime();
        });

        window.addEventListener('offline', () => {
            this.logger.info("Device offline, disconnecting...");
            this.cleanupClient();
            this.updateStatusBar("Offline");
        });

        // Focus Tracking
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && this.settings.syncEnabled) {
                this.logger.info("App focused/visible, checking for updates...");
                this.initSpacetime();
            }
        });
    }

    onunload() {
        this.cleanupClient();
    }

    private cleanupClient() {
        if (this.pushTimeout) clearTimeout(this.pushTimeout);
        if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
        if (this.disconnectTimeout) clearTimeout(this.disconnectTimeout);
        this.pushTimeout = this.reconnectTimeout = this.disconnectTimeout = null;
        
        if (this.client) {
            this.client.disconnect();
            this.client = null;
        }
    }

    private manualSync() {
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

    private updateStatusBar(text: string) {
        if (this.statusBarItem) {
            this.statusBarItem.setText(`📡 SpacetimeDB: ${text}`);
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    private isMobile(): boolean {
        return Platform.isMobile || Platform.isAndroidApp;
    }

    private initSpacetime() {
        if (this.isConnecting || this.client) return;
        
        const { host, dbName, deviceId, syncEnabled } = this.settings;

        if (!syncEnabled || !host || !dbName) {
            this.updateStatusBar("Stopped");
            return;
        }

        if (!navigator.onLine) {
            this.updateStatusBar("Offline");
            return;
        }

        this.isConnecting = true;
        this.logger.info(`Connecting to ${host}/${dbName} as ${deviceId}`);
        this.updateStatusBar("Connecting...");
        
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }

        try {
            this.client = DbConnection.builder()
                .withUri(host)
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
                this.cleanupClient();
                this.updateStatusBar("Disconnected (Idle)");
            }, 30000);
        }
    }

    private async syncAllFiles() {
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

    private debouncedHandleLocalChange(file: TFile) {
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

    private async handleLocalChange(file: TFile): Promise<boolean> {
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

    private handleLocalDelete(file: TAbstractFile) {
        if (this.isRemoteUpdate) return;
        this.client?.reducers.deleteDocument({ path: file.path });
    }

    private async handleLocalRename(file: TAbstractFile, oldPath: string) {
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
}

class SpacetimeSyncSettingTab extends PluginSettingTab {
    plugin: SpacetimeSyncPlugin;

    constructor(app: App, plugin: SpacetimeSyncPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'SpacetimeDB Sync Settings' });

        new Setting(containerEl)
            .setName('Sync Enabled')
            .setDesc('Master switch to enable or disable SpacetimeDB synchronization.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.syncEnabled)
                .onChange(async (value) => {
                    this.plugin.settings.syncEnabled = value;
                    await this.plugin.saveSettings();
                    
                    if (value) {
                        this.plugin['initSpacetime']();
                    } else {
                        this.plugin['cleanupClient']();
                        this.plugin['updateStatusBar']("Stopped");
                    }
                }));

        new Setting(containerEl)
            .setName('Sync Mode')
            .setDesc('Auto: Automatically sync changes with a delay. Manual: Only sync when ribbon icon is clicked.')
            .addDropdown(dropdown => dropdown
                .addOption('auto', 'Auto (Live)')
                .addOption('manual', 'Manual')
                .setValue(this.plugin.settings.syncMode)
                .onChange(async (value) => {
                    this.plugin.settings.syncMode = value as 'auto' | 'manual';
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Push Delay (ms)')
            .setDesc('The delay (bounce period) in milliseconds before pushing local changes to the server.')
            .addText(text => text
                .setPlaceholder('2000')
                .setValue(this.plugin.settings.pushDelay.toString())
                .onChange(async (value) => {
                    const num = parseInt(value);
                    if (!isNaN(num)) {
                        this.plugin.settings.pushDelay = num;
                        await this.plugin.saveSettings();
                    }
                }));

        new Setting(containerEl)
            .setName('SpacetimeDB Host')
            .setDesc('The WebSocket URL of your SpacetimeDB instance')
            .addText(text => text
                .setPlaceholder('ws://your-host.url')
                .setValue(this.plugin.settings.host)
                .onChange(async (value) => {
                    this.plugin.settings.host = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Database Name')
            .setDesc('The name of your deployed SpacetimeDB module')
            .addText(text => text
                .setPlaceholder('my-database-name')
                .setValue(this.plugin.settings.dbName)
                .onChange(async (value) => {
                    this.plugin.settings.dbName = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h3', { text: 'Debug Logging' });

        new Setting(containerEl)
            .setName('Enable Debug Logging')
            .setDesc('Write detailed logs to debug.log in the plugin folder.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.debugLogging)
                .onChange(async (value) => {
                    this.plugin.settings.debugLogging = value;
                    // @ts-ignore
                    this.plugin.logger.setEnabled(value);
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Clear Debug Logs')
            .setDesc('Delete all content from the debug.log file.')
            .addButton(button => button
                .setButtonText('Clear Logs')
                .onClick(async () => {
                    // @ts-ignore
                    await this.plugin.logger.clearLogs();
                    new Notice('SpacetimeDB: Logs cleared.');
                }));

        containerEl.createEl('p', { text: 'You can also open the log file directly: ' })
            .createEl('a', { 
                text: 'debug.log', 
                href: '#',
                cls: 'internal-link' 
            })
            .onClickEvent(async (e) => {
                e.preventDefault();
                // @ts-ignore
                const file = await this.plugin.logger.getLogFile();
                if (file) {
                    this.app.workspace.getLeaf().openFile(file);
                } else {
                    new Notice("No log file found.");
                }
            });
    }
}