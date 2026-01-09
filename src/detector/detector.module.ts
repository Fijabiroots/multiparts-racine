import { Module } from '@nestjs/common';
import { DetectorService } from './detector.service';
import { DetectorController } from './detector.controller';

@Module({
  providers: [DetectorService],
  controllers: [DetectorController],
  exports: [DetectorService],
})
export class DetectorModule {}
