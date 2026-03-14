import { Plugin, TFile, TAbstractFile, PluginSettingTab, App, Setting, Notice } from 'obsidian';
import { Identity, Timestamp } from 'spacetimedb'; 
import { DbConnection } from './module_bindings';

interface Document {
    path: string;
    content: string;
    contentBytes: Uint8Array;
    lastModified: Timestamp;
}

interface SpacetimeSyncSettings {
    deviceId: string;
    host: string;
    dbName: string;
    liveSync: boolean;
    isConnected: boolean;
}

const DEFAULT_SETTINGS: SpacetimeSyncSettings = {
    deviceId: '',
    host: '',
    dbName: '',
    liveSync: false,
    isConnected: false
}

export default class SpacetimeSyncPlugin extends Plugin {
    settings!: SpacetimeSyncSettings;
    private client: DbConnection | null = null;
    private isRemoteUpdate: boolean = false;
    private statusBarItem: HTMLElement | null = null;

    async onload() {
        await this.loadSettings();

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
    }

    onunload() {
        if (this.client) this.client.disconnect();
    }

    private manualSync() {
        if (!this.settings.host || !this.settings.dbName) {
            new Notice("SpacetimeDB Plugin: Please configure Host and Database in settings before syncing.");
            return;
        }
        
        if (this.client) {
            this.syncAllFiles();
        } else {
            console.log("SpacetimeDB Plugin: Manually connecting for sync...");
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

        // ✅ v2.0.4 Fix: .build() starts the connection. No .connect() call exists.
        this.updateStatusBar("Connecting...");
        this.client = DbConnection.builder()
            .withUri(host)
            .withDatabaseName(dbName)
            .onConnect((conn, identity: Identity) => {
                console.log(`Connected. Identity: ${identity.toHexString()}`);
                this.updateStatusBar("Connected");
                
                // Reducers use camelCase and object syntax
                // If registerDevice is red, see Step 2 below
                if (conn.reducers.registerDevice) {
                    conn.reducers.registerDevice({ deviceId });
                }

                conn.subscriptionBuilder()
                    .onApplied(() => {
                        console.log("Subscription applied. Syncing files...");
                        this.syncAllFiles();
                    })
                    .subscribeToAllTables();
            })
            .onDisconnect(() => {
                this.updateStatusBar("Disconnected");
                this.client = null;
            })
            .onConnectError((_conn, error) => {
                this.updateStatusBar("Error");
                new Notice(`SpacetimeDB Connection Error: ${error}`);
                this.client = null;
            })
            .build(); 

        // Setup listeners on the client returned by build()
        this.client.db.document.onInsert((_ctx, row: Document) => this.handleRemoteChange(row));
        this.client.db.document.onUpdate((_ctx, _oldRow: Document, newRow: Document) => this.handleRemoteChange(newRow));
        this.client.db.document.onDelete((_ctx, row: Document) => this.handleRemoteDelete(row));
    }

    private async syncAllFiles() {
        const files = this.app.vault.getFiles();
        const total = files.length;
        let current = 0;

        for (const file of files) {
            current++;
            this.updateStatusBar(`Syncing [${current}/${total}]`);
            await this.handleLocalChange(file);
            // Small delay to prevent blocking the UI and reduce memory pressure spikes
            await new Promise(resolve => setTimeout(resolve, 5));
        }
        
        this.updateStatusBar("Connected");
        new Notice("SpacetimeDB Sync: Completed!");

        if (!this.settings.liveSync && this.client) {
            this.client.disconnect();
            this.client = null;
            this.updateStatusBar("Disconnected");
        }
    }

    private async handleLocalChange(file: TFile) {
        if (this.isRemoteUpdate || !this.client) return;
        
        const content = await this.app.vault.read(file);
        const binary = await this.app.vault.readBinary(file);
        const bytes = new Uint8Array(binary);
        
        // ✅ v2.0.4 Fix: Use new Timestamp(bigint) constructor
        const micros = BigInt(file.stat.mtime) * 1000n;
        const modifiedAt = new Timestamp(micros);

        this.client.reducers.upsertDocument({
            path: file.path,
            content: content,
            contentBytes: bytes,
            modifiedAt: modifiedAt
        });
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

    private async handleRemoteChange(row: Document) {
        const localFile = this.app.vault.getAbstractFileByPath(row.path);
        
        this.isRemoteUpdate = true;
        try {
            if (localFile instanceof TFile) {
                const remoteMicros = row.lastModified.microsSinceUnixEpoch;
                const localMicros = BigInt(localFile.stat.mtime) * 1000n;

                if (remoteMicros > localMicros) {
                    if (this.isBinaryFile(row.path)) {
                        // ✅ Fix: correctly slice binary data
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
                    // ✅ Fix: correctly slice binary data
                    const buffer = row.contentBytes.buffer.slice(
                        row.contentBytes.byteOffset,
                        row.contentBytes.byteOffset + row.contentBytes.byteLength
                    ) as ArrayBuffer;
                    await this.app.vault.createBinary(row.path, buffer);
                } else {
                    await this.app.vault.create(row.path, row.content);
                }
            }
        } finally {
            this.isRemoteUpdate = false;
        }
    }

    private isBinaryFile(path: string): boolean {
        return !!path.match(/\.(png|jpg|jpeg|gif|pdf|zip|docx)$/i);
    }

    private async handleRemoteDelete(row: Document) {
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
    }
}