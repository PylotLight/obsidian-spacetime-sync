---
description: How to publish changes to the SpacetimeDB backend and sync with the plugin
---

# SpacetimeDB Publish Workflow

Follow these steps when modifying the backend schema or reducers.

## 1. Modify Backend Code
- Navigate to the backend directory: `.../obsidian-sync-backend/spacetimedb/src`.
- Update `schema.ts` for table changes.
- Update `index.ts` for reducer logic changes.

## 2. Test Locally (Optional)
- It's recommended to run a local instance if possible, but often we publish directly to the dev environment.

## 3. Publish to SpacetimeDB
- Run the publish command from the backend directory.
// turbo
```bash
spacetime publish obsidian-sync-backend -y
```
- **Note**: If you've made breaking changes to the schema (e.g., adding/removing non-optional fields), you may need a destructive migration:
```bash
spacetime publish obsidian-sync-backend --delete-data -y
```

## 4. Regenerate Client Bindings
- After a successful publish, you MUST regenerate the TypeScript bindings in the plugin project so the types match the new schema.
- Navigate to the plugin directory: `obsidian-spacetime-sync`.
// turbo
```bash
spacetime generate --lang typescript --out-dir src/module_bindings --project obsidian-sync-backend
```

## 5. Update Plugin Code
- If you added new reducers or table fields, update `src/main.ts` to utilize them.
- Check for TypeScript errors in the `src/module_bindings` directory as they reflect structural changes in the DB.

## Summary of Commands
| Action | Command |
| :--- | :--- |
| **Publish** | `spacetime publish obsidian-sync-backend -y` |
| **Destructive Publish** | `spacetime publish obsidian-sync-backend --delete-data -y` |
| **Generate Bindings** | `spacetime generate --lang typescript --out-dir src/module_bindings --project obsidian-sync-backend` |