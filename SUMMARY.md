# 🚀 GST & MCA Intelligence Platform - Complete Summary

## 📋 **Platform Overview**
A **Business Intelligence & Compliance Verification System** for Indian companies that automates data collection from multiple government portals and produces structured evidence outputs.

The system compares financial information across two submitted documents and produces a structured reconciliation dataset for MSME credit appraisal workflows.

## 🎯 **Core Purpose**
Verify company authenticity, financial compliance, and risk factors by fetching real-time data from official Indian government sources.

---

## 🔧 **4 Main Modules**

### **1. 📊 GST Verification Module** ✅ FULLY FUNCTIONAL
- **What it does**: Fetches GST registration details using GSTIN
- **Data Source**: Official GST Portal (gst.gov.in)
- **Features**:
  - Solves CAPTCHA automatically
  - Gets company legal name, trade name, registration date, status
  - Fetches filing compliance status (returns filed/not filed)
  - Shows taxpayer type, jurisdiction details
- **Status**: Working perfectly with real government API

### **2. 🏢 MCA Company Search Module** ✅ FULLY FUNCTIONAL
- **What it does**: Searches company details using CIN/Company Name
- **Data Source**: Ministry of Corporate Affairs (mca.gov.in)
- **Features**:
  - Autocomplete search with 50+ company suggestions
  - Fetches company profile (CIN, registration number, incorporation date)
  - Gets authorized capital, paid-up capital, company status
  - Lists all directors with DIN numbers and designations
  - Can fetch individual director details
- **Status**: Working with MCA official API

### **3. ⚠️ Compliance & Risk Intelligence** 🔄 RECENTLY BUILT
- **What it does**: Automated verification across 5 official sources to check if company appears in adverse lists
- **Data Sources Checked**:
  1. **NCLT** (nclt.gov.in) - Insolvency proceedings, winding-up petitions
  2. **SEBI** (sebi.gov.in) - Enforcement actions, broker debarments
  3. **eCourts** (ecourts.gov.in) - Pending litigation, court cases
  4. **NSE** (nseindia.com) - Defaulter lists, surveillance actions
  5. **BSE** (bseindia.com) - Expelled members, defaults
- **Features**:
  - Enter CIN/Company Name → Automatic parallel checking
  - Returns color-coded results: ✓ Green (Clean) / ✗ Red (Adverse)
  - Summary dashboard: Total checks, adverse records, clean records
  - Shows details for each source with timestamp
- **Status**: Frontend ready, backend structure complete (scraping logic marked TODO due to CAPTCHA/authentication challenges)

### **4. 🏭 UDYAM MSME Verification** ⚠️ PARTIALLY WORKING
- **What it does**: Verifies MSME (Micro, Small, Medium Enterprises) registration
- **Data Source**: udyamregistration.gov.in
- **Features**:
  - User-assisted CAPTCHA solving workflow
  - Parses Udyam certificate data (name, number, type, investment)
- **Status**: Portal blocks iframe embedding (X-Frame-Options), so user pastes portal results manually

---

## 🧾 **Financial Reconciliation Engine** ✅ ACTIVE
- **What it does**: Compares two submitted financial documents and returns a structured reconciliation dataset.
- **Input**:
  - `bank_statement_pdf`
  - `vendor_statement_pdf`
- **Output datasets**:
  1. `EXTRACTED_VALUES`
  2. `RECONCILIATION_TABLE`
  3. `RISK_CLASSIFICATION`
  4. `CREDIT_DECISION`
- **Status**: Active and integrated.

---

## 💻 **Technology Stack**

**Backend:**
- Node.js + Express (v22.22.0)
- Port 3000, 14 API endpoints
- Winston logger for debugging
- Axios for HTTP requests
- Cheerio for HTML parsing

**Frontend:**
- Vanilla JavaScript (no frameworks)
- Modern CSS with animations
- Responsive design
- Animated particle background on landing page

**Reconciliation Integration:**
- Deterministic OCR + extraction pipeline
- Structured reconciliation dataset generation
- Tolerance-based mismatch classification

**External APIs:**
- GST Portal API (official)
- MCA21 API (official)
- Government portals (NCLT, SEBI, Courts, NSE, BSE)

---

## 📊 **Current Capabilities**

### **What Works RIGHT NOW:**
✅ Search any Indian company by CIN/Name
✅ Verify GST registration by GSTIN  
✅ Get complete company profile from MCA
✅ List all directors with details
✅ Check GST filing compliance status
✅ Generate structured reconciliation datasets
✅ Automated compliance checking interface (UI ready)

### **What Needs Implementation:**
⚠️ Actual web scraping for NCLT, SEBI, Courts, NSE, BSE (marked TODO)
⚠️ CAPTCHA bypass for government portals
⚠️ UDYAM iframe embedding (blocked by portal security)

---

## 🎨 **User Interface**

**Landing Page:**
- 4 animated module cards with keyboard shortcuts
- GST (🟢 Green) - Press "1"
- MCA (🔵 Blue) - Press "2"  
- Compliance (🔴 Red) - Press "3"
- UDYAM (🟡 Yellow) - Press "4"

**Each Module Page:**
- Search form with input fields
- Real-time API calls to government portals
- Results display with tables/cards
- Navigation between modules
- Reconciliation workflow integration for financial document comparison

---

## 📁 **File Structure**
```
GST MODULE/
├── server/
│   ├── app.js (main server, 813 lines, 14 endpoints)
│   ├── services/
│   │   ├── complianceService.js (compliance checking logic)
│   │   ├── reportGenerator.js (AI PDF generation)
│   │   └── udyamService.js (UDYAM parsing)
│   └── public/ (frontend HTML files)
│       ├── index.html (landing page)
│       ├── gst.html (GST module)
│       ├── mca.html (MCA module)
│       ├── compliance.html (compliance checker - NEW)
│       └── udyam.html (UDYAM module)
├── .env (API keys)
└── AI_REPORT_GUIDE.md (reconciliation engine guide)
```

---

## 🔑 **Key API Endpoints**

```
POST /api/gst/search - GST verification
POST /api/fetch-mca - Company data from MCA
POST /api/search-companies - Autocomplete search
POST /api/fetch-director - Director details
POST /api/check-compliance - Compliance risk check (NEW)
POST /api/financial-reconciliation - Structured reconciliation dataset
POST /api/fetch-udyam - UDYAM data parsing
```

---

## 🎯 **Use Cases**

1. **Due Diligence**: Verify company before business partnership
2. **Credit Assessment**: Check financial compliance for loan approval
3. **Risk Analysis**: Identify litigation/regulatory actions
4. **MSME Verification**: Confirm Udyam registration for government tenders
5. **Compliance Audit**: Quick check across multiple government databases

---

## ⚡ **Current Status Summary**

**Production Ready:**
- ✅ GST Module (100% functional)
- ✅ MCA Module (100% functional)
- ✅ Financial Reconciliation Engine (active)

**Recently Built:**
- 🔄 Compliance Module (UI complete, scraping pending)

**Known Limitations:**
- ⚠️ UDYAM portal blocks iframe (external security restriction)
- ⚠️ Compliance sources need CAPTCHA solving (TODO implementation)
- ⚠️ Portal-level CAPTCHA and source accessibility limits

---

## Clarification
This system provides verified comparable financial evidence. Final interpretation and lending decision remains with the credit analyst or chartered accountant.

**In Short:** A business intelligence platform that fetches real company data from Indian government portals (GST, MCA), performs compliance checks, and provides structured reconciliation evidence for MSME credit appraisal workflows.
