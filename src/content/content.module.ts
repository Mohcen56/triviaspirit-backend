import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import {
  CategoryEntity,
  CategoryLikeEntity,
  CollectionEntity,
  PlayedQuestionEntity,
  QuestionEntity,
  SavedCategoryEntity,
} from '../database/entities';
import { MediaModule } from '../media/media.module';
import { ContentController } from './content.controller';
import { ContentService } from './content.service';
import { MultipartQuestionInterceptor } from './multipart-question.interceptor';
import { UploadCleanupInterceptor } from '../media/upload-cleanup.interceptor';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CollectionEntity,
      CategoryEntity,
      QuestionEntity,
      SavedCategoryEntity,
      CategoryLikeEntity,
      PlayedQuestionEntity,
    ]),
    AuthModule,
    MediaModule,
  ],
  controllers: [ContentController],
  providers: [
    ContentService,
    MultipartQuestionInterceptor,
    UploadCleanupInterceptor,
  ],
  exports: [ContentService],
})
export class ContentModule {}
