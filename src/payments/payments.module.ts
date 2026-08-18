import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import {
  PaymentEntity,
  PaymentWebhookEventEntity,
  SubscriptionEntity,
  UserEntity,
  UserProfileEntity,
} from '../database/entities';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaymentEntity,
      PaymentWebhookEventEntity,
      SubscriptionEntity,
      UserEntity,
      UserProfileEntity,
    ]),
    AuthModule,
  ],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
