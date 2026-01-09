import { DraftService } from './draft.service';
import { RfqLanguage } from '../common/rfq-instructions';
export declare class DraftController {
    private readonly draftService;
    constructor(draftService: DraftService);
    listDrafts(limit?: string): Promise<{
        success: boolean;
        count: number;
        data: any[];
    }>;
    getRfqInstructions(language?: RfqLanguage): {
        success: boolean;
        language: RfqLanguage;
        html: string;
        availableLanguages: string[];
    };
    previewRfqInstructions(language?: RfqLanguage): string;
    getCompanyInfo(): {
        success: boolean;
        data: {
            name: string;
            fullName: string;
            address: {
                line1: string;
                line2: string;
                city: string;
                country: string;
                countryCode: string;
            };
            contact: {
                name: string;
                title: string;
                phone: string;
                mobile: string;
                emails: string[];
                primaryEmail: string;
            };
            defaultPort: string;
            defaultIncoterm: string;
        };
        templates: {
            header: string;
            addressBlock: string;
        };
    };
    getAvailableLanguages(): {
        success: boolean;
        data: {
            code: string;
            name: string;
            description: string;
        }[];
        default: string;
        autoDetection: {
            enabled: boolean;
            description: string;
            frenchDomains: string[];
            englishDomains: string[];
        };
    };
    createTestDraft(body: {
        to?: string;
        language?: RfqLanguage;
    }): Promise<{
        success: boolean;
        message: string;
        to: string;
        language: RfqLanguage;
    }>;
}
