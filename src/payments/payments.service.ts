import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Repository } from 'typeorm';
import { stringValue } from '../common/utils';
import {
  PaymentEntity,
  SubscriptionEntity,
  UserEntity,
  UserProfileEntity,
} from '../database/entities';

type WebhookPayload = {
  meta?: { event_name?: string; custom_data?: Record<string, unknown> };
  data?: { id?: string | number; attributes?: Record<string, any> };
};

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(PaymentEntity)
    private readonly payments: Repository<PaymentEntity>,
    @InjectRepository(SubscriptionEntity)
    private readonly subscriptions: Repository<SubscriptionEntity>,
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(UserProfileEntity)
    private readonly profiles: Repository<UserProfileEntity>,
    private readonly config: ConfigService,
  ) {}

  async createCheckout(user: UserEntity, body: Record<string, unknown>) {
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
    rawBody: Buffer,
    body: WebhookPayload,
    signature: string | undefined,
  ) {
    if (this.config.get('NODE_ENV', 'development') === 'production') {
      if (!this.verifySignature(rawBody, signature || '')) {
        throw new UnauthorizedException({ error: 'Invalid signature' });
      }
    }
    const eventName = body.meta?.event_name;
    switch (eventName) {
      case 'order_created':
        await this.handleOrderCreated(body);
        break;
      case 'order_refunded':
        await this.handleOrderRefunded(body);
        break;
      case 'subscription_created':
      case 'subscription_updated':
      case 'subscription_cancelled':
      case 'subscription_expired':
        await this.handleSubscription(body);
        break;
      default:
        return { status: 'ignored' };
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
    const expected = createHmac('sha256', secret).update(payload).digest('hex');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private async handleOrderCreated(payload: WebhookPayload) {
    const user = await this.webhookUser(payload);
    if (!user) return;
    const attributes = payload.data?.attributes || {};
    const item = attributes.first_order_item || {};
    const orderId = String(
      payload.data?.id || attributes.order_id || attributes.order_number || '',
    );
    if (!orderId)
      throw new BadRequestException({ error: 'Webhook order ID is missing' });
    let payment = await this.payments.findOneBy({ orderId });
    payment = this.payments.create({
      ...payment,
      orderId,
      userId: user.id,
      customerId: String(attributes.customer_id || ''),
      amount: String(attributes.total || 0),
      currency: String(attributes.currency || 'USD').slice(0, 3),
      status: String(attributes.status || 'paid'),
      variantId: String(item.variant_id || ''),
      productName: String(item.product_name || ''),
      paidAt: new Date(),
      webhookData: payload as Record<string, unknown>,
    });
    await this.payments.save(payment);
    await this.setPremium(user.id, true, null);
  }

  private async handleOrderRefunded(payload: WebhookPayload) {
    const user = await this.webhookUser(payload);
    if (!user) return;
    const attributes = payload.data?.attributes || {};
    const orderId = String(
      payload.data?.id || attributes.order_id || attributes.order_number || '',
    );
    const payment = orderId ? await this.payments.findOneBy({ orderId }) : null;
    if (payment) {
      payment.status = 'refunded';
      payment.webhookData = payload;
      await this.payments.save(payment);
    }
    await this.setPremium(
      user.id,
      false,
      new Date().toISOString().slice(0, 10),
    );
  }

  private async handleSubscription(payload: WebhookPayload) {
    const attributes = payload.data?.attributes || {};
    const subscriptionId = String(payload.data?.id || '');
    if (!subscriptionId)
      throw new BadRequestException({ error: 'Subscription ID is missing' });
    let subscription = await this.subscriptions.findOneBy({ subscriptionId });
    let user: UserEntity | null = null;
    if (subscription)
      user = await this.users.findOneBy({ id: subscription.userId });
    if (!user) user = await this.webhookUser(payload);
    if (!user) return;
    subscription = this.subscriptions.create({
      ...subscription,
      subscriptionId,
      userId: user.id,
      customerId: String(attributes.customer_id || ''),
      orderId: String(attributes.order_id || ''),
      variantId: String(attributes.variant_id || ''),
      productName: String(attributes.product_name || ''),
      status: String(attributes.status || 'expired'),
      trialEndsAt: this.date(attributes.trial_ends_at),
      renewsAt: this.date(attributes.renews_at),
      endsAt: this.date(attributes.ends_at),
    });
    await this.subscriptions.save(subscription);
    const active = ['on_trial', 'active'].includes(subscription.status);
    await this.setPremium(
      user.id,
      active,
      active
        ? this.dateOnly(subscription.renewsAt)
        : this.dateOnly(subscription.endsAt),
    );
  }

  private async webhookUser(
    payload: WebhookPayload,
  ): Promise<UserEntity | null> {
    const id = Number(payload.meta?.custom_data?.user_id);
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    return this.users.findOneBy({ id });
  }

  private async setPremium(
    userId: number,
    premium: boolean,
    expiry: string | null,
  ) {
    let profile = await this.profiles.findOneBy({ userId });
    profile = this.profiles.create({
      ...profile,
      userId,
      isPremium: premium,
      premiumExpiry: expiry,
    });
    await this.profiles.save(profile);
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
