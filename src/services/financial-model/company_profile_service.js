function safeNumber(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export class CompanyProfileService {
  detect(financials = {}) {
    const revenue = safeNumber(financials?.revenue);
    const inventory = safeNumber(financials?.inventory);

    const inventoryRatio = revenue && revenue > 0 && inventory != null
      ? Number((inventory / revenue).toFixed(6))
      : null;

    const companyType = inventoryRatio != null && inventoryRatio < 0.15
      ? 'SERVICE_COMPANY'
      : 'TRADING_COMPANY';

    return {
      company_type: companyType,
      inventory_to_revenue_ratio: inventoryRatio,
      rule: 'inventory < 15% revenue => SERVICE_COMPANY else TRADING_COMPANY'
    };
  }
}

export default CompanyProfileService;
