import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route (or a whole controller) as open to anyone. The access-token guard runs on
 * every route, so protection is the default and opening a route is a visible choice.
 * SetMetadata attaches a value to the handler; guards read it back with Reflector.
 * Docs: https://docs.nestjs.com/security/authentication#enable-authentication-globally
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
