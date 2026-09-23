import { Injectable } from '@nestjs/common';
import { Request } from 'express';
import {
  ThrottlerGuard,
  ThrottlerRequest,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { createHash } from 'node:crypto';
import { DataSource } from 'typeorm';

type RateLimitRow = {
  total_hits: number;
  expires_at: Date;
  blocked_until: Date | null;
};

export class PostgresThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly database: DataSource) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ) {
    void throttlerName;
    const rows = await this.database.query<RateLimitRow[]>(
      `
        WITH expired AS (
          DELETE FROM "security_auth_rate_limit"
          WHERE "expires_at" < clock_timestamp() - interval '1 day'
            AND ("blocked_until" IS NULL OR "blocked_until" < clock_timestamp())
        )
        INSERT INTO "security_auth_rate_limit"
          ("rate_key", "total_hits", "expires_at", "blocked_until")
        VALUES ($1, 1, clock_timestamp() + $2 * interval '1 millisecond', NULL)
        ON CONFLICT ("rate_key") DO UPDATE SET
          "total_hits" = CASE
            WHEN "security_auth_rate_limit"."blocked_until" > clock_timestamp()
              THEN "security_auth_rate_limit"."total_hits"
            WHEN "security_auth_rate_limit"."blocked_until" IS NOT NULL
              OR "security_auth_rate_limit"."expires_at" <= clock_timestamp()
              THEN 1
            ELSE "security_auth_rate_limit"."total_hits" + 1
          END,
          "expires_at" = CASE
            WHEN "security_auth_rate_limit"."blocked_until" > clock_timestamp()
              THEN "security_auth_rate_limit"."expires_at"
            WHEN "security_auth_rate_limit"."blocked_until" IS NOT NULL
              OR "security_auth_rate_limit"."expires_at" <= clock_timestamp()
              THEN clock_timestamp() + $2 * interval '1 millisecond'
            ELSE "security_auth_rate_limit"."expires_at"
          END,
          "blocked_until" = CASE
            WHEN "security_auth_rate_limit"."blocked_until" > clock_timestamp()
              THEN "security_auth_rate_limit"."blocked_until"
            WHEN "security_auth_rate_limit"."blocked_until" IS NOT NULL
              OR "security_auth_rate_limit"."expires_at" <= clock_timestamp()
              THEN NULL
            WHEN "security_auth_rate_limit"."total_hits" + 1 > $3
              THEN clock_timestamp() + $4 * interval '1 millisecond'
            ELSE NULL
          END,
          "updated_at" = clock_timestamp()
        RETURNING "total_hits", "expires_at", "blocked_until"
      `,
      [key, ttl, limit, blockDuration || ttl],
    );
    const row = rows[0];
    const now = Date.now();
    const blockedUntil = row.blocked_until
      ? new Date(row.blocked_until).getTime()
      : 0;
    return {
      totalHits: Number(row.total_hits),
      timeToExpire: Math.max(
        0,
        Math.ceil((new Date(row.expires_at).getTime() - now) / 1000),
      ),
      isBlocked: blockedUntil > now,
      timeToBlockExpire: Math.max(0, Math.ceil((blockedUntil - now) / 1000)),
    };
  }
}

@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(request: Record<string, any>): Promise<string> {
    const req = request as Request;
    return Promise.resolve(this.ipAddress(req));
  }

  protected override async handleRequest(
    requestProps: ThrottlerRequest,
  ): Promise<boolean> {
    if (requestProps.throttler.name !== 'account') {
      return super.handleRequest(requestProps);
    }
    const request = requestProps.context.switchToHttp().getRequest<Request>();
    const tracker = this.accountTracker(request);
    return super.handleRequest({
      ...requestProps,
      getTracker: () => Promise.resolve(tracker),
    });
  }

  private accountTracker(request: Request): string {
    const path = request.path.toLowerCase().replace(/\/+$/, '');
    const body = request.body as Record<string, unknown> | undefined;
    let account: string | undefined;
    if (path.endsWith('/login') || path.endsWith('/password-reset')) {
      account = typeof body?.email === 'string' ? body.email : undefined;
    } else if (path.endsWith('/password-reset-confirm')) {
      account = typeof body?.uid === 'string' ? body.uid : undefined;
    }
    if (!account) return `ip:${this.ipAddress(request)}`;
    return `account:${createHash('sha256')
      .update(account.trim().toLowerCase())
      .digest('hex')}`;
  }

  private ipAddress(request: Request): string {
    return request.ips?.[0] || request.ip || request.socket.remoteAddress || '';
  }
}
