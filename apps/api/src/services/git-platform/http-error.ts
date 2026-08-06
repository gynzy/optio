export interface HttpError extends Error {
  status: number;
}

/**
 * An Error carrying the HTTP status alongside the message, so callers can tell
 * "this PR is gone" (404) from "we are rate limited" (403) from "bad token"
 * (401) without pattern-matching on message text.
 */
export function httpError(message: string, status: number): HttpError {
  const err = new Error(message) as HttpError;
  err.status = status;
  return err;
}
