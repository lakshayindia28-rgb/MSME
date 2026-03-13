import WebEvidenceService from './webEvidenceService.js';

class SEBIService {
  constructor() {
    this.webEvidence = new WebEvidenceService();
  }

  async verifyOrders(identity) {
    const companyName = identity?.legalName || '';
    const cin = identity?.cin || '';
    const directors = Array.isArray(identity?.directors) ? identity.directors : [];

    // Official-record parser hook (order index + pdf parser to be plugged here)
    const officialMatches = [];

    if (officialMatches.length > 0) {
      return {
        confirmedAction: true,
        confidence: 95,
        source: 'official_record',
        details: 'Matched against structured SEBI order records.',
        evidence: { results: officialMatches },
        directorCrossRefs: directors.map((d) => ({ name: d?.name || '', din: d?.din || null })),
        input_used: {
          type: cin && companyName ? 'cin+company_name' : cin ? 'cin' : 'company_name',
          cin: cin || null,
          company_name: companyName || null,
          note: 'Structured SEBI order records checked.'
        }
      };
    }

    const query = this.webEvidence.buildDomainQuery(
      ['sebi.gov.in'],
      companyName,
      cin,
      ['enforcement', 'order', 'notice', 'debar']
    );
    const web = await this.webEvidence.searchDuckDuckGo(query);

    return {
      confirmedAction: false,
      confidence: web.results.length > 0 ? 45 : 0,
      source: 'supporting_web',
      details: web.results.length
        ? 'No structured SEBI record confirmed; supporting web evidence found for analyst review.'
        : 'No SEBI action found in supporting web evidence.',
      evidence: web,
      directorCrossRefs: directors.map((d) => ({ name: d?.name || '', din: d?.din || null })),
      input_used: {
        type: cin && companyName ? 'cin+company_name' : cin ? 'cin' : 'company_name',
        cin: cin || null,
        company_name: companyName || null,
        query
      }
    };
  }
}

export default SEBIService;
