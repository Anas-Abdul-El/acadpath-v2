import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '../../generated/prisma/enums.js';
import type { AuthenticatedRequest } from '../auth.types.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';

/**
 * Lets the request through only if the user's role is listed in @Roles()
 * (v1: the `authorize(...roles)` middleware). Routes without @Roles() are open to any
 * logged-in user. Must run after AccessTokenGuard: no user is a 401, a wrong role a 403.
 *
 * The role comes from the signed access token, which the server issued. The client
 * can't choose it.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!roles || roles.length === 0) return true;

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user) throw new UnauthorizedException('Not authenticated');
    if (!roles.includes(user.role)) {
      throw new ForbiddenException("You don't have permission to do this");
    }
    return true;
  }
}
