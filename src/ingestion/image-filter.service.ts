import { Injectable, Logger } from '@nestjs/common';
import * as sharp from 'sharp';
import { FilteredImage, FilterReason } from './types';

/**
 * Image metadata for filtering decisions
 */
export interface ImageMetadata {
  filename: string;
  buffer: Buffer;
  contentType?: string;
  size: number;
  isInline?: boolean;           // true if embedded in email body
  positionInEmail?: 'header' | 'body' | 'footer' | 'unknown';
  cidReference?: string;        // Content-ID reference
  surroundingText?: string;     // Text around the image in email
}

/**
 * Result of image classification
 */
export interface ImageClassification {
  isFiltered: boolean;
  reason?: FilterReason;
  width?: number;
  height?: number;
  aspectRatio?: number;
  confidence: number;           // 0-1 confidence in classification
}

/**
 * Configuration for image filtering
 */
export interface ImageFilterConfig {
  minPixels?: number;           // Minimum total pixels (width*height), default: 40000
  maxIconSize?: number;         // Max dimension for icon detection, default: 64
  maxLogoAspectRatio?: number;  // Max aspect ratio for logo detection, default: 3.5
  minLogoHeight?: number;       // Min height for logo rejection, default: 120
  minOcrChars?: number;         // Min OCR chars to consider valuable, default: 15
  enableOcrCheck?: boolean;     // Whether to run OCR validation, default: false
}

/**
 * Default filter configuration
 */
const DEFAULT_CONFIG: Required<ImageFilterConfig> = {
  minPixels: 40000,
  maxIconSize: 64,
  maxLogoAspectRatio: 3.5,
  minLogoHeight: 120,
  minOcrChars: 15,
  enableOcrCheck: false,
};

/**
 * Service for filtering signature/icon images from emails
 *
 * Implements multiple heuristics to identify non-document images:
 * 1. Size/dimension rules (too small = icon)
 * 2. Filename/URL pattern matching
 * 3. Position in email (footer = likely signature)
 * 4. Aspect ratio analysis (very horizontal = logo)
 * 5. Optional OCR validation
 */
@Injectable()
export class ImageFilterService {
  private readonly logger = new Logger(ImageFilterService.name);
  private readonly config: Required<ImageFilterConfig>;

  // Filename patterns indicating signature/icon images
  private readonly FILENAME_REJECT_PATTERNS = [
    /^outlook/i,                    // Outlook images
    /^image\d+\./i,                // Generic inline images (image001.png)
    /\blogo\b/i,                    // Logo images
    /\bicon\b/i,                    // Icon images
    /\bsignature\b/i,               // Signature images
    /\bsig\b/i,                     // Shortened signature
    /\bfacebook\b/i,                // Social media
    /\blinkedin\b/i,
    /\btwitter\b/i,
    /\binstagram\b/i,
    /\bwhatsapp\b/i,
    /\byoutube\b/i,
    /\bbanner\b/i,                  // Banner images
    /\bbadge\b/i,                   // Badge images
    /\btracking\b/i,                // Tracking pixels
    /\bpixel\b/i,                   // Tracking pixels
    /\bspacer\b/i,                  // Spacer images
    /\bheader\b/i,                  // Header images
    /\bfooter\b/i,                  // Footer images
    /^att\d+\./i,                  // Outlook ATT attachments
    /^cid[:\-_]/i,                 // CID references
    /^[a-f0-9]{8,}[-_]/i,          // Hex ID patterns
    /desc\.(png|jpg|jpeg|gif)$/i,  // Desc suffix
    /~WRL\d+\.tmp$/i,              // Temp files
    /winmail\.dat$/i,              // Winmail.dat
  ];

  // URL patterns indicating signature/icon images
  private readonly URL_REJECT_PATTERNS = [
    /\.signature\./i,
    /\/signature\//i,
    /\/logos?\//i,
    /\/icons?\//i,
    /\/badge/i,
    /tracking\./i,
    /pixel\./i,
    /beacon\./i,
    /spacer\./i,
    /\.gif$/i,                     // Most email GIFs are icons/tracking
  ];

  // Signature text patterns (text surrounding image)
  private readonly SIGNATURE_TEXT_PATTERNS = [
    /cordialement/i,
    /regards/i,
    /sincerely/i,
    /best\s+regards/i,
    /sent\s+from/i,
    /envoyé\s+depuis/i,
    /^tel[:\s]/i,
    /^mobile[:\s]/i,
    /^phone[:\s]/i,
    /linkedin\.com/i,
    /twitter\.com/i,
    /facebook\.com/i,
  ];

  constructor() {
    this.config = { ...DEFAULT_CONFIG };
  }

  /**
   * Update configuration
   */
  configure(config: Partial<ImageFilterConfig>): void {
    Object.assign(this.config, config);
  }

  /**
   * Classify an image and determine if it should be filtered
   */
  async classifyImage(image: ImageMetadata): Promise<ImageClassification> {
    const result: ImageClassification = {
      isFiltered: false,
      confidence: 0,
    };

    try {
      // Rule 1: Check filename patterns
      const filenameCheck = this.checkFilenamePatterns(image.filename);
      if (filenameCheck.isRejected) {
        return {
          isFiltered: true,
          reason: filenameCheck.reason,
          confidence: filenameCheck.confidence,
        };
      }

      // Rule 2: Get image dimensions
      const dimensions = await this.getImageDimensions(image.buffer);
      if (dimensions) {
        result.width = dimensions.width;
        result.height = dimensions.height;
        result.aspectRatio = dimensions.width / dimensions.height;

        // Rule 2a: Tracking pixels (1x1, 2x2, etc.)
        if (dimensions.width <= 2 && dimensions.height <= 2) {
          return {
            ...result,
            isFiltered: true,
            reason: 'tracking_pixel',
            confidence: 1.0,
          };
        }

        // Rule 2b: Tiny icons
        if (dimensions.width <= this.config.maxIconSize &&
            dimensions.height <= this.config.maxIconSize) {
          return {
            ...result,
            isFiltered: true,
            reason: 'tiny_icon',
            confidence: 0.95,
          };
        }

        // Rule 2c: Total pixels too small
        const totalPixels = dimensions.width * dimensions.height;
        if (totalPixels < this.config.minPixels) {
          return {
            ...result,
            isFiltered: true,
            reason: 'likely_signature',
            confidence: 0.8,
          };
        }

        // Rule 2d: Suspicious aspect ratio (very horizontal logo)
        if (result.aspectRatio > this.config.maxLogoAspectRatio &&
            dimensions.height < this.config.minLogoHeight) {
          return {
            ...result,
            isFiltered: true,
            reason: 'aspect_ratio',
            confidence: 0.75,
          };
        }
      }

      // Rule 3: File size too small
      if (image.size < 5000) { // < 5KB
        return {
          ...result,
          isFiltered: true,
          reason: 'likely_signature',
          confidence: 0.7,
        };
      }

      // Rule 4: Check position in email
      if (image.positionInEmail === 'footer') {
        // Footer images are often signatures, but not always
        const sizeConfidence = image.size < 20000 ? 0.8 : 0.5;
        if (sizeConfidence > 0.7) {
          return {
            ...result,
            isFiltered: true,
            reason: 'footer_position',
            confidence: sizeConfidence,
          };
        }
      }

      // Rule 5: Check surrounding text
      if (image.surroundingText) {
        const textCheck = this.checkSurroundingText(image.surroundingText);
        if (textCheck.isSignature) {
          return {
            ...result,
            isFiltered: true,
            reason: 'likely_signature',
            confidence: textCheck.confidence,
          };
        }
      }

      // Rule 6: CID pattern check
      if (image.cidReference && /^[a-f0-9]{8,}[@_\-]/i.test(image.cidReference)) {
        return {
          ...result,
          isFiltered: true,
          reason: 'cid_pattern',
          confidence: 0.6,
        };
      }

      // Image passed all filters - likely a document image
      return {
        ...result,
        isFiltered: false,
        confidence: 1.0,
      };

    } catch (error) {
      this.logger.warn(`Error classifying image ${image.filename}: ${error.message}`);
      // On error, don't filter (false negative is better than false positive)
      return {
        ...result,
        isFiltered: false,
        confidence: 0.5,
      };
    }
  }

  /**
   * Filter a list of images and return classification results
   */
  async filterImages(images: ImageMetadata[]): Promise<{
    accepted: ImageMetadata[];
    filtered: FilteredImage[];
  }> {
    const accepted: ImageMetadata[] = [];
    const filtered: FilteredImage[] = [];

    for (const image of images) {
      const classification = await this.classifyImage(image);

      if (classification.isFiltered) {
        filtered.push({
          name: image.filename,
          reason: classification.reason!,
          width: classification.width,
          height: classification.height,
          size: image.size,
        });
        this.logger.debug(
          `Image filtered: ${image.filename} (reason: ${classification.reason}, confidence: ${classification.confidence.toFixed(2)})`
        );
      } else {
        accepted.push(image);
        this.logger.debug(`Image accepted: ${image.filename}`);
      }
    }

    this.logger.log(
      `Image filtering: ${accepted.length} accepted, ${filtered.length} filtered`
    );

    return { accepted, filtered };
  }

  /**
   * Check filename against reject patterns
   */
  private checkFilenamePatterns(filename: string): {
    isRejected: boolean;
    reason?: FilterReason;
    confidence: number;
  } {
    const lowerFilename = filename.toLowerCase();

    for (const pattern of this.FILENAME_REJECT_PATTERNS) {
      if (pattern.test(lowerFilename)) {
        // Determine specific reason
        let reason: FilterReason = 'likely_signature';

        if (/logo/i.test(lowerFilename)) reason = 'logo';
        else if (/icon/i.test(lowerFilename)) reason = 'tiny_icon';
        else if (/(facebook|linkedin|twitter|instagram|youtube|whatsapp)/i.test(lowerFilename)) reason = 'social_icon';
        else if (/banner/i.test(lowerFilename)) reason = 'banner';
        else if (/(tracking|pixel|beacon|spacer)/i.test(lowerFilename)) reason = 'tracking_pixel';
        else if (/^cid/i.test(lowerFilename)) reason = 'cid_pattern';
        else if (/^[a-f0-9]{8,}[-_]/i.test(lowerFilename)) reason = 'hex_id_pattern';

        return {
          isRejected: true,
          reason,
          confidence: 0.9,
        };
      }
    }

    return { isRejected: false, confidence: 0 };
  }

  /**
   * Get image dimensions using sharp
   */
  private async getImageDimensions(buffer: Buffer): Promise<{
    width: number;
    height: number;
  } | null> {
    try {
      const metadata = await sharp(buffer).metadata();
      if (metadata.width && metadata.height) {
        return {
          width: metadata.width,
          height: metadata.height,
        };
      }
    } catch (error) {
      this.logger.warn(`Failed to get image dimensions: ${error.message}`);
    }
    return null;
  }

  /**
   * Check if surrounding text indicates signature block
   */
  private checkSurroundingText(text: string): {
    isSignature: boolean;
    confidence: number;
  } {
    let matchCount = 0;
    const textLower = text.toLowerCase();

    for (const pattern of this.SIGNATURE_TEXT_PATTERNS) {
      if (pattern.test(textLower)) {
        matchCount++;
      }
    }

    if (matchCount >= 2) {
      return { isSignature: true, confidence: 0.85 };
    } else if (matchCount === 1) {
      return { isSignature: true, confidence: 0.6 };
    }

    return { isSignature: false, confidence: 0 };
  }

  /**
   * Quick check if a filename looks like a signature image
   * Use this for fast pre-filtering without loading the image
   */
  isLikelySignatureByName(filename: string): boolean {
    const check = this.checkFilenamePatterns(filename);
    return check.isRejected && check.confidence >= 0.8;
  }

  /**
   * Quick check if file size indicates signature/icon
   */
  isLikelySignatureBySize(size: number): boolean {
    return size < 5000; // < 5KB
  }
}
