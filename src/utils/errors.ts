/**
 * Error Utilities — Type-safe error handling helpers.
 *
 * TYPE-02: Provides type guards and message extractors so catch blocks
 * can safely access error properties without `as any` casts.
 */

/**
 * Extracts a human-readable message from an unknown error value.
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error';
}

/**
 * Type guard: checks whether an unknown value has a `code` property (like Node.js system errors).
 */
export function hasErrorCode(err: unknown): err is Error & { code: string } {
  return err instanceof Error && 'code' in err && typeof (err as Record<string, unknown>).code === 'string';
}

/**
 * Type guard: checks for Node.js ENOENT errors.
 */
export function isENOENT(err: unknown): boolean {
  return hasErrorCode(err) && err.code === 'ENOENT';
}
