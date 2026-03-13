import crypto from 'node:crypto';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

function normalizeWhitespace(text) {
  return String(text || '')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashText(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

export class PdfParserService {
  constructor({ maxPages = 150, pagesPerChunk = 4 } = {}) {
    this.maxPages = maxPages;
    this.pagesPerChunk = pagesPerChunk;
  }

  async parseAndChunk(buffer, { pagesPerChunk = this.pagesPerChunk } = {}) {
    if (!buffer || !(buffer instanceof Buffer) || buffer.length === 0) {
      throw new Error('PDF buffer is required');
    }

    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
    const pdf = await loadingTask.promise;

    const totalPages = Math.min(pdf.numPages, this.maxPages);
    const pageTexts = [];

    for (let i = 1; i <= totalPages; i += 1) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = normalizeWhitespace(content.items.map((item) => item.str || '').join(' '));

      pageTexts.push({
        page_number: i,
        text,
        text_hash: hashText(text)
      });
    }

    const chunks = [];
    for (let idx = 0; idx < pageTexts.length; idx += pagesPerChunk) {
      const group = pageTexts.slice(idx, idx + pagesPerChunk);
      const chunkText = group
        .map((p) => `[[PAGE ${p.page_number}]]\n${p.text}`)
        .join('\n\n');

      chunks.push({
        chunk_index: chunks.length,
        page_start: group[0].page_number,
        page_end: group[group.length - 1].page_number,
        page_count: group.length,
        text: chunkText,
        text_hash: hashText(chunkText)
      });
    }

    return {
      total_pages: totalPages,
      pages: pageTexts,
      chunks
    };
  }
}

export default PdfParserService;