import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';
import {
  collectIndexedQuestionFields,
  isIndexedQuestionField,
} from './question-input';

@Injectable()
export class MultipartQuestionInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const body = request.body as Record<string, unknown> | undefined;
    if (!body) return next.handle();

    const indexed = collectIndexedQuestionFields(Object.entries(body));
    Object.keys(body)
      .filter(isIndexedQuestionField)
      .forEach((key) => delete body[key]);
    if (indexed.size) {
      body.questions = [...indexed.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, question]) => question);
    }
    return next.handle();
  }
}
