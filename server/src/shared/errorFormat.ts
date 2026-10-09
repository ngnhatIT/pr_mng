/**
 * Format error cho logging: giữ message + stack trace (nếu có).
 * Dùng thay cho String(err) để production debug được.
 */
export function formatError(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack };
  }
  return { message: String(err) };
}
