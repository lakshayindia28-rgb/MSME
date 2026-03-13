import { GSTValidator } from '../utils/validator.js';
import { GSTFetcher } from '../services/gstFetcher.js';
import { DataFormatter } from '../services/dataFormatter.js';
import { logger } from '../utils/logger.js';
import PQueue from 'p-queue';

/**
 * Main GST Module - Production-grade orchestrator
 * International standard with rate limiting, caching, and error handling
 */
export class GSTModule {
  constructor() {
    this.fetcher = new GSTFetcher();
    // Queue to prevent rate limiting (max 2 concurrent requests)
    this.queue = new PQueue({ concurrency: 2, interval: 1000, intervalCap: 1 });
  }

  /**
   * Main method to fetch and display GST record - Production grade
   * @param {string} gstin - GST number
   * @param {Object} options - { format: 'console' | 'json', showRaw: boolean }
   * @returns {Promise<Object>} - Result with success status and data/error
   */
  async getGSTRecord(gstin, options = { format: 'console', showRaw: false }) {
    const startTime = Date.now();
    
    try {
      // Step 1: Validate GSTIN
      logger.info('Validating GSTIN: ' + gstin);
      const validation = GSTValidator.validate(gstin);
      
      if (!validation.valid) {
        logger.error('GSTIN validation failed: ' + validation.error);
        return {
          success: false,
          error: validation.error,
          errorCode: 'INVALID_GSTIN'
        };
      }

      logger.info('GSTIN validated successfully');

      // Step 2: Fetch data from GST portal (with queue management)
      logger.info('Fetching data from GST Portal...');
      const gstData = await this.queue.add(() => 
        this.fetcher.fetchGSTDetails(validation.gstin)
      );
      
      if (!gstData || !gstData.gstin) {
        throw new Error('No data received from GST portal');
      }

      logger.info('Data fetched successfully');

      // Step 3: Format and display data
      const formattedData = options.format === 'json' 
        ? DataFormatter.formatAsJSON(gstData)
        : DataFormatter.formatForConsole(gstData);

      const executionTime = Date.now() - startTime;
      logger.info(`Request completed in ${executionTime}ms`);

      return {
        success: true,
        data: options.showRaw ? gstData : undefined,
        formatted: formattedData,
        metadata: {
          gstin: validation.gstin,
          fetchedAt: new Date().toISOString(),
          executionTime: `${executionTime}ms`,
          source: 'GST Portal - Government of India'
        }
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      logger.error('Failed to fetch GST record', {
        error: error.message,
        stack: error.stack,
        gstin: gstin,
        executionTime: `${executionTime}ms`
      });

      return {
        success: false,
        error: error.message,
        errorCode: 'FETCH_FAILED',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        metadata: {
          gstin: gstin,
          executionTime: `${executionTime}ms`
        }
      };
    }
  }

  /**
   * Batch processing - fetch multiple GST records with progress tracking
   */
  async getMultipleGSTRecords(gstins, options = {}) {
    logger.info(`Starting batch processing for ${gstins.length} GSTINs`);
    const results = [];
    let successCount = 0;
    let failureCount = 0;
    
    for (let i = 0; i < gstins.length; i++) {
      const gstin = gstins[i];
      logger.info(`Processing ${i + 1}/${gstins.length}: ${gstin}`);
      
      const result = await this.getGSTRecord(gstin, options);
      results.push({ gstin, ...result });
      
      if (result.success) {
        successCount++;
      } else {
        failureCount++;
      }
      
      // Progress indicator
      const progress = ((i + 1) / gstins.length * 100).toFixed(1);
      logger.info(`Progress: ${progress}% (${successCount} success, ${failureCount} failed)`);
    }
    
    logger.info(`Batch processing completed: ${successCount} success, ${failureCount} failed`);
    
    return {
      summary: {
        total: gstins.length,
        success: successCount,
        failed: failureCount,
        successRate: `${(successCount / gstins.length * 100).toFixed(1)}%`
      },
      results
    };
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.fetcher.clearCache();
    logger.info('Cache cleared successfully');
  }

  /**
   * Get queue status
   */
  getQueueStatus() {
    return {
      size: this.queue.size,
      pending: this.queue.pending,
      isPaused: this.queue.isPaused
    };
  }

  /**
   * Utility: Sleep function
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
