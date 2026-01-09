declare const _default: () => {
    app: {
        port: number;
        attachmentsDir: string;
        outputDir: string;
        dbPath: string;
        defaultRecipient: string;
        responseDeadlineHours: number;
        checkIntervalMinutes: number;
        autoSendToProcurement: boolean;
        pdfStoragePath: string;
        requireManualReviewForOcr: boolean;
    };
    imap: {
        host: string;
        port: number;
        user: string | undefined;
        password: string | undefined;
        tls: boolean;
        authTimeout: number;
        tlsOptions: {
            rejectUnauthorized: boolean;
        };
    };
    smtp: {
        host: string;
        port: number;
        user: string | undefined;
        password: string | undefined;
        secure: boolean;
        from: string;
        replyTo: string;
    };
    drafts: {
        folder: string;
        sentFolder: string;
    };
    email: {
        signaturePath: string;
        defaultSignaturePath: string;
        sendAcknowledgment: boolean;
        acknowledgmentDelay: number;
    };
    reminder: {
        enabled: boolean;
        maxReminders: number;
        daysBetweenReminders: number;
    };
    lifecycle: {
        scanIntervalMinutes: number;
        monitoredEmails: string[];
    };
    webhook: {
        defaultUrl: string;
        secret: string;
        enabled: boolean;
    };
};
export default _default;
