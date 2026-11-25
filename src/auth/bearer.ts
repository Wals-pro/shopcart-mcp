import type { NextFunction, Request, Response } from "express";
import type { AppConfig } from "../config.js";
import type { StorageBackend, UserRecord } from "../store/types.js";
import { sha256Hex } from "./crypto.js";

export interface AuthenticatedContext {
  userId: string;
  user: UserRecord;
  clientId: string;
  scopes: string[];
  resource: string;
  tokenHash: string;
}

declare global {
  namespace Express {
    interface Request {
      mcpAuth?: AuthenticatedContext;
    }
  }
}

/**
 * RFC 6750 §3.1 compliant Bearer auth middleware:
 * - Missing Authorization header -> 401 with WWW-Authenticate WITHOUT error="invalid_token"
 * - Invalid/expired/revoked/wrong-resource Bearer token -> 401 WITH error="invalid_token"
 */
export function createBearerAuthMiddleware(config: AppConfig, store: StorageBackend) {
  const resourceUrl = `${config.appOrigin}/mcp`;
  const metadataUrl = `${config.appOrigin}/.well-known/oauth-protected-resource/mcp`;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;

    // 1. Missing Authorization header: MUST NOT include error="invalid_token"
    if (!authHeader || authHeader.trim() === "") {
      res.setHeader(
        "WWW-Authenticate",
        `Bearer resource_metadata="${metadataUrl}", scope="mcp:read"`
      );
      res.status(401).json({
        error: "unauthorized",
        error_description: "Bearer token required"
      });
      return;
    }

    const match = authHeader.match(/^Bearer\s+([^\s]+)$/i);
    const sendInvalidToken = (desc: string) => {
      res.setHeader(
        "WWW-Authenticate",
        `Bearer resource_metadata="${metadataUrl}", scope="mcp:read", error="invalid_token"`
      );
      res.status(401).json({
        error: "invalid_token",
        error_description: desc
      });
    };

    if (!match?.[1]) {
      sendInvalidToken("Malformed Authorization header");
      return;
    }

    const tokenHash = sha256Hex(match[1]);
    const token = await store.getOAuthToken(tokenHash);
    if (
      !token ||
      token.type !== "access" ||
      token.revoked ||
      token.expiresAt.getTime() <= Date.now()
    ) {
      sendInvalidToken("Token is invalid or expired");
      return;
    }

    // RFC 8707 resource binding verification
    if (token.resource !== resourceUrl) {
      sendInvalidToken("Token is not bound to this MCP resource");
      return;
    }

    const user = await store.getUserById(token.userId);
    if (!user) {
      sendInvalidToken("Account not found");
      return;
    }

    req.mcpAuth = {
      userId: user.id,
      user,
      clientId: token.clientId,
      scopes: token.scopes,
      resource: token.resource,
      tokenHash
    };
    next();
  };
}
