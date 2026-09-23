import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  applyDecorators,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  AnyFilesInterceptor,
  FileFieldsInterceptor,
} from '@nestjs/platform-express';
import { Throttle, minutes } from '@nestjs/throttler';
import {
  CurrentUser,
  OptionalTokenAuthGuard,
  TokenAuthGuard,
} from '../common/auth';
import { AuthThrottlerGuard } from '../common/rate-limit';
import { integerId } from '../common/utils';
import { UserEntity } from '../database/entities';
import { ContentService } from './content.service';
import {
  AddQuestionsDto,
  CreateCategoryDto,
  CreateQuestionDto,
  UpdateCategoryDto,
  UpdateQuestionDto,
} from './dto/content.dto';
import { MultipartQuestionInterceptor } from './multipart-question.interceptor';
import { UploadCleanupInterceptor } from '../media/upload-cleanup.interceptor';
import { uploadCleanup } from '../media/upload-options';

const questionUploadOptions = {
  ...uploadCleanup,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 2,
    parts: 12,
    fieldSize: 1024 * 1024,
  },
};
const categoryUploadOptions = {
  ...uploadCleanup,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 20,
    parts: 180,
    fieldSize: 1024 * 1024,
  },
};

function questionWrite() {
  return applyDecorators(
    UseGuards(AuthThrottlerGuard, TokenAuthGuard),
    Throttle({ ip: { limit: 10, ttl: minutes(1) } }),
    UseInterceptors(
      FileFieldsInterceptor(
        [
          { name: 'image', maxCount: 1 },
          { name: 'answer_image', maxCount: 1 },
        ],
        questionUploadOptions,
      ),
      UploadCleanupInterceptor,
    ),
  );
}

function categoryWrite() {
  return applyDecorators(
    UseGuards(AuthThrottlerGuard, TokenAuthGuard),
    Throttle({ ip: { limit: 5, ttl: minutes(1) } }),
    UseInterceptors(
      AnyFilesInterceptor(categoryUploadOptions),
      MultipartQuestionInterceptor,
      UploadCleanupInterceptor,
    ),
  );
}

@Controller('api/content')
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Get('collections')
  @UseGuards(OptionalTokenAuthGuard)
  listCollections(
    @Query() query: Record<string, string | string[] | undefined>,
    @CurrentUser() user?: UserEntity,
  ) {
    return this.content.listCollections(query, user);
  }

  @Get('collections/with_categories')
  @UseGuards(OptionalTokenAuthGuard)
  collectionsWithCategories(@CurrentUser() user?: UserEntity) {
    return this.content.collectionsWithCategories(user);
  }

  @Get('collections/all_data')
  @UseGuards(OptionalTokenAuthGuard)
  allCategoryData(@CurrentUser() user?: UserEntity) {
    return this.content.allCategoryData(user);
  }

  @Get('collections/:id')
  @UseGuards(OptionalTokenAuthGuard)
  getCollection(@Param('id') id: string, @CurrentUser() user?: UserEntity) {
    return this.content.getCollection(integerId(id), user);
  }

  @Get('categories')
  @UseGuards(OptionalTokenAuthGuard)
  listCategories(
    @Query() query: Record<string, string | string[] | undefined>,
    @CurrentUser() user?: UserEntity,
  ) {
    return this.content.listOfficialCategories(query, user);
  }

  @Get('categories/:id')
  @UseGuards(OptionalTokenAuthGuard)
  getCategory(@Param('id') id: string, @CurrentUser() user?: UserEntity) {
    return this.content.getOfficialCategory(integerId(id), user);
  }

  @Get('questions/random')
  @UseGuards(OptionalTokenAuthGuard)
  randomQuestions(
    @Query() query: Record<string, string | string[] | undefined>,
    @CurrentUser() user?: UserEntity,
  ) {
    return this.content.randomQuestions(query, user);
  }

  @Get('questions')
  @UseGuards(OptionalTokenAuthGuard)
  listQuestions(
    @Query() query: Record<string, string | string[] | undefined>,
    @CurrentUser() user?: UserEntity,
  ) {
    return this.content.listQuestions(query, user);
  }

  @Post('questions')
  @questionWrite()
  createQuestion(
    @CurrentUser() user: UserEntity,
    @Body() body: CreateQuestionDto,
    @UploadedFiles() files: Record<string, Express.Multer.File[]> = {},
  ) {
    return this.content.createQuestion(user, body, files);
  }

  @Get('questions/:id')
  @UseGuards(OptionalTokenAuthGuard)
  getQuestion(@Param('id') id: string, @CurrentUser() user?: UserEntity) {
    return this.content.getQuestion(integerId(id), user);
  }

  @Put('questions/:id')
  @questionWrite()
  updateQuestion(
    @Param('id') id: string,
    @CurrentUser() user: UserEntity,
    @Body() body: UpdateQuestionDto,
    @UploadedFiles() files: Record<string, Express.Multer.File[]> = {},
  ) {
    return this.content.updateQuestion(integerId(id), user, body, files);
  }

  @Patch('questions/:id')
  @questionWrite()
  patchQuestion(
    @Param('id') id: string,
    @CurrentUser() user: UserEntity,
    @Body() body: UpdateQuestionDto,
    @UploadedFiles() files: Record<string, Express.Multer.File[]> = {},
  ) {
    return this.content.updateQuestion(integerId(id), user, body, files);
  }

  @Delete('questions/:id')
  @UseGuards(TokenAuthGuard)
  @HttpCode(204)
  async deleteQuestion(
    @Param('id') id: string,
    @CurrentUser() user: UserEntity,
  ) {
    await this.content.deleteQuestion(integerId(id), user);
  }

  @Get('user-categories/my_categories')
  @UseGuards(TokenAuthGuard)
  myCategories(
    @Query() query: Record<string, string | string[] | undefined>,
    @CurrentUser() user: UserEntity,
  ) {
    return this.content.myCategories(query, user);
  }

  @Get('user-categories/my_saved_categories')
  @UseGuards(TokenAuthGuard)
  mySavedCategories(
    @Query() query: Record<string, string | string[] | undefined>,
    @CurrentUser() user: UserEntity,
  ) {
    return this.content.mySavedCategories(user, query);
  }

  @Get('user-categories')
  @UseGuards(TokenAuthGuard)
  listUserCategories(
    @Query() query: Record<string, string | string[] | undefined>,
    @CurrentUser() user: UserEntity,
  ) {
    return this.content.listUserCategories(query, user);
  }

  @Post('user-categories')
  @categoryWrite()
  createUserCategory(
    @CurrentUser() user: UserEntity,
    @Body() body: CreateCategoryDto,
    @UploadedFiles() files: Express.Multer.File[] = [],
  ) {
    return this.content.createUserCategory(user, body, files);
  }

  @Get('user-categories/:id')
  @UseGuards(TokenAuthGuard)
  getUserCategory(@Param('id') id: string, @CurrentUser() user: UserEntity) {
    return this.content.getUserCategory(integerId(id), user);
  }

  @Put('user-categories/:id')
  @categoryWrite()
  updateUserCategory(
    @Param('id') id: string,
    @CurrentUser() user: UserEntity,
    @Body() body: UpdateCategoryDto,
    @UploadedFiles() files: Express.Multer.File[] = [],
  ) {
    return this.content.updateUserCategory(integerId(id), user, body, files);
  }

  @Patch('user-categories/:id')
  @categoryWrite()
  patchUserCategory(
    @Param('id') id: string,
    @CurrentUser() user: UserEntity,
    @Body() body: UpdateCategoryDto,
    @UploadedFiles() files: Express.Multer.File[] = [],
  ) {
    return this.content.updateUserCategory(integerId(id), user, body, files);
  }

  @Delete('user-categories/:id')
  @UseGuards(TokenAuthGuard)
  @HttpCode(204)
  async deleteUserCategory(
    @Param('id') id: string,
    @CurrentUser() user: UserEntity,
  ) {
    await this.content.deleteUserCategory(integerId(id), user);
  }

  @Post('user-categories/:id/add_questions')
  @categoryWrite()
  addQuestions(
    @Param('id') id: string,
    @CurrentUser() user: UserEntity,
    @Body() body: AddQuestionsDto,
    @UploadedFiles() files: Express.Multer.File[] = [],
  ) {
    return this.content.addQuestions(integerId(id), user, body, files);
  }

  @Post('user-categories/:id/add_to_collection')
  @UseGuards(TokenAuthGuard)
  saveCategory(@Param('id') id: string, @CurrentUser() user: UserEntity) {
    return this.content.saveCategory(integerId(id), user);
  }

  @Post('user-categories/:id/remove_from_collection')
  @UseGuards(TokenAuthGuard)
  unsaveCategory(@Param('id') id: string, @CurrentUser() user: UserEntity) {
    return this.content.unsaveCategory(integerId(id), user);
  }

  @Delete('user-categories/:id/remove_from_collection')
  @UseGuards(TokenAuthGuard)
  deleteSavedCategory(
    @Param('id') id: string,
    @CurrentUser() user: UserEntity,
  ) {
    return this.content.unsaveCategory(integerId(id), user);
  }

  @Post('user-categories/:id/like')
  @UseGuards(TokenAuthGuard)
  likeCategory(@Param('id') id: string, @CurrentUser() user: UserEntity) {
    return this.content.likeCategory(integerId(id), user);
  }

  @Post('user-categories/:id/unlike')
  @UseGuards(TokenAuthGuard)
  unlikeCategory(@Param('id') id: string, @CurrentUser() user: UserEntity) {
    return this.content.unlikeCategory(integerId(id), user);
  }

  @Delete('user-categories/:id/unlike')
  @UseGuards(TokenAuthGuard)
  deleteLike(@Param('id') id: string, @CurrentUser() user: UserEntity) {
    return this.content.unlikeCategory(integerId(id), user);
  }
}
