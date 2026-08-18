import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  OnModuleInit,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { EntityManager, QueryFailedError, Repository } from 'typeorm';
import { stringValue } from '../common/utils';
import {
  PaymentEntity,
  PaymentWebhookEventEntity,
  SubscriptionEntity,
  UserEntity,
  UserProfileEntity,
} from '../database/entities';
import { CheckoutDto, PaymentWebhookDto } from './dto/payments.dto';

type WebhookPayload = PaymentWebhookDto;

@Injectable()
export class PaymentsService implements OnModuleInit {
  constructor(
    @InjectRepository(PaymentEntity)
    private readonly payments: Repository<PaymentEntity>,
    @InjectRepository(SubscriptionEntity)
    private readonly subscriptions: Repository<SubscriptionEntity>,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const paymentApiConfigured = [
      'LEMONSQUEEZY_API_KEY',
      'LEMONSQUEEZY_STORE_ID',
      'LEMONSQUEEZY_VARIANT_ID',
    ].some((name) => Boolean(this.config.get<string>(name)));
    if (
      paymentApiConfigured &&
      !this.config.get<string>('LEMONSQUEEZY_WEBHOOK_SECRET')
    ) {
      throw new Error(
        'LEMONSQUEEZY_WEBHOOK_SECRET is required when payments are configured',
      );
    }
  }

  async createCheckout(user: UserEntity, body: CheckoutDto) {
    const apiKey = this.config.get<string>('LEMONSQUEEZY_API_KEY');
    const storeId = this.config.get<string>('LEMONSQUEEZY_STORE_ID');
    const variantId = this.config.get<string>('LEMONSQUEEZY_VARIANT_ID');
    if (!apiKey || !storeId || !variantId) {
      throw new ServiceUnavailableException({
        error: 'Payment system not configured',
        detail: 'Lemon Squeezy environment variables are missing',
      });
    }
    const response = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        data: {
          type: 'checkouts',
          attributes: {
            checkout_data: {
              email: user.email,
              name: user.username,
              custom: {
                user_id: String(user.id),
                username: user.username,
                plan: body.plan || 'premium',
              },
            },
          },
          relationships: {
            store: { data: { type: 'stores', id: String(storeId) } },
            variant: { data: { type: 'variants', id: String(variantId) } },
          },
        },
      }),
    });
    if (!response.ok) {
      throw new InternalServerErrorException({
        error: 'Failed to create checkout session',
      });
    }
    const data = (await response.json()) as {
      data?: { attributes?: { url?: string } };
    };
    const checkoutUrl = data.data?.attributes?.url;
    if (!checkoutUrl)
      throw new InternalServerErrorException({
        error: 'Failed to create checkout session',
      });
    return {
      checkout_url: checkoutUrl,
      message: 'Checkout session created successfully',
    };
  }

  async webhook(
    rawBody: Buffer | undefined,
    body: WebhookPayload,
    signature: string | undefined,
  ) {
    if (!this.config.get<string>('LEMONSQUEEZY_WEBHOOK_SECRET')) {
      throw new ServiceUnavailableException({
        error: 'Payment webhook is not configured',
      });
    }
    if (!rawBody || !this.verifySignature(rawBody, signature || '')) {
      throw new UnauthorizedException({ error: 'Invalid signature' });
    }

    const eventName = body.meta.event_name;
    const handledEvents = new Set([
      'order_created',
      'order_refunded',
      'subscription_created',
      'subscription_updated',
      'subscription_cancelled',
      'subscription_expired',
    ]);
    if (!handledEvents.has(eventName)) return { status: 'ignored' };

    const fingerprint = createHash('sha256').update(rawBody).digest('hex');
    try {
      await this.payments.manager.transaction(async (manager) => {
        await manager.insert(PaymentWebhookEventEntity, {
          fingerprint,
          eventName,
          resourceId: String(body.data.id),
          processedAt: null,
        });
        switch (eventName) {
          case 'order_created':
            await this.handleOrderCreated(body, manager);
            break;
          case 'order_refunded':
            await this.handleOrderRefunded(body, manager);
            break;
          default:
            await this.handleSubscription(body, manager);
        }
        await manager.update(
          PaymentWebhookEventEntity,
          { fingerprint },
          { processedAt: new Date() },
        );
      });
    } catch (error) {
      if (this.isDuplicateWebhook(error)) return { status: 'duplicate' };
      throw error;
    }
    return { status: 'success' };
  }

  async history(user: UserEntity) {
    const payments = await this.payments.find({
      where: { userId: user.id },
      order: { createdAt: 'DESC' },
    });
    const subscriptions = await this.subscriptions.find({
      where: { userId: user.id },
      order: { createdAt: 'DESC' },
    });
    return {
      payments: payments.map((item) => ({
        order_id: item.orderId,
        amount: item.amount,
        currency: item.currency,
        status: item.status,
        product_name: item.productName,
        paid_at: item.paidAt,
        created_at: item.createdAt,
      })),
      subscriptions: subscriptions.map((item) => ({
        subscription_id: item.subscriptionId,
        product_name: item.productName,
        status: item.status,
        renews_at: item.renewsAt,
        ends_at: item.endsAt,
        created_at: item.createdAt,
      })),
    };
  }

  private verifySignature(payload: Buffer, signature: string): boolean {
    const secret = this.config.get<string>('LEMONSQUEEZY_WEBHOOK_SECRET');
    if (!secret || !signature) return false;
    const expected = createHmac('sha256', secret).update(payload).digest();
    const provided = signature.trim();
    if (!/^[a-f\d]{64}$/i.test(provided)) return false;
    const a = Buffer.from(provided, 'hex');
    const b = expected;
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private async handleOrderCreated(
    payload: WebhookPayload,
    manager: EntityManager,
  ) {
    const user = await this.webhookUser(payload, manager);
    if (!user)
      throw new BadRequestException({ error: 'Webhook user is invalid' });
    const attributes = payload.data.attributes;
    const item = (attributes.first_order_item || {}) as Record<string, unknown>;
    const orderId = stringValue(
      payload.data.id || attributes.order_id || attributes.order_number || '',
    );
    if (!orderId)
      throw new BadRequestException({ error: 'Webhook order ID is missing' });
    const repository = manager.getRepository(PaymentEntity);
    let payment = await repository.findOneBy({ orderId });
    payment = repository.create({
      ...payment,
      orderId,
      userId: user.id,
      customerId: stringValue(attributes.customer_id),
      amount: stringValue(attributes.total, '0'),
      currency: stringValue(attributes.currency, 'USD').slice(0, 3),
      status: stringValue(attributes.status, 'paid'),
      variantId: stringValue(item.variant_id),
      productName: stringValue(item.product_name),
      paidAt: new Date(),
      webhookData: payload as unknown as Record<string, unknown>,
    });
    await repository.save(payment);
    await this.setPremium(user.id, true, null, manager);
  }

  private async handleOrderRefunded(
    payload: WebhookPayload,
    manager: EntityManager,
  ) {
    const attributes = payload.data.attributes;
    const orderId = stringValue(
      payload.data.id || attributes.order_id || attributes.order_number || '',
    );
    const paymentRepository = manager.getRepository(PaymentEntity);
    const payment = orderId
      ? await paymentRepository.findOneBy({ orderId })
      : null;
    const user = payment
      ? await manager
          .getRepository(UserEntity)
          .findOneBy({ id: payment.userId })
      : await this.webhookUser(payload, manager);
    if (!user)
      throw new BadRequestException({ error: 'Webhook user is invalid' });
    if (payment) {
      payment.status = 'refunded';
      payment.webhookData = payload as unknown as Record<string, unknown>;
      await paymentRepository.save(payment);
    }
    await this.setPremium(
      user.id,
      false,
      new Date().toISOString().slice(0, 10),
      manager,
    );
  }

  private async handleSubscription(
    payload: WebhookPayload,
    manager: EntityManager,
  ) {
    const attributes = payload.data.attributes;
    const subscriptionId = String(payload.data.id || '');
    if (!subscriptionId)
      throw new BadRequestException({ error: 'Subscription ID is missing' });
    const subscriptionRepository = manager.getRepository(SubscriptionEntity);
    const userRepository = manager.getRepository(UserEntity);
    let subscription = await subscriptionRepository.findOneBy({
      subscriptionId,
    });
    let user: UserEntity | null = null;
    if (subscription)
      user = await userRepository.findOneBy({ id: subscription.userId });
    if (!user) user = await this.webhookUser(payload, manager);
    if (!user)
      throw new BadRequestException({ error: 'Webhook user is invalid' });
    subscription = subscriptionRepository.create({
      ...subscription,
      subscriptionId,
      userId: user.id,
      customerId: stringValue(attributes.customer_id),
      orderId: stringValue(attributes.order_id),
      variantId: stringValue(attributes.variant_id),
      productName: stringValue(attributes.product_name),
      status: stringValue(attributes.status, 'expired'),
      trialEndsAt: this.date(attributes.trial_ends_at),
      renewsAt: this.date(attributes.renews_at),
      endsAt: this.date(attributes.ends_at),
    });
    await subscriptionRepository.save(subscription);
    const active = ['on_trial', 'active'].includes(subscription.status);
    await this.setPremium(
      user.id,
      active,
      active
        ? this.dateOnly(subscription.renewsAt)
        : this.dateOnly(subscription.endsAt),
      manager,
    );
  }

  private async webhookUser(
    payload: WebhookPayload,
    manager: EntityManager,
  ): Promise<UserEntity | null> {
    const id = Number(payload.meta.custom_data?.user_id);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    return manager.getRepository(UserEntity).findOneBy({ id });
  }

  private async setPremium(
    userId: number,
    premium: boolean,
    expiry: string | null,
    manager: EntityManager,
  ) {
    const repository = manager.getRepository(UserProfileEntity);
    let profile = await repository.findOneBy({ userId });
    profile = repository.create({
      ...profile,
      userId,
      isPremium: premium,
      premiumExpiry: expiry,
    });
    await repository.save(profile);
  }

  private isDuplicateWebhook(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) return false;
    const driverError = error.driverError as {
      code?: string;
      constraint?: string;
      detail?: string;
    };
    return (
      driverError.code === '23505' &&
      (driverError.constraint === 'UQ_payments_webhook_event_fingerprint' ||
        driverError.detail?.includes('(fingerprint)') === true)
    );
  }

  private date(value: unknown): Date | null {
    if (!value) return null;
    const parsed = new Date(stringValue(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private dateOnly(value: Date | null): string | null {
    return value ? value.toISOString().slice(0, 10) : null;
  }
}
