import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser, TokenAuthGuard } from '../common/auth';
import { UserEntity } from '../database/entities';
import { PaymentsService } from './payments.service';
import { CheckoutDto, PaymentWebhookDto } from './dto/payments.dto';

@Controller('api/payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('checkout')
  @UseGuards(TokenAuthGuard)
  checkout(@CurrentUser() user: UserEntity, @Body() body: CheckoutDto) {
    return this.payments.createCheckout(user, body);
  }

  @Post('webhook')
  webhook(
    @Req() request: RawBodyRequest<Request>,
    @Body() body: PaymentWebhookDto,
    @Headers('x-signature') signature?: string,
  ) {
    return this.payments.webhook(request.rawBody, body, signature);
  }

  @Get('history')
  @UseGuards(TokenAuthGuard)
  history(@CurrentUser() user: UserEntity) {
    return this.payments.history(user);
  }
}
