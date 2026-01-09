"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAttachmentType = getAttachmentType;
function getAttachmentType(contentType, filename) {
    const lowerFilename = filename.toLowerCase();
    const lowerType = contentType.toLowerCase();
    if (lowerType.includes('pdf') || lowerFilename.endsWith('.pdf')) {
        return 'rfq_pdf';
    }
    if (lowerType.includes('image') || /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(lowerFilename)) {
        return 'image';
    }
    if (/\.(doc|docx|xls|xlsx|ppt|pptx)$/i.test(lowerFilename)) {
        return 'document';
    }
    return 'other';
}
//# sourceMappingURL=index.js.map