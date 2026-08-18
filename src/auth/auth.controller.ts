import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle, hours, minutes } from '@nestjs/throttler';
import { CurrentUser, TokenAuthGuard } from '../common/auth';
import { AuthThrottlerGuard } from '../common/rate-limit';
import { UserEntity } from '../database/entities';
import { AuthService } from './auth.service';
import {
  ChangePasswordDto,
  GoogleOAuthDto,
  LoginDto,
  PasswordResetConfirmDto,
  PasswordResetRequestDto,
  RegisterDto,
  UpdateProfileDto,
} from './dto/auth.dto';

@Controller('api/auth')
@UseGuards(AuthThrottlerGuard)
@Throttle({
  ip: { limit: 120, ttl: minutes(1) },
  account: { limit: 120, ttl: minutes(1) },
})
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    ip: { limit: 10, ttl: minutes(1) },
    account: { limit: 5, ttl: minutes(5) },
  })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Post('register')
  @Throttle({
    ip: { limit: 5, ttl: hours(1) },
    account: { limit: 5, ttl: hours(1) },
  })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('google-oauth')
  @Throttle({
    ip: { limit: 10, ttl: minutes(1) },
    account: { limit: 10, ttl: minutes(1) },
  })
  googleOAuth(@Body() dto: GoogleOAuthDto) {
    return this.auth.googleOAuth(dto);
  }

  @Get('profile')
  @UseGuards(TokenAuthGuard)
  profile(@CurrentUser() user: UserEntity) {
    return this.auth.profile(user.id);
  }

  @Patch('profile/update')
  @UseGuards(TokenAuthGuard)
  updateProfile(
    @CurrentUser() user: UserEntity,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.auth.updateProfile(user.id, dto);
  }

  @Patch('profile/avatar')
  @UseGuards(TokenAuthGuard)
  @UseInterceptors(
    FileInterceptor('avatar', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  updateAvatar(
    @CurrentUser() user: UserEntity,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.auth.updateAvatar(user.id, file);
  }

  @Post('change-password')
  @UseGuards(TokenAuthGuard)
  @HttpCode(HttpStatus.OK)
  changePassword(
    @CurrentUser() user: UserEntity,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.auth.changePassword(user.id, dto);
  }

  @Post('password-reset')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    ip: { limit: 5, ttl: hours(1) },
    account: { limit: 3, ttl: hours(1) },
  })
  passwordReset(@Body() dto: PasswordResetRequestDto) {
    return this.auth.requestPasswordReset(dto.email);
  }

  @Post('password-reset-confirm')
  @HttpCode(HttpStatus.OK)
  @Throttle({
    ip: { limit: 10, ttl: hours(1) },
    account: { limit: 5, ttl: hours(1) },
  })
  passwordResetConfirm(@Body() dto: PasswordResetConfirmDto) {
    return this.auth.confirmPasswordReset(dto);
  }

  @Post('logout')
  @UseGuards(TokenAuthGuard)
  @HttpCode(HttpStatus.OK)
  logout(@CurrentUser() user: UserEntity) {
    return this.auth.logout(user.id);
  }
}
