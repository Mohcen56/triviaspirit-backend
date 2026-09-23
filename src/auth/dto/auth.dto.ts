import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

const normalizedEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const isProvided = (_object: unknown, value: unknown) => value !== undefined;

export class LoginDto {
  @Transform(normalizedEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  password: string;
}

export class RegisterDto extends LoginDto {
  @MinLength(8)
  @MaxLength(128)
  declare password: string;

  @ValidateIf(isProvided)
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  username?: string;

  @ValidateIf(isProvided)
  @Transform(trimmed)
  @IsString()
  @MaxLength(150)
  first_name?: string;

  @ValidateIf(isProvided)
  @Transform(trimmed)
  @IsString()
  @MaxLength(150)
  last_name?: string;
}

export class UpdateProfileDto {
  @ValidateIf(isProvided)
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  username?: string;

  @ValidateIf(isProvided)
  @Transform(normalizedEmail)
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ValidateIf(isProvided)
  @Transform(trimmed)
  @IsString()
  @MaxLength(150)
  first_name?: string;

  @ValidateIf(isProvided)
  @Transform(trimmed)
  @IsString()
  @MaxLength(150)
  last_name?: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  current_password: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  new_password: string;
}

export class GoogleOAuthDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  token: string;
}

export class PasswordResetRequestDto {
  @Transform(normalizedEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;
}

export class PasswordResetConfirmDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  uid: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  token: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  new_password: string;
}
