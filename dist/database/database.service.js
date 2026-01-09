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
var DatabaseService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");
const uuid_1 = require("uuid");
let DatabaseService = DatabaseService_1 = class DatabaseService {
    constructor(configService) {
        this.configService = configService;
        this.logger = new common_1.Logger(DatabaseService_1.name);
        this.dbPath = this.configService.get('app.dbPath') || './data/price-request.db';
    }
    async onModuleInit() {
        await this.initDatabase();
        this.saveInterval = setInterval(() => this.saveToFile(), 5 * 60 * 1000);
    }
    onModuleDestroy() {
        if (this.saveInterval) {
            clearInterval(this.saveInterval);
        }
        this.saveToFile();
        if (this.db) {
            this.db.close();
        }
    }
    async initDatabase() {
        const SQL = await initSqlJs();
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        if (fs.existsSync(this.dbPath)) {
            const buffer = fs.readFileSync(this.dbPath);
            this.db = new SQL.Database(buffer);
            this.logger.log('Base de données chargée depuis fichier');
        }
        else {
            this.db = new SQL.Database();
            this.createTables();
            this.seedDefaultData();
            this.logger.log('Nouvelle base de données créée');
        }
    }
    createTables() {
        this.db.run(`
      CREATE TABLE IF NOT EXISTS clients (
        id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        alternate_emails TEXT,
        phone TEXT,
        address TEXT,
        contact_person TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
        this.db.run(`
      CREATE TABLE IF NOT EXISTS rfq_mappings (
        id TEXT PRIMARY KEY,
        client_id TEXT,
        client_rfq_number TEXT,
        internal_rfq_number TEXT NOT NULL,
        email_id TEXT,
        email_subject TEXT,
        received_at TEXT,
        processed_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        excel_path TEXT,
        notes TEXT,
        FOREIGN KEY (client_id) REFERENCES clients(id)
      )
    `);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_rfq_client ON rfq_mappings(client_id)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_rfq_client_number ON rfq_mappings(client_rfq_number)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_rfq_internal ON rfq_mappings(internal_rfq_number)`);
        this.db.run(`
      CREATE TABLE IF NOT EXISTS processing_config (
        id TEXT PRIMARY KEY,
        start_date TEXT,
        end_date TEXT,
        folders TEXT NOT NULL,
        auto_send_draft INTEGER NOT NULL DEFAULT 0,
        check_interval_minutes INTEGER NOT NULL DEFAULT 5,
        response_deadline_hours INTEGER NOT NULL DEFAULT 24,
        default_recipient TEXT DEFAULT 'procurement@multipartsci.com',
        last_processed_at TEXT,
        is_active INTEGER NOT NULL DEFAULT 1
      )
    `);
        this.db.run(`
      CREATE TABLE IF NOT EXISTS detection_keywords (
        id TEXT PRIMARY KEY,
        keyword TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 1.0,
        language TEXT NOT NULL DEFAULT 'both',
        type TEXT NOT NULL DEFAULT 'both'
      )
    `);
        this.db.run(`
      CREATE TABLE IF NOT EXISTS processing_logs (
        id TEXT PRIMARY KEY,
        rfq_mapping_id TEXT,
        email_id TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        message TEXT,
        timestamp TEXT NOT NULL
      )
    `);
        this.db.run(`
      CREATE TABLE IF NOT EXISTS pending_drafts (
        id TEXT PRIMARY KEY,
        rfq_mapping_id TEXT,
        internal_rfq_number TEXT NOT NULL,
        client_rfq_number TEXT,
        client_name TEXT,
        client_email TEXT,
        recipient TEXT NOT NULL,
        subject TEXT NOT NULL,
        excel_path TEXT NOT NULL,
        attachment_paths TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        updated_at TEXT,
        scheduled_send_at TEXT,
        sent_at TEXT,
        error_message TEXT,
        retry_count INTEGER DEFAULT 0,
        -- Nouveaux champs pour révision manuelle et stockage PDF
        original_pdf_path TEXT,
        original_pdf_filename TEXT,
        needs_manual_review INTEGER DEFAULT 0,
        extraction_method TEXT,
        review_notes TEXT,
        reviewed_at TEXT,
        reviewed_by TEXT,
        items_json TEXT
      )
    `);
        const addColumnIfNotExists = (column, type, defaultVal) => {
            try {
                const def = defaultVal ? ` DEFAULT ${defaultVal}` : '';
                this.db.run(`ALTER TABLE pending_drafts ADD COLUMN ${column} ${type}${def}`);
            }
            catch (e) {
            }
        };
        addColumnIfNotExists('updated_at', 'TEXT');
        addColumnIfNotExists('original_pdf_path', 'TEXT');
        addColumnIfNotExists('original_pdf_filename', 'TEXT');
        addColumnIfNotExists('needs_manual_review', 'INTEGER', '0');
        addColumnIfNotExists('extraction_method', 'TEXT');
        addColumnIfNotExists('review_notes', 'TEXT');
        addColumnIfNotExists('reviewed_at', 'TEXT');
        addColumnIfNotExists('reviewed_by', 'TEXT');
        addColumnIfNotExists('items_json', 'TEXT');
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_drafts_status ON pending_drafts(status)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_drafts_scheduled ON pending_drafts(scheduled_send_at)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_drafts_review ON pending_drafts(needs_manual_review)`);
        this.db.run(`
      CREATE TABLE IF NOT EXISTS output_logs (
        id TEXT PRIMARY KEY,
        draft_id TEXT,
        rfq_mapping_id TEXT,
        internal_rfq_number TEXT NOT NULL,
        client_rfq_number TEXT,
        client_name TEXT,
        recipient TEXT NOT NULL,
        subject TEXT NOT NULL,
        excel_path TEXT,
        attachment_count INTEGER DEFAULT 1,
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        error_message TEXT,
        sent_at TEXT NOT NULL,
        FOREIGN KEY (draft_id) REFERENCES pending_drafts(id),
        FOREIGN KEY (rfq_mapping_id) REFERENCES rfq_mappings(id)
      )
    `);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_output_status ON output_logs(status)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_output_date ON output_logs(sent_at)`);
        this.db.run(`
      CREATE TABLE IF NOT EXISTS known_suppliers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        email_domain TEXT,
        created_at TEXT NOT NULL
      )
    `);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_supplier_email ON known_suppliers(email)`);
        this.db.run(`CREATE INDEX IF NOT EXISTS idx_supplier_domain ON known_suppliers(email_domain)`);
        this.logger.log('Tables créées');
    }
    seedDefaultData() {
        const configId = (0, uuid_1.v4)();
        this.db.run(`
      INSERT INTO processing_config (id, folders, auto_send_draft, check_interval_minutes, is_active)
      VALUES (?, ?, ?, ?, ?)
    `, [configId, JSON.stringify(['INBOX']), 1, 5, 1]);
        const keywords = [
            { keyword: 'demande de prix', weight: 10, language: 'fr', type: 'both' },
            { keyword: 'demande de cotation', weight: 10, language: 'fr', type: 'both' },
            { keyword: 'appel d\'offres', weight: 9, language: 'fr', type: 'both' },
            { keyword: 'devis', weight: 8, language: 'fr', type: 'both' },
            { keyword: 'cotation', weight: 8, language: 'fr', type: 'both' },
            { keyword: 'prix unitaire', weight: 7, language: 'fr', type: 'body' },
            { keyword: 'offre de prix', weight: 9, language: 'fr', type: 'both' },
            { keyword: 'consultation', weight: 6, language: 'fr', type: 'subject' },
            { keyword: 'RFQ', weight: 10, language: 'both', type: 'both' },
            { keyword: 'RFP', weight: 9, language: 'both', type: 'both' },
            { keyword: 'request for quotation', weight: 10, language: 'en', type: 'both' },
            { keyword: 'request for quote', weight: 10, language: 'en', type: 'both' },
            { keyword: 'price request', weight: 9, language: 'en', type: 'both' },
            { keyword: 'quotation request', weight: 9, language: 'en', type: 'both' },
            { keyword: 'quote request', weight: 8, language: 'en', type: 'both' },
            { keyword: 'pricing', weight: 6, language: 'en', type: 'subject' },
            { keyword: 'unit price', weight: 7, language: 'en', type: 'body' },
        ];
        for (const kw of keywords) {
            this.db.run(`
        INSERT INTO detection_keywords (id, keyword, weight, language, type)
        VALUES (?, ?, ?, ?, ?)
      `, [(0, uuid_1.v4)(), kw.keyword, kw.weight, kw.language, kw.type]);
        }
        this.logger.log('Données par défaut insérées');
    }
    saveToFile() {
        try {
            const data = this.db.export();
            const buffer = Buffer.from(data);
            fs.writeFileSync(this.dbPath, buffer);
            this.logger.debug('Base de données sauvegardée');
        }
        catch (error) {
            this.logger.error('Erreur sauvegarde DB:', error.message);
        }
    }
    async createClient(client) {
        const id = (0, uuid_1.v4)();
        const now = new Date().toISOString();
        this.db.run(`
      INSERT INTO clients (id, code, name, email, alternate_emails, phone, address, contact_person, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
            id,
            client.code,
            client.name,
            client.email,
            JSON.stringify(client.alternateEmails || []),
            client.phone || null,
            client.address || null,
            client.contactPerson || null,
            now,
            now,
        ]);
        this.saveToFile();
        return this.getClientById(id);
    }
    async getClientById(id) {
        const result = this.db.exec(`SELECT * FROM clients WHERE id = ?`, [id]);
        if (result.length === 0 || result[0].values.length === 0)
            return null;
        return this.mapRowToClient(result[0].columns, result[0].values[0]);
    }
    async getClientByEmail(email) {
        const result = this.db.exec(`
      SELECT * FROM clients 
      WHERE email = ? OR alternate_emails LIKE ?
    `, [email, `%${email}%`]);
        if (result.length === 0 || result[0].values.length === 0)
            return null;
        return this.mapRowToClient(result[0].columns, result[0].values[0]);
    }
    async getClientByCode(code) {
        const result = this.db.exec(`SELECT * FROM clients WHERE code = ?`, [code]);
        if (result.length === 0 || result[0].values.length === 0)
            return null;
        return this.mapRowToClient(result[0].columns, result[0].values[0]);
    }
    async getAllClients() {
        const result = this.db.exec(`SELECT * FROM clients ORDER BY name`);
        if (result.length === 0)
            return [];
        return result[0].values.map((row) => this.mapRowToClient(result[0].columns, row));
    }
    async updateClient(id, updates) {
        const fields = [];
        const values = [];
        if (updates.name) {
            fields.push('name = ?');
            values.push(updates.name);
        }
        if (updates.email) {
            fields.push('email = ?');
            values.push(updates.email);
        }
        if (updates.alternateEmails) {
            fields.push('alternate_emails = ?');
            values.push(JSON.stringify(updates.alternateEmails));
        }
        if (updates.phone !== undefined) {
            fields.push('phone = ?');
            values.push(updates.phone);
        }
        if (updates.address !== undefined) {
            fields.push('address = ?');
            values.push(updates.address);
        }
        if (updates.contactPerson !== undefined) {
            fields.push('contact_person = ?');
            values.push(updates.contactPerson);
        }
        fields.push('updated_at = ?');
        values.push(new Date().toISOString());
        values.push(id);
        this.db.run(`UPDATE clients SET ${fields.join(', ')} WHERE id = ?`, values);
        this.saveToFile();
        return this.getClientById(id);
    }
    mapRowToClient(columns, row) {
        const obj = {};
        columns.forEach((col, i) => obj[col] = row[i]);
        return {
            id: obj.id,
            code: obj.code,
            name: obj.name,
            email: obj.email,
            alternateEmails: obj.alternate_emails ? JSON.parse(obj.alternate_emails) : [],
            phone: obj.phone,
            address: obj.address,
            contactPerson: obj.contact_person,
            createdAt: new Date(obj.created_at),
            updatedAt: new Date(obj.updated_at),
        };
    }
    async createRfqMapping(mapping) {
        const id = (0, uuid_1.v4)();
        const now = new Date().toISOString();
        this.db.run(`
      INSERT INTO rfq_mappings (id, client_id, client_rfq_number, internal_rfq_number, email_id, email_subject, received_at, processed_at, status, excel_path, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
            id,
            mapping.clientId || null,
            mapping.clientRfqNumber || null,
            mapping.internalRfqNumber,
            mapping.emailId || null,
            mapping.emailSubject || null,
            mapping.receivedAt?.toISOString() || null,
            now,
            mapping.status || 'pending',
            mapping.excelPath || null,
            mapping.notes || null,
        ]);
        this.saveToFile();
        return this.getRfqMappingById(id);
    }
    async getRfqMappingById(id) {
        const result = this.db.exec(`SELECT * FROM rfq_mappings WHERE id = ?`, [id]);
        if (result.length === 0 || result[0].values.length === 0)
            return null;
        return this.mapRowToRfqMapping(result[0].columns, result[0].values[0]);
    }
    async getRfqMappingByClientRfq(clientRfqNumber) {
        const result = this.db.exec(`SELECT * FROM rfq_mappings WHERE client_rfq_number = ?`, [clientRfqNumber]);
        if (result.length === 0 || result[0].values.length === 0)
            return null;
        return this.mapRowToRfqMapping(result[0].columns, result[0].values[0]);
    }
    async getRfqMappingByInternalRfq(internalRfqNumber) {
        const result = this.db.exec(`SELECT * FROM rfq_mappings WHERE internal_rfq_number = ?`, [internalRfqNumber]);
        if (result.length === 0 || result[0].values.length === 0)
            return null;
        return this.mapRowToRfqMapping(result[0].columns, result[0].values[0]);
    }
    async getClientRfqMappings(clientId) {
        const result = this.db.exec(`SELECT * FROM rfq_mappings WHERE client_id = ? ORDER BY processed_at DESC`, [clientId]);
        if (result.length === 0)
            return [];
        return result[0].values.map((row) => this.mapRowToRfqMapping(result[0].columns, row));
    }
    async updateRfqMappingStatus(id, status, notes) {
        const updates = notes
            ? `status = ?, notes = ?`
            : `status = ?`;
        const values = notes ? [status, notes, id] : [status, id];
        this.db.run(`UPDATE rfq_mappings SET ${updates} WHERE id = ?`, values);
        this.saveToFile();
    }
    async getAllRfqMappings(limit = 100) {
        const result = this.db.exec(`SELECT * FROM rfq_mappings ORDER BY processed_at DESC LIMIT ?`, [limit]);
        if (result.length === 0)
            return [];
        return result[0].values.map((row) => this.mapRowToRfqMapping(result[0].columns, row));
    }
    mapRowToRfqMapping(columns, row) {
        const obj = {};
        columns.forEach((col, i) => obj[col] = row[i]);
        return {
            id: obj.id,
            clientId: obj.client_id,
            clientRfqNumber: obj.client_rfq_number,
            internalRfqNumber: obj.internal_rfq_number,
            emailId: obj.email_id,
            emailSubject: obj.email_subject,
            receivedAt: obj.received_at ? new Date(obj.received_at) : undefined,
            processedAt: new Date(obj.processed_at),
            status: obj.status,
            excelPath: obj.excel_path,
            notes: obj.notes,
        };
    }
    async getProcessingConfig() {
        const result = this.db.exec(`SELECT * FROM processing_config LIMIT 1`);
        if (result.length === 0 || result[0].values.length === 0)
            return null;
        return this.mapRowToConfig(result[0].columns, result[0].values[0]);
    }
    async updateProcessingConfig(updates) {
        const fields = [];
        const values = [];
        if (updates.startDate !== undefined) {
            fields.push('start_date = ?');
            values.push(updates.startDate?.toISOString() || null);
        }
        if (updates.endDate !== undefined) {
            fields.push('end_date = ?');
            values.push(updates.endDate?.toISOString() || null);
        }
        if (updates.folders) {
            fields.push('folders = ?');
            values.push(JSON.stringify(updates.folders));
        }
        if (updates.autoSendDraft !== undefined) {
            fields.push('auto_send_draft = ?');
            values.push(updates.autoSendDraft ? 1 : 0);
        }
        if (updates.checkIntervalMinutes !== undefined) {
            fields.push('check_interval_minutes = ?');
            values.push(updates.checkIntervalMinutes);
        }
        if (updates.lastProcessedAt !== undefined) {
            fields.push('last_processed_at = ?');
            values.push(updates.lastProcessedAt?.toISOString() || null);
        }
        if (updates.isActive !== undefined) {
            fields.push('is_active = ?');
            values.push(updates.isActive ? 1 : 0);
        }
        if (fields.length > 0) {
            this.db.run(`UPDATE processing_config SET ${fields.join(', ')}`, values);
            this.saveToFile();
        }
    }
    mapRowToConfig(columns, row) {
        const obj = {};
        columns.forEach((col, i) => obj[col] = row[i]);
        return {
            id: obj.id,
            startDate: obj.start_date ? new Date(obj.start_date) : undefined,
            endDate: obj.end_date ? new Date(obj.end_date) : undefined,
            folders: JSON.parse(obj.folders || '["INBOX"]'),
            autoSendDraft: obj.auto_send_draft === 1,
            checkIntervalMinutes: obj.check_interval_minutes,
            lastProcessedAt: obj.last_processed_at ? new Date(obj.last_processed_at) : undefined,
            isActive: obj.is_active === 1,
        };
    }
    async getDetectionKeywords() {
        const result = this.db.exec(`SELECT * FROM detection_keywords ORDER BY weight DESC`);
        if (result.length === 0)
            return [];
        return result[0].values.map((row) => {
            const obj = {};
            result[0].columns.forEach((col, i) => obj[col] = row[i]);
            return {
                id: obj.id,
                keyword: obj.keyword,
                weight: obj.weight,
                language: obj.language,
                type: obj.type,
            };
        });
    }
    async addDetectionKeyword(keyword) {
        this.db.run(`
      INSERT INTO detection_keywords (id, keyword, weight, language, type)
      VALUES (?, ?, ?, ?, ?)
    `, [(0, uuid_1.v4)(), keyword.keyword, keyword.weight, keyword.language, keyword.type]);
        this.saveToFile();
    }
    async addProcessingLog(log) {
        this.db.run(`
      INSERT INTO processing_logs (id, rfq_mapping_id, email_id, action, status, message, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [(0, uuid_1.v4)(), log.rfqMappingId || null, log.emailId, log.action, log.status, log.message, new Date().toISOString()]);
    }
    async getProcessingLogs(limit = 100) {
        const result = this.db.exec(`SELECT * FROM processing_logs ORDER BY timestamp DESC LIMIT ?`, [limit]);
        if (result.length === 0)
            return [];
        return result[0].values.map((row) => {
            const obj = {};
            result[0].columns.forEach((col, i) => obj[col] = row[i]);
            return {
                id: obj.id,
                rfqMappingId: obj.rfq_mapping_id,
                emailId: obj.email_id,
                action: obj.action,
                status: obj.status,
                message: obj.message,
                timestamp: new Date(obj.timestamp),
            };
        });
    }
    async isEmailProcessed(emailId) {
        const result = this.db.exec(`SELECT COUNT(*) as count FROM rfq_mappings WHERE email_id = ?`, [emailId]);
        if (result.length === 0)
            return false;
        return result[0].values[0][0] > 0;
    }
    async createPendingDraft(draft) {
        const id = (0, uuid_1.v4)();
        const now = new Date();
        const scheduledSendAt = new Date(now.getTime() + 5 * 60 * 1000);
        this.db.run(`
      INSERT INTO pending_drafts (id, rfq_mapping_id, internal_rfq_number, client_rfq_number, client_name, client_email, recipient, subject, excel_path, attachment_paths, status, created_at, scheduled_send_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
            id,
            draft.rfqMappingId || null,
            draft.internalRfqNumber,
            draft.clientRfqNumber || null,
            draft.clientName || null,
            draft.clientEmail || null,
            draft.recipient,
            draft.subject,
            draft.excelPath,
            draft.attachmentPaths ? JSON.stringify(draft.attachmentPaths) : null,
            'pending',
            now.toISOString(),
            scheduledSendAt.toISOString(),
        ]);
        this.saveToFile();
        this.logger.log(`Brouillon créé: ${id}, envoi planifié pour ${scheduledSendAt.toISOString()}`);
        return id;
    }
    async getPendingDraftsToSend() {
        const now = new Date().toISOString();
        const result = this.db.exec(`
      SELECT * FROM pending_drafts 
      WHERE status = 'pending' 
      AND scheduled_send_at <= ?
      ORDER BY scheduled_send_at ASC
    `, [now]);
        if (result.length === 0)
            return [];
        return result[0].values.map((row) => {
            const obj = {};
            result[0].columns.forEach((col, i) => obj[col] = row[i]);
            return {
                id: obj.id,
                rfqMappingId: obj.rfq_mapping_id,
                internalRfqNumber: obj.internal_rfq_number,
                clientRfqNumber: obj.client_rfq_number,
                clientName: obj.client_name,
                clientEmail: obj.client_email,
                recipient: obj.recipient,
                subject: obj.subject,
                excelPath: obj.excel_path,
                attachmentPaths: obj.attachment_paths ? JSON.parse(obj.attachment_paths) : [],
                status: obj.status,
                createdAt: new Date(obj.created_at),
                scheduledSendAt: new Date(obj.scheduled_send_at),
                retryCount: obj.retry_count,
            };
        });
    }
    async updateDraftStatus(id, status, errorMessage) {
        const sentAt = status === 'sent' ? new Date().toISOString() : null;
        this.db.run(`
      UPDATE pending_drafts 
      SET status = ?, sent_at = ?, error_message = ?, retry_count = retry_count + 1
      WHERE id = ?
    `, [status, sentAt, errorMessage || null, id]);
        this.saveToFile();
    }
    async getDraftById(id) {
        const result = this.db.exec(`SELECT * FROM pending_drafts WHERE id = ?`, [id]);
        if (result.length === 0 || result[0].values.length === 0)
            return null;
        const obj = {};
        result[0].columns.forEach((col, i) => obj[col] = result[0].values[0][i]);
        return {
            id: obj.id,
            rfqMappingId: obj.rfq_mapping_id,
            internalRfqNumber: obj.internal_rfq_number,
            clientRfqNumber: obj.client_rfq_number,
            clientName: obj.client_name,
            clientEmail: obj.client_email,
            recipient: obj.recipient,
            subject: obj.subject,
            excelPath: obj.excel_path,
            attachmentPaths: obj.attachment_paths ? JSON.parse(obj.attachment_paths) : [],
            status: obj.status,
            createdAt: new Date(obj.created_at),
            updatedAt: obj.updated_at ? new Date(obj.updated_at) : null,
            scheduledSendAt: obj.scheduled_send_at ? new Date(obj.scheduled_send_at) : null,
            sentAt: obj.sent_at ? new Date(obj.sent_at) : null,
            errorMessage: obj.error_message,
            retryCount: obj.retry_count,
            originalPdfPath: obj.original_pdf_path,
            originalPdfFilename: obj.original_pdf_filename,
            needsManualReview: obj.needs_manual_review === 1,
            extractionMethod: obj.extraction_method,
            reviewNotes: obj.review_notes,
            reviewedAt: obj.reviewed_at ? new Date(obj.reviewed_at) : null,
            reviewedBy: obj.reviewed_by,
            itemsJson: obj.items_json,
        };
    }
    async updateDraft(id, updates) {
        const setClauses = ['updated_at = ?'];
        const params = [new Date().toISOString()];
        if (updates.status !== undefined) {
            setClauses.push('status = ?');
            params.push(updates.status);
        }
        if (updates.itemsJson !== undefined) {
            setClauses.push('items_json = ?');
            params.push(updates.itemsJson);
        }
        if (updates.reviewNotes !== undefined) {
            setClauses.push('review_notes = ?');
            params.push(updates.reviewNotes);
        }
        if (updates.needsManualReview !== undefined) {
            setClauses.push('needs_manual_review = ?');
            params.push(updates.needsManualReview ? 1 : 0);
        }
        if (updates.reviewedAt !== undefined) {
            setClauses.push('reviewed_at = ?');
            params.push(updates.reviewedAt.toISOString());
        }
        if (updates.reviewedBy !== undefined) {
            setClauses.push('reviewed_by = ?');
            params.push(updates.reviewedBy);
        }
        if (updates.originalPdfPath !== undefined) {
            setClauses.push('original_pdf_path = ?');
            params.push(updates.originalPdfPath);
        }
        if (updates.originalPdfFilename !== undefined) {
            setClauses.push('original_pdf_filename = ?');
            params.push(updates.originalPdfFilename);
        }
        if (updates.extractionMethod !== undefined) {
            setClauses.push('extraction_method = ?');
            params.push(updates.extractionMethod);
        }
        if (updates.errorMessage !== undefined) {
            setClauses.push('error_message = ?');
            params.push(updates.errorMessage);
        }
        params.push(id);
        this.db.run(`
      UPDATE pending_drafts 
      SET ${setClauses.join(', ')}
      WHERE id = ?
    `, params);
        this.saveToFile();
        return this.getDraftById(id);
    }
    async getAllDrafts(status, limit = 50) {
        let query = `SELECT * FROM pending_drafts`;
        const params = [];
        if (status) {
            query += ` WHERE status = ?`;
            params.push(status);
        }
        query += ` ORDER BY created_at DESC LIMIT ?`;
        params.push(limit);
        const result = this.db.exec(query, params);
        if (result.length === 0)
            return [];
        return result[0].values.map((row) => {
            const obj = {};
            result[0].columns.forEach((col, i) => obj[col] = row[i]);
            return {
                id: obj.id,
                internalRfqNumber: obj.internal_rfq_number,
                clientRfqNumber: obj.client_rfq_number,
                clientName: obj.client_name,
                clientEmail: obj.client_email,
                recipient: obj.recipient,
                subject: obj.subject,
                excelPath: obj.excel_path,
                status: obj.status,
                createdAt: new Date(obj.created_at),
                updatedAt: obj.updated_at ? new Date(obj.updated_at) : null,
                scheduledSendAt: obj.scheduled_send_at ? new Date(obj.scheduled_send_at) : null,
                sentAt: obj.sent_at ? new Date(obj.sent_at) : null,
                originalPdfPath: obj.original_pdf_path,
                originalPdfFilename: obj.original_pdf_filename,
                needsManualReview: obj.needs_manual_review === 1,
                extractionMethod: obj.extraction_method,
                reviewNotes: obj.review_notes,
                reviewedAt: obj.reviewed_at ? new Date(obj.reviewed_at) : null,
                itemsJson: obj.items_json,
            };
        });
    }
    async addOutputLog(log) {
        const id = (0, uuid_1.v4)();
        const now = new Date().toISOString();
        this.db.run(`
      INSERT INTO output_logs (id, draft_id, rfq_mapping_id, internal_rfq_number, client_rfq_number, client_name, recipient, subject, excel_path, attachment_count, action, status, error_message, sent_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
            id,
            log.draftId || null,
            log.rfqMappingId || null,
            log.internalRfqNumber,
            log.clientRfqNumber || null,
            log.clientName || null,
            log.recipient,
            log.subject,
            log.excelPath || null,
            log.attachmentCount || 1,
            log.action,
            log.status,
            log.errorMessage || null,
            now,
        ]);
        this.saveToFile();
        return id;
    }
    async getOutputLogs(limit = 100, status) {
        let query = `SELECT * FROM output_logs`;
        const params = [];
        if (status) {
            query += ` WHERE status = ?`;
            params.push(status);
        }
        query += ` ORDER BY sent_at DESC LIMIT ?`;
        params.push(limit);
        const result = this.db.exec(query, params);
        if (result.length === 0)
            return [];
        return result[0].values.map((row) => {
            const obj = {};
            result[0].columns.forEach((col, i) => obj[col] = row[i]);
            return {
                id: obj.id,
                draftId: obj.draft_id,
                rfqMappingId: obj.rfq_mapping_id,
                internalRfqNumber: obj.internal_rfq_number,
                clientRfqNumber: obj.client_rfq_number,
                clientName: obj.client_name,
                recipient: obj.recipient,
                subject: obj.subject,
                excelPath: obj.excel_path,
                attachmentCount: obj.attachment_count,
                action: obj.action,
                status: obj.status,
                errorMessage: obj.error_message,
                sentAt: new Date(obj.sent_at),
            };
        });
    }
    async getOutputLogsSummary() {
        const result = this.db.exec(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
      FROM output_logs
    `);
        if (result.length === 0 || result[0].values.length === 0) {
            return { total: 0, sent: 0, failed: 0, pending: 0 };
        }
        const row = result[0].values[0];
        return {
            total: row[0] || 0,
            sent: row[1] || 0,
            failed: row[2] || 0,
            pending: row[3] || 0,
        };
    }
    async addKnownSupplier(name, email) {
        const domain = email.split('@')[1] || '';
        this.db.run(`
      INSERT OR IGNORE INTO known_suppliers (id, name, email, email_domain, created_at)
      VALUES (?, ?, ?, ?, ?)
    `, [(0, uuid_1.v4)(), name, email.toLowerCase(), domain.toLowerCase(), new Date().toISOString()]);
        this.saveToFile();
    }
    async isKnownSupplier(email) {
        const lowerEmail = email.toLowerCase();
        const domain = lowerEmail.split('@')[1] || '';
        const result = this.db.exec(`
      SELECT COUNT(*) as count FROM known_suppliers 
      WHERE email = ? OR email_domain = ?
    `, [lowerEmail, domain]);
        return result.length > 0 && result[0].values[0][0] > 0;
    }
    async getAllKnownSuppliers() {
        const result = this.db.exec(`SELECT * FROM known_suppliers ORDER BY name`);
        if (result.length === 0)
            return [];
        return result[0].values.map((row) => {
            const obj = {};
            result[0].columns.forEach((col, i) => obj[col] = row[i]);
            return {
                id: obj.id,
                name: obj.name,
                email: obj.email,
                emailDomain: obj.email_domain,
                createdAt: new Date(obj.created_at),
            };
        });
    }
    async removeKnownSupplier(id) {
        this.db.run(`DELETE FROM known_suppliers WHERE id = ?`, [id]);
        this.saveToFile();
    }
};
exports.DatabaseService = DatabaseService;
exports.DatabaseService = DatabaseService = DatabaseService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], DatabaseService);
//# sourceMappingURL=database.service.js.map