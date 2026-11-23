import {
  createParamDecorator,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { AuthenticatedRequest, AuthUser } from '../auth.types.js';

/**
 * `@CurrentUser() user: AuthUser` hands a handler the logged-in user that the
 * access-token guard verified. "My" routes take the user id from here, never from the
 * path or body, so a student can only ever reach their own records.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const { user } = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    // Only reachable on a @Public() route, which has no user: a programming error.
    if (!user) throw new UnauthorizedException('Not authenticated');
    return user;
  },
);
