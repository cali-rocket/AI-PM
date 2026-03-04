/**
 * Responsibility: local OAuth callback receiver for Notion MCP login flow.
 * This utility is intentionally isolated from reader/agent runtime logic.
 */

import { createServer } from "node:http";
import { URL } from "node:url";
import type {
  NotionMcpAuthSessionManager,
  NotionMcpLoginResult,
  NotionMcpTokenExchangeResult,
} from "./notion-mcp-auth-session";

const DEFAULT_CALLBACK_TIMEOUT_MS = 180_000;
const DEFAULT_CALLBACK_PATH = "/oauth/callback";

export interface NotionMcpOAuthCallbackPayload {
  code: string;
  state: string;
}

export interface NotionMcpOAuthCallbackServerConfig {
  callbackPort: number;
  callbackPath?: string;
  timeoutMs?: number;
}

export async function waitForNotionMcpOAuthCallback(
  config: NotionMcpOAuthCallbackServerConfig
): Promise<NotionMcpOAuthCallbackPayload> {
  const callbackPath = normalizeCallbackPath(config.callbackPath || DEFAULT_CALLBACK_PATH);
  const timeoutMs = config.timeoutMs ?? DEFAULT_CALLBACK_TIMEOUT_MS;

  return new Promise<NotionMcpOAuthCallbackPayload>((resolve, reject) => {
    const server = createServer((req, res) => {
      try {
        const requestUrl = new URL(req.url || "/", `http://localhost:${config.callbackPort}`);
        if (requestUrl.pathname !== callbackPath) {
          res.statusCode = 404;
          res.end("Not Found");
          return;
        }

        const code = requestUrl.searchParams.get("code")?.trim();
        const state = requestUrl.searchParams.get("state")?.trim();
        const error = requestUrl.searchParams.get("error")?.trim();

        if (error) {
          res.statusCode = 400;
          res.end("OAuth failed. You can close this window.");
          cleanupAndReject(new Error(`OAuth callback returned error: ${error}`));
          return;
        }
        if (!code || !state) {
          res.statusCode = 400;
          res.end("Missing code/state. You can close this window.");
          cleanupAndReject(new Error("OAuth callback missing code or state."));
          return;
        }

        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("Notion MCP login complete. You can close this window.");
        cleanupAndResolve({ code, state });
      } catch (error) {
        cleanupAndReject(error as Error);
      }
    });

    const timeoutHandle = setTimeout(() => {
      cleanupAndReject(
        new Error("Timed out while waiting for OAuth callback.")
      );
    }, timeoutMs);

    server.listen(config.callbackPort, "127.0.0.1");

    function cleanup(): void {
      clearTimeout(timeoutHandle);
      server.close();
    }

    function cleanupAndResolve(payload: NotionMcpOAuthCallbackPayload): void {
      cleanup();
      resolve(payload);
    }

    function cleanupAndReject(error: Error): void {
      cleanup();
      reject(error);
    }
  });
}

export async function runNotionMcpLocalOAuthLogin(
  input: {
    sessionManager: NotionMcpAuthSessionManager;
    callbackPort: number;
    callbackPath?: string;
    timeoutMs?: number;
  }
): Promise<{
  login: NotionMcpLoginResult;
  tokenResult: NotionMcpTokenExchangeResult;
}> {
  const login = await input.sessionManager.startLogin();
  const callbackPayload = await waitForNotionMcpOAuthCallback({
    callbackPort: input.callbackPort,
    callbackPath: input.callbackPath,
    timeoutMs: input.timeoutMs,
  });
  const tokenResult = await input.sessionManager.completeLoginFromCallback(
    callbackPayload
  );
  return { login, tokenResult };
}

function normalizeCallbackPath(value: string): string {
  if (value.startsWith("/")) {
    return value;
  }
  return `/${value}`;
}
