import { Module, forwardRef } from '@nestjs/common';
import { DraftService } from './draft.service';
import { DraftController } from './draft.controller';
import { SupplierCollectorModule } from '../supplier-collector/supplier-collector.module';

@Module({
  imports: [
    forwardRef(() => SupplierCollectorModule),
  ],
  providers: [DraftService],
  controllers: [DraftController],
  exports: [DraftService],
})
export class DraftModule {}
