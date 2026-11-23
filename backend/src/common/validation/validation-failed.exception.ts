import {
  HttpException,
  HttpStatus,
  type ValidationError,
} from '@nestjs/common';

/** One problem with the request data, e.g. { path: "courses.0.credits", message: "..." }. */
export interface ValidationIssue {
  path: string;
  message: string;
}

/**
 * A request that broke the DTO rules. Its response body is v1's
 * `{ message: "Validation failed", details: [{ path, message }] }`; the global
 * exception filter wraps it in `{ error: ... }`. Only path and message are sent: they
 * describe what is wrong without echoing back the values the client sent.
 */
export class ValidationFailedException extends HttpException {
  constructor(
    readonly details: ValidationIssue[],
    status: number = HttpStatus.BAD_REQUEST,
  ) {
    super({ message: 'Validation failed', details }, status);
  }
}

/**
 * Flattens class-validator's error tree into one issue per invalid field, joining
 * nested property names with dots (`courses.1.credits`, like v1's Zod paths).
 */
export function toValidationIssues(
  errors: ValidationError[],
  parentPath = '',
): ValidationIssue[] {
  return errors.flatMap((error) => {
    const path = parentPath
      ? `${parentPath}.${error.property}`
      : error.property;
    const own = Object.values(error.constraints ?? {}).map((message) => ({
      path,
      message,
    }));
    return [...own, ...toValidationIssues(error.children ?? [], path)];
  });
}
