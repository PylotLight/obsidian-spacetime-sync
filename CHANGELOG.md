# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

### Changed

### Fixed

---

## [0.1.5] - 2026-03-14

### Added
- "Copy Connection URL" command to export settings for mobile.
- "Apply Connection URL from Clipboard" command to simplify mobile setup.
- Direct link to `debug.log` in plugin settings.
- Release process workflow for agents.

### Changed
- Improved `LogManager` path resolution for better cross-platform reliability.

### Fixed
- Fixed issue where `debug.log` might not be created on some platforms due to path resolution errors.

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
