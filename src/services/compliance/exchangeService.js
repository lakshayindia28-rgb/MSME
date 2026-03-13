import axios from 'axios';
import XLSX from 'xlsx';
import NodeCache from 'node-cache';
import { tokenSortRatio, normalizeName } from '../../core/entityResolver.js';

const cache = new NodeCache({ stdTTL: 60 * 60 * 12, checkperiod: 60 * 10, useClones: false });
const NSE_DEFAULTING_CLIENTS_XLSX_URL =
  'https://nsearchives.nseindia.com/web/sites/default/files/inline-files/Defaulting_Client_Database%202_1_1%20%281%29%20%281%29.xlsx';
const CACHE_KEY = 'nse:defaulting-clients:v2';

class ExchangeService {
  async getNSEDataset() {
    const cached = cache.get(CACHE_KEY);
    if (cached) return cached;

    const res = await axios.get(NSE_DEFAULTING_CLIENTS_XLSX_URL, {
      responseType: 'arraybuffer',
      timeout: 30000,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Referer: 'https://www.nseindia.com/'
      }
    });

    const workbook = XLSX.read(res.data, { type: 'buffer' });
    const sheetName = workbook.SheetNames?.[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

    const mapped = rows.map((r) => {
      const values = Object.values(r || {}).map((x) => String(x || '').trim());
      return {
        clientName: values[0] || '',
        pan: values[1] || '',
        tradingMember: values[2] || '',
        complaintNo: values[3] || '',
        orderDate: values[4] || '',
        awardDetails: values[5] || ''
      };
    }).filter((x) => x.clientName);

    const dataset = {
      source_url: NSE_DEFAULTING_CLIENTS_XLSX_URL,
      fetched_at: new Date().toISOString(),
      row_count: mapped.length,
      rows: mapped
    };

    cache.set(CACHE_KEY, dataset);
    return dataset;
  }

  matchDefaultingEntity(entityName, rows, minSimilarity = 92) {
    const normalized = normalizeName(entityName);
    if (!normalized) return [];

    return (rows || [])
      .map((row) => {
        const sim = tokenSortRatio(normalized, normalizeName(row.clientName));
        return { ...row, similarity: sim };
      })
      .filter((x) => x.similarity >= minSimilarity)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 10);
  }

  async verifyExchangeDefaults(identity) {
    const name = identity?.legalName || identity?.normalizedName || '';
    const dataset = await this.getNSEDataset();
    const matches = this.matchDefaultingEntity(name, dataset.rows, 92);

    return {
      source: 'official_record',
      sourceName: 'NSE Defaulting Client Dataset',
      confirmedDefaulter: matches.length > 0,
      confidence: matches.length ? Math.max(...matches.map((x) => x.similarity)) : 0,
      matches,
      evidence: {
        source_url: dataset.source_url,
        fetched_at: dataset.fetched_at
      },
      input_used: {
        type: 'company_name',
        company_name: String(name || '').trim(),
        cin: identity?.cin || null,
        note: 'Official NSE dataset matching with threshold > 92%.'
      }
    };
  }
}

export default ExchangeService;
