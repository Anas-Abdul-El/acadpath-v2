import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import cookieParser from 'cookie-parser';
import { portalMessageParser } from './portal/portal.gateway.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import {
  ValidationFailedException,
  toValidationIssues,
} from './common/validation/validation-failed.exception.js';

/**
 * App-wide configuration shared by `main.ts` and the e2e tests, so tests run
 * against the same pipeline as the real server.
 */
export function configureApp(app: INestApplication): void {
  // v1 mounted every router under /api; the refresh cookie's path depends on it.
  app.setGlobalPrefix('api');

  // Fills req.cookies. Middleware runs before guards and pipes, so the auth
  // routes can read the refresh-token cookie (v1: app.use(cookieParser())).
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      // Strip properties that have no class-validator decorator on the DTO...
      whitelist: true,
      // ...and reject the request (400) instead of silently dropping them.
      forbidNonWhitelisted: true,
      // Turn the plain JSON body into a DTO class instance, and convert
      // route params / query strings to their declared types (e.g. number).
      transform: true,
      // One message per invalid field, like v1's Zod errors.
      stopAtFirstError: true,
      // Keep v1's error body: { error: { message, details: [{ path, message }] } }.
      exceptionFactory: (errors) =>
        new ValidationFailedException(toValidationIssues(errors)),
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  // Plain WebSockets (the `ws` library) for the portal gateway, with v1's message
  // format and its 16 KB limit per message (a bigger frame closes the socket, 1009).
  app.useWebSocketAdapter(
    new WsAdapter(app, {
      messageParser: portalMessageParser,
      maxPayload: 16 * 1024,
    }),
  );
}
