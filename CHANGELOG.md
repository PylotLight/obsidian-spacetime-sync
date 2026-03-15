# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

### Changed

### Fixed

---

## [0.2.1] - 2026-03-16

### Added
- **Dynamic Connection Management**: Auto-reconnect loop and online/offline event handlers for robust syncing on mobile.
- **Debounced Auto-Push**: Efficient background syncing with a configurable bounce period (Push Delay).
- **Simplified Settings UI**: Replaced redundant toggles with a consolidated "Sync Enabled" switch and a "Sync Mode" (Auto vs Manual) dropdown.

### Changed
- Replaced "Connected" and "Live Sync" toggles with more intelligent sync behavior.
- Manual sync now intelligently manages connection state based on current settings.

### Fixed

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
