import { Type } from 'class-transformer';
import {
  IsDefined,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export enum CheckoutPlan {
  Premium = 'premium',
}

export class CheckoutDto {
  @IsOptional()
  @IsEnum(CheckoutPlan)
  plan?: CheckoutPlan = CheckoutPlan.Premium;
}

export class WebhookMetaDto {
  @IsString()
  @MaxLength(100)
  event_name: string;

  @IsOptional()
  @IsObject()
  custom_data?: Record<string, unknown>;
}

export class WebhookDataDto {
  @IsDefined()
  id: string | number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  type?: string;

  @IsObject()
  attributes: Record<string, unknown>;
}

export class PaymentWebhookDto {
  @ValidateNested()
  @Type(() => WebhookMetaDto)
  meta: WebhookMetaDto;

  @ValidateNested()
  @Type(() => WebhookDataDto)
  data: WebhookDataDto;
}
