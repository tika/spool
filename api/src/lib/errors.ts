export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AppError";
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details && { details: this.details }),
      },
    };
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, identifier?: string) {
    const message = identifier
      ? `${resource} not found: ${identifier}`
      : `${resource} not found`;
    super(message, "NOT_FOUND", 404, { resource, identifier });
    this.name = "NotFoundError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "VALIDATION_ERROR", 400, details);
    this.name = "ValidationError";
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "CONFLICT", 409, details);
    this.name = "ConflictError";
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, message: string, details?: Record<string, unknown>) {
    super(`${service}: ${message}`, "EXTERNAL_SERVICE_ERROR", 502, {
      service,
      ...details,
    });
    this.name = "ExternalServiceError";
  }
}

export class JobError extends AppError {
  constructor(
    public jobType: string,
    public jobId: string,
    message: string,
    public cause?: Error
  ) {
    super(message, "JOB_ERROR", 500, { jobType, jobId });
    this.name = "JobError";
  }
}

export function formatError(error: unknown): { message: string; stack?: string; details?: unknown } {
  if (error instanceof AppError) {
    return {
      message: error.message,
      details: error.details,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: String(error),
  };
}
