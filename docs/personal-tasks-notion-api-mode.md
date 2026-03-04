# Personal Tasks Notion API Mode

## Why this mode

Personal Tasks reader now uses Notion internal integration secret + Notion REST API.
OAuth/MCP session is no longer the primary runtime dependency for Personal Tasks reads.

## Required config

- `PERSONAL_TASKS_DATABASE_ID`
- `PERSONAL_TASKS_READER_MODE=notion_api` (or legacy `mcp`, mapped to `notion_api`)
- `NOTION_INTERNAL_INTEGRATION_SECRET`

Optional:

- `NOTION_API_BASE_URL` (default `https://api.notion.com`)
- `NOTION_API_VERSION` (default `2022-06-28`)

## Runtime behavior

- `mock` mode:
  - Always uses `mock-notion-tasks-reader`.
- `notion_api` mode:
  - Tries `notion-api-tasks-reader`.
  - If init/smoke read fails, logs reason and falls back to mock reader.

## Guardrails

- Personal Tasks only: reader is restricted to configured `PERSONAL_TASKS_DATABASE_ID`.
- Read-only only: no write endpoints.
- No generic workspace search/exploration is added.

## Sharing requirement

The Notion internal integration must be shared with the Personal Tasks database, or REST reads fail with authorization errors.
