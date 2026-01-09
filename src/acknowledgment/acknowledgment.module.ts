import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AcknowledgmentService } from './acknowledgment.service';

@Module({
  imports: [ConfigModule],
  providers: [AcknowledgmentService],
  exports: [AcknowledgmentService],
})
export class AcknowledgmentModule {}
