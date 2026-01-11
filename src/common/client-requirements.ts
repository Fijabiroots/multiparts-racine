/**
 * Utilitaires pour détecter et extraire les exigences client depuis les emails
 */

import { ClientRequirements } from './interfaces';

/**
 * Extraire les exigences client depuis le sujet et le corps de l'email
 */
export function extractClientRequirements(
  subject: string,
  body: string,
  replyToHeader?: string,
): ClientRequirements {
  const requirements: ClientRequirements = {};
  const text = `${subject} ${body}`.toLowerCase();
  const originalText = `${subject} ${body}`;

  // ═══════════════════════════════════════════════════════════════════════
  // 1. DÉTECTER LE DÉLAI DE RÉPONSE EXIGÉ
  // ═══════════════════════════════════════════════════════════════════════

  // Patterns pour les délais en heures
  const hourPatterns = [
    /(?:répon(?:dre|se)|reply|respond)\s*(?:dans|within|before|avant)?\s*(\d+)\s*(?:h(?:eures?)?|hours?)/i,
    /délai\s*(?:de\s+)?réponse\s*[:\-]?\s*(\d+)\s*(?:h(?:eures?)?|hours?)/i,
    /deadline\s*[:\-]?\s*(\d+)\s*(?:h(?:eures?)?|hours?)/i,
    /(\d+)\s*(?:h(?:eures?)?|hours?)\s*(?:délai|deadline|max)/i,
  ];

  for (const pattern of hourPatterns) {
    const match = text.match(pattern);
    if (match) {
      const hours = parseInt(match[1], 10);
      requirements.responseDeadline = `${hours}h`;
      requirements.responseDeadlineDate = calculateDeadlineWithBusinessHours(new Date(), hours);
      break;
    }
  }

  // Patterns pour les délais en jours
  if (!requirements.responseDeadline) {
    const dayPatterns = [
      /(?:répon(?:dre|se)|reply|respond)\s*(?:dans|within|before|avant)?\s*(\d+)\s*(?:j(?:ours?)?|days?)/i,
      /délai\s*(?:de\s+)?réponse\s*[:\-]?\s*(\d+)\s*(?:j(?:ours?)?|days?)/i,
      /deadline\s*[:\-]?\s*(\d+)\s*(?:j(?:ours?)?|days?)/i,
      /(\d+)\s*(?:j(?:ours?)?|days?)\s*(?:délai|deadline|max)/i,
    ];

    for (const pattern of dayPatterns) {
      const match = text.match(pattern);
      if (match) {
        const days = parseInt(match[1], 10);
        requirements.responseDeadline = `${days} jour${days > 1 ? 's' : ''}`;
        requirements.responseDeadlineDate = calculateDeadlineWithBusinessHours(new Date(), days * 24);
        break;
      }
    }
  }

  // Patterns pour les dates spécifiques
  if (!requirements.responseDeadline) {
    const datePatterns = [
      // Format: avant le 15/01/2024 ou before 15/01/2024
      /(?:avant\s+le|before|by|d'ici(?:\s+le)?)\s+(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.]?(\d{2,4})?/i,
      // Format: deadline 15 janvier
      /(?:deadline|délai)\s*[:\-]?\s*(\d{1,2})\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre|january|february|march|april|may|june|july|august|september|october|november|december)/i,
    ];

    const match1 = text.match(datePatterns[0]);
    if (match1) {
      const day = parseInt(match1[1], 10);
      const month = parseInt(match1[2], 10);
      const year = match1[3] ? parseInt(match1[3].length === 2 ? `20${match1[3]}` : match1[3], 10) : new Date().getFullYear();
      const deadlineDate = new Date(year, month - 1, day);
      requirements.responseDeadline = `avant le ${day.toString().padStart(2, '0')}/${month.toString().padStart(2, '0')}/${year}`;
      requirements.responseDeadlineDate = deadlineDate;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 2. DÉTECTER L'ADRESSE EMAIL DE RÉPONSE SPÉCIFIQUE
  // ═══════════════════════════════════════════════════════════════════════

  // Utiliser le Reply-To header si présent
  if (replyToHeader) {
    const emailMatch = replyToHeader.match(/[\w.-]+@[\w.-]+\.\w+/);
    if (emailMatch) {
      requirements.replyToEmail = emailMatch[0];
    }
  }

  // Sinon chercher dans le corps de l'email
  if (!requirements.replyToEmail) {
    const replyToPatterns = [
      /(?:répondre|reply|envoyer|send)\s+(?:à|to|sur)\s*[:\-]?\s*([\w.-]+@[\w.-]+\.\w+)/i,
      /(?:email|mail|courriel)\s*(?:de\s+)?réponse\s*[:\-]?\s*([\w.-]+@[\w.-]+\.\w+)/i,
      /(?:contact|joindre)\s*[:\-]?\s*([\w.-]+@[\w.-]+\.\w+)/i,
      /please\s+(?:reply|respond|send)\s+(?:to|at)\s*[:\-]?\s*([\w.-]+@[\w.-]+\.\w+)/i,
    ];

    for (const pattern of replyToPatterns) {
      const match = originalText.match(pattern);
      if (match) {
        requirements.replyToEmail = match[1];
        break;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 3. DÉTECTER SI C'EST URGENT
  // ═══════════════════════════════════════════════════════════════════════

  const urgentPatterns = [
    /\bURGEN(?:T|CE)\b/i,
    /\bASAP\b/i,
    /\bIMMÉDIAT(?:EMENT)?\b/i,
    /\bIMMEDIATE(?:LY)?\b/i,
    /\bPRIORITÉ\s+HAUTE\b/i,
    /\bHIGH\s+PRIORITY\b/i,
    /\bTRÈS\s+URGENT\b/i,
    /\bCRITIQUE\b/i,
    /\bCRITICAL\b/i,
  ];

  for (const pattern of urgentPatterns) {
    if (pattern.test(text) || pattern.test(subject)) {
      requirements.urgent = true;
      break;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 4. DÉTECTER AUTRES EXIGENCES
  // ═══════════════════════════════════════════════════════════════════════

  const otherRequirements: string[] = [];

  // Demande de confirmation de lecture
  if (/(?:accus[eé]\s+(?:de\s+)?r[eé]ception|read\s+receipt|confirm(?:er|ation)?\s+(?:de\s+)?r[eé]ception)/i.test(text)) {
    otherRequirements.push('Accusé de réception demandé');
  }

  // Format de réponse spécifique
  if (/(?:r[eé]pondre\s+(?:en|par)\s+PDF|PDF\s+(?:format|only))/i.test(text)) {
    otherRequirements.push('Réponse en PDF demandée');
  }

  if (/(?:r[eé]pondre\s+(?:en|par)\s+Excel|Excel\s+(?:format|only))/i.test(text)) {
    otherRequirements.push('Réponse en Excel demandée');
  }

  if (otherRequirements.length > 0) {
    requirements.otherRequirements = otherRequirements;
  }

  return requirements;
}

/**
 * Calculer la deadline en tenant compte des heures ouvrées
 * Les demandes arrivant vendredi après 12:00 GMT ou le week-end
 * commencent leur décompte le lundi suivant
 */
export function calculateDeadlineWithBusinessHours(startDate: Date, hours: number): Date {
  let effectiveStartDate = new Date(startDate);
  const dayOfWeek = effectiveStartDate.getUTCDay(); // 0 = Dimanche, 6 = Samedi
  const hour = effectiveStartDate.getUTCHours();

  // Si vendredi après 12:00 GMT, samedi ou dimanche → commencer lundi
  if (dayOfWeek === 5 && hour >= 12) {
    // Vendredi après-midi → lundi 08:00
    const daysUntilMonday = 3;
    effectiveStartDate.setUTCDate(effectiveStartDate.getUTCDate() + daysUntilMonday);
    effectiveStartDate.setUTCHours(8, 0, 0, 0);
  } else if (dayOfWeek === 6) {
    // Samedi → lundi 08:00
    const daysUntilMonday = 2;
    effectiveStartDate.setUTCDate(effectiveStartDate.getUTCDate() + daysUntilMonday);
    effectiveStartDate.setUTCHours(8, 0, 0, 0);
  } else if (dayOfWeek === 0) {
    // Dimanche → lundi 08:00
    const daysUntilMonday = 1;
    effectiveStartDate.setUTCDate(effectiveStartDate.getUTCDate() + daysUntilMonday);
    effectiveStartDate.setUTCHours(8, 0, 0, 0);
  }

  // Ajouter les heures de délai
  const deadline = new Date(effectiveStartDate);
  deadline.setTime(deadline.getTime() + hours * 60 * 60 * 1000);

  return deadline;
}

/**
 * Calculer la deadline par défaut (en heures) en tenant compte des heures ouvrées
 */
export function calculateDefaultDeadline(startDate: Date, defaultHours: number = 24): Date {
  return calculateDeadlineWithBusinessHours(startDate, defaultHours);
}

/**
 * Vérifier si le client a des exigences importantes
 */
export function hasImportantRequirements(requirements: ClientRequirements): boolean {
  return !!(
    requirements.responseDeadline ||
    requirements.replyToEmail ||
    requirements.urgent
  );
}

/**
 * Formater les exigences client pour affichage
 */
export function formatClientRequirements(requirements: ClientRequirements): string {
  const parts: string[] = [];

  if (requirements.urgent) {
    parts.push('URGENT');
  }
  if (requirements.responseDeadline) {
    parts.push(`Délai: ${requirements.responseDeadline}`);
  }
  if (requirements.replyToEmail) {
    parts.push(`Répondre à: ${requirements.replyToEmail}`);
  }
  if (requirements.otherRequirements && requirements.otherRequirements.length > 0) {
    parts.push(...requirements.otherRequirements);
  }

  return parts.join(' | ');
}
