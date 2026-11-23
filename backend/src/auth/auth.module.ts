import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { HashService } from './hash.service.js';
import { TokensService } from './tokens.service.js';

/**
 * Groups the auth feature. `providers` are the classes Nest creates and injects inside
 * this module; `exports` makes TokensService available to modules that import AuthModule
 * (the access-token guard will need it). PrismaService and ConfigService are global.
 */
@Module({
  // No default secret: TokensService passes the access or refresh secret on every call.
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, HashService, TokensService],
  exports: [TokensService],
})
export class AuthModule {}
