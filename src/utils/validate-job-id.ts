/**
 * Validates that a jobId is safe for use in file paths.
 * Only allows alphanumeric characters, hyphens, and underscores.
 */
export function validateJobId(jobId: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(jobId)) {
    throw new Error(`Invalid jobId: must contain only alphanumeric characters, hyphens, and underscores`);
  }
}
