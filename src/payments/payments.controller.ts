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

@Controller('api/payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('checkout')
  @UseGuards(TokenAuthGuard)
  checkout(
    @CurrentUser() user: UserEntity,
    @Body() body: Record<string, unknown>,
  ) {
    return this.payments.createCheckout(user, body);
  }

  @Post('webhook')
  webhook(
    @Req() request: RawBodyRequest<Request>,
    @Body() body: Record<string, unknown>,
    @Headers('x-signature') signature?: string,
  ) {
    return this.payments.webhook(
      request.rawBody || Buffer.from(JSON.stringify(body)),
      body,
      signature,
    );
  }

  @Get('history')
  @UseGuards(TokenAuthGuard)
  history(@CurrentUser() user: UserEntity) {
    return this.payments.history(user);
  }
}
