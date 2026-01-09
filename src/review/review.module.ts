import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ReviewService } from './review.service';
import { ReviewController } from './review.controller';
import { DatabaseModule } from '../database/database.module';
import { ExcelModule } from '../excel/excel.module';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    ExcelModule,
  ],
  controllers: [ReviewController],
  providers: [ReviewService],
  exports: [ReviewService],
})
export class ReviewModule {}
