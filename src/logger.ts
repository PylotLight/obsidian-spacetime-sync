import { App, Plugin, TFile } from 'obsidian';

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}

export class LogManager {
    private app: App;
    private plugin: Plugin;
    private logFilePath: string;
    private enabled: boolean = false;
    private maxLogSizeMB: number = 2; // Default 2MB limit

    constructor(app: App, plugin: Plugin) {
        this.app = app;
        this.plugin = plugin;
        this.logFilePath = `${this.plugin.manifest.dir}/debug.log`;
    }

    public setEnabled(enabled: boolean) {
        this.enabled = enabled;
        if (enabled) {
            this.info("Logging enabled");
        }
    }

    public async clearLogs() {
        const adapter = this.app.vault.adapter;
        if (await adapter.exists(this.logFilePath)) {
            await adapter.write(this.logFilePath, "");
            this.info("Logs cleared");
        }
    }

    public async getLogFile(): Promise<TFile | null> {
        const file = this.app.vault.getAbstractFileByPath(this.logFilePath);
        if (file instanceof TFile) {
            return file;
        }
        return null;
    }

    private async appendLog(level: LogLevel, message: string) {
        if (!this.enabled && level < LogLevel.WARN) return;

        const timestamp = new Date().toISOString();
        const levelName = LogLevel[level];
        const logLine = `[${timestamp}] [${levelName}] ${message}\n`;

        // Log to console as well
        switch (level) {
            case LogLevel.DEBUG: console.debug(message); break;
            case LogLevel.INFO: console.info(message); break;
            case LogLevel.WARN: console.warn(message); break;
            case LogLevel.ERROR: console.error(message); break;
        }

        try {
            const adapter = this.app.vault.adapter;
            
            // Check file size before appending
            if (await adapter.exists(this.logFilePath)) {
                const stats = await adapter.stat(this.logFilePath);
                if (stats && stats.size > this.maxLogSizeMB * 1024 * 1024) {
                    // Rotate or clear if too large
                    await adapter.write(this.logFilePath, `[${timestamp}] [INFO] Log size exceeded ${this.maxLogSizeMB}MB. Cleared.\n`);
                }
            }

            await adapter.append(this.logFilePath, logLine);
        } catch (err) {
            console.error("Failed to write to log file:", err);
        }
    }

    public debug(message: string) { this.appendLog(LogLevel.DEBUG, message); }
    public info(message: string) { this.appendLog(LogLevel.INFO, message); }
    public warn(message: string) { this.appendLog(LogLevel.WARN, message); }
    public error(message: string, error?: any) {
        let fullMessage = message;
        if (error) {
            if (error instanceof Error) {
                fullMessage += ` - ${error.message}\n${error.stack}`;
            } else {
                fullMessage += ` - ${JSON.stringify(error)}`;
            }
        }
        this.appendLog(LogLevel.ERROR, fullMessage);
    }
}
