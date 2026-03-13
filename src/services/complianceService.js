import axios from 'axios';
import * as cheerio from 'cheerio';
import NodeCache from 'node-cache';
import XLSX from 'xlsx';
import MCAProvider from '../providers/mcaProvider.js';
import NCLTService from './compliance/ncltService.js';
import SEBIService from './compliance/sebiService.js';
import CourtService from './compliance/courtService.js';
import ExchangeService from './compliance/exchangeService.js';
import { decideComplianceStatus } from './compliance/complianceDecision.js';
import { generateNarrative } from './compliance/reportNarrator.js';
import { normalizeName, resolveIdentityConfidence } from '../core/entityResolver.js';

const complianceDataCache = new NodeCache({ stdTTL: 60 * 60 * 12, checkperiod: 60 * 10, useClones: false });

const NSE_DEFAULTING_CLIENTS_XLSX_URL =
    'https://nsearchives.nseindia.com/web/sites/default/files/inline-files/Defaulting_Client_Database%202_1_1%20%281%29%20%281%29.xlsx';
const NSE_DEFAULTING_CLIENTS_CACHE_KEY = 'nse:defaulting-clients:xlsx:v1';

/**
 * Compliance & Risk Analysis Copilot for Indian Companies
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * IMPORTANT ROLE DEFINITION
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * You are a Compliance & Risk Analysis Copilot for Indian companies.
 * 
 * - You DO NOT bypass CAPTCHA or access restricted systems.
 * 
 * Data collection is performed by the backend system using publicly accessible pages.
 * This implementation uses public web search constrained to official domains and returns evidence links.
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * DATA COLLECTION (Handled by Backend – for your understanding)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * The backend scrapes the following OFFICIAL PUBLIC SOURCES:
 * 
 * 1. NCLT (nclt.gov.in)
 *    - Orders and cause list PDFs are downloaded
 *    - Text is extracted from PDFs
 *    - Company name / CIN keyword matching is performed
 * 
 * 2. High Court & Supreme Court portals
 *    - Party name search is submitted
 *    - Case status (pending / disposed) is captured
 * 
 * 3. SEBI (sebi.gov.in)
 *    - Enforcement orders, notices, consent rejections
 *    - PDFs are parsed and keyword matched
 *    - Broker Actions: https://www.sebi.gov.in/sebiweb/broker/BrokerAction.do?doBroke
 *    - Defaulting brokers, suspended entities, regulatory actions
 * 
 * 4. NSE / BSE
 *    - Defaulter / expelled member lists
 *    - HTML tables are parsed
 *    - Company names are normalized and matched
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * INPUT FORMAT YOU WILL RECEIVE
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * You will receive a JSON object like this:
 * 
 * {
 *   "company_name": "ABC PRIVATE LIMITED",
 *   "cin": "U12345DL2019PTC000000",
 *   "checks": [
 *     {
 *       "category": "NCLT",
 *       "match_found": false,
 *       "details": null
 *     },
 *     {
 *       "category": "Litigation (HC & SC)",
 *       "match_found": true,
 *       "details": "Pending matter before Supreme Court"
 *     },
 *     {
 *       "category": "SEBI Orders",
 *       "match_found": false
 *     },
 *     {
 *       "category": "NSE Defaulters",
 *       "match_found": false
 *     },
 *     {
 *       "category": "BSE Defaulters",
 *       "match_found": false
 *     }
 *   ]
 * }
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * YOUR RESPONSIBILITIES
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * 1. DO NOT invent cases or allegations
 * 2. Use ONLY the provided match_found flags
 * 3. If match_found = false → Risk Flag = Clean
 * 4. If match_found = true → Risk Flag = Adverse or Attention
 * 5. Use neutral, regulatory-safe language
 * 6. NEVER say:
 *    - "Company is clean"
 *    - "Company is fraud"
 *    - "Company is blacklisted"
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * OUTPUT FORMAT (MANDATORY)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Generate a structured table:
 * 
 * Category | Risk Flag | Remarks
 * 
 * Examples of remarks:
 * - "No Match Found"
 * - "No adverse public record found"
 * - "Pending litigation reported in public records"
 * - "Regulatory action referenced in official disclosure"
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * LEGAL LANGUAGE RULE
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Always assume results are:
 * - Based on publicly available information
 * - Valid only as of the search date
 * - Not a legal opinion or certification
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * FINAL GOAL
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Produce a bank-ready, compliance-safe adverse record report
 * based strictly on backend-verified scraping results.
 * 
 */

class ComplianceService {
    constructor() {
        this.sources = {
            nclt: 'National Company Law Tribunal (NCLT)',
            highCourt: 'High Courts of India',
            supremeCourt: 'Supreme Court of India',
            sebi: 'Securities and Exchange Board of India (SEBI)',
            nse: 'National Stock Exchange (NSE)',
            bse: 'Bombay Stock Exchange (BSE)',
            sfio: 'Serious Fraud Investigation Office (SFIO)',
            fiu: 'Financial Intelligence Unit (FIU) India'
        };

        this.mcaProvider = new MCAProvider();
        this.ncltService = new NCLTService();
        this.sebiService = new SEBIService();
        this.courtService = new CourtService();
        this.exchangeService = new ExchangeService();
    }

    hasUsableCompanyName(companyName) {
        const name = String(companyName || '').trim();
        return Boolean(name) && name !== 'Company (CIN provided)';
    }

    describeInputUsed(companyName, cin, checkType = 'generic') {
        const hasCin = Boolean(String(cin || '').trim());
        const hasName = this.hasUsableCompanyName(companyName);

        if (checkType === 'nse') {
            return {
                check: 'NSE',
                type: hasName ? 'company_name' : (hasCin ? 'cin' : 'unknown'),
                company_name: hasName ? String(companyName).trim() : null,
                cin: hasCin ? String(cin).trim() : null,
                note: hasName
                    ? 'NSE defaulting dataset is name-based; company name matching applied.'
                    : 'NSE defaulting dataset is name-based; CIN-only mode may be less reliable.'
            };
        }

        const type = hasCin && hasName ? 'cin+company_name' : hasCin ? 'cin' : hasName ? 'company_name' : 'unknown';
        return {
            check: checkType,
            type,
            company_name: hasName ? String(companyName).trim() : null,
            cin: hasCin ? String(cin).trim() : null,
            note: hasCin && hasName
                ? 'Both CIN and company name were used in query construction.'
                : hasCin
                    ? 'CIN was used in query construction.'
                    : hasName
                        ? 'Company name was used in query construction.'
                        : 'No reliable identifier available.'
        };
    }

    /**
     * Main compliance check function
     * Automatically fetches and checks data from all official sources
     */
    async checkCompliance(companyIdentifier) {
        try {
            console.log(`[Compliance] Starting automated check for: ${companyIdentifier}`);

            const companyName = this.extractCompanyName(companyIdentifier);
            const cin = this.extractCIN(companyIdentifier);

            let companyIdentity = {
                cin: cin || null,
                legalName: this.hasUsableCompanyName(companyName) ? String(companyName).trim() : null,
                normalizedName: normalizeName(companyName),
                directors: [],
                addresses: [],
                status: 'Unknown',
                chargesCount: 0,
                source: 'input_fallback'
            };

            if (cin) {
                const mcaIdentity = await this.mcaProvider.resolveIdentityByCIN(cin);
                if (mcaIdentity?.success && mcaIdentity?.identity) {
                    companyIdentity = {
                        ...companyIdentity,
                        ...mcaIdentity.identity,
                        source: mcaIdentity.source || 'mca_adapter'
                    };
                }
            }

            const idResolution = resolveIdentityConfidence({
                inputName: this.hasUsableCompanyName(companyName) ? companyName : companyIdentity.legalName,
                canonicalName: companyIdentity.legalName,
                mcaName: companyIdentity.legalName,
                directorsInput: [],
                directorsMca: companyIdentity.directors,
                addressesInput: [],
                addressesMca: companyIdentity.addresses
            });

            const [ncltEvidence, sebiEvidence, courtEvidence, exchangeEvidence] = await Promise.all([
                this.ncltService.verifyInsolvency(companyIdentity),
                this.sebiService.verifyOrders(companyIdentity),
                this.courtService.verifyCourtRisk(companyIdentity),
                this.exchangeService.verifyExchangeDefaults(companyIdentity)
            ]);

            const evidence = {
                nclt: ncltEvidence,
                sebi: sebiEvidence,
                exchange: exchangeEvidence,
                court: courtEvidence
            };

            const decision = decideComplianceStatus({
                companyIdentity,
                evidence
            });

            const generatedNarrative = await generateNarrative({
                companyIdentity,
                complianceStatus: decision.complianceStatus,
                evidence,
                reasoning: decision.reasoning
            });

            const ncltResult = {
                source: 'NCLT',
                category: 'Insolvency & Corporate Disputes',
                match_found: Boolean(ncltEvidence?.confirmedCase),
                risk_flag: ncltEvidence?.confirmedCase ? 'Adverse' : 'Clean',
                details: ncltEvidence?.details || 'No adverse official record found',
                evidence: ncltEvidence?.evidence || null,
                input_used: ncltEvidence?.input_used || this.describeInputUsed(companyIdentity.legalName, companyIdentity.cin, 'NCLT'),
                checked_at: new Date().toISOString()
            };

            const sebiResult = {
                source: 'SEBI',
                category: 'Securities Regulation',
                match_found: Boolean(sebiEvidence?.confirmedAction),
                risk_flag: sebiEvidence?.confirmedAction ? 'Adverse' : 'Clean',
                details: sebiEvidence?.details || 'No adverse official record found',
                evidence: sebiEvidence?.evidence || null,
                input_used: sebiEvidence?.input_used || this.describeInputUsed(companyIdentity.legalName, companyIdentity.cin, 'SEBI'),
                checked_at: new Date().toISOString()
            };

            const courtResult = {
                source: 'Courts',
                category: 'Litigation',
                match_found: Boolean(courtEvidence?.probableCase),
                risk_flag: courtEvidence?.probableCase ? 'Attention' : 'Clean',
                details: courtEvidence?.details || 'No adverse court record found',
                evidence: courtEvidence?.evidence || null,
                input_used: courtEvidence?.input_used || this.describeInputUsed(companyIdentity.legalName, companyIdentity.cin, 'Court'),
                checked_at: new Date().toISOString()
            };

            const nseResult = {
                source: 'NSE',
                category: 'Stock Exchange',
                match_found: Boolean(exchangeEvidence?.confirmedDefaulter),
                risk_flag: exchangeEvidence?.confirmedDefaulter ? 'Adverse' : 'Clean',
                details: exchangeEvidence?.details || 'No adverse exchange defaulter record found',
                evidence: {
                    engine: 'nse-defaulting-clients-xlsx',
                    query: companyIdentity.legalName || companyIdentity.cin || '',
                    source_url: exchangeEvidence?.evidence?.source_url || NSE_DEFAULTING_CLIENTS_XLSX_URL,
                    fetched_at: exchangeEvidence?.evidence?.fetched_at || null,
                    results: (exchangeEvidence?.matches || []).map((m) => ({
                        title: `${m.clientName} (${m.similarity}%)`,
                        url: exchangeEvidence?.evidence?.source_url || NSE_DEFAULTING_CLIENTS_XLSX_URL
                    }))
                },
                input_used: exchangeEvidence?.input_used || this.describeInputUsed(companyIdentity.legalName, companyIdentity.cin, 'nse'),
                checked_at: new Date().toISOString()
            };

            const bseResult = {
                source: 'BSE',
                category: 'Stock Exchange',
                match_found: false,
                risk_flag: 'Clean',
                details: 'BSE direct defaulter feed adapter not configured; NSE official dataset and supporting evidence used.',
                evidence: { results: [] },
                input_used: this.describeInputUsed(companyIdentity.legalName, companyIdentity.cin, 'BSE'),
                checked_at: new Date().toISOString()
            };

            const findings = [ncltResult, sebiResult, courtResult, nseResult, bseResult];
            const sections = this.buildSectionedFindings({ ncltResult, sebiResult, courtResult, nseResult, bseResult });

            return {
                companyName: companyIdentity.legalName || companyName,
                cin: companyIdentity.cin || cin,
                searchDate: new Date().toISOString(),
                findings: findings,
                sections,
                summary: this.generateSummary(findings),
                companyIdentity,
                identityResolution: idResolution,
                complianceStatus: decision.complianceStatus,
                evidence,
                reasoning: decision.reasoning,
                generatedNarrative,
                disclaimer: 'This report is based on publicly available information as of search date. It does not constitute legal advice or certification.'
            };

        } catch (error) {
            console.error('[Compliance] Error:', error);
            throw new Error('Failed to complete compliance check');
        }
    }

    /**
     * Check NCLT for insolvency proceedings
     */
    async checkNCLT(companyName, cin) {
        try {
            const q = this.buildDomainQuery(['nclt.gov.in'], companyName, cin, ['order', 'petition', 'insolvency', 'ibc']);
            const evidence = await this.searchDuckDuckGo(q);
            const match = evidence.results.length > 0;

            return {
                source: 'NCLT',
                category: 'Insolvency & Corporate Disputes',
                match_found: match,
                risk_flag: match ? 'Attention' : 'Clean',
                details: match
                    ? 'Potential NCLT public references found on official domain (requires manual verification of context)'
                    : 'No public reference found on official NCLT domain (limited to searchable pages)',
                evidence,
                input_used: { ...this.describeInputUsed(companyName, cin, 'NCLT'), query: q },
                checked_at: new Date().toISOString()
            };
        } catch (error) {
            console.error('[NCLT Check] Error:', error);
            return {
                source: 'NCLT',
                category: 'Insolvency & Corporate Disputes',
                match_found: null,
                risk_flag: 'Error',
                details: 'Unable to verify NCLT records',
                evidence: null,
                input_used: this.describeInputUsed(companyName, cin, 'NCLT'),
                checked_at: new Date().toISOString()
            };
        }
    }

    /**
     * Check SEBI for enforcement actions and broker defaults
     */
    async checkSEBI(companyName, cin) {
        try {
            const q = this.buildDomainQuery(['sebi.gov.in'], companyName, cin, ['order', 'enforcement', 'debar', 'penalty', 'notice']);
            const evidence = await this.searchDuckDuckGo(q);
            const match = evidence.results.length > 0;

            return {
                source: 'SEBI',
                category: 'Securities Regulation',
                match_found: match,
                risk_flag: match ? 'Attention' : 'Clean',
                details: match
                    ? 'Potential SEBI public references found on official domain (requires manual verification of applicability)'
                    : 'No public reference found on official SEBI domain (limited to searchable pages)',
                evidence,
                input_used: { ...this.describeInputUsed(companyName, cin, 'SEBI'), query: q },
                checked_at: new Date().toISOString()
            };
        } catch (error) {
            console.error('[SEBI Check] Error:', error);
            return {
                source: 'SEBI',
                category: 'Securities Regulation',
                match_found: null,
                risk_flag: 'Error',
                details: 'Unable to verify SEBI records',
                evidence: null,
                input_used: this.describeInputUsed(companyName, cin, 'SEBI'),
                checked_at: new Date().toISOString()
            };
        }
    }

    /**
     * Check High Courts and Supreme Court
     */
    async checkCourts(companyName, cin) {
        try {
            const q = this.buildDomainQuery(['ecourts.gov.in', 'main.sci.gov.in'], companyName, cin, ['case', 'party', 'vs', 'petition']);
            const evidence = await this.searchDuckDuckGo(q);
            const match = evidence.results.length > 0;

            return {
                source: 'Courts',
                category: 'Litigation',
                match_found: match,
                risk_flag: match ? 'Attention' : 'Clean',
                details: match
                    ? 'Potential court public references found on official court domains (requires manual verification of party match)'
                    : 'No public reference found on official court domains (limited to searchable pages)',
                evidence,
                input_used: { ...this.describeInputUsed(companyName, cin, 'Court'), query: q },
                checked_at: new Date().toISOString()
            };
        } catch (error) {
            console.error('[Courts Check] Error:', error);
            return {
                source: 'Courts',
                category: 'Litigation',
                match_found: null,
                risk_flag: 'Error',
                details: 'Unable to verify court records',
                evidence: null,
                input_used: this.describeInputUsed(companyName, cin, 'Court'),
                checked_at: new Date().toISOString()
            };
        }
    }

    /**
     * Check NSE defaulter lists
     */
    async checkNSE(companyName, cin) {
        try {
            const dataset = await this.getNSEDefaultingClientsDataset();
            const hasName = this.hasUsableCompanyName(companyName);
            const queryValue = hasName ? companyName : String(cin || companyName || '').trim();
            const matches = this.findNSEDefaultingClientMatches(queryValue, dataset.rows, { limit: 5 });
            const match = matches.length > 0;

            return {
                source: 'NSE',
                category: 'Stock Exchange',
                match_found: match,
                risk_flag: match ? 'Adverse' : 'Clean',
                details: match
                    ? 'Name matched in NSE Defaulting Clients Database (official published dataset; manual review of row details recommended)'
                    : 'No match found in NSE Defaulting Clients Database (official published dataset)',
                evidence: {
                    engine: 'nse-defaulting-clients-xlsx',
                    query: String(queryValue || '').trim(),
                    source_url: dataset.source_url,
                    last_modified: dataset.last_modified,
                    fetched_at: dataset.fetched_at,
                    results: matches
                },
                input_used: this.describeInputUsed(companyName, cin, 'nse'),
                checked_at: new Date().toISOString()
            };
        } catch (error) {
            console.error('[NSE Check] Error:', error);
            return {
                source: 'NSE',
                category: 'Stock Exchange',
                match_found: null,
                risk_flag: 'Error',
                details: 'Unable to verify NSE records',
                evidence: null,
                input_used: this.describeInputUsed(companyName, cin, 'nse'),
                checked_at: new Date().toISOString()
            };
        }
    }

    normalizeHeaderLabel(value) {
        return String(value ?? '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    normalizeEntityName(value) {
        const s = String(value ?? '')
            .toLowerCase()
            .replace(/&amp;/g, '&')
            .replace(/[^a-z0-9\s&]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        // Remove common legal suffixes (keep it conservative)
        return s
            .replace(/\b(pvt|private)\b/g, '')
            .replace(/\b(ltd|limited)\b/g, '')
            .replace(/\b(llp)\b/g, '')
            .replace(/\b(co|company|corp|corporation)\b/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    tokenize(value) {
        const norm = this.normalizeEntityName(value);
        if (!norm) return [];
        return norm.split(' ').filter(Boolean);
    }

    async getNSEDefaultingClientsDataset() {
        const cached = complianceDataCache.get(NSE_DEFAULTING_CLIENTS_CACHE_KEY);
        if (cached) return cached;

        const res = await axios.get(NSE_DEFAULTING_CLIENTS_XLSX_URL, {
            responseType: 'arraybuffer',
            timeout: 30000,
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
                Accept:
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                Referer: 'https://www.nseindia.com/'
            }
        });

        const workbook = XLSX.read(res.data, { type: 'buffer' });
        const sheetName = workbook.SheetNames?.[0];
        if (!sheetName) throw new Error('NSE XLSX parse failed (no sheets)');
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) throw new Error('NSE XLSX parse failed (missing first sheet)');

        const table = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
        if (!Array.isArray(table) || table.length === 0) throw new Error('NSE XLSX parse failed (empty sheet)');

        let headerRowIndex = -1;
        for (let i = 0; i < Math.min(10, table.length); i++) {
            const row = table[i];
            if (!Array.isArray(row)) continue;
            const rowText = row.map((c) => this.normalizeHeaderLabel(c)).join(' | ');
            if (rowText.includes('defaulting client') && rowText.includes('pan')) {
                headerRowIndex = i;
                break;
            }
        }
        if (headerRowIndex === -1) headerRowIndex = 0;

        const header = (table[headerRowIndex] || []).map((c) => this.normalizeHeaderLabel(c));
        const findCol = (predicate) => header.findIndex((h) => h && predicate(h));

        const colIndex = {
            clientName: findCol((h) => h.includes('defaulting client')),
            pan: findCol((h) => h === 'pan of client' || (h.includes('pan') && h.includes('client'))),
            tradingMember: findCol((h) => h.includes('trading member')),
            complaintNo: findCol((h) => h.includes('complaint') || h.includes('arbitration')),
            orderDate: findCol((h) => h.includes('date of order') || h.includes('award')),
            awardDetails: findCol((h) => h.includes('award details'))
        };

        const rows = [];
        for (let r = headerRowIndex + 1; r < table.length; r++) {
            const row = table[r];
            if (!Array.isArray(row)) continue;

            const clientName = String(row[colIndex.clientName] ?? '').trim();
            if (!clientName) continue;

            rows.push({
                clientName,
                pan: String(row[colIndex.pan] ?? '').trim(),
                tradingMember: String(row[colIndex.tradingMember] ?? '').trim(),
                complaintNo: String(row[colIndex.complaintNo] ?? '').trim(),
                orderDate: String(row[colIndex.orderDate] ?? '').trim(),
                awardDetails: String(row[colIndex.awardDetails] ?? '').trim()
            });
        }

        const dataset = {
            source_url: NSE_DEFAULTING_CLIENTS_XLSX_URL,
            fetched_at: new Date().toISOString(),
            last_modified: res.headers?.['last-modified'] || null,
            etag: res.headers?.etag || null,
            row_count: rows.length,
            rows
        };

        complianceDataCache.set(NSE_DEFAULTING_CLIENTS_CACHE_KEY, dataset);
        return dataset;
    }

    findNSEDefaultingClientMatches(entityName, rows, { limit = 5 } = {}) {
        const input = String(entityName || '').trim();
        const inputNorm = this.normalizeEntityName(input);
        if (!inputNorm) return [];

        const inputTokens = this.tokenize(inputNorm);
        const results = [];

        for (const row of rows || []) {
            const rowName = String(row?.clientName || '').trim();
            if (!rowName) continue;

            const rowNorm = this.normalizeEntityName(rowName);
            if (!rowNorm) continue;

            let score = 0;
            if (rowNorm === inputNorm) score = 3;
            else if (rowNorm.includes(inputNorm) || inputNorm.includes(rowNorm)) score = 2;
            else {
                const rowTokens = this.tokenize(rowNorm);
                if (inputTokens.length > 0 && rowTokens.length > 0) {
                    const overlap = inputTokens.filter((t) => rowTokens.includes(t)).length;
                    const ratio = overlap / inputTokens.length;
                    if ((inputTokens.length === 1 && overlap === 1) || (overlap >= 2 && ratio >= 0.8)) score = 1;
                }
            }

            if (score > 0) {
                results.push({
                    score,
                    clientName: rowName,
                    pan: row.pan || null,
                    tradingMember: row.tradingMember || null,
                    complaintNo: row.complaintNo || null,
                    orderDate: row.orderDate || null,
                    awardDetails: row.awardDetails || null
                });
            }
        }

        results.sort((a, b) => b.score - a.score);
        return results.slice(0, Math.max(0, limit));
    }

    /**
     * Check BSE defaulter lists
     */
    async checkBSE(companyName, cin) {
        try {
            const q = this.buildDomainQuery(['bseindia.com'], companyName, cin, ['defaulter', 'disciplinary', 'expelled', 'suspended']);
            const evidence = await this.searchDuckDuckGo(q);
            const match = evidence.results.length > 0;

            return {
                source: 'BSE',
                category: 'Stock Exchange',
                match_found: match,
                risk_flag: match ? 'Attention' : 'Clean',
                details: match
                    ? 'Potential BSE public references found on official domain (requires manual verification of context)'
                    : 'No public reference found on official BSE domain (limited to searchable pages)',
                evidence,
                input_used: { ...this.describeInputUsed(companyName, cin, 'BSE'), query: q },
                checked_at: new Date().toISOString()
            };
        } catch (error) {
            console.error('[BSE Check] Error:', error);
            return {
                source: 'BSE',
                category: 'Stock Exchange',
                match_found: null,
                risk_flag: 'Error',
                details: 'Unable to verify BSE records',
                evidence: null,
                input_used: this.describeInputUsed(companyName, cin, 'BSE'),
                checked_at: new Date().toISOString()
            };
        }
    }

    buildDomainQuery(domains, companyName, cin, keywords = []) {
        const dom = (domains || []).filter(Boolean).map((d) => `site:${d}`).join(' OR ');
        const id = (cin || '').trim() ? `"${cin.trim()}"` : '';
        const name = (companyName || '').trim() && companyName !== 'Company (CIN provided)' ? `"${companyName.trim()}"` : '';
        const extra = (keywords || []).filter(Boolean).slice(0, 6).join(' ');
        const who = [id, name].filter(Boolean).join(' OR ');
        return `${dom} ${who || ''} ${extra}`.trim();
    }

    async searchDuckDuckGo(query) {
        const q = String(query || '').trim();
        if (!q) return { query: '', engine: 'duckduckgo', results: [] };

        const url = 'https://duckduckgo.com/html/';
        const res = await axios.get(url, {
            params: { q },
            timeout: 15000,
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
                Accept: 'text/html,application/xhtml+xml'
            }
        });

        const $ = cheerio.load(res.data || '');
        const results = [];

        const decodeDuckUrl = (href) => {
            try {
                const u = new URL(href, 'https://duckduckgo.com');
                const uddg = u.searchParams.get('uddg');
                return uddg ? decodeURIComponent(uddg) : href;
            } catch {
                return href;
            }
        };

        $('a.result__a').each((_, a) => {
            if (results.length >= 3) return;
            const el = $(a);
            const title = (el.text() || '').trim();
            const href = el.attr('href') || '';
            const finalUrl = href ? decodeDuckUrl(href) : '';
            if (!finalUrl) return;
            results.push({ title, url: finalUrl });
        });

        return { query: q, engine: 'duckduckgo', results };
    }

    /**
     * Generate summary of findings
     */
    generateSummary(findings) {
        const adverse = findings.filter(f => f.match_found === true).length;
        const clean = findings.filter(f => f.match_found === false).length;
        const errors = findings.filter(f => f.match_found === null).length;

        return {
            total_checks: findings.length,
            adverse_records: adverse,
            clean_records: clean,
            verification_errors: errors,
            overall_status: adverse > 0 ? 'Adverse Records Found' : 'No Adverse Records Found'
        };
    }

    buildSectionedFindings({ ncltResult, sebiResult, courtResult, nseResult, bseResult }) {
        const sectionFrom = (title, items, sourceUrls) => {
            const arr = (items || []).filter(Boolean);
            const adverse = arr.some((r) => r?.match_found === true);

            const evidenceLinks = arr
                .flatMap((r) => Array.isArray(r?.evidence?.results) ? r.evidence.results : [])
                .map((ev) => ({
                    title: String(ev?.title || 'Evidence').trim(),
                    url: String(ev?.url || '').trim()
                }))
                .filter((ev) => /^https?:\/\//i.test(ev.url));

            const lines = arr.map((r) => {
                const risk = String(r?.risk_flag || '').trim();
                const details = String(r?.details || '').trim();
                const result = r?.match_found === true
                    ? 'Adverse/Attention'
                    : r?.match_found === false
                        ? 'No adverse public record found'
                        : 'Verification error/unknown';
                return [risk ? `Risk: ${risk}` : '', `Result: ${result}`, details ? `Details: ${details}` : '']
                    .filter(Boolean)
                    .join(' • ');
            }).filter(Boolean);

            return {
                title,
                adverse,
                summary: lines.join('\n') || (adverse ? 'Adverse records found' : 'No adverse public record found'),
                evidenceLinks,
                inputUsed: arr.map((r) => r?.input_used).filter(Boolean),
                sourceLinks: (sourceUrls || []).map((u) => ({
                    title: String(u?.title || 'Official Source').trim(),
                    url: String(u?.url || '').trim()
                }))
            };
        };

        return {
            nclt: sectionFrom('NCLT Check', [ncltResult], this.getOfficialLinksForSection('nclt')),
            sebi: sectionFrom('SEBI Check', [sebiResult], this.getOfficialLinksForSection('sebi')),
            court: sectionFrom('Court/Litigation Check', [courtResult], this.getOfficialLinksForSection('court')),
            exchange: sectionFrom('NSE/BSE Exchange Check', [nseResult, bseResult], this.getOfficialLinksForSection('exchange'))
        };
    }

    getOfficialLinksForSection(sectionKey) {
        const key = String(sectionKey || '').toLowerCase();
        const all = this.getOfficialSources();

        const pick = (matcher) => all
            .filter((src) => matcher(String(src?.name || ''), String(src?.url || '')))
            .map((src) => ({ title: src.name, url: src.url }));

        if (key === 'nclt') {
            return pick((name, url) => name.includes('NCLT') || url.includes('nclt.gov.in'));
        }
        if (key === 'sebi') {
            return pick((name, url) => name.includes('SEBI') || url.includes('sebi.gov.in'));
        }
        if (key === 'court') {
            return pick((name, url) => name.includes('eCourts') || name.includes('Supreme Court') || url.includes('ecourts.gov.in') || url.includes('sci.gov.in'));
        }
        if (key === 'exchange') {
            return pick((name, url) => name.includes('NSE') || name.includes('BSE') || url.includes('nseindia.com') || url.includes('bseindia.com'));
        }
        return [];
    }

    /**
     * Get official source links for compliance verification
     */
    getOfficialSources() {
        return [
            {
                name: 'NCLT (National Company Law Tribunal)',
                category: 'Insolvency & Corporate Disputes',
                url: 'https://nclt.gov.in',
                description: 'Check for insolvency proceedings, winding-up petitions, and company law disputes',
                services: ['Cause Lists', 'Orders', 'Case Status']
            },
            {
                name: 'MCA (Ministry of Corporate Affairs)',
                category: 'Company Records & Compliance',
                url: 'https://www.mca.gov.in',
                description: 'Company master data, director information, and compliance status',
                services: ['Company Master Data', 'Director Search', 'Annual Returns']
            },
            {
                name: 'SEBI (Securities and Exchange Board)',
                category: 'Securities Regulation',
                url: 'https://www.sebi.gov.in',
                description: 'Enforcement actions, debarments, and consent orders',
                services: ['Enforcement Orders', 'Debarred Entities', 'Consent Orders']
            },
            {
                name: 'SEBI Broker Actions',
                category: 'Broker Regulatory Actions',
                url: 'https://www.sebi.gov.in/sebiweb/broker/BrokerAction.do?doBroke',
                description: 'Official SEBI database of broker actions, suspensions, and regulatory measures',
                services: ['Defaulting Brokers', 'Suspended Entities', 'Regulatory Actions']
            },
            {
                name: 'NSE (National Stock Exchange)',
                category: 'Stock Exchange Compliance',
                url: 'https://www.nseindia.com',
                description: 'Defaulter lists, surveillance actions, and trading member disciplinary actions',
                services: ['Defaulters List', 'Disciplinary Actions', 'Surveillance']
            },
            {
                name: 'BSE (Bombay Stock Exchange)',
                category: 'Stock Exchange Compliance',
                url: 'https://www.bseindia.com',
                description: 'Member defaults, expelled members, and corporate actions',
                services: ['Defaulting Members', 'Expelled Members', 'Surveillance']
            },
            {
                name: 'eCourts Services',
                category: 'Judicial Records',
                url: 'https://ecourts.gov.in',
                description: 'Case status from High Courts and District Courts across India',
                services: ['Case Status', 'Cause Lists', 'Court Orders']
            },
            {
                name: 'Supreme Court of India',
                category: 'Apex Court Records',
                url: 'https://main.sci.gov.in',
                description: 'Supreme Court case status and judgments',
                services: ['Case Status', 'Daily Orders', 'Judgments']
            },
            {
                name: 'SFIO (Serious Fraud Investigation Office)',
                category: 'Fraud Investigation',
                url: 'https://www.mca.gov.in/MinistryV2/seriousfraudinvestigationoffice.html',
                description: 'Information about serious fraud investigations',
                services: ['Investigation Status', 'Public Notices']
            },
            {
                name: 'FIU-IND (Financial Intelligence Unit)',
                category: 'Financial Intelligence',
                url: 'https://fiuindia.gov.in',
                description: 'Suspicious transaction reports and financial intelligence',
                services: ['Public Advisories', 'Annual Reports']
            },
            {
                name: 'IBBI (Insolvency Board)',
                category: 'Insolvency & Bankruptcy',
                url: 'https://www.ibbi.gov.in',
                description: 'Insolvency professionals, resolution plans, and liquidation',
                services: ['CIRP Status', 'Liquidation Cases', 'IP Search']
            }
        ];
    }

    /**
     * Extract company name from identifier
     */
    extractCompanyName(identifier) {
        if (this.isCIN(identifier)) {
            return 'Company (CIN provided)';
        }
        return identifier;
    }

    /**
     * Extract CIN if present
     */
    extractCIN(identifier) {
        if (this.isCIN(identifier)) {
            return identifier;
        }
        return null;
    }

    /**
     * Check if identifier is a CIN
     */
    isCIN(identifier) {
        const cinPattern = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;
        return cinPattern.test(identifier.toUpperCase());
    }
}

export default new ComplianceService();
