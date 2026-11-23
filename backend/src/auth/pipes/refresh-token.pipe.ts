import { HttpStatus, Injectable, type PipeTransform } from '@nestjs/common';
import { isJWT } from 'class-validator';
import { ValidationFailedException } from '../../common/validation/validation-failed.exception.js';

/**
 * Checks that the refresh-token cookie is present and shaped like a JWT, before the
 * handler runs (v1: validateCookie(refreshTokenSchema, 401)). Pipes run right before the
 * handler, one per argument. A missing token means "not logged in", so this answers 401
 * rather than the usual 400. TokensService still checks the signature and expiry.
 * Docs: https://docs.nestjs.com/pipes
 */
@Injectable()
export class RefreshTokenPipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    if (typeof value === 'string' && isJWT(value)) return value;

    throw new ValidationFailedException(
      [{ path: 'refreshToken', message: 'Invalid or missing refresh token' }],
      HttpStatus.UNAUTHORIZED,
    );
  }
}
