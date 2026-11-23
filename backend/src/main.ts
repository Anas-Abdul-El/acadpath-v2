import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  // On SIGTERM/SIGINT (docker stop, a deploy), run the onModuleDestroy hooks: close the
  // portal browsers, the queues and the database pool instead of cutting them off.
  // Docs: https://docs.nestjs.com/fundamentals/lifecycle-events#application-shutdown
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
