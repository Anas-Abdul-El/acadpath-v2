import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Response } from 'express';
import { Cookies } from '../common/decorators/cookies.decorator.js';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { AUTH_RATE_LIMIT } from '../config/rate-limit.js';
import {
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  REFRESH_TOKEN_TTL_MS,
} from './auth.constants.js';
import { AuthService } from './auth.service.js';
import { Public } from './decorators/public.decorator.js';
import type { PublicUser } from './auth.types.js';
// DTOs are imported as values, not `import type`: the ValidationPipe reads the
// parameter's class from decorator metadata at runtime.
import { LoginDto } from './dto/login.dto.js';
import { SigninDto } from './dto/signin.dto.js';
import { RefreshTokenPipe } from './pipes/refresh-token.pipe.js';

interface AuthResponse {
  data: { user: PublicUser; accessToken: string };
}

/**
 * /api/auth routes (v1: routes/auth.route.ts + controllers/auth.controller.ts).
 * HTTP only: read the request, call AuthService, shape the response and the cookie.
 *
 * `@Res({ passthrough: true })` gives access to Express's response to set cookies,
 * while Nest still sends the returned value as the body.
 *
 * @Public(): these routes are how a user gets an access token, so they can't require one.
 */
@Public()
@Controller('auth')
export class AuthController {
  private readonly cookieOptions: CookieOptions;

  constructor(
    private readonly authService: AuthService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.cookieOptions = {
      httpOnly: true,
      secure: config.get('NODE_ENV', { infer: true }) === 'production',
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
    };
  }

  /** Creates a student account (the route keeps v1's name). 201. */
  @Post('signin')
  @Throttle({ default: AUTH_RATE_LIMIT })
  async signin(
    @Body() dto: SigninDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const { user, accessToken, refreshToken } =
      await this.authService.signup(dto);
    this.setRefreshCookie(res, refreshToken);
    return { data: { user, accessToken } };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  // Overrides the global limit for this route only: the guard reads this metadata.
  @Throttle({ default: AUTH_RATE_LIMIT })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const { user, accessToken, refreshToken } =
      await this.authService.login(dto);
    this.setRefreshCookie(res, refreshToken);
    return { data: { user, accessToken } };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Cookies(REFRESH_COOKIE_NAME, RefreshTokenPipe) oldRefreshToken: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ data: { accessToken: string } }> {
    const { accessToken, refreshToken } =
      await this.authService.refresh(oldRefreshToken);
    this.setRefreshCookie(res, refreshToken);
    return { data: { accessToken } };
  }

  /** Always 204 and always clears the cookie, even without a valid token. */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Cookies(REFRESH_COOKIE_NAME) refreshToken: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    if (typeof refreshToken === 'string') {
      await this.authService.logout(refreshToken);
    }
    res.clearCookie(REFRESH_COOKIE_NAME, this.cookieOptions);
  }

  private setRefreshCookie(res: Response, refreshToken: string): void {
    res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
      ...this.cookieOptions,
      maxAge: REFRESH_TOKEN_TTL_MS,
    });
  }
}
