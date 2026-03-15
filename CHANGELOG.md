# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

### Changed

### Fixed

---

## [0.3.0] - 2026-03-16

### Added
- **Internal Log View**: Added a dedicated "SpacetimeDB Logs" view inside Obsidian. This replaces the unreliable `debug.log` file opening method and provides a more seamless debugging experience.
- **Log Management Actions**: Added "Refresh" and "Clear" buttons directly within the Log View.

### Changed
- **Major Architecture Refactor**: Split the plugin into multiple modules for better maintainability:
    - `SyncManager`: Encapsulates SpacetimeDB connection and synchronization logic.
    - `LogManager`: Enhanced with content retrieval for the new view.
    - `SpacetimeSyncSettingTab`: Extracted to a separate UI module.
    - `LogView`: New component for internal logging UI.
    - `types.ts`: Centralized types and interfaces.

### Fixed
- Fixed issues with opening the debug log file on certain platforms (notably mobile) by providing an internal view.

---

## [0.2.2] - 2026-03-16

### Added
- **Ephemeral Connection Model**: Optimized for mobile by connecting ONLY during sync and disconnecting immediately after to save battery.
- **Pending Sync Queue**: Tracks changes while offline or disconnected, ensuring they are pushed efficiently on next connection without a full vault scan.
- **App Focus Syncing**: Automatically triggers a sync check when the Obsidian app becomes visible/focused.
- **Idle Timeout**: Automatically disconnects from SpacetimeDB after 30 seconds of inactivity on mobile.

### Changed
- Replaced "Connected" and "Live Sync" toggles with more intelligent sync behavior.
- Manual sync now intelligently manages connection state based on current settings.

### Fixed

---

## [0.2.1] - 2026-03-16

### Added

### Changed

---

## [0.2.0] - 2026-03-16

### Added
- **Intelligent Hashing**: Implemented SHA-256 hashing for files to enable efficient sync. Files are only uploaded if their content has actually changed.
- **Sync Progress Reporting**: Real-time sync status (syncing, completed, failed) and counts (updated, skipped, error) are now reported to the SpacetimeDB backend.
- **Enhanced Device Metadata**: Devices now report their OS and client version to the backend for better fleet management.
- **Status Bar Progress**: Improved status bar indicators for sync progress (e.g., "Syncing [10/100]").

### Changed
- Optimized `syncAllFiles` loop with small delays to prevent UI blocking and improve stability on mobile devices.
- Refactored `initSpacetime` to handle platform-specific registration (detects Desktop vs Android vs iOS).
- Updated .gitignore to include .agent/plans

### Fixed
- Fixed TypeScript type errors in the sync logic related to SpacetimeDB row structures.

---

## [0.1.6] - 2026-03-14

### Added
- "Copy Connection URL" command to export settings for mobile.
- "Apply Connection URL from Clipboard" command to simplify mobile setup.
- Direct link to `debug.log` in plugin settings.
- Release process workflow for agents.

### Changed
- Improved `LogManager` path resolution for better cross-platform reliability.

### Fixed
- Fixed issue where `debug.log` might not be created on some platforms due to path resolution errors.
- Deployment fix: ensure all source code and assets are included in the release build.

---

## [0.1.5] - 2026-03-14
- Botched release (missing source files in tag). Replaced by 0.1.6.

---

## [0.1.4] - 2026-03-14
- Deployment fix: ensure UI settings for debug logging are included in the build.

---

## [0.1.3] - 2026-03-14
- Partial rollout of logging system (backend only).

---

## [0.1.2] - 2026-03-14

### Added
- GitHub repository setup.
- Automated release workflow.
- `release.sh` script for versioning and tagging.
- Automated release notes from `CHANGELOG.md`.

### Changed
- Renamed plugin and repository to **Obsidian Spacetime Sync**.

---

## [0.1.1] - 2026-03-14
- Fix release permissions in GitHub Actions.

## [0.1.0] - 2026-03-14
- Initial release.
