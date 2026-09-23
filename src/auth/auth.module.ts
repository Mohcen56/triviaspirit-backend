import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OptionalTokenAuthGuard, TokenAuthGuard } from '../common/auth';
import { RateLimitModule } from '../common/rate-limit.module';
import {
  AuthTokenEntity,
  UserEntity,
  UserProfileEntity,
} from '../database/entities';
import { MediaModule } from '../media/media.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MailService } from './mail.service';
import { PasswordService } from './password.service';
import { UploadCleanupInterceptor } from '../media/upload-cleanup.interceptor';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, UserProfileEntity, AuthTokenEntity]),
    RateLimitModule,
    MediaModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    MailService,
    TokenAuthGuard,
    OptionalTokenAuthGuard,
    UploadCleanupInterceptor,
  ],
  exports: [
    TypeOrmModule,
    AuthService,
    PasswordService,
    TokenAuthGuard,
    OptionalTokenAuthGuard,
  ],
})
export class AuthModule {}
