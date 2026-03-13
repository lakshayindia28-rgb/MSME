import WebEvidenceService from './webEvidenceService.js';

class NCLTService {
  constructor() {
    this.webEvidence = new WebEvidenceService();
  }

  async verifyInsolvency(identity) {
    const companyName = identity?.legalName || '';
    const cin = identity?.cin || '';

    // Official-record parser hook (to be replaced by direct NCLT/IBBI dataset ingestion)
    const officialRecord = {
      found: false,
      confidence: 0,
      evidence: []
    };

    if (officialRecord.found) {
      return {
        confirmedCase: true,
        confidence: officialRecord.confidence,
        source: 'official_record',
        details: 'Matched against official NCLT/IBBI record feed.',
        evidence: { results: officialRecord.evidence },
        input_used: {
          type: cin && companyName ? 'cin+company_name' : cin ? 'cin' : 'company_name',
          cin: cin || null,
          company_name: companyName || null,
          note: 'Official NCLT/IBBI record match.'
        }
      };
    }

    const query = this.webEvidence.buildDomainQuery(
      ['nclt.gov.in', 'ibbi.gov.in'],
      companyName,
      cin,
      ['insolvency', 'ibc', 'cause list', 'order']
    );
    const web = await this.webEvidence.searchDuckDuckGo(query);

    return {
      confirmedCase: false,
      confidence: web.results.length > 0 ? 40 : 0,
      source: 'supporting_web',
      details: web.results.length
        ? 'No official record confirmed yet; web evidence found on official domains for analyst review.'
        : 'No official record confirmed and no supporting web evidence found.',
      evidence: web,
      input_used: {
        type: cin && companyName ? 'cin+company_name' : cin ? 'cin' : 'company_name',
        cin: cin || null,
        company_name: companyName || null,
        query
      }
    };
  }
}

export default NCLTService;
