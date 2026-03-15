import { ItemView, WorkspaceLeaf, Notice } from 'obsidian';
import type SpacetimeSyncPlugin from '../main';

export const LOG_VIEW_TYPE = 'spacetimedb-log-view';

export class LogView extends ItemView {
    plugin: SpacetimeSyncPlugin;
    private logContentEl: HTMLElement | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: SpacetimeSyncPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return LOG_VIEW_TYPE;
    }

    getDisplayText(): string {
        return 'SpacetimeDB Logs';
    }

    getIcon(): string {
        return 'terminal';
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('spacetimedb-log-view');

        const header = contentEl.createEl('div', { cls: 'log-view-header' });
        header.createEl('h4', { text: 'SpacetimeDB Debug Logs' });

        const actions = header.createEl('div', { cls: 'log-view-actions' });
        
        const refreshBtn = actions.createEl('button', { text: 'Refresh' });
        refreshBtn.onClickEvent(() => this.refreshLogs());

        const clearBtn = actions.createEl('button', { text: 'Clear' });
        clearBtn.onClickEvent(async () => {
            await this.plugin.logger.clearLogs();
            this.refreshLogs();
            new Notice('Logs cleared');
        });

        this.logContentEl = contentEl.createEl('pre', { cls: 'log-content' });
        this.logContentEl.style.whiteSpace = 'pre-wrap';
        this.logContentEl.style.wordBreak = 'break-all';
        this.logContentEl.style.maxHeight = 'calc(100% - 60px)';
        this.logContentEl.style.overflowY = 'auto';
        this.logContentEl.style.padding = '10px';
        this.logContentEl.style.backgroundColor = 'var(--background-secondary)';
        this.logContentEl.style.borderRadius = '5px';
        this.logContentEl.style.fontSize = '0.85em';

        this.refreshLogs();
    }

    async refreshLogs() {
        if (!this.logContentEl) return;
        const content = await this.plugin.logger.getLogContent();
        this.logContentEl.setText(content || 'No logs available.');
        this.logContentEl.scrollTop = this.logContentEl.scrollHeight;
    }
}
