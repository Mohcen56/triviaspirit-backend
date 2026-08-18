import { Module } from '@nestjs/common';
import { ThrottlerModule, minutes } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { AuthThrottlerGuard, PostgresThrottlerStorage } from './rate-limit';

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [DataSource],
      useFactory: (database: DataSource) => ({
        throttlers: [
          { name: 'ip', ttl: minutes(1), limit: 120 },
          { name: 'account', ttl: minutes(1), limit: 120 },
        ],
        storage: new PostgresThrottlerStorage(database),
      }),
    }),
  ],
  providers: [AuthThrottlerGuard],
  exports: [ThrottlerModule, AuthThrottlerGuard],
})
export class RateLimitModule {}
