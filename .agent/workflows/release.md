---
description: How to release a new version of the Obsidian Spacetime Sync plugin
---

# Release Process Workflow

Follow these steps to ensure a smooth release with correct versioning and changelog notes.

## 1. Update CHANGELOG.md
- Add your changes under the `## [Unreleased]` section.
- Follow the format: `### Added`, `### Changed`, `### Fixed`.
- Ensure there are actual notes there; the release script will fail if it's empty.

## 2. Run the Release Script
- Use the `./release.sh` script with the target version.
- **Example**: `./release.sh 0.1.5`
- This script will:
    - Update `package.json` and `manifest.json`.
    - Rename `[Unreleased]` in `CHANGELOG.md` to the new version and date.
    - Commit the changes.
    - Create an annotated git tag with the release notes.
    - Push to `main` and push the tag.

## 3. Verify GitHub Actions
- After pushing the tag, a GitHub Action will automatically:
    - Build the plugin (`bun run build`).
    - Create a GitHub Release.
    - Attach `main.js` and `manifest.json` to the release.

## Troubleshooting
- **Tag already exists**: If the tag locally exists but the release failed, delete it with `git tag -d v<version>` and retry.
- **Empty Unreleased section**: The script requires content in the `[Unreleased]` section. If you have nothing new to add, the release might not be necessary or you should add a "Maintenance" note.

// turbo
## Quick Release Command
```bash
./release.sh 0.1.5
```
