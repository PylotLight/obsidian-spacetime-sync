#!/bin/bash

# Exit on error
set -e

# Check for version argument
if [ -z "$1" ]; then
  echo "Usage: ./release.sh <version> (e.g., 0.1.1)"
  exit 1
fi

VERSION=$1

echo "Updating to version $VERSION..."

# Update package.json
sed -i '' "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" package.json

# Update manifest.json
sed -i '' "s/\"version\": \".*\"/\"version\": \"$VERSION\"/" manifest.json

# Commit changes
git add package.json manifest.json
git commit -m "Release v$VERSION"

# Tag and push
git tag "v$VERSION"
git push origin main
git push origin "v$VERSION"

echo "Successfully released v$VERSION! GitHub Actions will handle the build."
