import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ValidationIssue } from '../validation/validation-failed.exception.js';

interface ErrorBody {
  error: { message: string; details?: ValidationIssue[] };
}

/**
 * The last stop for every exception thrown anywhere in the request lifecycle (guards,
 * pipes, handlers, interceptors). It replaces v1's `errorHandler` middleware and keeps
 * its response shape: `{ error: { message, details? } }`.
 *
 * - HttpException (NotFoundException, ConflictException, ...): thrown on purpose, so
 *   its status and message are safe to send.
 * - Anything else is a bug or an outage: log it, answer a generic 500, never leak it.
 *
 * @Catch() with no arguments catches everything, not only HttpException.
 * Docs: https://docs.nestjs.com/exception-filters
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status >= 500) this.logger.error(exception.message, exception.stack);
      response.status(status).json(toErrorBody(exception));
      return;
    }

    this.logger.error(
      'Unhandled error',
      exception instanceof Error ? exception.stack : String(exception),
    );
    response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json({ error: { message: 'Internal server error' } });
  }
}

function toErrorBody(exception: HttpException): ErrorBody {
  const body = exception.getResponse();
  if (typeof body === 'string') return { error: { message: body } };

  const message =
    'message' in body && typeof body.message === 'string'
      ? body.message
      : exception.message;
  const details =
    'details' in body && Array.isArray(body.details)
      ? (body.details as ValidationIssue[])
      : undefined;

  return { error: { message, ...(details && { details }) } };
}
