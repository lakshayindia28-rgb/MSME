/**
 * Professional formatter for GST data - International grade output
 */
export class DataFormatter {
  /**
   * Format GST data for console output with enhanced professional styling
   */
  static formatForConsole(gstData) {
    const separator = '═'.repeat(85);
    const line = '─'.repeat(85);
    const doubleLine = '━'.repeat(85);
    
    let output = '\n';
    output += '╔' + separator + '╗\n';
    output += '║' + this.centerText('GOODS AND SERVICES TAX - TAXPAYER DETAILS', 85) + '║\n';
    output += '║' + this.centerText('Government of India - GST Portal', 85) + '║\n';
    output += '║' + this.centerText(`Generated: ${new Date().toLocaleString('en-IN')}`, 85) + '║\n';
    output += '╚' + separator + '╝\n\n';

    output += '╔' + separator + '╗\n';
    output += '║' + this.centerText('GOODS AND SERVICES TAX - TAXPAYER DETAILS', 85) + '║\n';
    output += '║' + this.centerText('Government of India - GST Portal', 85) + '║\n';
    output += '║' + this.centerText(`Generated: ${new Date().toLocaleString('en-IN')}`, 85) + '║\n';
    output += '╚' + separator + '╝\n\n';

    // Status indicator with color coding
    const statusEmoji = gstData.status?.toLowerCase().includes('active') ? '✅' : '❌';
    
    output += '┌' + line + '┐\n';
    output += '│' + this.padRight('  📋 BASIC INFORMATION', 85) + '│\n';
    output += '├' + line + '┤\n';
    output += this.formatTableRow('GSTIN Number', gstData.gstin || 'N/A', 85);
    output += this.formatTableRow('Legal Name', gstData.legalName || 'N/A', 85);
    output += this.formatTableRow('Trade Name', gstData.tradeName || 'Same as Legal Name', 85);
    output += this.formatTableRow('Status', `${statusEmoji} ${gstData.status || 'Unknown'}`, 85);
    output += this.formatTableRow('Registration Date', this.formatDate(gstData.registrationDate), 85);
    output += this.formatTableRow('Constitution of Business', gstData.constitutionOfBusiness || 'N/A', 85);
    output += this.formatTableRow('Taxpayer Type', gstData.taxpayerType || 'N/A', 85);
    
    if (gstData.lastUpdated) {
      output += this.formatTableRow('Last Updated', this.formatDate(gstData.lastUpdated), 85);
    }
    if (gstData.dateOfCancellation) {
      output += this.formatTableRow('Date of Cancellation', this.formatDate(gstData.dateOfCancellation), 85);
    }
    output += '└' + line + '┘\n\n';

    // Address Section
    output += '┌' + line + '┐\n';
    output += '│' + this.padRight('  🏢 PRINCIPAL PLACE OF BUSINESS', 85) + '│\n';
    output += '├' + line + '┤\n';
    
    if (gstData.address?.fullAddress) {
      output += this.formatTableRow('Complete Address', gstData.address.fullAddress, 85);
    } else {
      if (gstData.address?.buildingName) {
        output += this.formatTableRow('Building Name', gstData.address.buildingName, 85);
      }
      if (gstData.address?.buildingNumber) {
        output += this.formatTableRow('Building Number', gstData.address.buildingNumber, 85);
      }
      if (gstData.address?.floor) {
        output += this.formatTableRow('Floor', gstData.address.floor, 85);
      }
      if (gstData.address?.street) {
        output += this.formatTableRow('Street', gstData.address.street, 85);
      }
      if (gstData.address?.location) {
        output += this.formatTableRow('Location', gstData.address.location, 85);
      }
      if (gstData.address?.district) {
        output += this.formatTableRow('District', gstData.address.district, 85);
      }
      if (gstData.address?.state) {
        output += this.formatTableRow('State', gstData.address.state, 85);
      }
      if (gstData.address?.pincode) {
        output += this.formatTableRow('Pincode', gstData.address.pincode, 85);
      }
    }
    
    // Additional details
    if (gstData.aadhaarAuthenticated) {
      output += this.formatTableRow('Aadhaar Authenticated', gstData.aadhaarAuthenticated + (gstData.aadhaarAuthDate ? ` (On ${gstData.aadhaarAuthDate})` : ''), 85);
    }
    if (gstData.eKYCVerified) {
      output += this.formatTableRow('e-KYC Verified', gstData.eKYCVerified, 85);
    }
    output += '└' + line + '┘\n\n';

    // Center Jurisdiction
    if (gstData.centerJurisdiction) {
      output += '┌' + line + '┐\n';
      output += '│' + this.padRight('  🏛️  ADMINISTRATIVE OFFICE (JURISDICTION - CENTER)', 85) + '│\n';
      output += '├' + line + '┤\n';
      output += this.formatTableRow('State', gstData.centerJurisdiction.state, 85);
      output += this.formatTableRow('Zone', gstData.centerJurisdiction.zone, 85);
      output += this.formatTableRow('Commissionerate', gstData.centerJurisdiction.commissionerate, 85);
      output += this.formatTableRow('Division', gstData.centerJurisdiction.division, 85);
      output += this.formatTableRow('Range', gstData.centerJurisdiction.range, 85);
      output += '└' + line + '┘\n\n';
    }

    // State Jurisdiction
    if (gstData.stateJurisdiction && typeof gstData.stateJurisdiction === 'object') {
      output += '┌' + line + '┐\n';
      output += '│' + this.padRight('  🏛️  OTHER OFFICE (JURISDICTION - STATE)', 85) + '│\n';
      output += '├' + line + '┤\n';
      output += this.formatTableRow('State', gstData.stateJurisdiction.state, 85);
      output += this.formatTableRow('Headquarter', gstData.stateJurisdiction.headquarter, 85);
      output += this.formatTableRow('Ward', gstData.stateJurisdiction.ward, 85);
      output += '└' + line + '┘\n\n';
    }

    // Business Activities
    if (gstData.coreBusinessActivity) {
      output += '┌' + line + '┐\n';
      output += '│' + this.padRight('  💼 NATURE OF CORE BUSINESS ACTIVITY', 85) + '│\n';
      output += '├' + line + '┤\n';
      output += this.formatTableRow('Core Activity', gstData.coreBusinessActivity, 85);
      output += '└' + line + '┘\n\n';
    }

    if (gstData.businessActivities && gstData.businessActivities.length > 0) {
      output += '┌' + line + '┐\n';
      output += '│' + this.padRight('  💼 NATURE OF BUSINESS ACTIVITIES', 85) + '│\n';
      output += '├' + line + '┤\n';
      gstData.businessActivities.forEach((activity, idx) => {
        output += this.formatTableRow(`Activity ${idx + 1}`, activity, 85);
      });
      output += '└' + line + '┘\n\n';
    }

    // HSN Codes
    if (gstData.hsnCodes && gstData.hsnCodes.length > 0) {
      output += '┌' + line + '┐\n';
      output += '│' + this.padRight('  📦 DEALING IN GOODS AND SERVICES (HSN CODES)', 85) + '│\n';
      output += '├' + line + '┤\n';
      gstData.hsnCodes.forEach((hsn, idx) => {
        output += this.formatTableRow(`HSN ${idx + 1}`, `${hsn.code} - ${hsn.description}`, 85);
      });
      output += '└' + line + '┘\n\n';
    }

    // Footer
    output += '╔' + separator + '╗\n';
    output += '║' + this.centerText('⚠️  IMPORTANT NOTICE', 85) + '║\n';
    output += '║' + this.centerText('This information is as per Government GST Portal records', 85) + '║\n';
    output += '║' + this.centerText('Verify at: https://services.gst.gov.in', 85) + '║\n';
    output += '╚' + separator + '╝\n';
    
    return output;
  }

  /**
   * Format as table row
   */
  static formatTableRow(label, value, width) {
    const labelWidth = 30;
    const valueWidth = width - labelWidth - 5;
    
    // Handle multi-line values
    if (value && value.length > valueWidth) {
      const lines = this.wrapText(value, valueWidth);
      let output = `│  ${this.padRight(label, labelWidth)}: ${this.padRight(lines[0], valueWidth)} │\n`;
      
      for (let i = 1; i < lines.length; i++) {
        output += `│  ${' '.repeat(labelWidth)}  ${this.padRight(lines[i], valueWidth)} │\n`;
      }
      return output;
    }
    
    return `│  ${this.padRight(label, labelWidth)}: ${this.padRight(value || 'N/A', valueWidth)} │\n`;
  }

  /**
   * Wrap text to multiple lines
   */
  static wrapText(text, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';

    words.forEach(word => {
      if ((currentLine + word).length <= maxWidth) {
        currentLine += (currentLine ? ' ' : '') + word;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    });

    if (currentLine) lines.push(currentLine);
    return lines;
  }

  /**
   * Center text
   */
  static centerText(text, width) {
    const padding = Math.max(0, width - text.length);
    const leftPad = Math.floor(padding / 2);
    const rightPad = padding - leftPad;
    return ' '.repeat(leftPad) + text + ' '.repeat(rightPad);
  }

  /**
   * Pad right
   */
  static padRight(text, width) {
    return text + ' '.repeat(Math.max(0, width - text.length));
  }

  /**
   * Format GST data as JSON with metadata
   */
  static formatAsJSON(gstData) {
    return JSON.stringify({
      metadata: {
        fetchedAt: new Date().toISOString(),
        source: 'GST Portal - Government of India',
        version: '1.0.0'
      },
      data: gstData
    }, null, 2);
  }

  /**
   * Format date string to Indian format
   */
  static formatDate(dateString) {
    if (!dateString) return 'N/A';
    
    try {
      // Handle DD/MM/YYYY format
      if (dateString.includes('/')) {
        return dateString;
      }
      
      // Handle ISO format or timestamp
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return dateString;
      
      return date.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });
    } catch {
      return dateString;
    }
  }
}
