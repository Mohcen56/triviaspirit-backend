import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  root() {
    return {
      status: 'ok',
      service: 'triviaspirit-nestjs-backend',
      frontend: 'http://localhost:3000',
      health: '/health',
      api: '/api',
    };
  }

  @Get('health')
  health() {
    return { status: 'ok', service: 'triviaspirit-nestjs-backend' };
  }
}
