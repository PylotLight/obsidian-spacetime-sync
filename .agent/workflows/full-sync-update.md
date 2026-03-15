---
description: High-level workflow for updating both backend and frontend sync logic
---

# Full Sync System Update Workflow

Use this workflow when a feature requires changes to both the SpacetimeDB backend and the Obsidian plugin.

## Phase 1: Backend Update
1. Update `schema.ts` and `index.ts` in the `obsidian-sync-backend` project.
2. Publish with `spacetime publish`. (See [spacetime-publish.md](file://.../obsidian-spacetime-sync/.agent/workflows/spacetime-publish.md)).
3. Verify the module status via `spacetime logs`.

## Phase 2: Plugin Update
1. Regenerate TypeScript bindings in `obsidian-spacetime-sync`.
2. Update `main.ts` to implement the new logic using the fresh types.
3. Fix any TypeScript errors caused by schema changes.
4. Verify the build with `bun run build`.

## Phase 3: Release
1. Update `CHANGELOG.md` with the new features.
2. Trigger the release with `./release.sh <new-version>`. (See [release.md](file://.../obsidian-spacetime-sync/.agent/workflows/release.md)).

## Summary of Checklist
- [ ] Schema updated & Published
- [ ] Bindings regenerated
- [ ] Plugin logic implemented & Built
- [ ] Changelog updated
- [ ] Release script executed