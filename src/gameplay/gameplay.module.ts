import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ContentModule } from '../content/content.module';
import {
  CategoryEntity,
  GameCategoryEntity,
  GameEntity,
  PlayedQuestionEntity,
  QuestionEntity,
} from '../database/entities';
import { GameplayController } from './gameplay.controller';
import { GameplayService } from './gameplay.service';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      GameEntity,
      GameCategoryEntity,
      CategoryEntity,
      QuestionEntity,
      PlayedQuestionEntity,
    ]),
    AuthModule,
    ContentModule,
    MediaModule,
  ],
  controllers: [GameplayController],
  providers: [GameplayService],
})
export class GameplayModule {}
