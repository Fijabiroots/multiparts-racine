import { Controller, Get, Query, Param } from '@nestjs/common';
import { EmailService } from './email.service';
import { EmailFilterDto } from '../common/dto';

@Controller('emails')
export class EmailController {
  constructor(private readonly emailService: EmailService) {}

  @Get('folders')
  async listFolders() {
    const folders = await this.emailService.listFolders();
    return { folders };
  }

  @Get()
  async fetchEmails(@Query() filter: EmailFilterDto) {
    const emails = await this.emailService.fetchEmails(filter);
    return {
      count: emails.length,
      emails: emails.map((e) => ({
        id: e.id,
        from: e.from,
        subject: e.subject,
        date: e.date,
        hasAttachments: e.attachments.length > 0,
        attachments: e.attachments.map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          size: a.size,
        })),
      })),
    };
  }

  @Get('unread-with-pdf')
  async getUnreadWithPdf(@Query('folder') folder?: string) {
    const emails = await this.emailService.getUnreadEmailsWithPdfAttachments(folder);
    return {
      count: emails.length,
      emails: emails.map((e) => ({
        id: e.id,
        from: e.from,
        subject: e.subject,
        date: e.date,
        pdfAttachments: e.attachments
          .filter((a) => a.contentType === 'application/pdf')
          .map((a) => ({ filename: a.filename, size: a.size })),
      })),
    };
  }

  @Get(':id')
  async fetchEmailById(@Param('id') id: string, @Query('folder') folder?: string) {
    const email = await this.emailService.fetchEmailById(id, folder);
    if (!email) {
      return { error: 'Email non trouvé' };
    }
    return {
      id: email.id,
      from: email.from,
      to: email.to,
      subject: email.subject,
      date: email.date,
      body: email.body.substring(0, 500),
      attachments: email.attachments.map((a) => ({
        filename: a.filename,
        contentType: a.contentType,
        size: a.size,
      })),
    };
  }
}
