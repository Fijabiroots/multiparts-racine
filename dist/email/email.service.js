"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var EmailService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const imapSimple = require("imap-simple");
const mailparser_1 = require("mailparser");
let EmailService = EmailService_1 = class EmailService {
    constructor(configService) {
        this.configService = configService;
        this.logger = new common_1.Logger(EmailService_1.name);
    }
    getImapConfig() {
        return {
            imap: {
                host: this.configService.get('imap.host'),
                port: this.configService.get('imap.port'),
                user: this.configService.get('imap.user'),
                password: this.configService.get('imap.password'),
                tls: this.configService.get('imap.tls'),
                authTimeout: this.configService.get('imap.authTimeout'),
                tlsOptions: this.configService.get('imap.tlsOptions'),
            },
        };
    }
    async connect() {
        try {
            const connection = await imapSimple.connect(this.getImapConfig());
            this.logger.log('Connexion IMAP établie');
            return connection;
        }
        catch (error) {
            this.logger.error('Erreur de connexion IMAP:', error.message);
            throw error;
        }
    }
    async listFolders() {
        const connection = await this.connect();
        try {
            const boxes = await connection.getBoxes();
            return this.extractFolderNames(boxes);
        }
        finally {
            connection.end();
        }
    }
    extractFolderNames(boxes, prefix = '') {
        const folders = [];
        for (const [name, box] of Object.entries(boxes)) {
            const fullName = prefix ? `${prefix}/${name}` : name;
            folders.push(fullName);
            if (box.children) {
                folders.push(...this.extractFolderNames(box.children, fullName));
            }
        }
        return folders;
    }
    async fetchEmails(filter) {
        const connection = await this.connect();
        const folder = filter.folder || 'INBOX';
        try {
            await connection.openBox(folder);
            const searchCriteria = [];
            if (filter.unseen) {
                searchCriteria.push('UNSEEN');
            }
            else {
                searchCriteria.push('ALL');
            }
            if (filter.from) {
                searchCriteria.push(['FROM', filter.from]);
            }
            if (filter.subject) {
                searchCriteria.push(['SUBJECT', filter.subject]);
            }
            const fetchOptions = {
                bodies: ['HEADER', 'TEXT', ''],
                struct: true,
                markSeen: false,
            };
            const messages = await connection.search(searchCriteria, fetchOptions);
            const limit = filter.limit || 10;
            const limitedMessages = messages.slice(-limit);
            const parsedEmails = [];
            for (const message of limitedMessages) {
                const parsed = await this.parseMessage(message);
                if (parsed) {
                    parsedEmails.push(parsed);
                }
            }
            return parsedEmails;
        }
        finally {
            connection.end();
        }
    }
    async fetchEmailById(emailId, folder = 'INBOX') {
        const connection = await this.connect();
        try {
            await connection.openBox(folder);
            const fetchOptions = {
                bodies: ['HEADER', 'TEXT', ''],
                struct: true,
                markSeen: false,
            };
            const messages = await connection.search([['UID', emailId]], fetchOptions);
            if (messages.length === 0) {
                return null;
            }
            return this.parseMessage(messages[0]);
        }
        finally {
            connection.end();
        }
    }
    async parseMessage(message) {
        try {
            const all = message.parts.find((part) => part.which === '');
            if (!all)
                return null;
            const parsed = await (0, mailparser_1.simpleParser)(all.body);
            const attachments = (parsed.attachments || []).map((att) => ({
                filename: att.filename || 'unknown',
                contentType: att.contentType,
                content: att.content,
                size: att.size,
            }));
            const ccAddresses = [];
            if (parsed.cc) {
                if (Array.isArray(parsed.cc)) {
                    parsed.cc.forEach(addr => {
                        if (addr.text)
                            ccAddresses.push(addr.text);
                    });
                }
                else if (parsed.cc.text) {
                    ccAddresses.push(parsed.cc.text);
                }
            }
            const toAddresses = [];
            if (parsed.to) {
                if (Array.isArray(parsed.to)) {
                    parsed.to.forEach(addr => {
                        if (addr.text)
                            toAddresses.push(addr.text);
                    });
                }
                else if (parsed.to.text) {
                    toAddresses.push(parsed.to.text);
                }
            }
            return {
                id: message.attributes.uid.toString(),
                messageId: parsed.messageId || undefined,
                from: parsed.from?.text || '',
                to: toAddresses.length > 0 ? toAddresses : (parsed.to?.text || ''),
                cc: ccAddresses.length > 0 ? ccAddresses : undefined,
                replyTo: parsed.replyTo?.text || undefined,
                references: parsed.references ?
                    (Array.isArray(parsed.references) ? parsed.references.join(' ') : parsed.references)
                    : undefined,
                subject: parsed.subject || '',
                date: parsed.date || new Date(),
                body: parsed.text || parsed.html || '',
                attachments,
            };
        }
        catch (error) {
            this.logger.error('Erreur parsing email:', error.message);
            return null;
        }
    }
    async getUnreadEmailsWithPdfAttachments(folder = 'INBOX') {
        const emails = await this.fetchEmails({
            folder,
            unseen: true,
        });
        return emails.filter((email) => email.attachments.some((att) => att.contentType === 'application/pdf'));
    }
};
exports.EmailService = EmailService;
exports.EmailService = EmailService = EmailService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], EmailService);
//# sourceMappingURL=email.service.js.map