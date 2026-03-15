---
description: How to release a new version of the Obsidian Spacetime Sync plugin
---

# Plugin Release Process Workflow

Follow these steps to ensure a smooth release with correct versioning and changelog notes.

## 1. Quality Check
- **Build**: Ensure the plugin builds without errors.
// turbo
```bash
bun run build
```
- **Test**: Verify the latest changes locally in Obsidian if possible.

## 2. Update CHANGELOG.md
- Add your changes under the `## [Unreleased]` section.
- Follow the format: `### Added`, `### Changed`, `### Fixed`.
- **CRITICAL**: The release script parses this section. It must NOT be empty.

## 3. Run the Release Script
- Use the `./release.sh` script with the target version.
- **Example**: `./release.sh 0.2.1`
- This script will:
    - Update `package.json` and `manifest.json`.
    - Rename `[Unreleased]` in `CHANGELOG.md` to the new version and date.
    - Prepend a fresh `[Unreleased]` section.
    - **Add ALL changes** (`git add -A`).
    - Commit with `Release vX.Y.Z`.
    - Create an annotated git tag with the release notes.
    - Push to `main` and push the tag.

## 4. Verify GitHub Release
- After the tag is pushed, view the progress in the GitHub Actions tab.
- Once finished, check the [Releases](https://github.com/PylotLight/obsidian-spacetime-sync/releases) page to ensure `main.js` and `manifest.json` are attached.

## Troubleshooting
- **Tag Conflict**: If `v0.2.0` already exists but failed to push, delete it locally: `git tag -d v0.2.0`.
- **Force Push**: If you realize you forgot a file *after* running the script but *before* the tag works, you may need to `git push origin main --force`.
- **Incomplete Commit**: The script uses `git add -A` now, so it should catch all new files (like new module bindings).

// turbo
## Quick Release Command
```bash
./release.sh <version>
```
