# Notion Personal Tasks Read Test Plan (Notion API)

## Scope

This plan validates Personal Tasks read flow with:

- Notion internal integration secret
- Notion REST API reader
- strict `PERSONAL_TASKS_DATABASE_ID` scope
- read-only behavior

## Required env

- `PERSONAL_TASKS_READER_MODE=notion_api`
- `PERSONAL_TASKS_DATABASE_ID=<personal_tasks_db_id>`
- `NOTION_INTERNAL_INTEGRATION_SECRET=<internal_integration_secret>`

Optional:

- `NOTION_API_BASE_URL=https://api.notion.com`
- `NOTION_API_VERSION=2022-06-28`

## Preconditions

1. The Notion integration is shared directly with the Personal Tasks DB.
2. The DB has properties compatible with current mapping:
3. title
4. status/select (`not started` | `in progress` | `done`)
5. created time
6. due date (nullable)
7. last edited time

## Smoke path

1. Run `npm run demo:orchestrator`.
2. Confirm log: `[notion-reader] mode=notion_api, attempting Notion API reader`.
3. If API auth or schema fails, confirm fallback log to mock reader.
4. Run `npm run diagnose:personal-tasks` to inspect schema/property mapping and sample rows.

## Checks

1. `listTasks` returns only rows from configured database.
2. `listTasksByStatus("in progress")` filters correctly.
3. `getTaskByPageId` returns null when page is outside the configured DB.
4. `getTaskPageBody` returns plain text from page blocks.
5. No write endpoint is invoked.

## Notes

- Legacy `PERSONAL_TASKS_READER_MODE=mcp` is treated as deprecated alias and mapped to `notion_api`.
- OAuth/MCP session is no longer a required runtime assumption for Personal Tasks reader.
- `diagnose:personal-tasks` is read-only; it does not modify database/page content.
