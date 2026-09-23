import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { unlink } from 'node:fs/promises';
import { finalize, Observable } from 'rxjs';

type UploadedFile = Express.Multer.File & { path?: string };

function filesFromRequest(request: Request): UploadedFile[] {
  const files: UploadedFile[] = [];
  const visit = (value: unknown) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value === 'object' && 'path' in value) {
      files.push(value as UploadedFile);
      return;
    }
    if (typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(request.file);
  visit(request.files);
  return files;
}

@Injectable()
export class UploadCleanupInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    return next.handle().pipe(
      finalize(() => {
        void Promise.all(
          filesFromRequest(request).map(async (file) => {
            if (!file.path) return;
            try {
              await unlink(file.path);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return;
            }
          }),
        );
      }),
    );
  }
}
