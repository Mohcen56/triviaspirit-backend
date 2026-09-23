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
  @IsDefined()
  @IsString()
  @MaxLength(100)
  event_name: string;

  @IsOptional()
  @IsObject()
  custom_data?: Record<string, unknown>;
}

export class WebhookDataDto {
  @IsDefined()
  @IsString()
  id: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  type?: string;

  @IsDefined()
  @IsObject()
  attributes: Record<string, unknown>;
}

export class PaymentWebhookDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => WebhookMetaDto)
  meta: WebhookMetaDto;

  @IsDefined()
  @ValidateNested()
  @Type(() => WebhookDataDto)
  data: WebhookDataDto;
}
