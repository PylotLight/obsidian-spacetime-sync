import { Plugin, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import { SpacetimeSyncSettings, DEFAULT_SETTINGS } from './types';
import { LogManager } from './logger';
import { SyncManager } from './sync-manager';
import { SpacetimeSyncSettingTab } from './settings-tab';
import { LogView, LOG_VIEW_TYPE } from './views/log-view';

export default class SpacetimeSyncPlugin extends Plugin {
    settings!: SpacetimeSyncSettings;
    public logger!: LogManager;
    public syncManager!: SyncManager;

    async onload() {
        this.logger = new LogManager(this.app, this);
        await this.loadSettings();
        this.logger.setEnabled(this.settings.debugLogging);
        this.logger.info("Plugin loading...");

        if (!this.settings.deviceId) {
            this.settings.deviceId = 'device-' + Math.random().toString(36).substring(2, 11);
            await this.saveSettings();
        }

        this.syncManager = new SyncManager(
            this.app, 
            this.settings, 
            this.logger, 
            this.manifest,
            () => this.saveSettings()
        );

        this.registerView(
            LOG_VIEW_TYPE,
            (leaf) => new LogView(leaf, this)
        );

        this.addSettingTab(new SpacetimeSyncSettingTab(this.app, this));

        // Add ribbon icon for manual sync
        this.addRibbonIcon('refresh-cw', 'Sync with SpacetimeDB', () => {
            this.syncManager.manualSync();
        });

        // Add command palette
        this.addCommand({
            id: 'spacetime-manual-sync',
            name: 'Manual Sync with SpacetimeDB',
            callback: () => {
                this.syncManager.manualSync();
            }
        });

        // Initialize status bar
        const statusBarItem = this.addStatusBarItem();
        this.syncManager.setStatusBarItem(statusBarItem);

        this.syncManager.init();

        this.registerEvent(this.app.vault.on('modify', (file) => file instanceof TFile && this.syncManager.debouncedHandleLocalChange(file)));
        this.registerEvent(this.app.vault.on('create', (file) => file instanceof TFile && this.syncManager.debouncedHandleLocalChange(file)));
        this.registerEvent(this.app.vault.on('delete', (file) => this.syncManager.handleLocalDelete(file)));
        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.syncManager.handleLocalRename(file, oldPath)));

        this.setupCommands();
        this.setupNetworkHandlers();
    }

    private setupCommands() {
        this.addCommand({
            id: 'spacetime-show-logs',
            name: 'Show Debug Logs',
            callback: () => {
                this.openLogView();
            }
        });

        this.addCommand({
            id: 'spacetime-clear-logs',
            name: 'Clear Debug Logs',
            callback: async () => {
                await this.logger.clearLogs();
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
                            if (this.settings.syncEnabled) this.syncManager.initSpacetime();
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
            if (this.settings.syncEnabled) this.syncManager.initSpacetime();
        });

        window.addEventListener('offline', () => {
            this.logger.info("Device offline, disconnecting...");
            this.syncManager.cleanup();
            this.syncManager.updateStatusBar("Offline");
        });

        // Focus Tracking
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && this.settings.syncEnabled) {
                this.logger.info("App focused/visible, checking for updates...");
                this.syncManager.initSpacetime();
            }
        });
    }

    onunload() {
        this.syncManager.cleanup();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async openLogView() {
        const { workspace } = this.app;

        let leaf: WorkspaceLeaf | null = null;
        const leaves = workspace.getLeavesOfType(LOG_VIEW_TYPE);

        if (leaves.length > 0) {
            leaf = leaves[0];
        } else {
            leaf = workspace.getRightLeaf(false);
            if (leaf) {
                await leaf.setViewState({ type: LOG_VIEW_TYPE, active: true });
            }
        }

        if (leaf) {
            workspace.revealLeaf(leaf);
        }
    }
}