import fs from 'node:fs/promises';
import { parseIndianBankStatement } from '../src/core/bankIdu/index.js';

const filePath = process.argv[2] || '../KM.pdf';
const caseId = process.argv[3] || 'KM';

const buf = await fs.readFile(new URL(filePath, import.meta.url));
const fileBase64 = buf.toString('base64');

const parsed = await parseIndianBankStatement({ fileBase64, caseId });

function unwrap(x) {
  if (Array.isArray(x)) return x.map(unwrap);
  if (!x || typeof x !== 'object') return x;

  const keys = Object.keys(x);
  const isFieldWrapper =
    keys.includes('value') &&
    keys.includes('status') &&
    keys.includes('inferred') &&
    keys.includes('confidence') &&
    keys.length === 4;

  if (isFieldWrapper) return String(x.value ?? '');

  const out = {};
  for (const [k, v] of Object.entries(x)) out[k] = unwrap(v);
  return out;
}

const strict = unwrap(parsed);
process.stdout.write(JSON.stringify(strict, null, 2));
