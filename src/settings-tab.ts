import { App, Platform, PluginSettingTab, Setting, Notice } from 'obsidian';
import type SpacetimeSyncPlugin from './main';

export class SpacetimeSyncSettingTab extends PluginSettingTab {
    plugin: SpacetimeSyncPlugin;

    constructor(app: App, plugin: SpacetimeSyncPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'SpacetimeDB Sync Settings' });

        // ── Connection ──────────────────────────────────────────────
        new Setting(containerEl)
            .setName('Sync Enabled')
            .setDesc('Master switch to enable or disable SpacetimeDB synchronization.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.syncEnabled)
                .onChange(async (value) => {
                    this.plugin.settings.syncEnabled = value;
                    await this.plugin.saveSettings();
                    
                    if (value) {
                        this.plugin.syncManager.initSpacetime();
                    } else {
                        this.plugin.syncManager.cleanup();
                        this.plugin.syncManager.updateStatusBar("Stopped");
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

        // ── Authentication ───────────────────────────────────────────
        containerEl.createEl('h3', { text: 'Authentication' });
        containerEl.createEl('p', {
            text: 'Enable this if your SpacetimeDB is behind an auth-protected proxy (e.g. Pangolin, Cloudflare Access). The token is passed to the proxy on connection.',
            cls: 'setting-item-description',
        });

        new Setting(containerEl)
            .setName('Enable Auth')
            .setDesc('Require authentication before connecting to the proxy.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.authEnabled)
                .onChange(async (value) => {
                    this.plugin.settings.authEnabled = value;
                    await this.plugin.saveSettings();
                    this.display(); // Refresh to show/hide auth fields
                }));

        if (this.plugin.settings.authEnabled) {
            // Auth provider URL
            new Setting(containerEl)
                .setName('Auth Provider URL')
                .setDesc('The login page URL of your proxy. After login, it must redirect back to obsidian://spacetime-sync-auth?token=...')
                .addText(text => text
                    .setPlaceholder('https://your-proxy.example.com/auth')
                    .setValue(this.plugin.settings.authProviderUrl)
                    .onChange(async (value) => {
                        this.plugin.settings.authProviderUrl = value.trim();
                        await this.plugin.saveSettings();
                    }));

            // Status + Login/Logout
            const statusText = this.plugin.authManager.getStatusText();
            new Setting(containerEl)
                .setName('Auth Status')
                .setDesc(statusText)
                .addButton(button => button
                    .setButtonText('Login')
                    .setCta()
                    .onClick(() => {
                        this.plugin.authManager.login();
                    }))
                .addButton(button => button
                    .setButtonText('Logout')
                    .setWarning()
                    .onClick(async () => {
                        await this.plugin.authManager.logout();
                        this.plugin.syncManager.cleanup();
                        this.display();
                    }));

            // ── Mobile fallback: paste token manually ─────────────────
            // On Android, the obsidian:// redirect from a browser is unreliable.
            // Users can copy the token from the browser and paste it here instead.
            const isMobile = Platform.isMobile || Platform.isAndroidApp || Platform.isIosApp;
            const mobileDesc = isMobile
                ? 'On mobile, the browser redirect may not return to Obsidian automatically. Copy the token from your browser after login and paste it here.'
                : 'You can also paste a token manually (useful on mobile where browser redirects may be unreliable).';

            containerEl.createEl('h4', { text: 'Manual Token Entry' });

            let tokenInput = '';
            new Setting(containerEl)
                .setName('Paste Token')
                .setDesc(mobileDesc)
                .addText(text => {
                    text.setPlaceholder('Paste your auth token here...')
                        .onChange(value => { tokenInput = value.trim(); });
                    // On mobile, make the input larger for easier tapping
                    if (isMobile) text.inputEl.style.minWidth = '200px';
                    return text;
                })
                .addButton(button => button
                    .setButtonText('Apply')
                    .setCta()
                    .onClick(async () => {
                        if (!tokenInput) {
                            new Notice('SpacetimeDB: No token entered.');
                            return;
                        }
                        await this.plugin.authManager.handleCallback({ token: tokenInput });
                        this.display();
                    }));
        }

        // ── Debug Logging ────────────────────────────────────────────
        containerEl.createEl('h3', { text: 'Debug Logging' });

        new Setting(containerEl)
            .setName('Enable Debug Logging')
            .setDesc('Write detailed logs to debug.log in the plugin folder.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.debugLogging)
                .onChange(async (value) => {
                    this.plugin.settings.debugLogging = value;
                    this.plugin.logger.setEnabled(value);
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Clear Debug Logs')
            .setDesc('Delete all content from the debug.log file.')
            .addButton(button => button
                .setButtonText('Clear Logs')
                .onClick(async () => {
                    await this.plugin.logger.clearLogs();
                    new Notice('SpacetimeDB: Logs cleared.');
                }));

        containerEl.createEl('p', { text: 'You can also open the log view: ' })
            .createEl('a', { 
                text: 'Show Logs', 
                href: '#',
                cls: 'internal-link' 
            })
            .onClickEvent(async (e) => {
                e.preventDefault();
                // @ts-ignore
                this.plugin.openLogView();
            });
    }
}
