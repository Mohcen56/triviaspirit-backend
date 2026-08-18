import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { ContentModule } from './content/content.module';
import { databaseOptions } from './database/database-options';
import { GameplayModule } from './gameplay/gameplay.module';
import { MediaModule } from './media/media.module';
import { PaymentsModule } from './payments/payments.module';
import { AppController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot(databaseOptions()),
    MediaModule,
    AuthModule,
    ContentModule,
    GameplayModule,
    PaymentsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
