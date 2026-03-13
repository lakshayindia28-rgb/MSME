/**
 * Financial Engine — Validation Layer
 * ====================================
 * Guards against impossible values, NaN, Infinity, and extremely large numbers.
 * Used both for input sanitisation and output verification.
 */

import { MAX_SAFE_VALUE, MIN_SAFE_VALUE } from './constants.js';

/**
 * Safe division — returns 0 on division by zero / NaN / Infinity.
 * This mirrors Excel IFERROR(x/y, 0)
 */
export function safeDivide(numerator, denominator) {
  if (!denominator || !Number.isFinite(denominator) || denominator === 0) return 0;
  const result = numerator / denominator;
  if (!Number.isFinite(result)) return 0;
  return result;
}

/**
 * Clamp a number to safe bounds.
 */
export function clamp(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  if (value > MAX_SAFE_VALUE) return MAX_SAFE_VALUE;
  if (value < MIN_SAFE_VALUE) return MIN_SAFE_VALUE;
  return value;
}

/**
 * Round to N decimal places (default 2).
 */
export function round(value, decimals = 2) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Sanitise a numeric input value. Accepts number or string.
 * Returns 0 for null/undefined/NaN/Infinity.
 */
export function sanitiseNumber(raw) {
  if (raw === null || raw === undefined || raw === '') return 0;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0;
  return clamp(n);
}

/**
 * Validate entire input object — returns { valid, errors, sanitised }.
 */
export function validateInput(inputData) {
  const errors = [];
  const sanitised = {};

  if (!inputData || typeof inputData !== 'object') {
    return { valid: false, errors: ['Input must be a non-null object'], sanitised: {} };
  }

  const years = inputData.years;
  if (!Array.isArray(years) || years.length === 0) {
    return { valid: false, errors: ['Input must contain a "years" array with at least one year of data'], sanitised: {} };
  }

  sanitised.years = [];

  for (let i = 0; i < years.length; i++) {
    const yearData = years[i];
    if (!yearData || typeof yearData !== 'object') {
      errors.push(`years[${i}] must be a non-null object`);
      continue;
    }

    const sanitisedYear = {
      period_ends_on: String(yearData.period_ends_on || '').trim() || `Year ${i + 1}`,
      result_type: String(yearData.result_type || 'AUDITED').trim(),
      auditor_qualification: String(yearData.auditor_qualification || '').trim(),
      no_of_months: sanitiseNumber(yearData.no_of_months) || 12,
    };

    // Sanitise all financial fields
    const fieldKeys = Object.keys(yearData);
    for (const key of fieldKeys) {
      if (['period_ends_on', 'result_type', 'auditor_qualification', 'no_of_months'].includes(key)) continue;
      const val = sanitiseNumber(yearData[key]);
      sanitisedYear[key] = val;

      // Warn on suspiciously large values
      if (Math.abs(val) > 1e12) {
        errors.push(`years[${i}].${key} = ${val} exceeds 1 trillion — verify this value`);
      }
    }

    sanitised.years.push(sanitisedYear);
  }

  // Copy through any top-level metadata
  if (inputData.company_name) sanitised.company_name = String(inputData.company_name).trim();
  if (inputData.gstin) sanitised.gstin = String(inputData.gstin).trim();
  if (inputData.case_id) sanitised.case_id = String(inputData.case_id).trim();

  return {
    valid: errors.length === 0,
    errors,
    sanitised,
  };
}

/**
 * Validate output object — replace any NaN/Infinity with 0.
 */
export function sanitiseOutput(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'number') {
    if (!Number.isFinite(obj)) return 0;
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitiseOutput);
  }
  if (typeof obj === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = sanitiseOutput(v);
    }
    return result;
  }
  return obj;
}
