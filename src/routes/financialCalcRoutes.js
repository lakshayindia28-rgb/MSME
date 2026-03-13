/**
 * Financial Calculation API Routes
 * =================================
 * POST /api/financial-calc/calculate   — run calculation engine
 * GET  /api/financial-calc/schema      — get input field schema
 * POST /api/financial-calc/report      — get MSME report section
 */

import { Router } from 'express';
import { calculateFinancials, getInputSchema } from '../financial-engine/index.js';
import { mapFinancialsToReport } from '../financial-engine/reportMapper.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * GET /schema
 * Returns the full input field schema for the dashboard to render forms.
 */
router.get('/schema', (req, res) => {
  try {
    const schema = getInputSchema();
    return res.json({ success: true, data: schema });
  } catch (error) {
    logger.error('Financial calc schema error:', error);
    return res.status(500).json({ success: false, error: 'Failed to get schema' });
  }
});

/**
 * POST /calculate
 * Takes financial input data, runs the calculation engine, returns full output.
 *
 * Body: {
 *   company_name?: string,
 *   gstin?: string,
 *   case_id?: string,
 *   years: [ { period_ends_on, net_sales, ... }, ... ]
 * }
 */
router.post('/calculate', (req, res) => {
  try {
    const start = performance.now();
    const result = calculateFinancials(req.body);
    const elapsed = Math.round(performance.now() - start);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        errors: result.errors,
      });
    }

    logger.info(`Financial calculation completed in ${elapsed}ms for ${result.data?.meta?.company_name || 'unknown'}`);

    return res.json({
      success: true,
      data: result.data,
      warnings: result.warnings || [],
      performance_ms: elapsed,
    });
  } catch (error) {
    logger.error('Financial calc engine error:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Financial calculation failed',
    });
  }
});

/**
 * POST /report
 * Takes financial input, calculates, and returns MSME report section.
 * Combines calculate + mapFinancialsToReport in one call.
 */
router.post('/report', (req, res) => {
  try {
    const start = performance.now();
    const result = calculateFinancials(req.body);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        errors: result.errors,
      });
    }

    const reportSection = mapFinancialsToReport(result.data);
    const elapsed = Math.round(performance.now() - start);

    logger.info(`Financial report section generated in ${elapsed}ms`);

    return res.json({
      success: true,
      data: reportSection,
      warnings: result.warnings || [],
      performance_ms: elapsed,
    });
  } catch (error) {
    logger.error('Financial report mapper error:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Financial report generation failed',
    });
  }
});

export default router;
