#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();

const DEFAULT_WIDTH = 88;
const WIDTH = Math.max(60, Math.min(DEFAULT_WIDTH, Number(process.stdout?.columns) || DEFAULT_WIDTH));

// If user pipes output to `head`/`less` and the pipe closes early,
// Node may throw EPIPE on further writes. Treat it as a normal exit.
process.stdout.on('error', (err) => {
  if (err && err.code === 'EPIPE') process.exit(0);
});

function hr(char = '─', n = 90) {
  return char.repeat(Math.min(n, WIDTH));
}

function indent(lines, spaces = 2) {
  const pad = ' '.repeat(spaces);
  return String(lines)
    .split('\n')
    .map(l => (l.length ? pad + l : l))
    .join('\n');
}

function section(title) {
  return `\n${title}\n${hr('─', Math.min(WIDTH, Math.max(18, title.length)))}`;
}

function wrapText(text, width = WIDTH) {
  const lines = String(text).split('\n');
  const out = [];

  for (const line of lines) {
    if (!line.trim()) {
      out.push('');
      continue;
    }

    const bulletMatch = line.match(/^(\s*-\s+)(.*)$/);
    const leading = line.match(/^\s*/)?.[0] ?? '';
    const firstPrefix = bulletMatch ? bulletMatch[1] : leading;
    const hangingPrefix = bulletMatch ? ' '.repeat(firstPrefix.length) : leading;
    const body = bulletMatch ? bulletMatch[2].trim() : line.trim();
    const words = body.split(/\s+/g);

    let current = firstPrefix;
    let prefix = firstPrefix;

    for (const w of words) {
      const sep = current.endsWith(' ') || current.length === 0 ? '' : ' ';
      if ((current + sep + w).length > width) {
        if (current.trim().length) out.push(current);
        prefix = hangingPrefix;
        current = prefix + w;
      } else {
        current = current + sep + w;
      }
    }
    if (current.trim().length) out.push(current);
  }

  return out.join('\n');
}

function rel(p) {
  return path.relative(ROOT, p).replaceAll('\\', '/');
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function listTree(dir, { maxDepth = 3, ignore = new Set() } = {}, depth = 0) {
  const items = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return items;
  }

  const sorted = entries
    .filter(e => !ignore.has(e.name))
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

  for (const entry of sorted) {
    const full = path.join(dir, entry.name);
    const prefix = '  '.repeat(depth);
    if (entry.isDirectory()) {
      items.push(`${prefix}${entry.name}/`);
      if (depth + 1 < maxDepth) {
        const child = await listTree(full, { maxDepth, ignore }, depth + 1);
        items.push(...child);
      }
    } else {
      items.push(`${prefix}${entry.name}`);
    }
  }

  return items;
}

function printArchitecturalSummary() {
  const now = new Date().toISOString();

  const text = [
    hr('═', WIDTH),
    'GST MODULE — Current Architecture (console snapshot)',
    `Generated: ${now}`,
    hr('═', WIDTH),

    section('1) What this repo contains (high-level)'),
    wrapText([
      '- Node.js ESM monorepo-style workspace (single package.json).',
      '- GST fetcher module (CLI + services) for GSTIN lookup and formatting.',
      '- Express server that exposes REST APIs and serves static HTML dashboards.',
      '- Document Intelligence pipeline (file-based evidence store; OCR, extraction, confidence, comparison; optional AI agent).',
      '- Bank Statement IDU pipeline (OCR; layout zoning; table extraction; optional AI parser fallback).'
    ].join('\n')),

    section('2) Runtime entrypoints'),
    wrapText([
      '- CLI: src/index.js',
      '  - Uses: GSTModule → GSTFetcher → (API | Puppeteer scrape | third-party/demo) → DataFormatter.',
      '- Server: server/app.js',
      '  - Express + middleware (helmet/cors/rate-limit).',
      '  - Serves UI: server/public/*.html + assets.',
      '  - Exposes APIs: GST captcha/session flow, filing status, MCA/company search, Udyam, reports, OCR, bank statement parse, compliance.',
      '- Document Intelligence library: document-intelligence/index.js',
      '  - createDocumentIntelligence({ dataDir, agent }): ingest → OCR → extraction → confidence → comparison → approval → (optional) AI explain/locate.'
    ].join('\n')),

    section('3) Key subsystems (by folder)'),
    wrapText([
      '- src/core/',
      '  - gstModule.js: orchestrator (validation, queueing, formatting).',
      '  - ocr/: OCR pipeline for itr|financial|bank (decode → pages → preprocess → OCR → extract → score).',
      '  - bankIdu/: bank statement parsing (zones + table txns + field extraction + validations + optional AI merge).',
      '- src/services/',
      '  - gstFetcher.js: multi-strategy GST fetch + caching + retries.',
      '  - gstProxyService.js: HTTP session + captcha assisted GST verification (no browser automation).',
      '  - mcaSearchService.js / zaubaService.js / udyamService.js / searchService.js: external lookups.',
      '  - reportService.js / complianceService.js: report generation + compliance checks.',
      '- document-intelligence/',
      '  - evidence/: file-based store + hashing + metadata.',
      '  - ocr/: Tesseract + pdfjs rendering + preprocessing + normalization.',
      '  - extractors/: bank/financial/itr extraction logic.',
      '  - confidence/: scoring + missing diagnostics.',
      '  - compare/: deterministic comparison + executive approval gate.',
      '  - ai/: agent interface + output validation guardrails.'
    ].join('\n')),

    section('4) Primary data flows (simple)'),
    wrapText([
      'A) GST (assisted captcha path, via server)',
      '  UI/Client → GET /api/captcha → user solves captcha → POST /api/gst/search → GSTProxyService → GST portal → JSON response',
      '',
      'B) GST (CLI/module path)',
      '  CLI → GSTModule → GSTFetcher (cache → official API → puppeteer scrape → third-party/demo) → DataFormatter → console/JSON',
      '',
      'C) OCR + extraction (server APIs)',
      '  UI/Client → POST /api/ocr/perform → src/core/ocr/performOCR → extractors → scoring → JSON',
      '',
      'D) Bank Statement IDU',
      '  UI/Client → POST /api/bank/statement/parse → bankIdu/pipeline → decode → pages → preprocess → OCR(words) → zones → table txns → fields → validation (+ optional AI) → JSON',
      '',
      'E) Document Intelligence (library)',
      '  ingestDocument → EvidenceStore (document-intelligence-data/) → runOcr (Tesseract/pdfjs/sharp) → runExtraction → confidence → compare → executive approval → (optional) agent.explain/locateFields'
    ].join('\n')),

    section('5) Mermaid diagram (paste into Mermaid renderer)'),
    [
      'flowchart LR',
      '  subgraph Client_UI[Client / UI]',
      '    UI[Static HTML in server/public]\n(gst.html, dashboard.html, etc.)',
      '  end',
      '',
      '  subgraph Server[Express Server: server/app.js]',
      '    API[REST API routes]',
      '  end',
      '',
      '  subgraph GST[GST Subsystem]',
      '    GSTProxy[GSTProxyService\n(captcha + session)]',
      '    GSTModule[GSTModule]',
      '    GSTFetcher[GSTFetcher\n(cache + retry + multi-strategy)]',
      '    Formatter[DataFormatter]',
      '  end',
      '',
      '  subgraph OCRBank[OCR + Bank/ITR/Financial]',
      '    OCRPerform[src/core/ocr/performOCR]',
      '    BankIDU[src/core/bankIdu/pipeline]',
      '  end',
      '',
      '  subgraph DocIntel[Document Intelligence: document-intelligence/]',
      '    Store[EvidenceStore\n(file-based)]',
      '    OCRDI[ocr/ocrEngine]',
      '    Extract[extractors/*]',
      '    Confidence[confidenceEngine]',
      '    Compare[compareEngine\n+ exec approval]',
      '    Agent[ai/agentInterface\n(optional)]',
      '  end',
      '',
      '  UI --> Server',
      '  Server --> API',
      '',
      '  API -->|/api/captcha, /api/gst/search| GSTProxy -->|HTTPS| GSTPortal[(services.gst.gov.in)]',
      '  API -->|/api/gst/:gstin, batch| GSTModule --> GSTFetcher --> GSTPortal',
      '  GSTFetcher --> Formatter',
      '',
      '  API -->|/api/ocr/perform| OCRPerform',
      '  API -->|/api/bank/statement/parse| BankIDU',
      '',
      '  Store --> OCRDI --> Extract --> Confidence --> Compare --> Agent'
    ].join('\n'),

    section('6) Project tree (trimmed to depth=3)'),
    '(generated below)'
  ];

  return text.join('\n');
}

async function main() {
  const ignore = new Set([
    'node_modules',
    '.git',
    '.venv',
    'logs',
    '.tmp-di-data',
    '.tmp-di-km-data',
    // Contains large case data; keep architecture output clean.
    'document-intelligence-data'
  ]);

  const base = printArchitecturalSummary();
  console.log(base);

  const tree = await listTree(ROOT, { maxDepth: 3, ignore });
  console.log(indent(tree.join('\n'), 0));

  // Quick sanity: highlight missing expected folders if any.
  const expected = ['src', 'server', 'document-intelligence'];
  const missing = [];
  for (const name of expected) {
    if (!(await exists(path.join(ROOT, name)))) missing.push(name);
  }
  if (missing.length) {
    console.log('\n' + hr('-', 90));
    console.log(`Note: expected folders missing: ${missing.join(', ')}`);
  }

  console.log('\n' + hr('═', WIDTH));
}

main().catch(err => {
  console.error('Failed to print architecture:', err?.message || err);
  process.exitCode = 1;
});
