import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { ContentModule } from './content/content.module';
import { ENTITIES } from './database/entities';
import { GameplayModule } from './gameplay/gameplay.module';
import { MediaModule } from './media/media.module';
import { PaymentsModule } from './payments/payments.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('DATABASE_URL');
        if (!url) throw new Error('DATABASE_URL must be configured');
        return {
          type: 'postgres' as const,
          url,
          entities: ENTITIES,
          synchronize:
            config
              .get<string>('DATABASE_SYNCHRONIZE', 'false')
              .toLowerCase() === 'true',
          logging:
            config.get<string>('DATABASE_LOGGING', 'false').toLowerCase() ===
            'true',
          ssl:
            config.get<string>('DATABASE_SSL', 'false').toLowerCase() === 'true'
              ? { rejectUnauthorized: false }
              : false,
        };
      },
    }),
    MediaModule,
    AuthModule,
    ContentModule,
    GameplayModule,
    PaymentsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
