import axios from 'axios';
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer';
import NodeCache from 'node-cache';
import retry from 'retry';
import { config } from '../config/config.js';
import { logger } from '../utils/logger.js';
import { ThirdPartyGSTAPI } from './thirdPartyAPI.js';

/**
 * Production-grade GST Fetcher with multiple fallback methods
 */
export class GSTFetcher {
  constructor() {
    this.baseUrl = config.gstPortal.baseUrl;
    this.timeout = config.gstPortal.timeout;
    this.maxRetries = config.gstPortal.maxRetries;
    
    // Cache for 1 hour
    this.cache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });
    
    // Third-party API fallback
    this.thirdPartyAPI = new ThirdPartyGSTAPI();
    
    // Session management
    this.sessionHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Origin': 'https://services.gst.gov.in',
      'Referer': 'https://services.gst.gov.in/services/searchtpbypan',
      'Connection': 'keep-alive',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin'
    };
  }

  /**
   * Main method - tries multiple approaches to fetch GST data
   */
  async fetchGSTDetails(gstin) {
    // Check cache first
    const cached = this.cache.get(gstin);
    if (cached) {
      logger.info('Returning cached data for GSTIN: ' + gstin);
      return cached;
    }

    logger.info(`Fetching GST details for: ${gstin}`);

    // Fast mode - skip real APIs and use demo data directly
    if (config.performance.fastMode && config.performance.useDemoData) {
      logger.info('Fast mode enabled - using demo data');
      const data = this.thirdPartyAPI.getSampleData(gstin);
      this.cache.set(gstin, data);
      return data;
    }

    try {
      // Method 1: Try official API endpoint (quick attempt)
      const data = await this.fetchViaAPI(gstin);
      if (data && data.gstin) {
        this.cache.set(gstin, data);
        return data;
      }
    } catch (error) {
      logger.warn('API method failed: ' + error.message);
    }

    // Skip web scraping if configured (it's very slow)
    if (!config.performance.skipWebScraping) {
      try {
        // Method 2: Try web scraping with Puppeteer
        const data = await this.fetchViaPuppeteer(gstin);
        if (data && data.gstin) {
          this.cache.set(gstin, data);
          return data;
        }
      } catch (error) {
        logger.error('Puppeteer method failed: ' + error.message);
      }
    }

    // Method 3: Try third-party APIs or return demo data
    try {
      const data = await this.thirdPartyAPI.fetchFromThirdParty(gstin);
      if (data && data.gstin) {
        this.cache.set(gstin, data);
        return data;
      }
    } catch (error) {
      logger.error('Third-party API method failed: ' + error.message);
    }

    throw new Error('Unable to fetch GST details. All methods failed.');
  }

  /**
   * Method 1: Official GST Portal API
   */
  async fetchViaAPI(gstin) {
    const operation = retry.operation({
      retries: this.maxRetries,
      factor: 1.5,
      minTimeout: 500,
      maxTimeout: 2000
    });

    return new Promise((resolve, reject) => {
      operation.attempt(async (currentAttempt) => {
        try {
          logger.info(`API attempt ${currentAttempt}/${this.maxRetries + 1}`);

          // Try multiple API endpoints
          const endpoints = [
            `${this.baseUrl}/services/api/search/taxpayerDetails?gstin=${gstin}`,
            `${this.baseUrl}/services/api/get/taxpayerdetails?gstin=${gstin}`,
            `https://commonapi.gst.gov.in/commonapi/v1.0/search?action=TP&gstin=${gstin}`
          ];

          for (const endpoint of endpoints) {
            try {
              const response = await axios.get(endpoint, {
                headers: this.sessionHeaders,
                timeout: this.timeout,
                validateStatus: (status) => status < 500
              });

              if (response.data && (response.data.stjCd === 'Active' || response.data.sts)) {
                logger.info('Successfully fetched data via API');
                return resolve(this.parseAPIResponse(response.data));
              }
            } catch (endpointError) {
              logger.debug(`Endpoint failed: ${endpoint}`);
              continue;
            }
          }

          throw new Error('All API endpoints failed');

        } catch (error) {
          if (operation.retry(error)) {
            return;
          }
          reject(operation.mainError());
        }
      });
    });
  }

  /**
   * Method 2: Web scraping using Puppeteer (for captcha handling)
   */
  async fetchViaPuppeteer(gstin) {
    logger.info('Launching browser for web scraping...');
    
    const browser = await puppeteer.launch({
      headless: false, // Show browser for captcha solving
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1920,1080'
      ]
    });

    try {
      const page = await browser.newPage();
      
      // Set viewport and user agent
      await page.setViewport({ width: 1920, height: 1080 });
      await page.setUserAgent(this.sessionHeaders['User-Agent']);

      // Navigate to ACTUAL GST search page
      const searchUrl = 'https://services.gst.gov.in/services/searchtp';
      logger.info('Navigating to GST portal...');
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 30000 });

      await this.sleep(2000);

      // Wait for GSTIN input field
      await page.waitForSelector('input#gs1', { timeout: 10000 });

      // Enter GSTIN
      logger.info('Entering GSTIN...');
      await page.type('input#gs1', gstin, { delay: 100 });
      
      await this.sleep(1000);

      // Wait for captcha image to load
      await page.waitForSelector('img[alt="captcha"]', { timeout: 5000 });
      
      logger.info('⚠️ CAPTCHA DETECTED - Please solve captcha manually in the browser window');
      logger.info('Waiting 60 seconds for manual captcha entry...');
      
      // Wait for user to enter captcha and click search
      // The search button is usually clicked after captcha entry
      await this.sleep(60000); // Wait 60 seconds for manual captcha solving

      // Try to detect if data has loaded
      try {
        await page.waitForSelector('.GST_data, table, .card', { timeout: 10000 });
        logger.info('Data page loaded, extracting information...');
        
        await this.sleep(2000);

        // Extract ALL data from the page
        const extractedData = await page.evaluate((gstinNum) => {
          const getText = (selector) => {
            const element = document.querySelector(selector);
            return element ? element.textContent.trim() : '';
          };

          const getAllText = (selector) => {
            const elements = document.querySelectorAll(selector);
            return Array.from(elements).map(el => el.textContent.trim());
          };

          // Try to find data in tables
          const tables = document.querySelectorAll('table');
          const tableData = {};
          
          tables.forEach(table => {
            const rows = table.querySelectorAll('tr');
            rows.forEach(row => {
              const cells = row.querySelectorAll('td');
              if (cells.length >= 2) {
                const key = cells[0].textContent.trim();
                const value = cells[1].textContent.trim();
                if (key && value) {
                  tableData[key] = value;
                }
              }
            });
          });

          return {
            gstin: gstinNum,
            legalName: tableData['Legal Name of Business'] || 
                      tableData['Legal Name'] ||
                      getText('.legal-name'),
            tradeName: tableData['Trade Name'] || getText('.trade-name'),
            status: tableData['GSTIN / UIN Status'] || 
                   tableData['Status'] || 
                   getText('.status'),
            registrationDate: tableData['Effective Date of registration'] ||
                            tableData['Date of Registration'] ||
                            tableData['Registration Date'],
            constitutionOfBusiness: tableData['Constitution of Business'] || '',
            taxpayerType: tableData['Taxpayer Type'] || '',
            principalPlace: tableData['Principal Place of Business'] || '',
            aadhaarAuth: tableData['Whether Aadhaar Authenticated?'] || '',
            eKYC: tableData['Whether e-KYC Verified?'] || '',
            coreActivity: tableData['Nature Of Core Business Activity'] || '',
            tableData: tableData,
            fullHtml: document.body.innerHTML
          };
        }, gstin);

        logger.info('Data extracted successfully via web scraping');
        
        // Parse the extracted data
        return this.parseExtractedData(extractedData);

      } catch (error) {
        logger.error('Failed to extract data after captcha: ' + error.message);
        throw new Error('Could not find data on page. Captcha may not have been solved correctly.');
      }

    } finally {
      await this.sleep(3000); // Keep browser open briefly to see results
      await browser.close();
    }
  }

  /**
   * Parse extracted data from actual GST portal
   */
  parseExtractedData(extracted) {
    const tableData = extracted.tableData || {};
    
    return {
      gstin: extracted.gstin,
      legalName: extracted.legalName || 'N/A',
      tradeName: extracted.tradeName || extracted.legalName || 'N/A',
      registrationDate: extracted.registrationDate || 'N/A',
      effectiveDate: extracted.registrationDate || 'N/A',
      constitutionOfBusiness: extracted.constitutionOfBusiness || 'N/A',
      taxpayerType: extracted.taxpayerType || 'Regular',
      status: extracted.status || 'Active',
      address: {
        fullAddress: extracted.principalPlace || 'Address not available'
      },
      aadhaarAuthenticated: extracted.aadhaarAuth || 'N/A',
      eKYCVerified: extracted.eKYC || 'N/A',
      coreBusinessActivity: extracted.coreActivity || 'N/A',
      businessActivities: this.extractActivities(tableData),
      hsnCodes: this.extractHSNCodes(extracted.fullHtml),
      jurisdictionCenter: this.extractJurisdiction(tableData, 'center'),
      jurisdictionState: this.extractJurisdiction(tableData, 'state'),
      _source: 'Real GST Portal (Web Scraping)',
      _rawData: tableData
    };
  }

  /**
   * Extract business activities from table data
   */
  extractActivities(tableData) {
    const activities = tableData['Nature of Business Activities'];
    if (!activities) return [];
    
    return activities.split(/\d+\./).filter(a => a.trim()).map(a => a.trim());
  }

  /**
   * Extract HSN codes from HTML
   */
  extractHSNCodes(html) {
    const hsnPattern = /(\d{4,8})\s*([A-Z\s]+)/g;
    const matches = [...html.matchAll(hsnPattern)];
    
    return matches.slice(0, 5).map(match => ({
      code: match[1],
      description: match[2].trim()
    }));
  }

  /**
   * Extract jurisdiction details
   */
  extractJurisdiction(tableData, type) {
    if (type === 'center') {
      return {
        state: tableData['State - CBIC'] || 'CBIC',
        zone: tableData['Zone'] || 'N/A',
        commissionerate: tableData['Commissionerate'] || 'N/A',
        division: tableData['Division'] || 'N/A',
        range: tableData['Range'] || 'N/A'
      };
    } else {
      return {
        state: tableData['State'] || 'N/A',
        headquarter: tableData['Headquarter'] || 'N/A',
        ward: tableData['Ward'] || 'N/A'
      };
    }
  }

  /**
   * Parse API response
   */
  parseAPIResponse(response) {
    return {
      gstin: response.gstin || '',
      legalName: response.lgnm || response.tradeNam || '',
      tradeName: response.tradeNam || response.tradeName || '',
      registrationDate: response.rgdt || response.registrationDate || '',
      constitutionOfBusiness: response.ctb || response.constitutionOfBusiness || '',
      taxpayerType: response.dty || response.taxpayerType || '',
      status: response.sts || response.stjCd || response.status || '',
      lastUpdated: response.lstupdt || response.lastUpdated || '',
      stateJurisdiction: response.stj || '',
      centralJurisdiction: response.ctj || '',
      address: {
        buildingName: response.pradr?.bno || response.address?.buildingName || '',
        buildingNumber: response.pradr?.bnm || response.address?.buildingNumber || '',
        floor: response.pradr?.flno || response.address?.floor || '',
        street: response.pradr?.st || response.address?.street || '',
        location: response.pradr?.loc || response.address?.location || '',
        district: response.pradr?.dst || response.address?.district || '',
        state: response.pradr?.stcd || response.address?.state || '',
        pincode: response.pradr?.pncd || response.address?.pincode || '',
        fullAddress: this.buildFullAddress(response.pradr || response.address || {})
      },
      businessActivities: response.nba || response.natureOfBusinessActivities || [],
      filingStatus: response.filingStatus || [],
      dateOfCancellation: response.cxdt || '',
      rawData: response
    };
  }

  /**
   * Parse web page HTML
   */
  parseWebPage($, gstin) {
    const extractText = (selectors) => {
      for (const selector of selectors) {
        const text = $(selector).text().trim();
        if (text) return text;
      }
      return '';
    };

    return {
      gstin: gstin,
      legalName: extractText(['[data-label="Legal Name"]', '.legal-name', 'td:contains("Legal Name") + td']),
      tradeName: extractText(['[data-label="Trade Name"]', '.trade-name']),
      status: extractText(['[data-label="Status"]', '.status']),
      registrationDate: extractText(['[data-label="Date of Registration"]']),
      constitutionOfBusiness: extractText(['[data-label="Constitution"]']),
      taxpayerType: extractText(['[data-label="Taxpayer Type"]']),
      address: {
        fullAddress: extractText(['[data-label="Address"]', '.address'])
      },
      businessActivities: [],
      filingStatus: []
    };
  }

  /**
   * Build full address string
   */
  buildFullAddress(addr) {
    const parts = [
      addr.bnm || addr.buildingName,
      addr.bno || addr.buildingNumber,
      addr.flno || addr.floor,
      addr.st || addr.street,
      addr.loc || addr.location,
      addr.dst || addr.district,
      addr.stcd || addr.state,
      addr.pncd || addr.pincode
    ].filter(Boolean);
    
    return parts.join(', ');
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.flushAll();
    logger.info('Cache cleared');
  }
}
