import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, TokenAuthGuard } from '../common/auth';
import { integerId } from '../common/utils';
import { UserEntity } from '../database/entities';
import { GameplayService } from './gameplay.service';

@Controller('api/gameplay')
@UseGuards(TokenAuthGuard)
export class GameplayController {
  constructor(private readonly gameplay: GameplayService) {}

  @Get('stats')
  stats(@CurrentUser() user: UserEntity) {
    return this.gameplay.stats(user);
  }

  @Get('recent')
  recent(@CurrentUser() user: UserEntity) {
    return this.gameplay.recent(user);
  }

  @Get('games')
  list(@CurrentUser() user: UserEntity) {
    return this.gameplay.list(user);
  }

  @Post('games')
  create(
    @CurrentUser() user: UserEntity,
    @Body() body: Record<string, unknown>,
  ) {
    return this.gameplay.create(user, body);
  }

  @Get('games/:id/available_questions')
  availableQuestions(@Param('id') id: string, @CurrentUser() user: UserEntity) {
    return this.gameplay.availableQuestions(integerId(id), user);
  }

  @Get('games/:id/prefetch_outside_board')
  outsideBoard(
    @Param('id') id: string,
    @Query('count') count: string | undefined,
    @CurrentUser() user: UserEntity,
  ) {
    return this.gameplay.outsideBoard(integerId(id), user, count);
  }

  @Post('games/:id/finish_round')
  @HttpCode(200)
  finishRound(
    @Param('id') id: string,
    @CurrentUser() user: UserEntity,
    @Body() body: Record<string, unknown>,
  ) {
    return this.gameplay.finishRound(integerId(id), user, body);
  }

  @Get('games/:id')
  retrieve(@Param('id') id: string, @CurrentUser() user: UserEntity) {
    return this.gameplay.retrieve(integerId(id), user);
  }

  @Delete('games/:id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() user: UserEntity) {
    await this.gameplay.remove(integerId(id), user);
  }
}
