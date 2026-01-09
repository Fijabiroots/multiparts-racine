import { Module, Global } from '@nestjs/common';
import { BrandIntelligenceService } from './brand-intelligence.service';
import { BrandIntelligenceController } from './brand-intelligence.controller';

@Global()
@Module({
  providers: [BrandIntelligenceService],
  controllers: [BrandIntelligenceController],
  exports: [BrandIntelligenceService],
})
export class BrandIntelligenceModule {}
