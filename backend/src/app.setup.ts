import { ValidationPipe, type INestApplication } from '@nestjs/common';

/**
 * App-wide configuration shared by `main.ts` and the e2e tests, so tests run
 * against the same pipeline as the real server.
 */
export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(
    new ValidationPipe({
      // Strip properties that have no class-validator decorator on the DTO...
      whitelist: true,
      // ...and reject the request (400) instead of silently dropping them.
      forbidNonWhitelisted: true,
      // Turn the plain JSON body into a DTO class instance, and convert
      // route params / query strings to their declared types (e.g. number).
      transform: true,
    }),
  );
}
