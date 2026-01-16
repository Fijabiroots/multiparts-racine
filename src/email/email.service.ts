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
    const timeout = filter.timeout || 60000; // Default 60s timeout

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
      // IMAP requires dates in format DD-Mon-YYYY (e.g., 01-Jan-2024)
      if (filter.since) {
        const sinceDate = filter.since instanceof Date ? filter.since : new Date(filter.since);
        searchCriteria.push(['SINCE', this.formatImapDate(sinceDate)]);
      }
      if (filter.before) {
        const beforeDate = filter.before instanceof Date ? filter.before : new Date(filter.before);
        searchCriteria.push(['BEFORE', this.formatImapDate(beforeDate)]);
      }

      // Step 1: Search for UIDs only (lightweight operation)
      const uidFetchOptions = {
        bodies: [],
        struct: false,
        markSeen: false,
      };

      const allMessages = await this.withTimeout<any[]>(
        connection.search(searchCriteria, uidFetchOptions),
        timeout,
        'IMAP search timeout',
      );

      this.logger.log(`Found ${allMessages.length} messages in ${folder}`);

      if (allMessages.length === 0) {
        return [];
      }

      // Step 2: Apply limit BEFORE fetching full bodies (memory optimization)
      // If no limit specified (0 or undefined), fetch ALL messages
      const limit = filter.limit;
      const messagesToFetch = (limit && limit > 0)
        ? allMessages.slice(-limit)
        : allMessages;

      const limitedUids = messagesToFetch.map((m: any) => m.attributes.uid);

      this.logger.log(`Fetching ${limitedUids.length} emails from ${folder}...`);

      // Step 3: Fetch full bodies only for selected UIDs
      const fetchOptions = {
        bodies: ['HEADER', 'TEXT', ''],
        struct: true,
        markSeen: false,
      };

      const messages = await this.withTimeout<any[]>(
        connection.search([['UID', limitedUids.join(',')]], fetchOptions),
        timeout,
        'IMAP fetch timeout',
      );

      const parsedEmails: ParsedEmail[] = [];

      for (const message of messages) {
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

  /**
   * Wrap a promise with a timeout
   */
  private async withTimeout<T>(promise: Promise<T>, ms: number, errorMsg: string): Promise<T> {
    let timeoutId: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(errorMsg)), ms);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      clearTimeout(timeoutId!);
      return result;
    } catch (error) {
      clearTimeout(timeoutId!);
      throw error;
    }
  }

  /**
   * Format a Date object to IMAP date format (DD-Mon-YYYY)
   */
  private formatImapDate(date: Date): string {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = date.getDate();
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
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
