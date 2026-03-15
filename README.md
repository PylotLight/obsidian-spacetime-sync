# Obsidian Spacetime Sync

Synchronize your Obsidian vault with [SpacetimeDB](https://spacetimedb.com).

## 🚀 Overview

This plugin provides a robust, real-time synchronization layer for Obsidian, utilizing SpacetimeDB as the backend. It features intelligent hashing, binary file support, and an optimized mobile connection strategy.

## 🏗 Architecture & Code Structure

The project is modularized to ensure maintainability and ease of development. All source code is located in the `src/` directory.

### Core Components

- **[main.ts](src/main.ts)**: The plugin entry point. Coordinates initialization, settings loading, and event registration.
- **[sync-manager.ts](src/sync-manager.ts)**: Encapsulates all SpacetimeDB logic, including:
    - Connection lifecycle management.
    - Local change detection and debouncing.
    - Remote change application.
    - Conflict resolution (via timestamps and hashing).
    - Status bar updates.
- **[logger.ts](src/logger.ts)**: Handles persistent debug logging to a local file and provides an interface for the internal Log View.
- **[types.ts](src/types.ts)**: Centralized definitions for settings, status states, and shared interfaces.

### UI Components

- **[settings-tab.ts](src/settings-tab.ts)**: Defines the plugin settings page.
- **[views/log-view.ts](src/views/log-view.ts)**: An internal Obsidian view (`ItemView`) for inspecting debug logs in real-time.

### Data Layer
- **[module_bindings/](src/module_bindings/)**: Automatically generated SpacetimeDB SDK bindings. Do not edit these manually; they are updated via the SpacetimeDB CLI.

## 🛠 Development

### Prerequisites
- [Bun](https://bun.sh) runtime.
- Obsidian installed on your machine.

### Setup
1. Clone the repository into your vault's `.obsidian/plugins` folder.
2. Run `bun install` to install dependencies.
3. Run `bun run dev` to start the build process in watch mode.

### Adding New Features
- **New Settings**: Update `SpacetimeSyncSettings` in `src/types.ts`, add the UI element in `src/settings-tab.ts`, and handle the logic in `src/sync-manager.ts`.
- **New Reducers/Tables**: Update your SpacetimeDB module, regenerate bindings using `spacetime generate`, and then implement the handler in `src/sync-manager.ts`.
- **New UI Views**: Create a new class in `src/views/`, register it in `src/main.ts`, and add a command to open it.

## 📜 Logging & Debugging
The plugin includes a dedicated logging system.
- Logs are written to `.obsidian/plugins/obsidian-spacetime-sync/debug.log`.
- High-level logs can be viewed directly in Obsidian via the command: `SpacetimeDB: Show Debug Logs`.

## 📄 License
MIT
