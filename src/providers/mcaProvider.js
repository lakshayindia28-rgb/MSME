import zaubaService from '../services/zaubaService.js';
import { normalizeName } from '../core/entityResolver.js';

class MCAProvider {
  constructor({ primaryAdapter = zaubaService } = {}) {
    this.primaryAdapter = primaryAdapter;
  }

  async resolveIdentityByCIN(cin) {
    const safeCin = String(cin || '').trim().toUpperCase();
    if (!safeCin) {
      return {
        success: false,
        error: 'CIN is required',
        source: 'mca_provider'
      };
    }

    const response = await this.primaryAdapter.fetchCompanyData(safeCin);
    if (!response?.success || !response?.data) {
      return {
        success: false,
        error: response?.error || 'Unable to resolve company identity from MCA adapter',
        source: 'mca_provider'
      };
    }

    const d = response.data;
    const legalName = String(d.companyName || '').trim();
    const directors = Array.isArray(d.directors) ? d.directors.map((x) => ({
      name: String(x?.name || '').trim(),
      din: String(x?.din || '').trim() || null
    })).filter((x) => x.name) : [];

    const address = String(d.registeredAddress || '').trim();
    const status = String(d.status || '').trim() || 'Unknown';
    const strikeOff = /strike|struck|inactive|amalgamated|dissolved/i.test(status);

    return {
      success: true,
      source: 'mca_adapter',
      identity: {
        cin: safeCin,
        legalName,
        normalizedName: normalizeName(legalName),
        directors,
        addresses: address ? [address] : [],
        status,
        chargesCount: Number(d.chargesCount || 0) || 0,
        strikeOff,
        incorporationDate: String(d.dateOfIncorporation || '').trim() || null
      }
    };
  }
}

export default MCAProvider;
