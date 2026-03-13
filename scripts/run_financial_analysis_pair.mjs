import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';

import { FinancialAnalysisService } from '../src/services/financial-model/financial_analysis_service.js';

const cwd = process.cwd();
const defaultBankPath = path.resolve(cwd, 'ITR PROGALAXY.pdf');
const defaultVendorPath = path.resolve(cwd, '834754311101225.pdf');

function parseArgs(argv = []) {
  const out = {
    bank: defaultBankPath,
    vendor: defaultVendorPath,
    companyName: 'PROGALAXY SERVICES PRIVATE LIMITED',
    tolerancePct: 0.5
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--bank' && next) {
      out.bank = path.resolve(cwd, next);
      index += 1;
      continue;
    }
    if (arg === '--vendor' && next) {
      out.vendor = path.resolve(cwd, next);
      index += 1;
      continue;
    }
    if (arg === '--company' && next) {
      out.companyName = String(next || '').trim();
      index += 1;
      continue;
    }
    if (arg === '--tolerance' && next) {
      const value = Number(next);
      if (Number.isFinite(value)) out.tolerancePct = value;
      index += 1;
    }
  }

  return out;
}

async function ensureFileReadable(filePath, label) {
  await fs.access(filePath);
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    throw new Error(`${label} is not a file: ${filePath}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set. Please export it before running this script.');
  }

  await Promise.all([
    ensureFileReadable(args.bank, 'Bank PDF'),
    ensureFileReadable(args.vendor, 'Vendor PDF')
  ]);

  const [bankBuffer, vendorBuffer] = await Promise.all([
    fs.readFile(args.bank),
    fs.readFile(args.vendor)
  ]);

  const service = new FinancialAnalysisService();

  const result = await service.analyze({
    bankSubmittedPdfBuffer: bankBuffer,
    vendorVerifiedPdfBuffer: vendorBuffer,
    tolerancePct: args.tolerancePct,
    companyName: args.companyName
  });

  const output = {
    company_name: result?.company_name || null,
    decision: result?.decision || null,
    confidence_score: result?.confidence_score ?? null,
    reliability_level: result?.reliability_level || null,
    report_pdf_path: result?.report_pdf_path || null
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(`run_financial_analysis_pair failed: ${error?.message || error}`);
  process.exit(1);
});
