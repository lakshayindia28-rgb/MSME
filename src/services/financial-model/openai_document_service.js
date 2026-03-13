import fs from 'node:fs';
import OpenAI from 'openai';

export class OpenAIDocumentService {
  constructor({ openaiClient } = {}) {
    this.openai = openaiClient || (process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null);
  }

  async uploadAndGetFileId(localFilePath) {
    if (!this.openai) {
      throw new Error('OPENAI_API_KEY is not configured. OpenAI API is required for this flow.');
    }
    const file = await this.openai.files.create({
      file: fs.createReadStream(localFilePath),
      purpose: 'assistants'
    });
    return file.id;
  }

  async deleteFile(fileId) {
    const id = String(fileId || '').trim();
    if (!id || !this.openai) return;
    try {
      await this.openai.files.del(id);
    } catch {
      // ignore cleanup failures
    }
  }
}

export default OpenAIDocumentService;