import { registerAs } from '@nestjs/config';
import { ReminderConfig, ChaserKeywordsConfig, RequestStatus } from '../interfaces/reminder.interfaces';

export const reminderConfig = registerAs('reminder', (): ReminderConfig => ({
  reminderSlaDays: parseInt(process.env.REMINDER_SLA_DAYS || '3', 10),
  reminderRunHour: parseInt(process.env.REMINDER_RUN_HOUR || '9', 10),
  autoReplyThrottleHours: parseInt(process.env.AUTO_REPLY_THROTTLE_HOURS || '12', 10),
  multipartsAckFrom: process.env.MULTIPARTS_ACK_FROM || 'rafiou.oyeossi@multipartsci.com',
  procurementSentMailbox: process.env.PROCUREMENT_SENT_MAILBOX || 'procurement@multipartsci.com',
  chaserScoreThreshold: parseInt(process.env.CHASER_SCORE_THRESHOLD || '60', 10),
  closedStatuses: (process.env.CLOSED_STATUSES || 'CLOSED,CANCELLED,LOST,WON').split(',') as RequestStatus[],
}));

/**
 * Default chaser keywords configuration
 * These can be overridden via database or external config
 */
export const defaultChaserKeywords: ChaserKeywordsConfig = {
  // D1) Indicateurs forts dans le SUJET (+35 points)
  subjectStrong: {
    fr: [
      'relance',
      'rappel',
      'suivi',
      'où en est',
      'ou en est',
      'mise à jour',
      'mise a jour',
      'point',
      'statut',
      'retour',
    ],
    en: [
      'follow up',
      'follow-up',
      'followup',
      'any update',
      'status',
      'update',
      'reminder',
      'checking in',
    ],
  },

  // Urgent keywords (+10 points, but not sufficient alone)
  subjectUrgent: ['urgent', 'asap', 'urgence', 'priorité', 'priority'],

  // D2) Indicateurs forts dans le CORPS (+35 points)
  bodyStrong: {
    fr: [
      'je me permets de relancer',
      'je vous relance',
      'nous vous relançons',
      'pouvez-vous nous faire un retour',
      'pourriez-vous nous faire un retour',
      'avez-vous un retour',
      'où en est',
      'ou en est',
      'merci de votre retour',
      'dans l\'attente de votre retour',
      'dans l\'attente de',
      'sans retour de votre part',
      'en attente de votre réponse',
      'qu\'en est-il',
      'avez-vous des nouvelles',
      'auriez-vous des nouvelles',
    ],
    en: [
      'just following up',
      'following up on',
      'i\'m following up',
      'we\'re following up',
      'could you please update',
      'can you please update',
      'any news on',
      'any news about',
      'please advise',
      'awaiting your feedback',
      'awaiting your response',
      'waiting for your response',
      'haven\'t heard back',
      'have not heard back',
      'checking in on',
      'wanted to check',
    ],
  },

  // D2) Questions courtes typiques (+20 points)
  bodyQuestions: {
    fr: [
      'des nouvelles ?',
      'des nouvelles?',
      'un retour ?',
      'un retour?',
      'statut ?',
      'statut?',
      'point d\'avancement ?',
      'point d\'avancement?',
      'où en sommes-nous ?',
      'où en sommes-nous?',
    ],
    en: [
      'any update?',
      'any updates?',
      'status?',
      'update?',
      'any progress?',
      'what\'s the status?',
      'what is the status?',
    ],
  },

  // D3) Indices temporels (+10 points)
  temporalIndicators: [
    'depuis',
    'since',
    'il y a',
    'ago',
    'last week',
    'la semaine dernière',
    'last month',
    'le mois dernier',
    'plusieurs jours',
    'several days',
    'quelques jours',
    'few days',
  ],

  // D4) Anti-faux positifs: nouvelle demande (-25 or block)
  newRequestIndicators: {
    fr: [
      'demande de prix',
      'demande de cotation',
      'merci de nous coter',
      'prière de coter',
      'veuillez nous fournir',
      'nouvelle demande',
      'ci-joint',
      'pièces jointes',
    ],
    en: [
      'rfq',
      'request for quotation',
      'request for quote',
      'quotation request',
      'please quote',
      'kindly quote',
      'new request',
      'attached please find',
      'please find attached',
    ],
  },

  // D4) Anti-faux positifs: bon de commande (-40 points)
  purchaseOrderIndicators: {
    fr: [
      'bon de commande',
      'commande',
      'purchase order',
      'po',
      'order confirmation',
      'confirmation de commande',
    ],
    en: [
      'purchase order',
      'po #',
      'po number',
      'order confirmation',
      'order number',
      'placed order',
    ],
  },

  // D4) Anti-faux positifs: réclamation logistique (-30 points)
  deliveryIndicators: {
    fr: [
      'livraison',
      'retard',
      'tracking',
      'bl',
      'awb',
      'expédition',
      'colis',
      'réception',
    ],
    en: [
      'delivery',
      'shipment',
      'tracking',
      'awb',
      'bl',
      'shipping',
      'package',
      'received goods',
    ],
  },

  // D4) Anti-faux positifs: refus/annulation (-30 points)
  cancellationIndicators: {
    fr: [
      'annuler',
      'annulation',
      'stop',
      'abandon',
      'nous ne donnons pas suite',
      'sans suite',
      'abandonner',
    ],
    en: [
      'cancel',
      'cancellation',
      'withdraw',
      'no longer proceed',
      'not proceeding',
      'discontinue',
      'abort',
    ],
  },

  // Marqueurs de signature pour nettoyage du body
  signatureMarkers: [
    'cordialement',
    'best regards',
    'kind regards',
    'regards',
    'sincerely',
    'thanks and regards',
    'bien cordialement',
    'salutations',
    'cdlt',
    'cdt',
    '____',
    '-- ',
    '—',
    'sent from my',
    'envoyé depuis',
    'get outlook',
  ],
};

/**
 * RFQ Token patterns for correlation
 */
export const RFQ_TOKEN_PATTERNS = [
  // Internal DDP format: DDP-YYYYMMDD-XXX
  /\bDDP-\d{8}-\d{3,4}\b/gi,
  // RFQ format: RFQ-YYYY-XXXX
  /\bRFQ-\d{4}-\d{3,5}\b/gi,
  // Quote format: QUO-YYYY-XXXX
  /\bQUO-\d{4}-\d{3,5}\b/gi,
  // PR format: PR[\s_-]?\d{6,10}
  /\bPR[\s_-]?\d{6,10}\b/gi,
  // Generic RFQ number
  /\bréf(?:érence)?[\s.:]*([A-Z0-9-]{5,20})\b/gi,
  /\bref(?:erence)?[\s.:]*([A-Z0-9-]{5,20})\b/gi,
];

/**
 * Auto-reply headers to detect
 */
export const AUTO_REPLY_HEADERS = [
  { header: 'X-Multiparts-Auto', value: '1' },
  { header: 'Auto-Submitted', values: ['auto-replied', 'auto-generated', 'auto-notified'] },
  { header: 'Precedence', values: ['bulk', 'junk', 'list', 'auto_reply'] },
  { header: 'X-Auto-Response-Suppress', value: 'All' },
  { header: 'X-Autoreply', value: 'yes' },
];

/**
 * Internal domains to ignore
 */
export const INTERNAL_DOMAINS = ['multipartsci.com', 'multiparts.ci'];
