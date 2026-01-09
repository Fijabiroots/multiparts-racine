import { WebhookService, WebhookEventType } from './webhook.service';
export declare class WebhookController {
    private readonly webhookService;
    constructor(webhookService: WebhookService);
    listEndpoints(): {
        success: boolean;
        count: number;
        data: {
            secret: string | undefined;
            id: string;
            url: string;
            events: WebhookEventType[] | "*";
            enabled: boolean;
            retryCount?: number;
            headers?: Record<string, string>;
        }[];
    };
    addEndpoint(body: {
        url: string;
        secret?: string;
        events?: WebhookEventType[] | '*';
        enabled?: boolean;
        headers?: Record<string, string>;
    }): {
        success: boolean;
        error: string;
        message?: undefined;
        data?: undefined;
    } | {
        success: boolean;
        message: string;
        data: {
            id: string;
            url: string;
        };
        error?: undefined;
    };
    removeEndpoint(id: string): {
        success: boolean;
        message: string;
    };
    toggleEndpoint(id: string, body: {
        enabled: boolean;
    }): {
        success: boolean;
        message: string;
    };
    listEventTypes(): {
        success: boolean;
        data: {
            type: WebhookEventType;
            category: string;
            description: string;
        }[];
    };
    getHistory(limit?: string): {
        success: boolean;
        count: number;
        data: any[];
    };
    testWebhook(body: {
        url?: string;
    }): Promise<{
        success: boolean;
        message: string;
        results: {
            endpointId: string;
            success: boolean;
            statusCode: number | undefined;
            duration: number | undefined;
            error: string | undefined;
        }[];
    }>;
    private getEventDescription;
}
