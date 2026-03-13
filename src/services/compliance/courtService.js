import WebEvidenceService from './webEvidenceService.js';

class CourtService {
  constructor() {
    this.webEvidence = new WebEvidenceService();
  }

  async verifyCourtRisk(identity) {
    const companyName = identity?.legalName || '';
    const cin = identity?.cin || '';

    const query = this.webEvidence.buildDomainQuery(
      ['ecourts.gov.in', 'main.sci.gov.in'],
      companyName,
      cin,
      ['case', 'petition', 'party']
    );

    const web = await this.webEvidence.searchDuckDuckGo(query);
    const confidence = Math.min(80, web.results.length * 20);

    return {
      probableCase: web.results.length > 0,
      confidence,
      source: 'court_search',
      details: web.results.length
        ? 'Probabilistic court references found; manual case-party verification required.'
        : 'No court references found in current search window.',
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

export default CourtService;
