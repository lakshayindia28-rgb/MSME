export class SummaryEngine {
  constructor({ openaiClient, model = process.env.OPENAI_FINANCIAL_MODEL || 'gpt-4.1-mini' } = {}) {
    this.openai = openaiClient;
    this.model = model;
  }

  async generate({
    companyName,
    authenticityCheck,
    extractedFinancials,
    ratios,
    riskAssessment,
    decision,
    companyProfile,
    trendAnalysis,
    dataReliability,
    confidence
  }) {
    if (!this.openai) {
      return this.buildFallbackSummary({
        companyName,
        authenticityCheck,
        ratios,
        riskAssessment,
        decision,
        companyProfile,
        trendAnalysis,
        dataReliability
      });
    }

    const promptPayload = {
      instruction:
        'You are a senior credit analyst. Rules already decided approval. AI must only explain with no assumptions. Use only supplied data. Mention the exact company name in detailed_summary whenever provided and never substitute with "Unknown Company" if a name is available. Distinguish clearly between overall confidence_score and data_reliability_score; do not mix them. Return strict JSON with keys: bullet_summary (max 5), detailed_summary, key_concerns (array max 5), improvement_suggestions (array max 5). Explain why decision taken, key concerns, and what business must improve to get approval.',
      company_name: String(companyName || '').trim() || null,
      decision,
      authenticity_check: authenticityCheck,
      company_profile: companyProfile,
      extracted_financials: extractedFinancials,
      ratios,
      risk_assessment: riskAssessment,
      risk_flags: riskAssessment?.flags || [],
      trend_analysis: trendAnalysis,
      reliability_level: dataReliability?.reliability_level,
      reliability_details: dataReliability,
      overall_confidence_score: confidence?.confidence_score ?? null,
      confidence_breakdown: confidence || null
    };

    try {
      const completion = await this.openai.responses.create({
        model: this.model,
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: JSON.stringify(promptPayload)
              }
            ]
          }
        ]
      });

      const raw = String(completion?.output_text || '').trim();
      const parsed = JSON.parse(raw);
      return {
        bullet_summary: Array.isArray(parsed?.bullet_summary)
          ? parsed.bullet_summary.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 5)
          : [],
        detailed_summary: String(parsed?.detailed_summary || '').trim(),
        key_concerns: Array.isArray(parsed?.key_concerns)
          ? parsed.key_concerns.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 5)
          : [],
        improvement_suggestions: Array.isArray(parsed?.improvement_suggestions)
          ? parsed.improvement_suggestions.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 5)
          : []
      };
    } catch {
      return this.buildFallbackSummary({
        companyName,
        authenticityCheck,
        ratios,
        riskAssessment,
        decision,
        companyProfile,
        trendAnalysis,
        dataReliability
      });
    }
  }

  buildFallbackSummary({ companyName, authenticityCheck, ratios, riskAssessment, decision, trendAnalysis, dataReliability }) {
    const legalName = String(companyName || '').trim();
    const bullets = [
      legalName ? `Company assessed: ${legalName}.` : 'Company assessed: Name not provided in request payload.',
      `Authenticity status is ${authenticityCheck?.authenticity_status || 'UNKNOWN'} with severity ${authenticityCheck?.severity || 'N/A'}.`,
      `Liquidity indicators show current ratio ${ratios?.current_ratio ?? 'N/A'} and working capital ${ratios?.working_capital ?? 'N/A'}.`,
      `Profitability indicators show net margin ${ratios?.net_profit_margin != null ? `${(ratios.net_profit_margin * 100).toFixed(2)}%` : 'N/A'} and ROA ${ratios?.roa != null ? `${(ratios.roa * 100).toFixed(2)}%` : 'N/A'}.`,
      `Trend shows ${trendAnalysis?.growth_status || 'STABLE'} growth with ${trendAnalysis?.collection_behavior || 'IMPROVING'} collection behavior.`
    ];

    const detailed = [
      legalName ? `Company under review: ${legalName}.` : 'Company under review: Name not available.',
      `This is an explanation-only narrative based on deterministic underwriting rules.`,
      `The final decision is ${decision?.decision || riskAssessment?.decision || 'N/A'} and grade ${decision?.grade || riskAssessment?.grade || 'N/A'}.`,
      `Key reasons: ${Array.isArray(decision?.reasons) && decision.reasons.length ? decision.reasons.join(' ') : 'No major rule breach recorded.'}`
    ].join(' ');

    const keyConcerns = Array.isArray(riskAssessment?.flags)
      ? riskAssessment.flags.map((f) => f.reason).slice(0, 5)
      : [];

    const suggestions = [
      'Improve liquidity buffer and maintain current ratio above 1.0.',
      'Strengthen collections and reduce debtor days with tighter credit policy.',
      'Improve profitability by cost rationalization and margin discipline.'
    ];

    return {
      bullet_summary: bullets,
      detailed_summary: detailed,
      key_concerns: keyConcerns,
      improvement_suggestions: suggestions
    };
  }
}

export default SummaryEngine;