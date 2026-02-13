/**
 * Auth Middleware — Bearer token authentication for the dashboard API.
 *
 * Spec v0.6 §5.8 "Dashboard Authentication":
 *   - Validates Authorization: Bearer <token> header.
 *   - Skips auth for the /health endpoint.
 *   - Token sourced from environment variable or static config.
 */

import crypto from 'node:crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

export interface AuthMiddlewareOptions {
  tokenEnvVar?: string;
  staticToken?: string;
}

export function createAuthMiddleware(options: AuthMiddlewareOptions): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip auth for health checks
    if (req.path === '/health' || req.path === '/api/health') {
      next();
      return;
    }

    const expectedToken = options.staticToken
      ?? (options.tokenEnvVar ? process.env[options.tokenEnvVar] : undefined);

    if (!expectedToken) {
      res.status(500).json({ error: 'Server misconfiguration: no auth token defined' });
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      res.status(401).json({ error: 'Missing Authorization header' });
      return;
    }

    // HTTP auth schemes are case-insensitive (RFC 7235)
    if (!authHeader.toLowerCase().startsWith('bearer ')) {
      res.status(401).json({ error: 'Invalid Authorization header format. Expected: Bearer <token>' });
      return;
    }

    const token = authHeader.slice('bearer '.length);

    // Use timing-safe comparison to prevent timing attacks
    const tokenBuf = Buffer.from(token);
    const expectedBuf = Buffer.from(expectedToken);
    if (tokenBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(tokenBuf, expectedBuf)) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    next();
  };
}
