import { Plugin, TFile, TAbstractFile, PluginSettingTab, App, Setting, Notice } from 'obsidian';
import { Identity, Timestamp } from 'spacetimedb'; 
import { DbConnection } from './module_bindings';
import { Document } from './module_bindings/types';
import { Platform } from 'obsidian';

interface SpacetimeSyncSettings {
    deviceId: string;
    host: string;
    dbName: string;
    liveSync: boolean;
    isConnected: boolean;
    debugLogging: boolean;
}

const DEFAULT_SETTINGS: SpacetimeSyncSettings = {
    deviceId: '',
    host: '',
    dbName: '',
    liveSync: false,
    isConnected: false,
    debugLogging: false
}

export default class SpacetimeSyncPlugin extends Plugin {
    settings!: SpacetimeSyncSettings;
    private client: DbConnection | null = null;
    private isRemoteUpdate: boolean = false;
    private statusBarItem: HTMLElement | null = null;
    private logger!: import('./logger').LogManager;

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
        this.updateStatusBar("Disconnected");

        if (this.settings.isConnected && this.settings.host && this.settings.dbName) {
            this.initSpacetime();
        }

        this.registerEvent(this.app.vault.on('modify', (file) => file instanceof TFile && this.handleLocalChange(file)));
        this.registerEvent(this.app.vault.on('create', (file) => file instanceof TFile && this.handleLocalChange(file)));
        this.registerEvent(this.app.vault.on('delete', (file) => this.handleLocalDelete(file)));
        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.handleLocalRename(file, oldPath)));

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

    onunload() {
        if (this.client) this.client.disconnect();
    }

    private manualSync() {
        this.logger.info("Manual sync triggered");
        if (!this.settings.host || !this.settings.dbName) {
            this.logger.warn("Manual sync skipped: host or dbName missing");
            new Notice("SpacetimeDB Plugin: Please configure Host and Database in settings before syncing.");
            return;
        }
        
        if (this.client) {
            this.syncAllFiles();
        } else {
            this.logger.info("SpacetimeDB Plugin: Manually connecting for sync...");
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

    private initSpacetime() {
        const { host, dbName, deviceId } = this.settings;

        this.logger.info(`Connecting to ${host}/${dbName} as ${deviceId}`);
        this.updateStatusBar("Connecting...");
        
        try {
            this.client = DbConnection.builder()
                .withUri(host)
                .withDatabaseName(dbName)
                .onConnect((conn, identity: Identity) => {
                    this.logger.info(`Connected. Identity: ${identity.toHexString()}`);
                    this.updateStatusBar("Connected");
                    
                    if (conn.reducers.registerDevice) {
                        const os = Platform.isMobile ? (Platform.isAndroidApp ? 'Android' : 'iOS') : 'Desktop';
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
                    this.logger.info("Disconnected from SpacetimeDB");
                    this.updateStatusBar("Disconnected");
                    this.client = null;
                })
                .onConnectError((_conn, error) => {
                    this.logger.error("Connection error", error);
                    this.updateStatusBar("Error");
                    new Notice(`SpacetimeDB Connection Error: ${error}`);
                    this.client = null;
                })
                .build(); 

            // Setup listeners on the client returned by build()
            this.client.db.document.onInsert((_ctx, row: any) => {
                this.logger.debug(`Remote insert: ${row.path}`);
                this.handleRemoteChange(row);
            });
            this.client.db.document.onUpdate((_ctx, _oldRow: any, newRow: any) => {
                this.logger.debug(`Remote update: ${newRow.path}`);
                this.handleRemoteChange(newRow);
            });
            this.client.db.document.onDelete((_ctx, row: any) => {
                this.logger.debug(`Remote delete: ${row.path}`);
                this.handleRemoteDelete(row);
            });
        } catch (e) {
            this.logger.error("Fatal error initializing SpacetimeDB", e);
            throw e;
        }
    }

    private async syncAllFiles() {
        const files = this.app.vault.getFiles();
        const total = files.length;
        this.updateSyncStatus("syncing", `Starting sync of ${total} files`, true);
        let updatedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;

        let current = 0;
        for (const file of files) {
            current++;
            if (current % 10 === 0 || current === total) {
                this.logger.debug(`Sync progress: ${current}/${total} (${file.path})`);
            }
            this.updateStatusBar(`Syncing [${current}/${total}]`);
            try {
                const wasUpdated = await this.handleLocalChange(file);
                if (wasUpdated) updatedCount++;
                else skippedCount++;
            } catch (e) {
                this.logger.error(`Failed to sync file: ${file.path}`, e);
                errorCount++;
            }
            // Small delay to prevent blocking the UI and reduce memory pressure spikes
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        
        const details = `Completed: ${updatedCount} updated, ${skippedCount} skipped, ${errorCount} errors`;
        this.logger.info(`Full sync completed. ${details}`);
        this.updateStatusBar("Connected");
        this.updateSyncStatus("completed", details, false);
        new Notice(`SpacetimeDB Sync: ${details}`);

        if (!this.settings.liveSync && this.client) {
            this.logger.info("Live sync disabled, disconnecting after full sync");
            this.client.disconnect();
            this.client = null;
            this.updateStatusBar("Disconnected");
        }
    }

    private async handleLocalChange(file: TFile): Promise<boolean> {
        if (this.isRemoteUpdate || !this.client) return false;
        
        try {
            const binary = await this.app.vault.readBinary(file);
            const bytes = new Uint8Array(binary);
            const hash = await this.calculateHash(bytes);
            
            // Check if remote already has this exact hash
            const remoteDoc = this.client.db.document.path.find(file.path);
            if (remoteDoc && remoteDoc.hash === hash) {
                this.logger.debug(`Skipping ${file.path}: hash matches remote`);
                return false;
            }

            this.logger.debug(`Local change detected: ${file.path} (hash changed)`);
            const content = await this.app.vault.read(file);
            
            // ✅ v2.0.4 Fix: Use new Timestamp(bigint) constructor
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
            } else {
                this.logger.error("upsertDocument reducer not found");
                return false;
            }
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
        this.logger.debug(`Applying remote change to ${row.path}`);
        try {
            if (localFile instanceof TFile) {
                const remoteMicros = row.lastModified.microsSinceUnixEpoch;
                const localMicros = BigInt(localFile.stat.mtime) * 1000n;

                if (remoteMicros > localMicros) {
                    this.logger.debug(`Updating local file: ${row.path}`);
                    if (this.isBinaryFile(row.path)) {
                        const buffer = row.contentBytes.buffer.slice(
                            row.contentBytes.byteOffset,
                            row.contentBytes.byteOffset + row.contentBytes.byteLength
                        ) as ArrayBuffer;
                        await this.app.vault.modifyBinary(localFile, buffer);
                    } else {
                        await this.app.vault.modify(localFile, row.content);
                    }
                } else {
                    this.logger.debug(`Skipping remote change for ${row.path}: local is newer or same`);
                }
            } else {
                this.logger.debug(`Creating new local file: ${row.path}`);
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
            .setName('Connected')
            .setDesc('Toggle connection to SpacetimeDB.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.isConnected)
                .onChange(async (value) => {
                    this.plugin.settings.isConnected = value;
                    await this.plugin.saveSettings();
                    
                    if (value) {
                         if (this.plugin.settings.host && this.plugin.settings.dbName && !this.plugin['client']) {
                             this.plugin['initSpacetime']();
                         }
                    } else {
                        if (this.plugin['client']) {
                            this.plugin['client'].disconnect();
                            this.plugin['client'] = null;
                        }
                    }
                }));

        new Setting(containerEl)
            .setName('Live Sync')
            .setDesc('Enable live synchronization. If disabled, synchronization only happens on initial connection or manual sync.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.liveSync)
                .onChange(async (value) => {
                    this.plugin.settings.liveSync = value;
                    await this.plugin.saveSettings();
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
            .setDesc('Write detailed logs to debug.log in the plugin folder. Useful for troubleshooting Android crashes.')
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