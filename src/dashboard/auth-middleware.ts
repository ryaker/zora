/**
 * Auth Middleware — Bearer token authentication for the dashboard API.
 *
 * Spec v0.6 §5.8 "Dashboard Authentication":
 *   - Validates Authorization: Bearer <token> header.
 *   - Skips auth for the /health endpoint.
 *   - Token sourced from environment variable or static config.
 */

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

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      res.status(401).json({ error: 'Invalid Authorization header format. Expected: Bearer <token>' });
      return;
    }

    const token = parts[1];
    if (token !== expectedToken) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    next();
  };
}
