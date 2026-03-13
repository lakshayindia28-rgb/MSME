import axios from 'axios';
import * as cheerio from 'cheerio';

class WebEvidenceService {
  buildDomainQuery(domains, companyName, cin, keywords = []) {
    const dom = (domains || []).filter(Boolean).map((d) => `site:${d}`).join(' OR ');
    const id = String(cin || '').trim() ? `"${String(cin).trim()}"` : '';
    const name = String(companyName || '').trim() ? `"${String(companyName).trim()}"` : '';
    const extra = (keywords || []).filter(Boolean).slice(0, 8).join(' ');
    return `${dom} ${[id, name].filter(Boolean).join(' OR ')} ${extra}`.trim();
  }

  async searchDuckDuckGo(query) {
    const q = String(query || '').trim();
    if (!q) return { query: '', engine: 'duckduckgo', results: [] };

    const res = await axios.get('https://duckduckgo.com/html/', {
      params: { q },
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0',
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
      if (results.length >= 5) return;
      const el = $(a);
      const title = (el.text() || '').trim();
      const href = decodeDuckUrl(el.attr('href') || '');
      if (!href) return;
      results.push({ title, url: href });
    });

    return { query: q, engine: 'duckduckgo', results };
  }
}

export default WebEvidenceService;
