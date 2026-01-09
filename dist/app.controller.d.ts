export declare class AppController {
    getInfo(): {
        name: string;
        version: string;
        description: string;
        features: string[];
        endpoints: {
            scheduler: {
                'GET /scheduler/status': string;
                'POST /scheduler/start': string;
                'POST /scheduler/stop': string;
                'POST /scheduler/run-once': string;
                'POST /scheduler/configure': string;
                'PUT /scheduler/config': string;
            };
            database: {
                'GET /database/clients': string;
                'POST /database/clients': string;
                'GET /database/rfq-mappings': string;
                'GET /database/rfq-mappings/by-client-rfq/:rfq': string;
                'GET /database/rfq-mappings/by-internal-rfq/:rfq': string;
                'GET /database/config': string;
                'GET /database/keywords': string;
                'GET /database/logs': string;
            };
            detector: {
                'POST /detector/analyze': string;
                'GET /detector/refresh-keywords': string;
            };
            emails: {
                'GET /emails': string;
                'GET /emails/folders': string;
                'GET /emails/unread-with-pdf': string;
                'GET /emails/:id': string;
            };
            excel: {
                'POST /excel/generate': string;
                'POST /excel/preview': string;
            };
            drafts: {
                'GET /drafts': string;
                'POST /drafts/save': string;
            };
        };
        quickStart: {
            step1: string;
            step2: string;
            step3: string;
            step4: string;
        };
    };
    healthCheck(): {
        status: string;
        timestamp: string;
    };
}
