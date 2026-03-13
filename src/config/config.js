import dotenv from 'dotenv';
dotenv.config();

export const config = {
  gstPortal: {
    baseUrl: process.env.GST_PORTAL_BASE_URL || 'https://services.gst.gov.in',
    searchUrl: '/services/api/search/taxpayerDetails',
    timeout: parseInt(process.env.REQUEST_TIMEOUT) || 5000,
    maxRetries: parseInt(process.env.MAX_RETRIES) || 1
  },
  output: {
    format: process.env.OUTPUT_FORMAT || 'console'
  },
  performance: {
    skipWebScraping: process.env.SKIP_WEB_SCRAPING === 'true',
    useDemoData: process.env.USE_DEMO_DATA === 'true',
    fastMode: process.env.FAST_MODE === 'true'
  }
};
