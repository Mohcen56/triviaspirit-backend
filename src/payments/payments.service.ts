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
    const apiKeyConfigured = Boolean(
      this.config.get<string>('LEMONSQUEEZY_API_KEY'),
    );
    const storeConfigured = Boolean(
      this.config.get<string>('LEMONSQUEEZY_STORE_ID'),
    );
    const variantConfigured = Boolean(
      this.config.get<string>('LEMONSQUEEZY_VARIANT_ID'),
    );
    if ((apiKeyConfigured || storeConfigured) && !variantConfigured) {
      throw new Error(
        'LEMONSQUEEZY_API_KEY, LEMONSQUEEZY_STORE_ID, and LEMONSQUEEZY_VARIANT_ID must be configured together',
      );
    }
    if (apiKeyConfigured !== storeConfigured) {
      throw new Error(
        'LEMONSQUEEZY_API_KEY, LEMONSQUEEZY_STORE_ID, and LEMONSQUEEZY_VARIANT_ID must be configured together',
      );
    }
    const checkoutConfigured =
      apiKeyConfigured && storeConfigured && variantConfigured;
    if (
      checkoutConfigured &&
      !this.config.get<string>('LEMONSQUEEZY_WEBHOOK_SECRET')
    ) {
      throw new Error(
        'LEMONSQUEEZY_WEBHOOK_SECRET is required when payments are configured',
      );
    }
    if (
      checkoutConfigured &&
      !this.config.get<string>('LEMONSQUEEZY_TEST_MODE')
    ) {
      throw new Error(
        'LEMONSQUEEZY_TEST_MODE must be set to true or false when payments are configured',
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
    let response: Response;
    try {
      response = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.api+json',
          'Content-Type': 'application/vnd.api+json',
          Authorization: `Bearer ${apiKey}`,
        },
        signal: AbortSignal.timeout(10_000),
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
    } catch {
      throw new ServiceUnavailableException({
        error: 'Payment provider is unavailable',
      });
    }
    if (!response.ok) {
      throw new InternalServerErrorException({
        error: 'Failed to create checkout session',
      });
    }
    let data: { data?: { attributes?: { url?: string } } };
    try {
      data = (await response.json()) as {
        data?: { attributes?: { url?: string } };
      };
    } catch {
      throw new InternalServerErrorException({
        error: 'Invalid checkout provider response',
      });
    }
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

  async history(user: UserEntity, pagination = { limit: 50, offset: 0 }) {
    const payments = await this.payments.find({
      where: { userId: user.id },
      order: { createdAt: 'DESC' },
      skip: pagination.offset,
      take: pagination.limit,
    });
    const subscriptions = await this.subscriptions.find({
      where: { userId: user.id },
      order: { createdAt: 'DESC' },
      skip: pagination.offset,
      take: pagination.limit,
    });
    return {
      payments: payments.map((item) => ({
        order_id: item.orderId,
        amount: item.amount,
        currency: item.currency,
        status: item.status,
        amount_minor: item.amountMinor,
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
    this.validateOrder(attributes, item);
    const orderId = stringValue(
      payload.data.id || attributes.order_id || attributes.order_number || '',
    );
    if (!orderId)
      throw new BadRequestException({ error: 'Webhook order ID is missing' });
    const repository = manager.getRepository(PaymentEntity);
    let payment = await repository.findOne({
      where: { orderId },
      lock: { mode: 'pessimistic_write' },
    });
    if (payment?.status === 'refunded') return;
    const providerUpdatedAt = this.date(attributes.updated_at);
    if (
      payment?.providerUpdatedAt &&
      providerUpdatedAt &&
      providerUpdatedAt <= payment.providerUpdatedAt
    ) {
      return;
    }
    const amountMinor = this.amountMinor(attributes.total);
    payment = repository.create({
      ...payment,
      orderId,
      userId: user.id,
      customerId: stringValue(attributes.customer_id),
      amount: (amountMinor / 100).toFixed(2),
      amountMinor,
      currency: stringValue(attributes.currency, 'USD').slice(0, 3),
      status: 'paid',
      variantId: stringValue(item.variant_id),
      productName: stringValue(item.product_name),
      paidAt: new Date(),
      webhookData: payload as unknown as Record<string, unknown>,
      providerUpdatedAt,
    });
    await repository.save(payment);
    await this.recomputePremium(user.id, manager);
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
      ? await paymentRepository.findOne({
          where: { orderId },
          lock: { mode: 'pessimistic_write' },
        })
      : null;
    const user = payment
      ? await manager
          .getRepository(UserEntity)
          .findOneBy({ id: payment.userId })
      : null;
    if (!payment || !user)
      throw new BadRequestException({ error: 'Webhook user is invalid' });
    this.validateRefund(attributes, payment.variantId);
    const providerUpdatedAt = this.date(attributes.updated_at);
    if (
      payment.providerUpdatedAt &&
      providerUpdatedAt &&
      providerUpdatedAt <= payment.providerUpdatedAt
    ) {
      return;
    }
    payment.status = 'refunded';
    payment.webhookData = payload as unknown as Record<string, unknown>;
    payment.providerUpdatedAt = providerUpdatedAt;
    await paymentRepository.save(payment);
    await this.recomputePremium(user.id, manager);
  }

  private async handleSubscription(
    payload: WebhookPayload,
    manager: EntityManager,
  ) {
    const attributes = payload.data.attributes;
    const subscriptionId = String(payload.data.id || '');
    if (!subscriptionId)
      throw new BadRequestException({ error: 'Subscription ID is missing' });
    this.validateSubscription(attributes);
    const subscriptionRepository = manager.getRepository(SubscriptionEntity);
    const userRepository = manager.getRepository(UserEntity);
    let subscription = await subscriptionRepository.findOne({
      where: { subscriptionId },
      lock: { mode: 'pessimistic_write' },
    });
    let user: UserEntity | null = null;
    if (subscription)
      user = await userRepository.findOneBy({ id: subscription.userId });
    if (!user) user = await this.webhookUser(payload, manager);
    if (!user)
      throw new BadRequestException({ error: 'Webhook user is invalid' });
    const providerUpdatedAt = this.date(attributes.updated_at);
    if (
      subscription?.providerUpdatedAt &&
      providerUpdatedAt &&
      providerUpdatedAt <= subscription.providerUpdatedAt
    ) {
      return;
    }
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
      providerUpdatedAt,
    });
    await subscriptionRepository.save(subscription);
    await this.recomputePremium(user.id, manager);
  }

  private async webhookUser(
    payload: WebhookPayload,
    manager: EntityManager,
  ): Promise<UserEntity | null> {
    const id = Number(payload.meta.custom_data?.user_id);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    return manager.getRepository(UserEntity).findOneBy({ id });
  }

  private async recomputePremium(userId: number, manager: EntityManager) {
    // Serialize entitlement updates for one user. Without this lock, two
    // simultaneous refunds/renewals can both calculate from stale state and
    // overwrite the profile with the wrong final premium value.
    const user = await manager.getRepository(UserEntity).findOne({
      where: { id: userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!user)
      throw new BadRequestException({ error: 'Webhook user is invalid' });
    const [payments, subscriptions] = await Promise.all([
      manager.getRepository(PaymentEntity).find({ where: { userId } }),
      manager.getRepository(SubscriptionEntity).find({ where: { userId } }),
    ]);
    const validPayments = payments.filter(
      (payment) =>
        payment.status === 'paid' &&
        payment.variantId === this.expectedVariantId(),
    );
    const validSubscriptions = subscriptions.filter(
      (subscription) =>
        subscription.variantId === this.expectedVariantId() &&
        this.subscriptionEntitlement(subscription),
    );
    const hasPermanentEntitlement = validPayments.length > 0;
    const expiryDates = validSubscriptions
      .map((subscription) => this.entitlementExpiry(subscription))
      .filter((date): date is Date => date !== null);
    const latestExpiry = expiryDates.reduce<Date | null>(
      (latest, date) => (!latest || date > latest ? date : latest),
      null,
    );
    const premium = hasPermanentEntitlement || validSubscriptions.length > 0;
    const expiry = hasPermanentEntitlement
      ? null
      : latestExpiry
        ? this.dateOnly(latestExpiry)
        : null;
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

  private validateOrder(
    attributes: Record<string, unknown>,
    item: Record<string, unknown>,
  ) {
    if (stringValue(attributes.status).toLowerCase() !== 'paid') {
      throw new BadRequestException({ error: 'Order is not paid' });
    }
    this.validateVariant(stringValue(item.variant_id));
    this.validateStore(attributes);
    this.validateTestMode(attributes);
    this.validateProviderTimestamp(attributes);
  }

  private amountMinor(value: unknown): number {
    const raw = stringValue(value).trim();
    if (!/^\d+$/.test(raw)) {
      throw new BadRequestException({ error: 'Invalid payment amount' });
    }
    const amount = Number(raw);
    if (!Number.isSafeInteger(amount)) {
      throw new BadRequestException({ error: 'Invalid payment amount' });
    }
    return amount;
  }

  private validateSubscription(attributes: Record<string, unknown>) {
    const status = stringValue(attributes.status).toLowerCase();
    if (
      ![
        'on_trial',
        'active',
        'paused',
        'past_due',
        'unpaid',
        'cancelled',
        'expired',
      ].includes(status)
    ) {
      throw new BadRequestException({ error: 'Invalid subscription status' });
    }
    this.validateVariant(stringValue(attributes.variant_id));
    this.validateStore(attributes);
    this.validateTestMode(attributes);
    this.validateProviderTimestamp(attributes);
  }

  private validateProviderTimestamp(attributes: Record<string, unknown>) {
    if (!this.date(attributes.updated_at)) {
      throw new BadRequestException({
        error: 'Payment provider update timestamp is required',
      });
    }
  }

  private validateRefund(
    attributes: Record<string, unknown>,
    storedVariantId: string,
  ) {
    this.validateProviderTimestamp(attributes);
    this.validateVariant(storedVariantId);
    const status = stringValue(attributes.status).toLowerCase();
    if (status && status !== 'refunded') {
      throw new BadRequestException({ error: 'Invalid refund status' });
    }
    const item = (attributes.first_order_item || {}) as Record<string, unknown>;
    const actualVariant = stringValue(attributes.variant_id || item.variant_id);
    if (actualVariant) this.validateVariant(actualVariant);
    this.validateStore(attributes);
    this.validateTestMode(attributes);
  }

  private validateVariant(actual: string) {
    const expected = this.expectedVariantId();
    if (!expected || actual !== expected) {
      throw new BadRequestException({ error: 'Unexpected payment variant' });
    }
  }

  private validateStore(attributes: Record<string, unknown>) {
    const expected = this.config.get<string>('LEMONSQUEEZY_STORE_ID');
    const actual = stringValue(attributes.store_id);
    if (expected && actual !== expected) {
      throw new BadRequestException({ error: 'Unexpected payment store' });
    }
  }

  private validateTestMode(attributes: Record<string, unknown>) {
    const configured = this.config.get<string>('LEMONSQUEEZY_TEST_MODE');
    if (configured === undefined || configured === '') return;
    const normalized = configured.toLowerCase();
    if (normalized !== 'true' && normalized !== 'false') {
      throw new BadRequestException({ error: 'Invalid payment environment' });
    }
    const expected = normalized === 'true';
    if (typeof attributes.test_mode !== 'boolean') {
      throw new BadRequestException({
        error: 'Payment environment is missing',
      });
    }
    const actual = attributes.test_mode;
    if (actual !== expected) {
      throw new BadRequestException({
        error: 'Unexpected payment environment',
      });
    }
  }

  private expectedVariantId(): string {
    return this.config.get<string>('LEMONSQUEEZY_VARIANT_ID', '');
  }

  private subscriptionEntitlement(subscription: SubscriptionEntity): boolean {
    const status = subscription.status.toLowerCase();
    if (status === 'active' || status === 'on_trial') return true;
    if (status === 'cancelled' || status === 'past_due') {
      return Boolean(
        subscription.endsAt && subscription.endsAt.getTime() > Date.now(),
      );
    }
    return false;
  }

  private entitlementExpiry(subscription: SubscriptionEntity): Date | null {
    if (subscription.status.toLowerCase() === 'cancelled') {
      return subscription.endsAt;
    }
    return subscription.renewsAt || subscription.endsAt;
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
