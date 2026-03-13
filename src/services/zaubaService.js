import axios from 'axios';
import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import { logger } from '../utils/logger.js';

class ZaubaService {
  constructor() {
    this.baseUrl = 'https://www.zaubacorp.com';
    this.proxyRaw = process.env.SCRAPE_PROXY || null; // IP:PORT:USER:PASS
    this.proxy = this.proxyRaw ? this._parseProxy(this.proxyRaw) : null;
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
   * Fetch page HTML using Puppeteer (bypasses Cloudflare challenge)
   */
  async _fetchWithBrowser(url) {
    const args = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled'
    ];
    if (this.proxyRaw) {
      const parts = this.proxyRaw.split(':');
      args.push(`--proxy-server=http://${parts[0]}:${parts[1]}`);
    }

    const browser = await puppeteer.launch({
      headless: 'new',
      executablePath: process.env.CHROME_PATH || '/snap/bin/chromium',
      args
    });

    try {
      const page = await browser.newPage();

      // Authenticate with proxy if credentials exist
      if (this.proxy && this.proxy.auth) {
        await page.authenticate({ username: this.proxy.auth.username, password: this.proxy.auth.password });
      }

      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Wait a bit for any Cloudflare challenge to resolve
      await page.waitForSelector('body', { timeout: 10000 });

      const html = await page.content();
      return html;
    } finally {
      await browser.close();
    }
  }

  /**
   * Fetch company data from ZaubaCorp by CIN
   */
  async fetchCompanyData(cin) {
    try {
      logger.info(`Fetching MCA data for CIN: ${cin}`);

      // Validate CIN format (basic validation)
      if (!cin || cin.length < 21) {
        throw new Error('Invalid CIN format. CIN should be at least 21 characters.');
      }

      // Search for company by CIN
      const searchUrl = `${this.baseUrl}/company/${cin}`;

      let html;
      try {
        // Try Puppeteer first (bypasses Cloudflare)
        html = await this._fetchWithBrowser(searchUrl);
      } catch (browserErr) {
        logger.warn(`Puppeteer fetch failed, falling back to axios: ${browserErr.message}`);
        // Fallback to axios
        const axiosOpts = {
          headers: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
            'Accept': 'text/html',
          },
          timeout: 20000,
          maxRedirects: 5
        };
        if (this.proxy) axiosOpts.proxy = this.proxy;
        const response = await axios.get(searchUrl, axiosOpts);
        if (response.status !== 200) {
          throw new Error(`Failed to fetch data. Status: ${response.status}`);
        }
        html = response.data;
      }

      // Parse HTML response
      const companyData = this.parseCompanyHTML(html, cin);
      
      logger.info(`✓ MCA data fetched successfully for: ${companyData.companyName}`);
      
      return {
        success: true,
        data: companyData
      };

    } catch (error) {
      logger.error(`MCA fetch failed: ${error.message}`);
      
      if (error.message.includes('Invalid CIN')) {
        return {
          success: false,
          error: 'Invalid CIN format'
        };
      } else if (error.response && error.response.status === 404) {
        return {
          success: false,
          error: 'Company not found with this CIN'
        };
      } else if (error.code === 'ECONNABORTED') {
        return {
          success: false,
          error: 'Request timeout. Please try again.'
        };
      } else {
        return {
          success: false,
          error: 'Server busy. Please try again later.'
        };
      }
    }
  }

  /**
   * Parse company data from ZaubaCorp HTML
   */
  parseCompanyHTML(html, cin) {
    const $ = cheerio.load(html);
    
    const companyData = {
      cin: cin,
      companyName: 'N/A',
      summary: 'N/A',
      status: 'N/A',
      roc: 'N/A',
      category: 'N/A',
      subCategory: 'N/A',
      companyClass: 'N/A',
      authorizedCapital: 'N/A',
      paidUpCapital: 'N/A',
      dateOfIncorporation: 'N/A',
      registeredAddress: 'N/A',
      email: 'N/A',
      registrationNumber: 'N/A',
      age: 'N/A',
      listedOnStockExchange: 'N/A',
      activity: 'N/A',
      numberOfMembers: 'N/A',
      lastAGMDate: 'N/A',
      lastBalanceSheetDate: 'N/A',
      website: 'N/A',
      totalAssets: 'N/A',
      revenue: 'N/A',
      profit: 'N/A',
      salaries: 'N/A',
      directors: [],
      _source: 'ZaubaCorp',
      _timestamp: new Date().toISOString()
    };

    const directors = [];

    try {
      // Extract company name from h1
      const h1Text = $('h1').first().text().trim();
      if (h1Text && h1Text.length > 0) {
        companyData.companyName = h1Text;
      }

      // Extract company summary from about paragraph
      const summaryParagraph = $('p#about').text().trim();
      if (summaryParagraph && summaryParagraph.length > 0) {
        companyData.summary = summaryParagraph;
      }

      // Extract data from "Basic Information" table
      $('h3:contains("Basic Information")').parent().find('.table-responsive table tr').each((i, row) => {
        const cells = $(row).find('td');
        if (cells.length >= 2) {
          const label = $(cells[0]).text().trim();
          const valueCell = $(cells[1]);
          
          // Check if value is locked (premium content)
          const isLocked = valueCell.find('i.lock').length > 0;
          const value = isLocked ? 'Premium Data' : valueCell.text().trim();

          if (label === 'CIN') {
            companyData.cin = value || cin;
          } else if (label === 'Name') {
            companyData.companyName = value;
          } else if (label === 'Listed on Stock Exchange') {
            companyData.listedOnStockExchange = value;
          } else if (label === 'Company Status') {
            companyData.status = value;
          } else if (label === 'ROC') {
            companyData.roc = value;
          } else if (label === 'Registration Number') {
            companyData.registrationNumber = value;
          } else if (label === 'Company Category') {
            companyData.category = value;
          } else if (label === 'Company Sub Category') {
            companyData.subCategory = value;
          } else if (label === 'Class of Company') {
            companyData.companyClass = value;
          } else if (label === 'Date of Incorporation') {
            companyData.dateOfIncorporation = value;
          } else if (label === 'Age of Company') {
            companyData.age = value;
          } else if (label === 'Activity') {
            companyData.activity = value;
          } else if (label === 'Number of Members') {
            companyData.numberOfMembers = value;
          }
        }
      });

      // Extract Annual Compliance Status
      $('h3:contains("Annual Compliance Status")').parent().find('.table-responsive table tr').each((i, row) => {
        const cells = $(row).find('td');
        if (cells.length >= 2) {
          const label = $(cells[0]).text().trim();
          const valueCell = $(cells[1]);
          
          // Check if value is locked (premium content)
          const isLocked = valueCell.find('i.lock').length > 0;
          const value = isLocked ? 'Premium Data' : valueCell.text().trim();

          if (label === 'Date of Last Annual General Meeting') {
            companyData.lastAGMDate = value;
          } else if (label === 'Date of Last Filed Balance Sheet') {
            companyData.lastBalanceSheetDate = value;
          }
        }
      });

      // Extract capital data from "Key Numbers" table
      $('h3:contains("Key Numbers")').parent().find('.table-responsive table tr').each((i, row) => {
        const cells = $(row).find('td');
        if (cells.length >= 2) {
          const label = $(cells[0]).text().trim();
          const valueCell = $(cells[1]);
          
          // Check if value is locked (premium content)
          const isLocked = valueCell.find('i.lock').length > 0;
          const value = isLocked ? 'Premium Data' : valueCell.text().trim();

          if (label === 'Authorised Share Capital') {
            companyData.authorizedCapital = value;
          } else if (label === 'Paid-up Share Capital') {
            companyData.paidUpCapital = value;
          } else if (label === 'Total Assets') {
            companyData.totalAssets = value;
          } else if (label === 'Revenue') {
            companyData.revenue = value;
          } else if (label === 'Profit') {
            companyData.profit = value;
          } else if (label === 'Salaries & Other Employee Benefit Expenses') {
            companyData.salaries = value;
          }
        }
      });

      // Extract contact details - Updated to handle span elements
      const contactSection = $('#contact-details').parent();
      
      // Extract email
      contactSection.find('span').each((i, elem) => {
        const text = $(elem).text();
        if (text.includes('Email ID:')) {
          const emailMatch = text.match(/Email ID:\s*(.+)/);
          if (emailMatch) {
            let email = emailMatch[1].trim();
            // Handle [email protected] format
            email = email.replace(/\[email\s*protected\]/g, '').trim();
            if (email && email.length > 0 && !email.includes('protected')) {
              companyData.email = email;
            }
          }
        }
        
        if (text.includes('Website:')) {
          const websiteMatch = text.match(/Website:\s*(.+)/);
          if (websiteMatch && !websiteMatch[1].includes('Not Available')) {
            companyData.website = websiteMatch[1].trim();
          }
        }
        
        if (text.includes('Address:')) {
          const addressMatch = text.match(/Address:\s*(.+)/s);
          if (addressMatch) {
            companyData.registeredAddress = addressMatch[1].trim();
          }
        }
      });

      // Fallback: Try extracting from contact details text if spans didn't work
      if (companyData.email === 'N/A' || companyData.registeredAddress === 'N/A') {
        contactSection.find('div.col-md-6').first().find('span').each((i, elem) => {
          const text = $(elem).text();
          
          if (text.includes('Email ID:') && companyData.email === 'N/A') {
            const parts = text.split('Email ID:');
            if (parts.length > 1) {
              companyData.email = parts[1].trim().split(/\s/)[0];
            }
          }
          
          if (text.includes('Website:') && companyData.website === 'N/A') {
            const parts = text.split('Website:');
            if (parts.length > 1 && !parts[1].includes('Not Available')) {
              companyData.website = parts[1].trim().split(/\s/)[0];
            }
          }
          
          if (text.includes('Address:') && companyData.registeredAddress === 'N/A') {
            // Get next sibling span for address
            const nextSpan = $(elem).next('span');
            if (nextSpan.length > 0) {
              companyData.registeredAddress = nextSpan.text().trim();
            }
          }
        });
      }

      // Extract directors from "Directors & Key Managerial Personnel" table
      // Look for the table with caption containing "Current Directors"
      $('table').each((tableIndex, table) => {
        const caption = $(table).find('caption').text();
        
        // Only process current directors table
        if (caption.includes('Current Directors')) {
          $(table).find('tbody tr').each((i, row) => {
            const cells = $(row).find('td');
            if (cells.length >= 3) {
              const din = $(cells[0]).text().trim();
              const name = $(cells[1]).text().trim();
              const designation = $(cells[2]).text().trim();
              const appointedOn = cells.length >= 4 ? $(cells[3]).text().trim() : 'N/A';
              
              // Skip header rows and empty rows
              if (name && name.length > 2 && !name.toLowerCase().includes('director name') && din !== 'DIN') {
                directors.push({
                  din: din || 'N/A',
                  name: name,
                  designation: designation || 'Director',
                  appointedOn: appointedOn
                });
              }
            }
          });
        }
      });

      companyData.directors = directors;

    } catch (parseError) {
      logger.warn(`HTML parsing warning: ${parseError.message}`);
    }

    return companyData;
  }

  /**
   * Fetch director details by DIN from ZaubaCorp
   */
  async fetchDirectorData(din) {
    try {
      logger.info(`Fetching director data for DIN: ${din}`);

      // Validate DIN format
      if (!din || din.length !== 8) {
        throw new Error('Invalid DIN format. DIN should be 8 characters.');
      }

      const directorUrl = `${this.baseUrl}/director/${din}`;
      
      const response = await axios.get(directorUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1'
        },
        timeout: 15000,
        validateStatus: (status) => status < 500
      });

      if (response.status !== 200) {
        throw new Error(`Failed to fetch director data. Status: ${response.status}`);
      }

      const directorData = this.parseDirectorHTML(response.data, din);
      
      logger.info(`✓ Director data fetched successfully for DIN: ${din}`);
      
      return {
        success: true,
        data: directorData
      };

    } catch (error) {
      logger.error(`Error fetching director data: ${error.message}`);
      throw error;
    }
  }

  /**
   * Parse director HTML page
   */
  parseDirectorHTML(html, din) {
    const $ = cheerio.load(html);
    const directorData = {
      din: din,
      name: '',
      companies: [],
      pastCompanies: [],
      personalInfo: {},
      about: ''
    };

    try {
      // Extract director name from h1
      const h1Text = $('h1').first().text().trim();
      directorData.name = h1Text || `Director ${din}`;

      // Extract "About" text from the information div
      const aboutText = $('.container .information p').first().text().trim();
      if (aboutText) {
        directorData.about = aboutText;
      }

      // Find all tables with class 'table table-striped'
      const tables = $('.table.table-striped');
      
      // First table: Current Companies
      const currentCompaniesTable = tables.eq(0);
      if (currentCompaniesTable.length) {
        currentCompaniesTable.find('tbody tr').each((idx, row) => {
          const cells = $(row).find('td');
          if (cells.length >= 3) {
            const companyLink = $(cells[0]).find('a');
            const companyName = companyLink.text().trim();
            const companyUrl = companyLink.attr('href') || '';
            
            // Extract CIN from URL (e.g., /COMPANY-NAME-U12345XX2020PTC123456)
            const cinMatch = companyUrl.match(/([UL]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})/);
            const cin = cinMatch ? cinMatch[1] : '';
            
            const designation = $(cells[1]).find('h5').text().trim();
            const dateOfAppointment = $(cells[2]).find('h5').text().trim();
            
            if (companyName) {
              directorData.companies.push({
                name: companyName,
                cin: cin,
                designation: designation || 'Director',
                dateOfAppointment: dateOfAppointment || 'N/A'
              });
            }
          }
        });
      }

      // Second table: Past Companies (if exists)
      const pastCompaniesTable = tables.eq(1);
      if (pastCompaniesTable.length) {
        pastCompaniesTable.find('tbody tr').each((idx, row) => {
          const cells = $(row).find('td');
          if (cells.length >= 4) {
            const companyLink = $(cells[0]).find('a');
            const companyName = companyLink.text().trim();
            const companyUrl = companyLink.attr('href') || '';
            
            // Extract CIN from URL
            const cinMatch = companyUrl.match(/([UL]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6})/);
            const cin = cinMatch ? cinMatch[1] : '';
            
            const designation = $(cells[1]).find('h5').text().trim();
            const dateOfAppointment = $(cells[2]).find('h5').text().trim();
            const dateOfCessation = $(cells[3]).find('h5').text().trim();
            
            if (companyName) {
              directorData.pastCompanies.push({
                name: companyName,
                cin: cin,
                designation: designation || 'Director',
                dateOfAppointment: dateOfAppointment || 'N/A',
                dateOfCessation: dateOfCessation || 'N/A'
              });
            }
          }
        });
      }

      // Extract any additional personal info from description
      if (aboutText) {
        // Extract number of companies from about text
        const companiesMatch = aboutText.match(/associated with (\d+) compan/i);
        if (companiesMatch) {
          directorData.personalInfo['Total Companies'] = companiesMatch[1];
        }
      }

    } catch (parseError) {
      logger.warn(`Director HTML parsing warning: ${parseError.message}`);
    }

    return directorData;
  }
}

export default new ZaubaService();
