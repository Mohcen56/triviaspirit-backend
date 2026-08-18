import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  async sendPasswordReset(
    email: string,
    name: string,
    resetUrl: string,
  ): Promise<void> {
    const apiKey = this.config.get<string>('ZEPTOMAIL_API_KEY');
    if (!apiKey) {
      this.logger.log(`Password reset for ${email}: ${resetUrl}`);
      return;
    }

    const endpoint = this.config.get<string>(
      'ZEPTOMAIL_API_ENDPOINT',
      'https://api.zeptomail.eu/',
    );
    const from = this.config.get<string>(
      'DEFAULT_FROM_EMAIL',
      'support@triviaspirit.com',
    );
    const response = await fetch(`${endpoint.replace(/\/?$/, '/')}v1.1/email`, {
      method: 'POST',
      headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: { address: from },
        to: [{ email_address: { address: email } }],
        subject: 'Reset your password',
        textbody: `Hi ${name || 'there'}, reset your password here: ${resetUrl}`,
        htmlbody: `<p>Hi ${name || 'there'},</p><p><a href="${resetUrl}">Reset your password</a></p>`,
      }),
    });
    if (!response.ok) {
      throw new Error(`ZeptoMail returned HTTP ${response.status}`);
    }
  }
}
