import { Context } from 'hono';
import { HonoTypes } from '../types';

export class AppError extends Error {
  code: string;
  statusCode: number;

  constructor(message: string, code: string, statusCode = 400) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function handleAppError(err: Error, c: Context<HonoTypes>) {
  const requestId = c.get('requestId') || crypto.randomUUID();
  console.error(`[Error] RequestId: ${requestId}`, err);

  if (err instanceof AppError) {
    return c.json(
      {
        success: false,
        error: {
          code: err.code,
          message: err.message,
          requestId
        }
      },
      err.statusCode as any
    );
  }

  // Generic fallback error (do not expose internal error messages/stack traces to client)
  return c.json(
    {
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred. Please try again later.',
        requestId
      }
    },
    500
  );
}
