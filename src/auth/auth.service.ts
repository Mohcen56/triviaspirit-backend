import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { OAuth2Client } from 'google-auth-library';
import { randomBytes } from 'node:crypto';
import { Not, QueryFailedError, Raw, Repository } from 'typeorm';
import {
  AuthTokenEntity,
  UserEntity,
  UserProfileEntity,
} from '../database/entities';
import { MediaService } from '../media/media.service';
import {
  ChangePasswordDto,
  GoogleOAuthDto,
  LoginDto,
  PasswordResetConfirmDto,
  RegisterDto,
  UpdateProfileDto,
} from './dto/auth.dto';
import { MailService } from './mail.service';
import { PasswordService } from './password.service';

const DUMMY_PASSWORD_HASH =
  'pbkdf2_sha256$870000$codex-dummy-salt$jFLkpJD6aciyBDCvFq/U5EoePW0a7BqfNsZAkOS6QYg=';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(UserProfileEntity)
    private readonly profiles: Repository<UserProfileEntity>,
    @InjectRepository(AuthTokenEntity)
    private readonly tokens: Repository<AuthTokenEntity>,
    private readonly passwords: PasswordService,
    private readonly mail: MailService,
    private readonly media: MediaService,
    private readonly config: ConfigService,
  ) {}

  async login(dto: LoginDto) {
    const email = normalizeEmail(dto.email);
    const user = await this.users.findOne({
      where: { email: emailCondition(email) },
      relations: { profile: true },
    });
    const passwordValid = await this.passwords.verify(
      dto.password,
      user?.password || DUMMY_PASSWORD_HASH,
    );
    if (!user || !passwordValid || !user.isActive) {
      throw new UnauthorizedException({ error: 'Invalid email or password' });
    }
    user.lastLogin = new Date();
    await this.users.save(user);
    return {
      token: await this.getOrCreateToken(user.id),
      user: this.serializeUser(user),
    };
  }

  async register(dto: RegisterDto) {
    const email = normalizeEmail(dto.email);
    if (await this.users.exists({ where: { email: emailCondition(email) } })) {
      throw new BadRequestException({ error: 'Email already exists' });
    }

    const baseUsername = (dto.username?.trim() || email.split('@')[0]).slice(
      0,
      150,
    );
    const username = await this.uniqueUsername(baseUsername);
    const password = await this.passwords.hash(dto.password);

    let user: UserEntity;
    try {
      user = await this.users.manager.transaction(async (manager) => {
        const created = await manager.save(
          UserEntity,
          manager.create(UserEntity, {
            username,
            email,
            password,
            firstName: dto.first_name || '',
            lastName: dto.last_name || '',
            isActive: true,
            isStaff: false,
            isSuperuser: false,
          }),
        );
        created.profile = await manager.save(
          UserProfileEntity,
          manager.create(UserProfileEntity, {
            userId: created.id,
            avatar: null,
            bio: '',
            isPremium: false,
            premiumExpiry: null,
          }),
        );
        return created;
      });
    } catch (error) {
      if (isUniqueViolation(error, 'auth_user_email_ci_unique')) {
        throw new BadRequestException({ error: 'Email already exists' });
      }
      if (isUniqueViolation(error, 'username')) {
        throw new BadRequestException({ error: 'Username already exists' });
      }
      throw error;
    }

    return {
      token: await this.getOrCreateToken(user.id),
      user: this.serializeUser(user),
    };
  }

  async profile(userId: number) {
    return { user: this.serializeUser(await this.getUser(userId)) };
  }

  async updateProfile(userId: number, dto: UpdateProfileDto) {
    const user = await this.getUser(userId);
    if (
      dto.username &&
      (await this.users.exists({
        where: { username: dto.username, id: Not(userId) },
      }))
    ) {
      throw new BadRequestException({ error: 'Username already exists' });
    }
    if (
      dto.email &&
      (await this.users.exists({
        where: {
          email: emailCondition(normalizeEmail(dto.email)),
          id: Not(userId),
        },
      }))
    ) {
      throw new BadRequestException({ error: 'Email already exists' });
    }
    if (dto.username !== undefined) user.username = dto.username.trim();
    if (dto.email !== undefined) user.email = dto.email.trim().toLowerCase();
    if (dto.first_name !== undefined) user.firstName = dto.first_name;
    if (dto.last_name !== undefined) user.lastName = dto.last_name;
    try {
      await this.users.save(user);
    } catch (error) {
      if (isUniqueViolation(error, 'auth_user_email_ci_unique')) {
        throw new BadRequestException({ error: 'Email already exists' });
      }
      if (isUniqueViolation(error, 'username')) {
        throw new BadRequestException({ error: 'Username already exists' });
      }
      throw error;
    }
    return {
      user: this.serializeUser(user),
      message: 'Profile updated successfully',
    };
  }

  async updateAvatar(userId: number, file?: Express.Multer.File) {
    if (!file)
      throw new BadRequestException({ error: 'No avatar file provided' });
    const stored = await this.media.storeImage(file, 'avatars', 5);
    let previousAvatar: string | null = null;
    try {
      const user = await this.getUser(userId);
      const profile =
        user.profile ||
        this.profiles.create({ userId, bio: '', isPremium: false });
      previousAvatar = profile.avatar;
      profile.avatar = stored.key;
      user.profile = await this.profiles.save(profile);
      if (previousAvatar && previousAvatar !== stored.key) {
        try {
          await this.media.removeImages([previousAvatar]);
        } catch (error) {
          this.logger.warn(
            `Failed to remove replaced avatar: ${String(error)}`,
          );
        }
      }
      return {
        user: this.serializeUser(user),
        avatar_url: this.media.url(stored.key),
        message: 'Avatar updated successfully',
      };
    } catch (error) {
      try {
        await this.media.removeImages([stored.key]);
      } catch (cleanupError) {
        this.logger.warn(`Failed to clean up avatar: ${String(cleanupError)}`);
      }
      throw error;
    }
  }

  async changePassword(userId: number, dto: ChangePasswordDto) {
    const user = await this.getUser(userId);
    if (!(await this.passwords.verify(dto.current_password, user.password))) {
      throw new BadRequestException({ error: 'Current password is incorrect' });
    }
    const password = await this.passwords.hash(dto.new_password);
    const token = await this.users.manager.transaction(async (manager) => {
      user.password = password;
      user.sessionVersion = (user.sessionVersion || 0) + 1;
      await manager.save(UserEntity, user);
      return this.rotateToken(user.id, manager);
    });
    return { message: 'Password changed successfully', token };
  }

  async googleOAuth(dto: GoogleOAuthDto) {
    const clientId = this.config.get<string>('GOOGLE_OAUTH_CLIENT_ID');
    if (!clientId) throw new Error('GOOGLE_OAUTH_CLIENT_ID is not configured');

    let googleUser: {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      hd?: string;
      name?: string;
      given_name?: string;
      family_name?: string;
    };
    try {
      const ticket = await new OAuth2Client(clientId).verifyIdToken({
        idToken: dto.token,
        audience: clientId,
      });
      googleUser = ticket.getPayload() || {};
    } catch {
      throw new UnauthorizedException({
        error: 'Invalid or expired Google token',
      });
    }

    if (
      !googleUser.sub ||
      !googleUser.email ||
      googleUser.email_verified !== true
    )
      throw new BadRequestException({ error: 'Email not provided by Google' });
    const email = normalizeEmail(googleUser.email);
    const isAuthoritativeEmail =
      Boolean(googleUser.hd) ||
      email.endsWith('@gmail.com') ||
      email.endsWith('@googlemail.com');
    let user = await this.users.findOne({
      where: { googleSubject: googleUser.sub },
      relations: { profile: true },
    });
    if (!user) {
      user = await this.users.findOne({
        where: { email: emailCondition(email) },
        relations: { profile: true },
      });
      if (
        user &&
        (!isAuthoritativeEmail ||
          (user.googleSubject && user.googleSubject !== googleUser.sub))
      ) {
        throw new UnauthorizedException({
          error: 'Sign in with your existing account before linking Google',
        });
      }
    }
    const isNew = !user;
    if (!user) {
      const names = (googleUser.name || '').trim().split(/\s+/);
      const registered = await this.register({
        email,
        password: randomBytes(32).toString('hex'),
        username: email.split('@')[0],
        first_name: googleUser.given_name || names[0] || '',
        last_name: googleUser.family_name || names.slice(1).join(' '),
      });
      user = await this.getUser(registered.user.id);
    }
    if (!user.isActive)
      throw new UnauthorizedException({ error: 'Account is inactive' });
    if (user.googleSubject !== googleUser.sub) {
      user.googleSubject = googleUser.sub;
      await this.users.save(user);
    }
    return {
      token: await this.getOrCreateToken(user.id),
      user: this.serializeUser(user),
      is_new: isNew,
    };
  }

  async requestPasswordReset(email: string) {
    const normalized = normalizeEmail(email);
    const user = await this.users.findOne({
      where: { email: emailCondition(normalized) },
    });
    if (user) {
      const uid = Buffer.from(String(user.id)).toString('base64url');
      const token = this.passwords.makeResetToken(user.id, user.password);
      const frontend = this.config
        .get<string>('FRONTEND_URL', 'http://localhost:3000')
        .replace(/\/$/, '');
      try {
        await this.mail.sendPasswordReset(
          user.email,
          user.firstName,
          `${frontend}/ResetPassword?uid=${uid}&token=${encodeURIComponent(token)}`,
        );
      } catch (error) {
        this.logger.error('Failed to send password reset email', error);
      }
    }
    return { detail: "If an account exists, we'll send an email." };
  }

  async confirmPasswordReset(dto: PasswordResetConfirmDto) {
    let userId: number;
    try {
      userId = Number(Buffer.from(dto.uid, 'base64url').toString());
      if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error();
    } catch {
      throw new BadRequestException({ detail: 'Invalid link or user.' });
    }
    const password = await this.passwords.hash(dto.new_password);
    await this.users.manager.transaction(async (manager) => {
      const user = await manager.findOne(UserEntity, {
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user)
        throw new BadRequestException({ detail: 'Invalid link or user.' });
      if (!this.passwords.verifyResetToken(user.id, user.password, dto.token)) {
        throw new BadRequestException({ detail: 'Invalid or expired token.' });
      }
      user.password = password;
      user.sessionVersion = (user.sessionVersion || 0) + 1;
      await manager.save(UserEntity, user);
      await this.rotateToken(user.id, manager);
    });
    return { detail: 'Password has been reset successfully.' };
  }

  async logout(userId: number) {
    await this.users.manager.transaction(async (manager) => {
      await manager.delete(AuthTokenEntity, { userId });
      await manager.increment(UserEntity, { id: userId }, 'sessionVersion', 1);
    });
    return { detail: 'Successfully logged out.' };
  }

  serializeUser(user: UserEntity) {
    const expiry = user.profile?.premiumExpiry || null;
    const today = new Date().toISOString().slice(0, 10);
    const premium = Boolean(
      user.profile?.isPremium && (!expiry || expiry >= today),
    );
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      date_joined: user.dateJoined,
      avatar: this.media.url(user.profile?.avatar) || '/avatars/thumbs.svg',
      is_premium: premium,
      premium_expiry: expiry,
    };
  }

  private async getUser(id: number): Promise<UserEntity> {
    const user = await this.users.findOne({
      where: { id },
      relations: { profile: true },
    });
    if (!user) throw new UnauthorizedException();
    if (!user.profile) {
      user.profile = await this.profiles.save(
        this.profiles.create({
          userId: user.id,
          avatar: null,
          bio: '',
          isPremium: false,
          premiumExpiry: null,
        }),
      );
    }
    return user;
  }

  private async getOrCreateToken(userId: number): Promise<string> {
    const existing = await this.tokens.findOneBy({ userId });
    if (existing) return existing.key;
    const key = randomBytes(20).toString('hex');
    try {
      await this.tokens.insert({ key, userId });
      return key;
    } catch (error) {
      if (!isUniqueViolation(error, 'user_id')) throw error;
      const concurrent = await this.tokens.findOneBy({ userId });
      if (!concurrent) throw error;
      return concurrent.key;
    }
  }

  private async rotateToken(
    userId: number,
    manager: import('typeorm').EntityManager,
  ): Promise<string> {
    const repository = manager.getRepository(AuthTokenEntity);
    await repository.delete({ userId });
    const key = randomBytes(20).toString('hex');
    await repository.save(repository.create({ key, userId }));
    return key;
  }

  private async uniqueUsername(raw: string): Promise<string> {
    const base = raw || 'user';
    let candidate = base;
    let suffix = 1;
    while (await this.users.exists({ where: { username: candidate } })) {
      candidate = `${base.slice(0, 150 - String(suffix).length)}${suffix++}`;
    }
    return candidate;
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function emailCondition(email: string) {
  return Raw((column) => `LOWER(${column}) = :normalizedEmail`, {
    normalizedEmail: email,
  });
}

function isUniqueViolation(error: unknown, expected: string): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError = error.driverError as {
    code?: string;
    constraint?: string;
    detail?: string;
  };
  return (
    driverError.code === '23505' &&
    (driverError.constraint?.includes(expected) === true ||
      driverError.detail?.includes(`(${expected})`) === true)
  );
}
