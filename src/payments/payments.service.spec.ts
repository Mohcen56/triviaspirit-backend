import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { Repository } from 'typeorm';
import { PaymentEntity, SubscriptionEntity } from '../database/entities';
import { PaymentWebhookDto } from './dto/payments.dto';
import { PaymentsService } from './payments.service';

describe('PaymentsService webhook security', () => {
  const payload: PaymentWebhookDto = {
    meta: { event_name: 'unhandled_event', custom_data: {} },
    data: { id: 'event-1', attributes: {} },
  };
  const rawBody = Buffer.from(JSON.stringify(payload));

  function service(configuration: Record<string, string>) {
    const transaction = jest.fn();
    const paymentRepository = {
      manager: { transaction },
    } as unknown as Repository<PaymentEntity>;
    const subscriptionRepository = {} as Repository<SubscriptionEntity>;
    return {
      paymentRepository,
      transaction,
      subject: new PaymentsService(
        paymentRepository,
        subscriptionRepository,
        new ConfigService(configuration),
      ),
    };
  }

  it('rejects invalid signatures even outside production', async () => {
    const { subject, transaction } = service({
      NODE_ENV: 'development',
      LEMONSQUEEZY_WEBHOOK_SECRET: 'secret',
    });

    await expect(
      subject.webhook(rawBody, payload, '0'.repeat(64)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('refuses webhook processing when no secret is configured', async () => {
    const { subject } = service({ NODE_ENV: 'production' });

    await expect(
      subject.webhook(rawBody, payload, undefined),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('accepts a valid signature before ignoring an unsupported event', async () => {
    const secret = 'secret';
    const signature = createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');
    const { subject, transaction } = service({
      NODE_ENV: 'test',
      LEMONSQUEEZY_WEBHOOK_SECRET: secret,
    });

    await expect(subject.webhook(rawBody, payload, signature)).resolves.toEqual(
      {
        status: 'ignored',
      },
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects refunds for an unexpected entitlement variant', () => {
    const { subject } = service({
      LEMONSQUEEZY_WEBHOOK_SECRET: 'secret',
      LEMONSQUEEZY_VARIANT_ID: 'premium-variant',
      LEMONSQUEEZY_STORE_ID: 'store-1',
      LEMONSQUEEZY_TEST_MODE: 'false',
    });
    const validateRefund = (
      subject as unknown as {
        validateRefund(
          attributes: Record<string, unknown>,
          storedVariantId: string,
        ): void;
      }
    ).validateRefund.bind(subject);

    expect(() =>
      validateRefund(
        {
          status: 'refunded',
          updated_at: '2026-09-23T00:00:00.000Z',
          store_id: 'store-1',
          test_mode: false,
        },
        'unexpected-variant',
      ),
    ).toThrow(BadRequestException);
  });
});
