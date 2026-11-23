import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * `@Cookies('refreshToken')` hands a handler one cookie (or all of them with no name),
 * like `@Body()` does for the body. Values are `unknown`: they come from the client,
 * so a pipe or the handler must check them. Needs cookie-parser (see app.setup.ts).
 *
 * A pipe can be passed after the name: `@Cookies('refreshToken', RefreshTokenPipe)`.
 * Docs: https://docs.nestjs.com/custom-decorators
 */
export const Cookies = createParamDecorator(
  (name: string | undefined, ctx: ExecutionContext): unknown => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const cookies: Record<string, unknown> = request.cookies ?? {};
    return name ? cookies[name] : cookies;
  },
);
