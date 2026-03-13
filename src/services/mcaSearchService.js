import axios from 'axios';
import { logger } from '../utils/logger.js';
import * as cheerio from 'cheerio';
import searchService from './searchService.js';

/**
 * MCA Official Search Service
 * Uses existing working search service to find companies
 * Rate-limited and legally compliant
 */
class MCASearchService {
  constructor() {
    // Rate limiting
    this.lastRequestTime = 0;
    this.minRequestInterval = 1000; // 1 second between requests
    
    // Cache for 10 minutes
    this.cache = new Map();
    this.cacheTimeout = 10 * 60 * 1000;
  }

  /**
   * Rate limiter
   */
  async rateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.minRequestInterval) {
      const waitTime = this.minRequestInterval - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.lastRequestTime = Date.now();
  }

  /**
   * Search companies using existing searchService
   * @param {string} companyName - Company name to search
   * @returns {Promise<Array>} List of companies with Name, CIN, State, Status
   */
  async searchCompanies(companyName) {
    try {
      // Check cache first
      const cacheKey = companyName.toLowerCase().trim();
      const cached = this.cache.get(cacheKey);
      
      if (cached && (Date.now() - cached.timestamp < this.cacheTimeout)) {
        logger.info(`MCA search cache hit for: ${companyName}`);
        return cached.data;
      }

      // Rate limit
      await this.rateLimit();

      logger.info(`Searching companies for: ${companyName}`);

      // Use existing working searchService
      const searchResult = await searchService.searchCompanies(companyName);
      
      if (!searchResult.success || !searchResult.results || searchResult.results.length === 0) {
        logger.warn(`Search returned no results for: ${companyName}`);
        return [];
      }

      // Transform results to match our format
      const companies = [];
      
      for (const result of searchResult.results) {
        // CIN is already in result.cin
        const cin = result.cin || '';
        const name = result.name || '';
        
        // Skip if no valid CIN or name
        if (!cin || !name || cin.length < 21) {
          continue;
        }
        
        companies.push({
          name: name,
          cin: cin,
          state: this.extractStateFromCIN(cin),
          status: 'Active',
          registrationDate: ''
        });
      }

      // Cache the results
      if (companies.length > 0) {
        this.cache.set(cacheKey, {
          data: companies,
          timestamp: Date.now()
        });
      }

      logger.info(`Search found ${companies.length} companies for: ${companyName}`);
      return companies;

    } catch (error) {
      logger.error(`Search error for ${companyName}: ${error.message}`);
      return [];
    }
  }

  /**
   * Extract state code from CIN
   */
  extractStateFromCIN(cin) {
    const stateMap = {
      'MH': 'Maharashtra',
      'DL': 'Delhi',
      'KA': 'Karnataka',
      'TN': 'Tamil Nadu',
      'GJ': 'Gujarat',
      'RJ': 'Rajasthan',
      'UP': 'Uttar Pradesh',
      'WB': 'West Bengal',
      'TG': 'Telangana',
      'AP': 'Andhra Pradesh',
      'HR': 'Haryana',
      'PB': 'Punjab',
      'BR': 'Bihar',
      'OR': 'Odisha',
      'KL': 'Kerala',
      'AS': 'Assam',
      'JH': 'Jharkhand',
      'CG': 'Chhattisgarh',
      'UK': 'Uttarakhand',
      'HP': 'Himachal Pradesh',
      'MP': 'Madhya Pradesh'
    };

    // CIN format: U12345XX2020PTC123456
    // State code is at position 5-6 (0-indexed)
    if (cin && cin.length >= 7) {
      const stateCode = cin.substring(5, 7);
      return stateMap[stateCode] || stateCode;
    }

    return 'N/A';
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
    logger.info('MCA search cache cleared');
  }
}

export default new MCASearchService();
