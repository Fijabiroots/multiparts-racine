# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a NestJS application that automates price request (RFQ) processing from emails. It reads emails via IMAP, extracts data from PDF/Excel/Word attachments, generates standardized Excel files, and saves drafts to Thunderbird via IMAP.

## Build & Run Commands

```bash
# Install dependencies
npm install

# Development (with hot reload)
npm run start:dev

# Build for production
npm run build

# Production
npm run start:prod

# PM2 deployment
npm run pm2:start
npm run pm2:stop
npm run pm2:logs

# Docker
npm run docker:up
npm run docker:down
```

## Architecture

### Core Processing Flow

1. **SchedulerService** (`src/scheduler/`) - Polls IMAP on interval, triggers processing
2. **AutoProcessorService** - Coordinates the email-to-draft pipeline
3. **DetectorService** (`src/detector/`) - Scores emails to identify price requests using weighted keywords
4. **PriceRequestService** (`src/price-request/`) - Main orchestrator that:
   - Fetches email via EmailService
   - Extracts items via PdfService (PDF) or DocumentParserService (Excel/Word)
   - Generates Excel via ExcelService
   - Saves draft via DraftService
   - Sends acknowledgment via AcknowledgmentService
   - Tracks via TrackingService and webhooks

### Module Responsibilities

| Module | Purpose |
|--------|---------|
| `database/` | SQLite (sql.js) for clients, RFQ mappings, keywords, config |
| `email/` | IMAP connection, email fetching via imap-simple |
| `pdf/` | PDF text extraction with pdf-parse, item parsing with regex patterns |
| `parser/` | DocumentParserService for Excel/Word via xlsx/mammoth |
| `excel/` | Generates output Excel files with exceljs |
| `draft/` | Saves emails to IMAP Drafts folder |
| `mail/` | SMTP sending via nodemailer |
| `acknowledgment/` | Sends auto-reply to client confirming receipt |
| `tracking/` | Maintains suivi-rfq.xlsx tracking spreadsheet |
| `review/` | Manual review UI served from `public/` |
| `brand-intelligence/` | Brand/supplier enrichment from `output/brand-intelligence.json` |
| `rfq-lifecycle/` | Quote comparison, reminders, inbound scanning |
| `webhook/` | Event emission for external integrations |

### Key Data Types (src/common/interfaces/)

- `ParsedEmail` - Email with attachments, threading headers
- `ExtractedPdfData` - Parsed PDF with items, rfqNumber, extraction metadata
- `PriceRequestItem` - Line item with reference, brand, quantity, flags for manual review
- `PriceRequest` - Full request with client info, items, deadline
- `DraftRecord` - Database record with status workflow

### Database (SQLite via sql.js)

Stored at `data/price-request.db`. Key tables:
- `clients` - Client/supplier info
- `rfq_mappings` - Maps client RFQ numbers to internal DDP-YYYYMMDD-XXX numbers
- `detection_keywords` - Weighted keywords for price request detection
- `processing_config` - Scheduler configuration
- `drafts` - Draft records with status tracking
- `output_logs` - Processing history

### Configuration

Environment variables in `.env` (see `.env.example`):
- IMAP/SMTP credentials for email access
- `DRAFTS_FOLDER` - IMAP folder for drafts
- `DB_PATH` - SQLite database path
- `OUTPUT_DIR` - Generated Excel files location

### API

All endpoints prefixed with `/api`. Key endpoints:
- `GET /scheduler/status` - Scheduler state
- `POST /scheduler/configure` - Start with config
- `POST /scheduler/run-once` - Manual processing trigger
- `GET /database/rfq-mappings` - RFQ correspondence lookup
- `POST /detector/analyze` - Test email detection
- `GET /review/:id` - Manual review interface

### Static Files

`public/` contains the manual review web interface served at root `/`.

## Code Patterns

- NestJS modules follow standard controller/service/module pattern
- Global `ValidationPipe` with whitelist/transform enabled
- Path alias `@/*` maps to `src/*`
- Logging via NestJS Logger per service
- All dates use French locale for display
