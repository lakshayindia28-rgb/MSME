/**
 * Validates GST Identification Number (GSTIN)
 * Format: 2 digits (state code) + 10 digits (PAN) + 1 digit (entity number) + 1 letter (Z) + 1 check digit
 */
export class GSTValidator {
  static GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

  /**
   * Validates GSTIN format
   * @param {string} gstin - GST number to validate
   * @returns {Object} - {valid: boolean, error: string}
   */
  static validate(gstin) {
    if (!gstin) {
      return { valid: false, error: 'GSTIN is required' };
    }

    // Remove spaces and convert to uppercase
    const cleanGSTIN = gstin.toString().trim().toUpperCase().replace(/\s/g, '');

    if (cleanGSTIN.length !== 15) {
      return { valid: false, error: 'GSTIN must be 15 characters long' };
    }

    if (!this.GSTIN_REGEX.test(cleanGSTIN)) {
      return { valid: false, error: 'Invalid GSTIN format' };
    }

    return { valid: true, gstin: cleanGSTIN };
  }

  /**
   * Extract state code from GSTIN
   */
  static getStateCode(gstin) {
    return gstin.substring(0, 2);
  }

  /**
   * Extract PAN from GSTIN
   */
  static getPAN(gstin) {
    return gstin.substring(2, 12);
  }
}
