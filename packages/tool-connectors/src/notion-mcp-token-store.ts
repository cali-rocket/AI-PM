/**
 * Responsibility: minimal token persistence for Notion MCP OAuth sessions.
 * This layer stores only OAuth session data and is isolated from agent logic.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { NotionMcpOAuthSession } from "./notion-mcp-auth-session";

export interface NotionMcpTokenStore {
  load(): Promise<NotionMcpOAuthSession | null>;
  save(session: NotionMcpOAuthSession): Promise<void>;
  clear(): Promise<void>;
}

export interface FileNotionMcpTokenStoreConfig {
  filePath?: string;
}

const DEFAULT_SESSION_FILE_PATH = join(
  homedir(),
  ".ai-pm",
  "notion-mcp-oauth-session.json"
);

export class FileNotionMcpTokenStore implements NotionMcpTokenStore {
  readonly filePath: string;

  constructor(config?: FileNotionMcpTokenStoreConfig) {
    this.filePath = config?.filePath?.trim() || DEFAULT_SESSION_FILE_PATH;
  }

  async load(): Promise<NotionMcpOAuthSession | null> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const accessToken = asString(parsed.accessToken);
      if (!accessToken) {
        return null;
      }

      return {
        accessToken,
        refreshToken: asOptionalString(parsed.refreshToken),
        expiresAt: asOptionalString(parsed.expiresAt),
        scope: asOptionalString(parsed.scope),
      };
    } catch (error) {
      if (isFileMissingError(error)) {
        return null;
      }
      throw new Error(
        `Failed to load Notion MCP OAuth session: ${(error as Error).message}`
      );
    }
  }

  async save(session: NotionMcpOAuthSession): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(session, null, 2), "utf8");
  }

  async clear(): Promise<void> {
    try {
      await rm(this.filePath, { force: true });
    } catch (error) {
      if (!isFileMissingError(error)) {
        throw error;
      }
    }
  }
}

export class InMemoryNotionMcpTokenStore implements NotionMcpTokenStore {
  private session: NotionMcpOAuthSession | null = null;

  async load(): Promise<NotionMcpOAuthSession | null> {
    return this.session;
  }

  async save(session: NotionMcpOAuthSession): Promise<void> {
    this.session = { ...session };
  }

  async clear(): Promise<void> {
    this.session = null;
  }
}

function isFileMissingError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
