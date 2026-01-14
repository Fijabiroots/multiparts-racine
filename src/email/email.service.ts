import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as imapSimple from 'imap-simple';
import { simpleParser, ParsedMail } from 'mailparser';
import { ParsedEmail, EmailAttachment } from '../common/interfaces';
import { EmailFilterDto } from '../common/dto';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private configService: ConfigService) {}

  private getImapConfig(): imapSimple.ImapSimpleOptions {
    return {
      imap: {
        host: this.configService.get<string>('imap.host'),
        port: this.configService.get<number>('imap.port'),
        user: this.configService.get<string>('imap.user'),
        password: this.configService.get<string>('imap.password'),
        tls: this.configService.get<boolean>('imap.tls'),
        authTimeout: this.configService.get<number>('imap.authTimeout'),
        tlsOptions: this.configService.get('imap.tlsOptions'),
      },
    };
  }

  async connect(): Promise<imapSimple.ImapSimple> {
    try {
      const connection = await imapSimple.connect(this.getImapConfig());
      this.logger.log('Connexion IMAP établie');
      return connection;
    } catch (error) {
      this.logger.error('Erreur de connexion IMAP:', error.message);
      throw error;
    }
  }

  async listFolders(): Promise<string[]> {
    const connection = await this.connect();
    try {
      const boxes = await connection.getBoxes();
      return this.extractFolderNames(boxes);
    } finally {
      connection.end();
    }
  }

  private extractFolderNames(boxes: any, prefix = ''): string[] {
    const folders: string[] = [];
    for (const [name, box] of Object.entries(boxes as Record<string, any>)) {
      const fullName = prefix ? `${prefix}/${name}` : name;
      folders.push(fullName);
      if (box.children) {
        folders.push(...this.extractFolderNames(box.children, fullName));
      }
    }
    return folders;
  }

  async fetchEmails(filter: EmailFilterDto): Promise<ParsedEmail[]> {
    const connection = await this.connect();
    const folder = filter.folder || 'INBOX';

    try {
      await connection.openBox(folder);

      const searchCriteria: any[] = [];
      if (filter.unseen) {
        searchCriteria.push('UNSEEN');
      } else {
        searchCriteria.push('ALL');
      }
      if (filter.from) {
        searchCriteria.push(['FROM', filter.from]);
      }
      if (filter.subject) {
        searchCriteria.push(['SUBJECT', filter.subject]);
      }
      // Filtres de date IMAP (SINCE = à partir de, BEFORE = avant)
      if (filter.since) {
        searchCriteria.push(['SINCE', filter.since]);
      }
      if (filter.before) {
        searchCriteria.push(['BEFORE', filter.before]);
      }

      const fetchOptions = {
        bodies: ['HEADER', 'TEXT', ''],
        struct: true,
        markSeen: false,
      };

      const messages = await connection.search(searchCriteria, fetchOptions);
      const limit = filter.limit || 10;
      const limitedMessages = messages.slice(-limit);

      const parsedEmails: ParsedEmail[] = [];

      for (const message of limitedMessages) {
        const parsed = await this.parseMessage(message);
        if (parsed) {
          parsedEmails.push(parsed);
        }
      }

      return parsedEmails;
    } finally {
      connection.end();
    }
  }

  async fetchEmailById(emailId: string, folder = 'INBOX'): Promise<ParsedEmail | null> {
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
    } finally {
      connection.end();
    }
  }

  private async parseMessage(message: any): Promise<ParsedEmail | null> {
    try {
      const all = message.parts.find((part: any) => part.which === '');
      if (!all) return null;

      const parsed: ParsedMail = await simpleParser(all.body);

      const attachments: EmailAttachment[] = (parsed.attachments || []).map((att) => ({
        filename: att.filename || 'unknown',
        contentType: att.contentType,
        content: att.content,
        size: att.size,
      }));

      // Extraire les destinataires CC
      const ccAddresses: string[] = [];
      if (parsed.cc) {
        if (Array.isArray(parsed.cc)) {
          parsed.cc.forEach(addr => {
            if (addr.text) ccAddresses.push(addr.text);
          });
        } else if (parsed.cc.text) {
          ccAddresses.push(parsed.cc.text);
        }
      }

      // Extraire les destinataires To comme array
      const toAddresses: string[] = [];
      if (parsed.to) {
        if (Array.isArray(parsed.to)) {
          parsed.to.forEach(addr => {
            if (addr.text) toAddresses.push(addr.text);
          });
        } else if (parsed.to.text) {
          toAddresses.push(parsed.to.text);
        }
      }

      return {
        id: message.attributes.uid.toString(),
        messageId: parsed.messageId || undefined,  // Ex: "<abc123@mail.example.com>"
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
    } catch (error) {
      this.logger.error('Erreur parsing email:', error.message);
      return null;
    }
  }

  async getUnreadEmailsWithPdfAttachments(folder = 'INBOX'): Promise<ParsedEmail[]> {
    const emails = await this.fetchEmails({
      folder,
      unseen: true,
    });

    return emails.filter((email) =>
      email.attachments.some((att) => att.contentType === 'application/pdf'),
    );
  }

  /**
   * Marquer un email comme non lu (retirer le flag SEEN)
   */
  async markAsUnread(emailId: string, folder = 'INBOX'): Promise<boolean> {
    const connection = await this.connect();

    try {
      await connection.openBox(folder);
      await connection.delFlags(emailId, ['\\Seen']);
      this.logger.log(`Email ${emailId} marqué comme non lu`);
      return true;
    } catch (error) {
      this.logger.error(`Erreur markAsUnread: ${error.message}`);
      return false;
    } finally {
      connection.end();
    }
  }
}
