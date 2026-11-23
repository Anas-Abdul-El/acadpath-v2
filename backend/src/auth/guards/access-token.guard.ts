import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../generated/prisma/enums.js';
import type { AuthenticatedRequest } from '../auth.types.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { TokensService } from '../tokens.service.js';

const isUserRole = (value: unknown): value is UserRole =>
  Object.values<unknown>(UserRole).includes(value);

/**
 * Reads `Authorization: Bearer <access token>`, verifies it and puts the user on
 * request.user (v1: the `authenticate` middleware).
 *
 * Why a guard and not middleware: a guard runs after middleware and knows which handler
 * is about to run (ExecutionContext), so it can read @Public() metadata. Middleware
 * can't see that. Registered globally with APP_GUARD in AppModule.
 * Docs: https://docs.nestjs.com/guards
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // HTTP only. A WebSocket gateway authenticates its own connections (PortalGateway
    // checks the origin and a single-use ticket), and has no Authorization header.
    if (context.getType() !== 'http') return true;
    // Handler metadata wins over controller metadata.
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or malformed access token');
    }

    // verify throws its own 401 for a bad signature, an expired token or a refresh token.
    const { sub, role } = this.tokens.verify(
      header.slice('Bearer '.length),
      'access',
    );
    if (typeof sub !== 'string' || sub === '' || !isUserRole(role)) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    request.user = { id: sub, role };
    return true;
  }
}
