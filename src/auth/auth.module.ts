import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OptionalTokenAuthGuard, TokenAuthGuard } from '../common/auth';
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

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, UserProfileEntity, AuthTokenEntity]),
    MediaModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    MailService,
    TokenAuthGuard,
    OptionalTokenAuthGuard,
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
