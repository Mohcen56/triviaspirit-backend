import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';

@Injectable()
export class MultipartQuestionInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const body = request.body as Record<string, unknown> | undefined;
    if (!body) return next.handle();

    const indexed = new Map<number, Record<string, unknown>>();
    for (const [key, value] of Object.entries(body)) {
      const match = /^questions\[(\d+)]\[(\w+)]$/.exec(key);
      if (!match) continue;
      const index = Number(match[1]);
      indexed.set(index, {
        ...(indexed.get(index) || {}),
        [match[2]]: value,
      });
      delete body[key];
    }
    if (indexed.size) {
      body.questions = [...indexed.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, question]) => question);
    }
    return next.handle();
  }
}
