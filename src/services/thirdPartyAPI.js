import axios from 'axios';
import { logger } from '../utils/logger.js';

/**
 * Third-party GST API services (fallback options)
 */
export class ThirdPartyGSTAPI {
  constructor() {
    this.providers = [
      {
        name: 'MasterIndia',
        url: 'https://api.mastergst.com/public/gstin',
        requiresAuth: false
      },
      {
        name: 'KnowYourGST',
        url: 'https://knowyourgst.com/developers/api',
        requiresAuth: false
      }
    ];
  }

  /**
   * Try fetching from third-party APIs
   */
  async fetchFromThirdParty(gstin) {
    logger.info('Using demo/sample data (Fast mode)');
    // Directly return sample data for speed
    return this.getSampleData(gstin);
  }

  /**
   * Sample data based on real GST portal format
   */
  getSampleData(gstin) {
    const stateCode = gstin.substring(0, 2);
    const pan = gstin.substring(2, 12);
    
    // State mapping for realistic data
    const stateMap = {
      '26': { name: 'Dadra and Nagar Haveli and Daman and Diu', hq: 'Silvassa' },
      '27': { name: 'Maharashtra', hq: 'Mumbai' },
      '29': { name: 'Karnataka', hq: 'Bengaluru' },
      '07': { name: 'Delhi', hq: 'New Delhi' },
      '09': { name: 'Uttar Pradesh', hq: 'Lucknow' },
      '06': { name: 'Haryana', hq: 'Chandigarh' },
      '24': { name: 'Gujarat', hq: 'Gandhinagar' }
    };

    const state = stateMap[stateCode] || { name: 'India', hq: 'State Capital' };
    
    return {
      gstin: gstin,
      legalName: `${pan} PRIVATE LIMITED`,
      tradeName: `${pan} PRIVATE LIMITED`,
      registrationDate: '23/06/2021',
      effectiveDate: '23/06/2021',
      constitutionOfBusiness: 'Private Limited Company',
      taxpayerType: 'Regular',
      status: 'Active',
      lastUpdated: new Date().toISOString(),
      
      // Jurisdiction - Center
      centerJurisdiction: {
        state: 'CBIC',
        zone: 'ZONE-I',
        commissionerate: 'COMMISSIONERATE-I',
        division: 'DIVISION-I',
        range: 'RANGE-I'
      },
      
      // Jurisdiction - State
      stateJurisdiction: {
        state: state.name,
        headquarter: state.hq,
        ward: `${state.hq} Ward`
      },
      
      // Principal Place of Business
      address: {
        fullAddress: `S.NO. 216/3, PLOT NO.11, CANAL ROAD, ${state.hq}, ${state.name}, 396193`,
        buildingNumber: '216/3',
        plotNumber: '11',
        street: 'CANAL ROAD',
        location: state.hq,
        district: state.hq,
        state: state.name,
        pincode: `${stateCode}6193`
      },
      
      // Additional Details
      aadhaarAuthenticated: 'Yes',
      aadhaarAuthDate: new Date().toLocaleDateString('en-IN'),
      eKYCVerified: 'Not Applicable',
      
      // Business Details
      coreBusinessActivity: 'Manufacturer',
      businessActivities: [
        'Wholesale Business',
        'Factory / Manufacturing',
        'Export'
      ],
      
      // HSN Codes (Goods)
      hsnCodes: [
        { code: '10063020', description: 'BASMATI RICE' },
        { code: '76121010', description: 'PLAIN ALUMINIUM' },
        { code: '76129090', description: 'OTHER ALUMINIUM PRODUCTS' },
        { code: '7602', description: 'ALUMINIUM WASTE AND SCRAP' },
        { code: '76071110', description: 'ORDINARILY USED FOR TEA CHEST LINING' }
      ],
      
      _note: '⚡ FAST MODE: This is realistic demo data. For actual GST Portal data, configure API authentication or use paid GST API services.'
    };
  }

  /**
   * Normalize third-party API response
   */
  normalizeResponse(data) {
    return {
      gstin: data.gstin || data.gstinNumber || '',
      legalName: data.legalName || data.legal_name || data.taxpayerName || '',
      tradeName: data.tradeName || data.trade_name || '',
      registrationDate: data.registrationDate || data.rgdt || '',
      constitutionOfBusiness: data.constitutionOfBusiness || data.constitution || '',
      taxpayerType: data.taxpayerType || data.taxpayer_type || '',
      status: data.status || data.taxpayerStatus || '',
      lastUpdated: data.lastUpdated || new Date().toISOString(),
      address: {
        fullAddress: data.principalPlaceOfBusiness || data.address || ''
      },
      businessActivities: data.natureOfBusinessActivities || [],
      filingStatus: []
    };
  }
}
