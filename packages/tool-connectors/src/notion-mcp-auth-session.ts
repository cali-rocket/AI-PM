/**
 * Responsibility: OAuth session lifecycle for Notion-hosted MCP clients.
 * Agent/runtime layers use this only as a session provider abstraction.
 */

import { createHash, randomBytes } from "node:crypto";
import {
  FileNotionMcpTokenStore,
  type NotionMcpTokenStore,
} from "./notion-mcp-token-store";

const DEFAULT_AUTHORIZE_URL = "https://mcp.notion.com/oauth/authorize";
const DEFAULT_TOKEN_URL = "https://mcp.notion.com/oauth/token";
const DEFAULT_MIN_VALIDITY_SECONDS = 60;
const DEFAULT_HTTP_TIMEOUT_MS = 45_000;

export interface NotionMcpOAuthSession {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  scope?: string;
}

export interface NotionMcpOAuthConfig {
  clientId: string;
  redirectUri: string;
  callbackPort?: number;
  authorizeUrl?: string;
  tokenUrl?: string;
  scope?: string;
  /**
   * Optional for OAuth providers requiring client_secret.
   * TODO: verify whether Notion-hosted MCP requires confidential client auth.
   */
  clientSecret?: string;
  tokenStore?: NotionMcpTokenStore;
  minValiditySeconds?: number;
  timeoutMs?: number;
}

export interface NotionMcpLoginResult {
  authorizationUrl: string;
  state: string;
  codeVerifier: string;
}

export interface NotionMcpTokenExchangeResult {
  session: NotionMcpOAuthSession;
  receivedAt: string;
}

export interface NotionMcpAuthSessionManager {
  startLogin(input?: { scope?: string }): Promise<NotionMcpLoginResult>;
  completeLoginFromCallback(input: {
    code: string;
    state: string;
    codeVerifier?: string;
  }): Promise<NotionMcpTokenExchangeResult>;
  getValidSession(): Promise<NotionMcpOAuthSession>;
  refreshSession(): Promise<NotionMcpOAuthSession>;
  clearSession(): Promise<void>;
}

interface PendingLoginState {
  codeVerifier: string;
  requestedAt: string;
}

interface TokenEndpointResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

export class NotionMcpOAuthLoginRequiredError extends Error {
  readonly code = "oauth_login_required";

  constructor(message: string) {
    super(message);
    this.name = "NotionMcpOAuthLoginRequiredError";
  }
}

export class NotionMcpOAuthSessionManager implements NotionMcpAuthSessionManager {
  private readonly config: Required<
    Pick<NotionMcpOAuthConfig, "clientId" | "redirectUri">
  > &
    Omit<NotionMcpOAuthConfig, "clientId" | "redirectUri">;
  private readonly tokenStore: NotionMcpTokenStore;
  private readonly pendingStates = new Map<string, PendingLoginState>();

  constructor(config: NotionMcpOAuthConfig) {
    const clientId = config.clientId?.trim();
    const redirectUri = config.redirectUri?.trim();
    if (!clientId) {
      throw new Error("Notion MCP OAuth clientId is required.");
    }
    if (!redirectUri) {
      throw new Error("Notion MCP OAuth redirectUri is required.");
    }

    this.config = {
      ...config,
      clientId,
      redirectUri,
      authorizeUrl: config.authorizeUrl?.trim() || DEFAULT_AUTHORIZE_URL,
      tokenUrl: config.tokenUrl?.trim() || DEFAULT_TOKEN_URL,
      minValiditySeconds: config.minValiditySeconds ?? DEFAULT_MIN_VALIDITY_SECONDS,
      timeoutMs: config.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS,
    };
    this.tokenStore = config.tokenStore ?? new FileNotionMcpTokenStore();
  }

  async startLogin(input?: { scope?: string }): Promise<NotionMcpLoginResult> {
    const state = randomBase64Url(24);
    const codeVerifier = randomBase64Url(64);
    const codeChallenge = sha256Base64Url(codeVerifier);
    const scope = input?.scope?.trim() || this.config.scope?.trim();

    const authorizationUrl = new URL(this.config.authorizeUrl);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", this.config.clientId);
    authorizationUrl.searchParams.set("redirect_uri", this.config.redirectUri);
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("code_challenge", codeChallenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    if (scope) {
      authorizationUrl.searchParams.set("scope", scope);
    }

    this.pendingStates.set(state, {
      codeVerifier,
      requestedAt: new Date().toISOString(),
    });

    return {
      authorizationUrl: authorizationUrl.toString(),
      state,
      codeVerifier,
    };
  }

  async completeLoginFromCallback(input: {
    code: string;
    state: string;
    codeVerifier?: string;
  }): Promise<NotionMcpTokenExchangeResult> {
    const code = input.code?.trim();
    const state = input.state?.trim();
    if (!code || !state) {
      throw new Error("Both authorization code and state are required.");
    }

    const pending = this.pendingStates.get(state);
    const codeVerifier = input.codeVerifier?.trim() || pending?.codeVerifier;
    if (!codeVerifier) {
      throw new Error("PKCE code verifier was not found for OAuth callback state.");
    }

    const tokenResponse = await this.requestToken({
      grantType: "authorization_code",
      authorizationCode: code,
      codeVerifier,
    });
    const receivedAt = new Date().toISOString();
    const session = this.mapTokenResponseToSession(tokenResponse, receivedAt);

    await this.tokenStore.save(session);
    this.pendingStates.delete(state);

    return {
      session,
      receivedAt,
    };
  }

  async getValidSession(): Promise<NotionMcpOAuthSession> {
    const session = await this.tokenStore.load();
    if (!session?.accessToken) {
      throw new NotionMcpOAuthLoginRequiredError(
        "OAuth login required: no saved Notion MCP session."
      );
    }

    if (!session.expiresAt) {
      return session;
    }

    if (isSessionValid(session.expiresAt, this.config.minValiditySeconds)) {
      return session;
    }

    if (!session.refreshToken) {
      throw new NotionMcpOAuthLoginRequiredError(
        "OAuth login required: session expired and refresh token is unavailable."
      );
    }

    return this.refreshSession();
  }

  async refreshSession(): Promise<NotionMcpOAuthSession> {
    const session = await this.tokenStore.load();
    if (!session?.refreshToken) {
      throw new NotionMcpOAuthLoginRequiredError(
        "OAuth login required: refresh token is missing."
      );
    }

    const tokenResponse = await this.requestToken({
      grantType: "refresh_token",
      refreshToken: session.refreshToken,
    });
    const receivedAt = new Date().toISOString();
    const refreshed = this.mapTokenResponseToSession(tokenResponse, receivedAt, session);
    await this.tokenStore.save(refreshed);
    return refreshed;
  }

  async clearSession(): Promise<void> {
    await this.tokenStore.clear();
  }

  private async requestToken(input: {
    grantType: "authorization_code" | "refresh_token";
    authorizationCode?: string;
    codeVerifier?: string;
    refreshToken?: string;
  }): Promise<TokenEndpointResponse> {
    const body = new URLSearchParams();
    body.set("grant_type", input.grantType);
    body.set("client_id", this.config.clientId);

    if (this.config.clientSecret) {
      body.set("client_secret", this.config.clientSecret);
    }

    if (input.grantType === "authorization_code") {
      body.set("code", input.authorizationCode ?? "");
      body.set("redirect_uri", this.config.redirectUri);
      body.set("code_verifier", input.codeVerifier ?? "");
    } else {
      body.set("refresh_token", input.refreshToken ?? "");
    }

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(this.config.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
        signal: controller.signal,
      });
      const text = await response.text();
      const payload = parseJsonObject(text);

      if (!response.ok) {
        throw new Error(
          `Token endpoint failed (${response.status}): ${truncate(text, 300)}`
        );
      }

      return payload;
    } catch (error) {
      throw new Error(
        `Notion MCP OAuth token request failed: ${(error as Error).message}`
      );
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private mapTokenResponseToSession(
    response: TokenEndpointResponse,
    receivedAt: string,
    previousSession?: NotionMcpOAuthSession
  ): NotionMcpOAuthSession {
    const accessToken = asNonEmptyString(response.access_token);
    if (!accessToken) {
      throw new Error(
        "Notion MCP OAuth token response does not include access_token."
      );
    }

    return {
      accessToken,
      refreshToken:
        asNonEmptyString(response.refresh_token) ?? previousSession?.refreshToken,
      expiresAt: toExpiresAt(receivedAt, response.expires_in) ?? previousSession?.expiresAt,
      scope: asNonEmptyString(response.scope) ?? previousSession?.scope,
    };
  }
}

export function createNotionMcpAuthSessionManagerFromEnv():
  | NotionMcpOAuthSessionManager
  | null {
  const clientId = process.env.NOTION_MCP_OAUTH_CLIENT_ID?.trim();
  const redirectUri = process.env.NOTION_MCP_OAUTH_REDIRECT_URI?.trim();
  if (!clientId || !redirectUri) {
    return null;
  }

  return new NotionMcpOAuthSessionManager({
    clientId,
    redirectUri,
    callbackPort: parseOptionalNumber(process.env.NOTION_MCP_OAUTH_CALLBACK_PORT),
    authorizeUrl: process.env.NOTION_MCP_OAUTH_AUTHORIZE_URL?.trim(),
    tokenUrl: process.env.NOTION_MCP_OAUTH_TOKEN_URL?.trim(),
    scope: process.env.NOTION_MCP_OAUTH_SCOPE?.trim(),
    clientSecret: process.env.NOTION_MCP_OAUTH_CLIENT_SECRET?.trim(),
    tokenStore: new FileNotionMcpTokenStore({
      filePath: process.env.NOTION_MCP_OAUTH_SESSION_FILE?.trim(),
    }),
  });
}

function parseJsonObject(value: string): TokenEndpointResponse {
  try {
    const parsed = JSON.parse(value) as TokenEndpointResponse;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function toExpiresAt(receivedAt: string, expiresInSeconds: number | undefined): string | undefined {
  if (typeof expiresInSeconds !== "number" || !Number.isFinite(expiresInSeconds)) {
    return undefined;
  }
  return new Date(new Date(receivedAt).getTime() + expiresInSeconds * 1000).toISOString();
}

function isSessionValid(expiresAt: string, minValiditySeconds: number): boolean {
  const expiresMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiresMs)) {
    return false;
  }
  const threshold = Date.now() + minValiditySeconds * 1000;
  return expiresMs > threshold;
}

function randomBase64Url(byteLength: number): string {
  return randomBytes(byteLength).toString("base64url");
}

function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}
