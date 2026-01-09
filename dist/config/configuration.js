"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = () => ({
    app: {
        port: parseInt(process.env.APP_PORT || '3000', 10),
        attachmentsDir: process.env.ATTACHMENTS_DIR || './attachments',
        outputDir: process.env.OUTPUT_DIR || './output',
        dbPath: process.env.DB_PATH || './data/price-request.db',
        defaultRecipient: process.env.DEFAULT_RECIPIENT || 'procurement@multipartsci.com',
        responseDeadlineHours: parseInt(process.env.RESPONSE_DEADLINE_HOURS || '24', 10),
        checkIntervalMinutes: parseInt(process.env.CHECK_INTERVAL_MINUTES || '5', 10),
        autoSendToProcurement: process.env.AUTO_SEND_TO_PROCUREMENT !== 'false',
        pdfStoragePath: process.env.PDF_STORAGE_PATH || './storage/pdfs',
        requireManualReviewForOcr: process.env.REQUIRE_MANUAL_REVIEW_FOR_OCR !== 'false',
    },
    imap: {
        host: process.env.IMAP_HOST || 'localhost',
        port: parseInt(process.env.IMAP_PORT || '993', 10),
        user: process.env.IMAP_USER,
        password: process.env.IMAP_PASSWORD,
        tls: process.env.IMAP_TLS === 'true',
        authTimeout: 10000,
        tlsOptions: {
            rejectUnauthorized: false,
        },
    },
    smtp: {
        host: process.env.SMTP_HOST || 'localhost',
        port: parseInt(process.env.SMTP_PORT || '465', 10),
        user: process.env.SMTP_USER,
        password: process.env.SMTP_PASSWORD,
        secure: process.env.SMTP_SECURE === 'true',
        from: process.env.SMTP_FROM || 'procurement@multipartsci.com',
        replyTo: process.env.SMTP_REPLY_TO || 'procurement@multipartsci.com',
    },
    drafts: {
        folder: process.env.DRAFTS_FOLDER || 'INBOX.Drafts',
        sentFolder: process.env.SENT_FOLDER || 'INBOX.Sent',
    },
    email: {
        signaturePath: process.env.THUNDERBIRD_SIGNATURE_PATH || '',
        defaultSignaturePath: process.env.DEFAULT_SIGNATURE_PATH || './signature.html',
        sendAcknowledgment: process.env.SEND_ACKNOWLEDGMENT !== 'false',
        acknowledgmentDelay: parseInt(process.env.ACKNOWLEDGMENT_DELAY_SECONDS || '5', 10),
    },
    reminder: {
        enabled: process.env.REMINDER_ENABLED !== 'false',
        maxReminders: parseInt(process.env.REMINDER_MAX_COUNT || '3', 10),
        daysBetweenReminders: parseInt(process.env.REMINDER_DAYS_BETWEEN || '2', 10),
    },
    lifecycle: {
        scanIntervalMinutes: parseInt(process.env.LIFECYCLE_SCAN_INTERVAL || '10', 10),
        monitoredEmails: (process.env.MONITORED_EMAILS || 'procurement@multipartsci.com,rafiou.oyeossi@multipartsci.com').split(','),
    },
    webhook: {
        defaultUrl: process.env.WEBHOOK_URL || '',
        secret: process.env.WEBHOOK_SECRET || '',
        enabled: process.env.WEBHOOK_ENABLED !== 'false',
    },
});
//# sourceMappingURL=configuration.js.map