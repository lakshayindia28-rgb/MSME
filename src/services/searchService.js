import axios from 'axios';
import * as cheerio from 'cheerio';
import { logger } from '../utils/logger.js';

class SearchService {
  constructor() {
    this.googleSearchUrl = 'https://www.google.com/search';
    this.cache = new Map(); // Cache search results
    this.proxy = process.env.SCRAPE_PROXY ? this._parseProxy(process.env.SCRAPE_PROXY) : null;
  }

  _parseProxy(str) {
    try {
      // Format: IP:PORT:USER:PASS
      const parts = str.split(':');
      if (parts.length >= 2) {
        const p = { host: parts[0], port: Number(parts[1]), protocol: 'http' };
        if (parts.length >= 4) { p.auth = { username: parts[2], password: parts.slice(3).join(':') }; }
        return p;
      }
    } catch {}
    return null;
  }

  /**
   * Search companies using Google search to find company results
   */
  async searchCompanies(query) {
    try {
      logger.info(`Searching companies for query: ${query}`);

      if (!query || query.trim().length < 2) {
        return {
          success: true,
          results: []
        };
      }

      const searchTerm = query.trim();
      
      // Check cache first
      const cacheKey = searchTerm.toUpperCase();
      if (this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey);
        logger.info(`Returning ${cached.length} cached results`);
        return {
          success: true,
          results: cached
        };
      }

      // If user typed a valid CIN pattern, return it directly
      const cinPattern = /^[UL]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/i;
      if (cinPattern.test(searchTerm)) {
        const cin = searchTerm.toUpperCase();
        logger.info(`Direct CIN search: ${cin}`);
        return {
          success: true,
          results: [{
            name: `Search for CIN: ${cin}`,
            cin: cin,
            url: `/api/fetch-mca?cin=${cin}`
          }]
        };
      }

      // Use Google to search for company data
      const googleQuery = `site:zaubacorp.com/company "${searchTerm}"`;
      
      const axiosOpts = {
        params: {
          q: googleQuery,
          num: 10,
          hl: 'en'
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1'
        },
        timeout: 10000
      };
      if (this.proxy) axiosOpts.proxy = this.proxy;

      const response = await axios.get(this.googleSearchUrl, axiosOpts);

      const results = this.parseGoogleResults(response.data, searchTerm);
      
      // Cache results for 10 minutes
      if (results.length > 0) {
        this.cache.set(cacheKey, results);
        setTimeout(() => this.cache.delete(cacheKey), 10 * 60 * 1000);
      }
      
      logger.info(`Found ${results.length} search results via Google`);
      
      return {
        success: true,
        results: results.slice(0, 10)
      };

    } catch (error) {
      logger.error(`Search failed: ${error.message}`);
      
      // Return empty results instead of error
      return {
        success: true,
        results: []
      };
    }
  }

  /**
   * Parse Google search results to extract company links
   */
  parseGoogleResults(html, query) {
    const results = [];
    
    try {
      const $ = cheerio.load(html);
      
      // Find all links in Google search results
      $('a').each((i, elem) => {
        const href = $(elem).attr('href');
        
        if (!href) return;
        
        // Extract company URLs from Google results
        let companyUrl = null;
        
        // Google wraps URLs in /url?q=... format
        if (href.includes('/url?q=')) {
          const urlMatch = href.match(/\/url\?q=(https?:\/\/[^&]+)/);
          if (urlMatch) {
            companyUrl = decodeURIComponent(urlMatch[1]);
          }
        } else if (href.includes('zaubacorp.com/company/')) {
          companyUrl = href;
        }
        
        if (companyUrl && companyUrl.includes('zaubacorp.com/company/')) {
          // Extract CIN from URL
          const cinMatch = companyUrl.match(/\/company\/([UL]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})/);
          
          if (cinMatch && cinMatch[1]) {
            const cin = cinMatch[1];
            
            // Get company name from the link text or parent element
            let companyName = $(elem).text().trim();
            
            // If link text is empty, try parent or sibling elements
            if (!companyName || companyName.length < 3) {
              companyName = $(elem).parent().text().trim();
            }
            
            // Clean company name - remove all website references
            companyName = companyName
              .replace(/[UL]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}/g, '')
              .replace(/\s*-\s*(ZaubaCorp|zaubacorp).*/gi, '')
              .replace(/\s+/g, ' ')
              .trim();
            
            // If still no name, extract from CIN area
            if (!companyName || companyName.length < 3) {
              companyName = `Company ${cin}`;
            }
            
            // Add if not duplicate - use internal API endpoint instead of external URL
            if (!results.some(r => r.cin === cin)) {
              results.push({
                name: companyName,
                cin: cin,
                url: `/api/fetch-mca?cin=${cin}`
              });
            }
          }
        }
      });

      // Also try parsing structured data
      $('div[data-snf]').each((i, elem) => {
        const $elem = $(elem);
        const text = $elem.text();
        
        const cinMatch = text.match(/([UL]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})/);
        if (cinMatch) {
          const cin = cinMatch[1];
          const companyName = text
            .replace(cin, '')
            .replace(/\s*-\s*(ZaubaCorp|zaubacorp).*/gi, '')
            .trim();
          
          if (companyName && !results.some(r => r.cin === cin)) {
            results.push({
              name: companyName,
              cin: cin,
              url: `/api/fetch-mca?cin=${cin}`
            });
          }
        }
      });
      
    } catch (parseError) {
      logger.warn(`Parse error: ${parseError.message}`);
    }

    return results;
  }
}

export default new SearchService();
