import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

@Controller()
export class AppController {
  constructor(
    private readonly config: ConfigService,
    private readonly database: DataSource,
  ) {}

  @Get()
  root() {
    return {
      status: 'ok',
      service: 'triviaspirit-nestjs-backend',
      frontend: this.config.get<string>('FRONTEND_URL', ''),
      health: '/health',
      api: '/api',
    };
  }

  @Get('health')
  health() {
    return { status: 'ok', service: 'triviaspirit-nestjs-backend' };
  }

  @Get('ready')
  async readiness() {
    try {
      await this.database.query('SELECT 1');
      return { status: 'ok', service: 'triviaspirit-nestjs-backend' };
    } catch {
      throw new ServiceUnavailableException({ status: 'not_ready' });
    }
  }
}
