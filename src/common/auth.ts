import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { AuthTokenEntity, UserEntity } from '../database/entities';

export type AuthenticatedRequest = Request & { user?: UserEntity };

@Injectable()
export class OptionalTokenAuthGuard implements CanActivate {
  constructor(
    @InjectRepository(AuthTokenEntity)
    private readonly tokens: Repository<AuthTokenEntity>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header) return true;

    const [scheme, key] = header.trim().split(/\s+/, 2);
    if (scheme?.toLowerCase() !== 'token' || !key) {
      throw new UnauthorizedException({ detail: 'Invalid token header.' });
    }

    const token = await this.tokens.findOne({
      where: { key },
      relations: { user: { profile: true } },
    });
    if (!token?.user?.isActive) {
      throw new UnauthorizedException({ detail: 'Invalid token.' });
    }

    request.user = token.user;
    return true;
  }
}

@Injectable()
export class TokenAuthGuard extends OptionalTokenAuthGuard {
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    await super.canActivate(context);
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      throw new UnauthorizedException({
        detail: 'Authentication credentials were not provided.',
      });
    }
    return true;
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): UserEntity | undefined =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
