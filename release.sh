#!/bin/bash

# Exit on error
set -e

# Check for version argument
if [ -z "$1" ]; then
  echo "Usage: ./release.sh <version> (e.g., 0.1.2)"
  exit 1
fi

VERSION=$1
DATE=$(date +%Y-%m-%d)

# Check if CHANGELOG.md has [Unreleased] changes
if ! grep -q "## \[Unreleased\]" CHANGELOG.md; then
  echo "Error: CHANGELOG.md does not have an [Unreleased] section."
  exit 1
fi

# Extract release notes (content between [Unreleased] and the next ##)
# This is a bit tricky with sed/grep, so we'll use a temporary file
NOTES=$(sed -n '/## \[Unreleased\]/,/## \[/p' CHANGELOG.md | sed '1d;$d')

if [ -z "$(echo "$NOTES" | tr -d '[:space:]')" ]; then
  echo "Error: No changes found in [Unreleased] section of CHANGELOG.md."
  exit 1
fi

echo "Updating to version $VERSION..."

# Update package.json and manifest.json
sed -i '' "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" package.json
sed -i '' "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" manifest.json

# Update CHANGELOG.md: Rename [Unreleased] to [VERSION] - DATE and prepend new [Unreleased]
sed -i '' "s/## \[Unreleased\]/## \[Unreleased\]\n\n### Added\n\n### Changed\n\n### Fixed\n\n---\n\n## \[$VERSION\] - $DATE/" CHANGELOG.md

# Commit changes
git add -A
git commit -m "Release v$VERSION"

# Tag and push with notes
git tag -a "v$VERSION" -m "Release v$VERSION"$'\n\n'"$NOTES"
git push origin main
git push origin "v$VERSION"

echo "Successfully released v$VERSION with automated notes!"
