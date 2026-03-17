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
            .setDesc('Auto: sync changes after a delay. Manual: only sync when the ribbon icon is clicked.')
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
            .setDesc('Debounce period before pushing local changes to the server.')
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
            .setName('Server URL')
            .setDesc('URL of your SpacetimeDB instance or proxy. Accepts ws://, wss://, http://, https://, or bare host:port. When auth is enabled, login opens this same host in your browser.')
            .addText(text => text
                .setPlaceholder('https://db.example.com  or  ws://192.168.1.10:4000')
                .setValue(this.plugin.settings.host)
                .onChange(async (value) => {
                    this.plugin.settings.host = value.trim();
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Database Name')
            .setDesc('The name of your deployed SpacetimeDB module.')
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
            text: 'Enable if your SpacetimeDB is behind an auth-protected proxy (Pangolin, Cloudflare Access, etc.). The token is injected as a browser cookie before connecting — the proxy validates it on the WebSocket upgrade.',
            cls: 'setting-item-description',
        });

        new Setting(containerEl)
            .setName('Enable Auth')
            .setDesc('Require login before connecting to the proxy.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.authEnabled)
                .onChange(async (value) => {
                    this.plugin.settings.authEnabled = value;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        if (this.plugin.settings.authEnabled) {
            // Auth status + login/logout
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

            // Cookie name (advanced)
            new Setting(containerEl)
                .setName('Auth Cookie Name')
                .setDesc('Cookie name the proxy expects. Cloudflare Access uses "CF_Authorization". Check your proxy docs.')
                .addText(text => text
                    .setPlaceholder('CF_Authorization')
                    .setValue(this.plugin.settings.authCookieName)
                    .onChange(async (value) => {
                        this.plugin.settings.authCookieName = value.trim() || 'CF_Authorization';
                        await this.plugin.saveSettings();
                    }));

            // Mobile fallback: manual token paste
            const isMobile = Platform.isMobile || Platform.isAndroidApp || Platform.isIosApp;
            containerEl.createEl('h4', { text: 'Manual Token Entry' });
            containerEl.createEl('p', {
                text: isMobile
                    ? 'If the browser did not redirect back automatically, copy the token from the browser page and paste it here.'
                    : 'Paste a token manually (useful on mobile where browser redirect may not return automatically).',
                cls: 'setting-item-description',
            });

            let tokenInput = '';
            new Setting(containerEl)
                .setName('Paste Token')
                .addText(text => {
                    text.setPlaceholder('Paste your auth token here...')
                        .onChange(value => { tokenInput = value.trim(); });
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
