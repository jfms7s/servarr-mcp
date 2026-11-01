import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export function isAuthorized(authHeader: string | undefined, expected: string): boolean {
  if (!authHeader) return false;

  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!match?.[1]) return false;

  // Compare fixed-length digests so the comparison takes the same time whatever the
  // provided token's length: a length check first would tell an attacker the real length.
  return timingSafeEqual(digest(match[1]), digest(expected));
}

export function bearerAuth(expected: string): RequestHandler {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (isAuthorized(request.headers.authorization, expected)) {
      next();
      return;
    }
    response.status(401).json({ error: 'unauthorized' });
  };
}
