import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

// Services universels
import { UniversalLlmParserService } from './universal-llm-parser.service';
import { DocumentExtractionService } from './document-extraction.service';
import { HybridParserService } from './hybrid-parser.service';
import { CanonicalAdapterService } from './canonical-adapter.service';

// Controller
import { DocumentParserController } from './document-parser.controller';

@Module({
  imports: [ConfigModule],
  controllers: [DocumentParserController],
  providers: [
    // Parser LLM universel
    UniversalLlmParserService,
    
    // Orchestrateur d'extraction (PDF, Excel, Word)
    DocumentExtractionService,
    
    // Parser hybride regex + LLM
    HybridParserService,
    
    // Adaptateur pour compatibilité avec code existant
    CanonicalAdapterService,
  ],
  exports: [
    UniversalLlmParserService,
    DocumentExtractionService,
    HybridParserService,
    CanonicalAdapterService,
  ],
})
export class LlmModule {}
