/**
 * R26: Tests for DashboardServer endpoints and auth middleware.
 *
 * Tests API routes, auth middleware behavior, and SSE connections.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAuthMiddleware } from '../../../src/dashboard/auth-middleware.js';
import type { Request, Response, NextFunction } from 'express';

// ─── Auth Middleware Tests ──────────────────────────────────────────

describe('Auth Middleware (R26)', () => {
  const mockNext = vi.fn() as NextFunction;

  function createMockReq(path: string, authHeader?: string): Partial<Request> {
    return {
      path,
      headers: authHeader ? { authorization: authHeader } : {},
    };
  }

  function createMockRes(): Partial<Response> {
    const res: any = {
      statusCode: 200,
      _json: null,
    };
    res.status = vi.fn((code: number) => { res.statusCode = code; return res; });
    res.json = vi.fn((data: any) => { res._json = data; return res; });
    return res;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should skip auth for /health endpoint', () => {
    const middleware = createAuthMiddleware({ staticToken: 'secret123' });
    const req = createMockReq('/health');
    const res = createMockRes();

    middleware(req as Request, res as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
  });

  it('should skip auth for /api/health endpoint', () => {
    const middleware = createAuthMiddleware({ staticToken: 'secret123' });
    const req = createMockReq('/api/health');
    const res = createMockRes();

    middleware(req as Request, res as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
  });

  it('should reject requests without Authorization header', () => {
    const middleware = createAuthMiddleware({ staticToken: 'secret123' });
    const req = createMockReq('/api/jobs');
    const res = createMockRes();

    middleware(req as Request, res as Response, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should reject requests with invalid token', () => {
    const middleware = createAuthMiddleware({ staticToken: 'secret123' });
    const req = createMockReq('/api/jobs', 'Bearer wrongtoken');
    const res = createMockRes();

    middleware(req as Request, res as Response, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should accept requests with valid token', () => {
    const middleware = createAuthMiddleware({ staticToken: 'secret123' });
    const req = createMockReq('/api/jobs', 'Bearer secret123');
    const res = createMockRes();

    middleware(req as Request, res as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
  });

  it('should handle case-insensitive Bearer prefix', () => {
    const middleware = createAuthMiddleware({ staticToken: 'mytoken' });
    const req = createMockReq('/api/jobs', 'BEARER mytoken');
    const res = createMockRes();

    middleware(req as Request, res as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
  });

  it('should reject non-Bearer auth scheme', () => {
    const middleware = createAuthMiddleware({ staticToken: 'secret123' });
    const req = createMockReq('/api/jobs', 'Basic dXNlcjpwYXNz');
    const res = createMockRes();

    middleware(req as Request, res as Response, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should return 500 when no token is configured', () => {
    const middleware = createAuthMiddleware({});
    const req = createMockReq('/api/jobs', 'Bearer anything');
    const res = createMockRes();

    middleware(req as Request, res as Response, mockNext);

    expect(mockNext).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('should support token from environment variable', () => {
    process.env['TEST_ZORA_TOKEN'] = 'envtoken';
    const middleware = createAuthMiddleware({ tokenEnvVar: 'TEST_ZORA_TOKEN' });
    const req = createMockReq('/api/jobs', 'Bearer envtoken');
    const res = createMockRes();

    middleware(req as Request, res as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
    delete process.env['TEST_ZORA_TOKEN'];
  });
});
