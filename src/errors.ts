export type AppErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "UNSUPPORTED_FILE"
  | "EMPTY_RESUME"
  | "INVALID_DOCUMENT"
  | "MISSING_API_KEY"
  | "AI_FAILURE"
  | "INVALID_AI_RESPONSE"
  | "RATE_LIMIT"
  | "OFFLINE"
  | "STORE_ERROR"

export class AppError extends Error {
  readonly code: AppErrorCode
  constructor(code: AppErrorCode, message: string) {
    super(message)
    this.name = "AppError"
    this.code = code
  }
}

export function toUserError(err: unknown): AppError {
  if (err instanceof AppError) return err
  if (err instanceof Error) return new AppError("AI_FAILURE", err.message)
  return new AppError("AI_FAILURE", String(err))
}

/** Raised when Jev is disabled; callers always fail open. */
export class JevDisabled extends Error {
  constructor(message = "TypeSafe Jev is not configured (offline mode)") {
    super(message)
    this.name = "JevDisabled"
  }
}
