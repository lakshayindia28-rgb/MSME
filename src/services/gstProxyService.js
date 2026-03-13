import axios from 'axios';
import * as cheerio from 'cheerio';
import { logger } from '../utils/logger.js';

/**
 * GST Portal Proxy Service
 * Simple HTTP-based session management - NO browser automation
 * User manually solves captcha, backend just forwards requests
 */
export class GSTProxyService {
  constructor() {
    this.gstPortalBase = 'https://services.gst.gov.in/services';
    this.sessions = new Map(); // Store sessions by ID
  }

  /**
   * Step 1: Fetch captcha from GST portal and maintain session
   * Returns: captcha image (base64), sessionId
   */
  async getCaptcha(gstin) {
    try {
      logger.info(`Fetching captcha for GSTIN: ${gstin}`);

      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      
      // STEP 1: Make initial request to get session cookies
      const pageResponse = await axios.get(`${this.gstPortalBase}/searchtp`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none'
        },
        timeout: 30000
      });

      // Extract cookies from initial page load
      const cookies = pageResponse.headers['set-cookie'] || [];
      const cookieString = cookies.map(c => c.split(';')[0]).join('; ');
      
      logger.info('✓ Initial page loaded, cookies obtained');

      // STEP 2: Fetch captcha image with proper headers (matching real browser)
      const rnd = Math.random(); // Random parameter to prevent caching
      const captchaResponse = await axios.get(`${this.gstPortalBase}/captcha`, {
        params: { rnd },
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
          'Accept': 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'Connection': 'keep-alive',
          'Referer': `${this.gstPortalBase}/searchtp`,
          'Cookie': cookieString,
          'Sec-Fetch-Dest': 'image',
          'Sec-Fetch-Mode': 'no-cors',
          'Sec-Fetch-Site': 'same-origin',
          'Priority': 'u=0, i'
        },
        timeout: 10000
      });

      if (!captchaResponse.data || captchaResponse.data.length === 0) {
        throw new Error('Empty captcha response');
      }

      // Merge cookies from captcha response
      const captchaCookies = captchaResponse.headers['set-cookie'] || [];
      const allCookies = [...cookies, ...captchaCookies];

      const captchaBase64 = Buffer.from(captchaResponse.data).toString('base64');
      logger.info(`✓ Captcha fetched (182×50 PNG image)`);

      // Store session data
      this.sessions.set(sessionId, {
        gstin,
        cookies: allCookies,
        cookieString: allCookies.map(c => c.split(';')[0]).join('; '),
        createdAt: Date.now()
      });

      // Clean up old sessions
      this.cleanupSessions();

      return {
        success: true,
        captcha: `data:image/png;base64,${captchaBase64}`,
        sessionId
      };

    } catch (error) {
      logger.error('Failed to fetch captcha: ' + error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Step 2: Submit GSTIN + captcha to GST portal using stored session
   * Real GST portal flow: POST (taxpayerDetails) → GET (goodservice) → merge both
   * Returns: merged GST data from both endpoints
   */
  async verifyGST(gstin, captchaText, sessionId) {
    try {
      logger.info(`Verifying GSTIN: ${gstin} with captcha`);

      // Retrieve session
      const session = this.sessions.get(sessionId);
      if (!session) {
        throw new Error('Session expired. Please reload captcha.');
      }

      // Verify GSTIN matches
      if (session.gstin !== gstin) {
        throw new Error('GSTIN mismatch with session');
      }

      // STEP 1: POST to taxpayerDetails endpoint (main GST profile data)
      logger.info('Step 1: Sending POST to taxpayerDetails...');
      
      let taxpayerData = null;
      let updatedCookies = session.cookieString;

      try {
        const postResponse = await axios.post(
          `${this.gstPortalBase}/api/search/taxpayerDetails`,
          { gstin, captcha: captchaText },
          {
            headers: {
              'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
              'Accept': 'application/json, text/plain, */*',
              'Accept-Language': 'en-US,en;q=0.5',
              'Accept-Encoding': 'gzip, deflate, br, zstd',
              'Content-Type': 'application/json;charset=utf-8',
              'Origin': this.gstPortalBase,
              'Connection': 'keep-alive',
              'Referer': `${this.gstPortalBase}/searchtp`,
              'Cookie': session.cookieString,
              'Sec-Fetch-Dest': 'empty',
              'Sec-Fetch-Mode': 'cors',
              'Sec-Fetch-Site': 'same-origin',
              'Priority': 'u=0'
            },
            timeout: 15000,
            validateStatus: (status) => status < 500
          }
        );

        logger.debug(`POST response status: ${postResponse.status}`);
        logger.debug(`POST response data type: ${typeof postResponse.data}`);
        logger.debug(`POST response data: ${JSON.stringify(postResponse.data).substring(0, 200)}`);

        // Check if captcha was invalid
        if (postResponse.data && typeof postResponse.data === 'object' && postResponse.data.error) {
          if (postResponse.data.error.toLowerCase().includes('captcha')) {
            return {
              success: false,
              error: 'Invalid captcha. Please try again.',
              invalidCaptcha: true
            };
          }
        }

        if (postResponse.data) {
          taxpayerData = postResponse.data;
          logger.info('✓ Step 1 complete: Got taxpayerDetails');

          // Update cookies from POST response (CaptchaCookie may be cleared)
          if (postResponse.headers['set-cookie']) {
            const newCookies = postResponse.headers['set-cookie'];
            const cookieParts = [...session.cookies];
            
            newCookies.forEach(newCookie => {
              const cookieName = newCookie.split('=')[0];
              const existingIndex = cookieParts.findIndex(c => c.startsWith(cookieName + '='));
              if (existingIndex >= 0) {
                cookieParts[existingIndex] = newCookie.split(';')[0];
              } else {
                cookieParts.push(newCookie.split(';')[0]);
              }
            });

            updatedCookies = cookieParts.join('; ');
            logger.debug('Cookies updated after POST');
          }
        }
      } catch (err) {
        logger.error('POST taxpayerDetails failed: ' + err.message);
        logger.debug('Error details: ' + JSON.stringify({
          message: err.message,
          code: err.code,
          response: err.response ? {
            status: err.response.status,
            data: JSON.stringify(err.response.data).substring(0, 200)
          } : null
        }));
        throw new Error('Failed to fetch taxpayer details from GST portal');
      }

      if (!taxpayerData) {
        throw new Error('No taxpayer data received from GST portal');
      }

      // STEP 2: GET goodservice endpoint (HSN/goods/services data)
      logger.info('Step 2: Sending GET to goodservice...');
      
      let goodServiceData = null;

      try {
        const getResponse = await axios.get(
          `${this.gstPortalBase}/api/search/goodservice`,
          {
            params: { gstin },
            headers: {
              'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
              'Accept': 'application/json, text/plain, */*',
              'Accept-Language': 'en-US,en;q=0.5',
              'Accept-Encoding': 'gzip, deflate, br, zstd',
              'Connection': 'keep-alive',
              'Referer': `${this.gstPortalBase}/searchtp`,
              'Cookie': updatedCookies,
              'Sec-Fetch-Dest': 'empty',
              'Sec-Fetch-Mode': 'cors',
              'Sec-Fetch-Site': 'same-origin',
              'Priority': 'u=4'
            },
            timeout: 15000,
            validateStatus: (status) => status < 500
          }
        );

        if (getResponse.data) {
          goodServiceData = getResponse.data;
          logger.info('✓ Step 2 complete: Got goodservice data');
          if (Array.isArray(getResponse.data)) {
            logger.info(`GoodService response format: array (${getResponse.data.length} rows)`);
          } else {
            logger.info(`GoodService response keys: ${Object.keys(getResponse.data || {}).join(', ')}`);
            if (Array.isArray(getResponse.data.bzgddtls)) {
              logger.info(`bzgddtls count: ${getResponse.data.bzgddtls.length}`);
              logger.info(`bzgddtls sample: ${JSON.stringify(getResponse.data.bzgddtls[0] || {})}`);
            } else {
              logger.debug('GoodService response does not include bzgddtls (using generic extractor)');
            }
          }
        }
      } catch (err) {
        // Non-critical - goodservice data is supplementary
        logger.warn('GET goodservice failed (non-critical): ' + err.message);
      }

      // STEP 3: Merge both responses
      const mergedData = this.mergeGSTResponses(taxpayerData, goodServiceData, gstin);

      // Update session with new cookies (DON'T delete - needed for filing data)
      this.sessions.set(sessionId, {
        gstin,
        cookies: session.cookies,
        cookieString: updatedCookies,
        createdAt: Date.now() // Reset expiry
      });

      logger.info('✓ GST verification complete (2-step flow)');

      return {
        success: true,
        data: mergedData,
        sessionId: sessionId // Return session for filing data
      };

    } catch (error) {
      logger.error('Verification failed: ' + error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Step 3: Get filing years dropdown data
   */
  async getFilingYears(gstin, sessionId) {
    try {
      logger.info(`Fetching filing years for GSTIN: ${gstin}`);

      const session = this.sessions.get(sessionId);
      if (!session) {
        throw new Error('Session expired. Please search GSTIN first.');
      }

      const response = await axios.get(
        `${this.gstPortalBase}/api/dropdownfinyear`,
        {
          params: { gstin },
          headers: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br, zstd',
            'Connection': 'keep-alive',
            'Origin': this.gstPortalBase,
            'Referer': `${this.gstPortalBase}/searchtp`,
            'Cookie': session.cookieString,
            'X-Requested-With': 'XMLHttpRequest',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin'
          },
          timeout: 10000
        }
      );

      if (response.headers['set-cookie']) {
        const mergedCookieString = this.mergeCookieString(session.cookieString, response.headers['set-cookie']);
        this.sessions.set(sessionId, {
          ...session,
          cookieString: mergedCookieString,
          createdAt: Date.now()
        });
      }

      logger.debug(`Filing years response status: ${response.status}`);
      logger.info(`Filing years RAW response: ${JSON.stringify(response.data)}`);

      if (this.isPortalRejectedPayload(response.data)) {
        logger.warn('Filing years request rejected by portal. Refreshing session and retrying once...');

        const refreshed = await this.refreshSearchSession(sessionId);
        if (!refreshed.success) {
          return {
            success: false,
            error: 'GST portal rejected filing years request',
            errorCode: 'GST_PORTAL_REJECTED',
            retryable: true
          };
        }

        const latestSession = this.sessions.get(sessionId);
        const retryResponse = await axios.get(
          `${this.gstPortalBase}/api/dropdownfinyear`,
          {
            params: { gstin },
            headers: {
              'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
              'Accept': 'application/json, text/plain, */*',
              'Accept-Language': 'en-US,en;q=0.5',
              'Accept-Encoding': 'gzip, deflate, br, zstd',
              'Connection': 'keep-alive',
              'Origin': this.gstPortalBase,
              'Referer': `${this.gstPortalBase}/searchtp`,
              'Cookie': latestSession?.cookieString || session.cookieString,
              'X-Requested-With': 'XMLHttpRequest',
              'Sec-Fetch-Dest': 'empty',
              'Sec-Fetch-Mode': 'cors',
              'Sec-Fetch-Site': 'same-origin'
            },
            timeout: 10000
          }
        );

        if (retryResponse.headers['set-cookie']) {
          const mergedCookieString = this.mergeCookieString(
            latestSession?.cookieString || session.cookieString,
            retryResponse.headers['set-cookie']
          );
          this.sessions.set(sessionId, {
            ...(latestSession || session),
            cookieString: mergedCookieString,
            createdAt: Date.now()
          });
        }

        if (retryResponse.data && retryResponse.data.status === 1 && retryResponse.data.data) {
          logger.info('✓ Filing years fetched after session refresh retry');
          return {
            success: true,
            years: retryResponse.data.data
          };
        }

        if (retryResponse.data && Array.isArray(retryResponse.data)) {
          logger.info('✓ Filing years fetched after session refresh retry (array format)');
          return {
            success: true,
            years: retryResponse.data
          };
        }

        if (this.isPortalRejectedPayload(retryResponse.data)) {
          logger.warn('Filing years retry also rejected by portal');
          return {
            success: false,
            error: 'GST portal rejected filing years request',
            errorCode: 'GST_PORTAL_REJECTED',
            retryable: true
          };
        }
      }

      if (response.data && response.data.status === 1 && response.data.data) {
        logger.info('✓ Filing years fetched');
        return {
          success: true,
          years: response.data.data
        };
      }

      // Maybe different format - try direct array
      if (response.data && Array.isArray(response.data)) {
        logger.info('✓ Filing years fetched (array format)');
        return {
          success: true,
          years: response.data
        };
      }

      logger.warn(`Filing years response invalid format. Status: ${response.data?.status}, hasData: ${!!response.data?.data}`);
      return {
        success: false,
        error: 'No filing years data'
      };

    } catch (error) {
      logger.error('Failed to fetch filing years: ' + error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Step 4: Get filing status for a specific year (with session cookies)
   */
  async getFilingStatus(gstin, financialYear, sessionId) {
    try {
      logger.info(`Fetching filing status for GSTIN: ${gstin}, FY: ${financialYear}`);

      // Get session for cookies
      const session = this.sessions.get(sessionId);
      if (!session) {
        throw new Error('Session expired. Please search GSTIN first.');
      }

      logger.info(`Using session cookies for filing status: ${session.cookieString.substring(0, 100)}...`);

      const fy = String(financialYear || '').trim();
      logger.info(`Filing status request payload: ${JSON.stringify({ gstin, fy })}`);

      const response = await axios.post(
        `${this.gstPortalBase}/api/search/taxpayerReturnDetails`,
        {
          gstin,
          fy
        },
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br, zstd',
            'Content-Type': 'application/json;charset=utf-8',
            'Origin': this.gstPortalBase,
            'Connection': 'keep-alive',
            'Referer': `${this.gstPortalBase}/searchtp`,
            'Cookie': session.cookieString,
            'X-Requested-With': 'XMLHttpRequest',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin',
            'Priority': 'u=0'
          },
          timeout: 10000,
          validateStatus: (status) => status < 500
        }
      );

      logger.debug(`Filing response status: ${response.status}`);
      logger.info(`Filing status RAW response: ${JSON.stringify(response.data).substring(0, 500)}`);

      const rawPayload = response.data;
      const filingRows = this.normalizeFilingStatusRows(rawPayload, fy);

      if (filingRows.length > 0) {
        logger.info('✓ Filing status fetched');
        return {
          success: true,
          filingStatus: filingRows
        };
      }

      if (this.isPortalRejectedPayload(rawPayload)) {
        logger.warn('GST portal rejected filing status request. Refreshing session and retrying once...');

        const refreshed = await this.refreshSearchSession(sessionId);
        if (!refreshed.success) {
          return {
            success: false,
            error: 'GST portal rejected filing status request',
            errorCode: 'GST_PORTAL_REJECTED',
            retryable: true
          };
        }

        const latestSession = this.sessions.get(sessionId);
        const retryResponse = await axios.post(
          `${this.gstPortalBase}/api/search/taxpayerReturnDetails`,
          {
            gstin,
            fy
          },
          {
            headers: {
              'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
              'Accept': 'application/json, text/plain, */*',
              'Accept-Language': 'en-US,en;q=0.5',
              'Accept-Encoding': 'gzip, deflate, br, zstd',
              'Content-Type': 'application/json;charset=utf-8',
              'Origin': this.gstPortalBase,
              'Connection': 'keep-alive',
              'Referer': `${this.gstPortalBase}/searchtp`,
              'Cookie': latestSession?.cookieString || session.cookieString,
              'X-Requested-With': 'XMLHttpRequest',
              'Sec-Fetch-Dest': 'empty',
              'Sec-Fetch-Mode': 'cors',
              'Sec-Fetch-Site': 'same-origin',
              'Priority': 'u=0'
            },
            timeout: 10000,
            validateStatus: (status) => status < 500
          }
        );

        const retryPayload = retryResponse.data;
        const retryRows = this.normalizeFilingStatusRows(retryPayload, fy);

        if (retryRows.length > 0) {
          logger.info('✓ Filing status fetched after session refresh retry');
          return {
            success: true,
            filingStatus: retryRows
          };
        }

        if (this.isPortalRejectedPayload(retryPayload)) {
          logger.warn('Filing status retry also rejected by portal');
          return {
            success: false,
            error: 'GST portal rejected filing status request',
            errorCode: 'GST_PORTAL_REJECTED',
            retryable: true
          };
        }
      }

      logger.warn('No filing status in response');
      return {
        success: false,
        error: 'No filing status data',
        errorCode: 'NO_FILING_DATA',
        raw: typeof rawPayload === 'string' ? rawPayload.substring(0, 300) : undefined
      };

    } catch (error) {
      logger.error('Failed to fetch filing status: ' + error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Merge taxpayerDetails + goodservice responses
   * Actual GST portal response structure
   */
  mergeGSTResponses(taxpayerData, goodServiceData, gstin) {
    const merged = {
      gstin: taxpayerData.gstin || gstin,
      legalName: taxpayerData.lgnm || 'N/A',
      tradeName: taxpayerData.tradeNam || taxpayerData.lgnm || 'N/A',
      status: taxpayerData.sts || 'Active',
      registrationDate: taxpayerData.rgdt || 'N/A',
      constitutionOfBusiness: taxpayerData.ctb || 'N/A',
      taxpayerType: taxpayerData.dty || 'Regular',
      stateJurisdiction: taxpayerData.stj || 'N/A',
      centerJurisdiction: taxpayerData.ctj || 'N/A',
      principalAddress: taxpayerData.pradr?.adr || 'N/A',
      natureOfBusinessActivities: taxpayerData.nba || [],
      natureOfBusinessDetails: this.normalizeBusinessDetails(taxpayerData.nba),
      natureOfBusinessRaw: taxpayerData.nba ?? null,
      aadhaarValidation: taxpayerData.adhrVFlag || 'N/A',
      aadhaarValidationDate: taxpayerData.adhrVdt || 'N/A',
      eInvoiceStatus: taxpayerData.einvoiceStatus || 'N/A',
      fieldVisitConducted: taxpayerData.isFieldVisitConducted || 'N/A',
      cancellationDate: taxpayerData.cxdt || null,
      _source: 'GST Portal (2-step flow)',
      _timestamp: new Date().toISOString()
    };

    const goodsAndServices = this.extractGoodsAndServicesRows(goodServiceData);

    // Add goodservice data if available (supports multiple response formats)
    if (goodsAndServices.length > 0) {
      merged.goodsAndServices = goodsAndServices;
      merged._goodServiceIncluded = true;
    } else {
      merged.goodsAndServices = [];
      merged._goodServiceIncluded = false;
    }

    return merged;
  }

  safeParseJSON(value) {
    if (typeof value !== 'string') return value;
    const raw = value.trim();
    if (!raw) return value;
    if (!(raw.startsWith('{') || raw.startsWith('['))) return value;
    try {
      return JSON.parse(raw);
    } catch {
      return value;
    }
  }

  toArray(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value === 'object') return Object.values(value);
    return [];
  }

  normalizeGoodsServiceType(value) {
    const v = String(value || '').trim().toLowerCase();
    if (!v) return 'goods';
    if (v.includes('service') || v === 's') return 'services';
    if (v.includes('good') || v === 'g') return 'goods';
    return 'goods';
  }

  normalizeBusinessDetails(rawValue) {
    const raw = this.safeParseJSON(rawValue);
    if (!raw) return [];

    const details = [];

    const pushDetail = (label, value = '') => {
      const cleanLabel = String(label || '').trim();
      const cleanValue = String(value || '').trim();
      if (!cleanLabel && !cleanValue) return;
      details.push({
        label: cleanLabel || 'Detail',
        value: cleanValue
      });
    };

    const toDetailText = (value) => {
      if (value == null) return '';
      if (typeof value === 'string') return value.trim();
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      if (Array.isArray(value)) {
        return value
          .map((item) => {
            if (item == null) return '';
            if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') return String(item);
            return JSON.stringify(item);
          })
          .filter(Boolean)
          .join(', ');
      }
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    };

    const normalizeLabel = (key) => String(key || '')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .trim();

    if (Array.isArray(raw)) {
      const hasComplexRow = raw.some((item) => item && typeof item === 'object' && !Array.isArray(item));
      if (!hasComplexRow) {
        return [];
      }

      raw.forEach((item, idx) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return;
        }

        const title = String(
          item.activity ?? item.name ?? item.nature ?? item.description ?? item.desc ?? item.label ?? ''
        ).trim();

        const otherFields = Object.entries(item)
          .filter(([key, value]) => {
            if (!value && value !== 0) return false;
            return !['activity', 'name', 'nature', 'description', 'desc', 'label'].includes(String(key));
          })
          .map(([key, value]) => `${normalizeLabel(key)}: ${toDetailText(value)}`)
          .filter(Boolean)
          .join(' | ');

        pushDetail(title || `Activity ${idx + 1}`, otherFields);
      });

      return details;
    }

    if (typeof raw === 'object') {
      Object.entries(raw).forEach(([key, value]) => {
        const text = toDetailText(value);
        if (!text) return;
        pushDetail(normalizeLabel(key), text);
      });
      return details;
    }

    return [];
  }

  isPortalRejectedPayload(payload) {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload || {});
    return /request\s+rejected/i.test(text);
  }

  mergeCookieString(existingCookieString, setCookieHeaders = []) {
    const cookieMap = new Map();

    String(existingCookieString || '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((pair) => {
        const [name, ...rest] = pair.split('=');
        if (!name || rest.length === 0) return;
        cookieMap.set(name.trim(), rest.join('=').trim());
      });

    (Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders])
      .filter(Boolean)
      .forEach((cookieLine) => {
        const firstPart = String(cookieLine).split(';')[0].trim();
        const [name, ...rest] = firstPart.split('=');
        if (!name || rest.length === 0) return;
        cookieMap.set(name.trim(), rest.join('=').trim());
      });

    return Array.from(cookieMap.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  async refreshSearchSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { success: false, error: 'Session expired' };
    }

    try {
      const response = await axios.get(`${this.gstPortalBase}/searchtp`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Referer': `${this.gstPortalBase}/searchtp`,
          'Cookie': session.cookieString,
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'same-origin'
        },
        timeout: 15000
      });

      const setCookie = response.headers['set-cookie'] || [];
      const mergedCookieString = this.mergeCookieString(session.cookieString, setCookie);

      this.sessions.set(sessionId, {
        ...session,
        cookieString: mergedCookieString,
        createdAt: Date.now()
      });

      return { success: true };
    } catch (error) {
      logger.warn('Failed to refresh GST portal search session: ' + error.message);
      return { success: false, error: error.message };
    }
  }

  extractGoodsAndServicesRows(rawPayload) {
    const payload = this.safeParseJSON(rawPayload);
    const candidateLists = [];

    if (Array.isArray(payload)) {
      candidateLists.push(payload);
    } else if (payload && typeof payload === 'object') {
      candidateLists.push(
        payload.bzgddtls,
        payload.data?.bzgddtls,
        payload.result?.bzgddtls,
        payload.goodsAndServices,
        payload.data?.goodsAndServices,
        payload.hsnDetails,
        payload.data?.hsnDetails,
        payload
      );
    }

    const flattened = candidateLists
      .flatMap((list) => this.toArray(this.safeParseJSON(list)))
      .filter((item) => item && typeof item === 'object');

    const out = [];
    const seen = new Set();

    for (const item of flattened) {
      const hsnCode = String(
        item.hsncd ?? item.hsn ?? item.hsnCode ?? item.hsnsac ?? item.sac ?? item.code ?? ''
      ).trim();
      const description = String(
        item.gdes ?? item.desc ?? item.description ?? item.descr ?? item.name ?? ''
      ).trim();
      const kind = this.normalizeGoodsServiceType(
        item.type ?? item.itemType ?? item.gstType ?? item.goodsOrServices ?? item.gs
      );

      if (!hsnCode && !description) continue;

      const key = `${kind}|${hsnCode}|${description}`;
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({ hsnCode, description, kind });
    }

    return out;
  }

  normalizeReturnType(rawType, fallbackKey = '') {
    const source = String(rawType || fallbackKey || '').trim();
    if (!source) return '';

    const compact = source.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!compact) return '';
    if (compact === 'GSTR3B') return 'GSTR3B';
    if (compact === 'GSTR1' || compact === 'GSTR1IFF' || compact === 'IFF') return 'GSTR1';
    return source;
  }

  normalizeFilingStatusRows(rawPayload, financialYear = '') {
    let payload = this.safeParseJSON(rawPayload);
    if (payload && typeof payload === 'object' && payload.filingStatus != null) {
      payload = this.safeParseJSON(payload.filingStatus);
    }

    const rows = [];
    const pushRow = (entry, fallbackReturnType = '') => {
      if (!entry || typeof entry !== 'object') return;

      const rtntype = this.normalizeReturnType(
        entry.rtntype ?? entry.returnType ?? entry.rtnType,
        fallbackReturnType
      );
      const taxp = String(entry.taxp ?? entry.taxPeriod ?? entry.period ?? entry.ret_prd ?? entry.month ?? '').trim();
      const dof = String(entry.dof ?? entry.filingDate ?? entry.dateOfFiling ?? entry.filedOn ?? '').trim();
      const mof = String(entry.mof ?? entry.modeOfFiling ?? entry.mode ?? '').trim();
      const status = String(entry.status ?? entry.filedStatus ?? entry.sts ?? '').trim();
      const fy = String(entry.fy ?? entry.financialYear ?? entry.year ?? financialYear ?? '').trim();

      if (!rtntype && !taxp && !dof && !status) return;

      rows.push({ rtntype, taxp, dof, mof, status, fy });
    };

    if (Array.isArray(payload)) {
      payload.flat(Infinity).forEach((entry) => pushRow(entry));
      return rows;
    }

    if (payload && typeof payload === 'object') {
      for (const [key, value] of Object.entries(payload)) {
        if (Array.isArray(value)) {
          value.forEach((entry) => pushRow(entry, key));
          continue;
        }
        if (value && typeof value === 'object') {
          pushRow(value, key);
        }
      }
      return rows;
    }

    return rows;
  }

  /**
   * Parse JSON response from GST portal
   */
  parseJSONResponse(data, gstin) {
    return {
      gstin: data.gstin || gstin,
      legalName: data.lgnm || data.legalName || 'N/A',
      tradeName: data.tradeNam || data.tradeName || 'N/A',
      status: data.sts || data.status || 'Active',
      effectiveDate: data.rgdt || data.registrationDate || 'N/A',
      constitutionOfBusiness: data.ctb || data.constitution || 'N/A',
      taxpayerType: data.dty || data.taxpayerType || 'Regular',
      stateJurisdiction: data.stj || 'N/A',
      centerJurisdiction: data.ctj || 'N/A',
      lastUpdated: data.lstupdt || new Date().toISOString(),
      _source: 'GST Portal API',
      _timestamp: new Date().toISOString()
    };
  }

  /**
   * Parse HTML response from GST portal
   */
  parseHTMLResponse(html, gstin) {
    const $ = cheerio.load(html);
    const data = { gstin, _source: 'GST Portal HTML' };

    // Extract data from tables
    $('table tr').each((i, row) => {
      const cells = $(row).find('td');
      if (cells.length >= 2) {
        const key = $(cells[0]).text().trim();
        const value = $(cells[1]).text().trim();

        if (key.includes('Legal Name')) data.legalName = value;
        else if (key.includes('Trade Name')) data.tradeName = value;
        else if (key.includes('Status')) data.status = value;
        else if (key.includes('Registration') || key.includes('Effective Date')) data.effectiveDate = value;
        else if (key.includes('Constitution')) data.constitutionOfBusiness = value;
        else if (key.includes('Taxpayer Type')) data.taxpayerType = value;
        else if (key.includes('State Jurisdiction')) data.stateJurisdiction = value;
        else if (key.includes('Center Jurisdiction')) data.centerJurisdiction = value;
      }
    });

    // Set defaults
    data.legalName = data.legalName || 'N/A';
    data.tradeName = data.tradeName || data.legalName;
    data.status = data.status || 'Active';
    data.effectiveDate = data.effectiveDate || 'N/A';
    data.constitutionOfBusiness = data.constitutionOfBusiness || 'N/A';
    data.taxpayerType = data.taxpayerType || 'Regular';
    data._timestamp = new Date().toISOString();

    return data;
  }

  /**
   * Clean up expired sessions (older than 5 minutes)
   */
  cleanupSessions() {
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 minutes

    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.createdAt > maxAge) {
        this.sessions.delete(sessionId);
        logger.debug(`Cleaned up expired session: ${sessionId}`);
      }
    }
  }

  /**
   * Refresh captcha (get new one for same GSTIN)
   */
  async refreshCaptcha(gstin, oldSessionId) {
    // Delete old session
    if (oldSessionId) {
      this.sessions.delete(oldSessionId);
    }
    
    // Get new captcha
    return await this.getCaptcha(gstin);
  }
}
