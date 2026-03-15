import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
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
