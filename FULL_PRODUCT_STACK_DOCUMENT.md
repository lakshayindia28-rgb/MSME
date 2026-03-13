hi# CrediVerify 360 — Full Product & Technology Stack Document

> **Version**: 1.0  
> **Last Updated**: 11 March 2026  
> **Module Name**: `gst-record-fetcher` (package.json)  
> **Platform**: Enterprise Due Diligence & Verification Platform  

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Technology Stack](#2-technology-stack)
3. [Architecture Overview](#3-architecture-overview)
4. [Directory Structure](#4-directory-structure)
5. [Backend — Server & API](#5-backend--server--api)
6. [Frontend — Pages & UI](#6-frontend--pages--ui)
7. [Core Modules](#7-core-modules)
8. [Document Intelligence Module](#8-document-intelligence-module)
9. [Financial Engine](#9-financial-engine)
10. [Financial Model Services](#10-financial-model-services)
11. [Compliance Module](#11-compliance-module)
12. [Services Layer](#12-services-layer)
13. [Database Models & Schemas](#13-database-models--schemas)
14. [AI / ML Integrations](#14-ai--ml-integrations)
15. [API Endpoints Reference](#15-api-endpoints-reference)
16. [Frontend Assets](#16-frontend-assets)
17. [Scripts & Utilities](#17-scripts--utilities)
18. [Configuration & Environment](#18-configuration--environment)
19. [Security & Access Control](#19-security--access-control)
20. [Deployment & DevOps](#20-deployment--devops)
21. [Key Workflows](#21-key-workflows)
22. [Dependencies — Full List](#22-dependencies--full-list)
23. [Module Status Matrix](#23-module-status-matrix)

---

## 1. Product Overview

**CrediVerify 360** is an enterprise-grade **Pre-Sanction Due Diligence & Verification Platform** designed for Indian financial institutions, NBFCs, and lending companies.

### What It Does

- Automates multi-module due-diligence verification workflows
- Fetches and validates **GST**, **MCA**, **Compliance**, **PAN**, **UDYAM**, **ITR** data from government portals
- Processes **bank statements** and **financial documents** via OCR + AI extraction
- Runs **financial calculations** (P&L, Balance Sheet, Ratios, Eligibility)
- Performs **compliance checks** across 5 regulatory sources (NCLT, SEBI, Courts, NSE, BSE)
- Generates **AI-powered due-diligence reports** with officer signatures
- Manages **cases** with full lifecycle tracking (Draft → Pending → Ongoing → Completed)

### Target Users

| Role | Usage |
|------|-------|
| **Credit Analyst** | Run verifications, review data, generate reports |
| **Executive** | Create cases, assign work, monitor dashboards |
| **Admin** | System configuration, user management |

---

## 2. Technology Stack

### Backend

| Technology | Version | Purpose |
|-----------|---------|---------|
| **Node.js** | 18+ (ESM) | Runtime environment |
| **Express.js** | 4.22.1 | HTTP server & REST API framework |
| **MongoDB** | 4.4+ (Docker) | Primary database |
| **Mongoose** | 9.2.4 | MongoDB ODM |

### Frontend

| Technology | Purpose |
|-----------|---------|
| **HTML5** | Page structure |
| **CSS3** (Custom) | Styling with theme system |
| **Vanilla JavaScript (ES6+)** | Client-side logic (no framework) |
| **Fetch API** | AJAX calls to backend |

### AI / ML

| Technology | Version | Purpose |
|-----------|---------|---------|
| **AWS Bedrock (Claude Sonnet)** | claude-sonnet-4-6 | Report generation, AI summaries, observations |
| **OpenAI GPT-4.1-mini** | via openai SDK 6.17.0 | Document extraction, field parsing |
| **Tesseract.js** | 5.1.0 | OCR (Optical Character Recognition) |

### Document Processing

| Library | Version | Purpose |
|---------|---------|---------|
| **Puppeteer** | 22.0.0 | Web scraping, PDF generation |
| **pdf-lib** | 1.17.1 | PDF manipulation |
| **pdfjs-dist** | 4.10.38 | PDF parsing & rasterization |
| **PDFKit** | 0.17.2 | PDF creation |
| **sharp** | 0.33.5 | Image processing (resize, convert) |
| **@napi-rs/canvas** | 0.1.74 | Canvas rendering for OCR preprocessing |
| **xlsx** | 0.18.5 | Excel file parsing |

### Networking & Scraping

| Library | Version | Purpose |
|---------|---------|---------|
| **axios** | 1.6.5 | HTTP client |
| **axios-cookiejar-support** | 6.0.5 | Cookie management for portal sessions |
| **cheerio** | 1.0.0-rc.12 | HTML parsing & scraping |
| **tough-cookie** | 6.0.0 | Cookie jar implementation |

### Infrastructure & Middleware

| Library | Version | Purpose |
|---------|---------|---------|
| **helmet** | 7.2.0 | Security headers (CSP, HSTS) |
| **cors** | 2.8.6 | Cross-Origin Resource Sharing |
| **express-rate-limit** | 7.5.1 | API rate limiting |
| **multer** | 1.4.5-lts.1 | File upload handling |
| **dotenv** | 16.3.1 | Environment variable management |
| **winston** | 3.11.0 | Structured logging |
| **node-cache** | 5.1.2 | In-memory caching |
| **p-queue** | 8.0.1 | Concurrency control & job queueing |
| **retry** | 0.13.1 | Retry logic for API calls |

### CLI & Dev

| Library | Version | Purpose |
|---------|---------|---------|
| **chalk** | 5.3.0 | Colored terminal output |
| **ora** | 8.0.1 | Terminal spinners |
| **file-type** | 19.6.0 | File MIME type detection |
| **nodemon** | 3.1.11 (dev) | Auto-restart on code changes |

---

## 3. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                         CLIENT (Browser)                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐│
│  │Dashboard │ │  Case    │ │  Report  │ │Financial │ │  OCR   ││
│  │  .html   │ │Workspace │ │  .html   │ │ Calc.html│ │ .html  ││
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └───┬────┘│
│       │             │            │             │           │      │
│  ┌────┴─────┐ ┌────┴─────┐ ┌────┴─────┐ ┌────┴─────┐ ┌──┴────┐│
│  │dashboard │ │case-work │ │report.js │ │financial │ │(inline)││
│  │  .js     │ │space.js  │ │          │ │ -calc.js │ │       ││
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └───────┘│
└───────────────────────────┬──────────────────────────────────────┘
                            │ HTTP REST (JSON)
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│                   EXPRESS SERVER (server/app.js)                  │
│                         Port 3000                                │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  Middleware: Helmet · CORS · Rate Limiter · Multer       │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │GST Routes│ │MCA Routes│ │Case Mgmt │ │Financial │           │
│  │          │ │          │ │  Routes  │ │  Routes  │           │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘           │
│       │             │            │             │                  │
│  ┌────┴─────┐ ┌────┴─────┐ ┌────┴─────┐ ┌────┴─────────────┐   │
│  │gstModule │ │mcaSearch │ │caseDb    │ │financialModel    │   │
│  │gstFetcher│ │mcaProvider│ │Service   │ │Routes + CalcRoutes│   │
│  │proxyServ │ │zaubaServ │ │          │ │                   │   │
│  └──────────┘ └──────────┘ └──────────┘ └───────────────────┘   │
│                                                                   │
│  ┌──────────────┐ ┌──────────────┐ ┌─────────────────────────┐  │
│  │ Compliance   │ │ Report       │ │ Document Intelligence   │  │
│  │ Service      │ │ Service      │ │ (OCR · Extractors ·     │  │
│  │ (5 sources)  │ │ (AI Bedrock) │ │  Compare · Confidence)  │  │
│  └──────┬───────┘ └──────┬───────┘ └────────────┬────────────┘  │
│         │                │                       │               │
│  ┌──────┴───────────────┴───────────────────────┴────────────┐  │
│  │              EXTERNAL INTEGRATIONS                        │  │
│  │  GST Portal · MCA Portal · ZaubaCorp · NCLT · SEBI       │  │
│  │  NSE · BSE · Courts · AWS Bedrock · OpenAI               │  │
│  └───────────────────────────────────────────────────────────┘  │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│                     DATA LAYER                                   │
│  ┌──────────────────┐  ┌─────────────────────────────────────┐  │
│  │  MongoDB 4.4     │  │  File System                        │  │
│  │  (Docker)        │  │  document-intelligence-data/         │  │
│  │  ┌────────────┐  │  │  ├── cases_registry.json            │  │
│  │  │ Cases      │  │  │  └── cases/                         │  │
│  │  │ Collection │  │  │      ├── metadata.json              │  │
│  │  ├────────────┤  │  │      ├── documents/                 │  │
│  │  │ Snapshots  │  │  │      └── extractions/               │  │
│  │  │ Collection │  │  │                                      │  │
│  │  └────────────┘  │  │  logs/                               │  │
│  └──────────────────┘  │  └── financial-model/*.json          │  │
│                         └─────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. Directory Structure

```
GST MODULE/
│
├── package.json                    # Project manifest & scripts
├── eng.traineddata                 # Tesseract OCR English model
│
├── server/
│   ├── app.js                      # Main Express server (~850 lines, 40+ endpoints)
│   └── public/                     # Static frontend files
│       ├── index.html              # Landing page
│       ├── dashboard.html          # Case management dashboard
│       ├── case-workspace.html     # Main case verification workspace
│       ├── gst.html                # GST verification module
│       ├── mca.html                # MCA company search module
│       ├── compliance.html         # Compliance checker module
│       ├── director.html           # Director lookup page
│       ├── ocr.html                # OCR workspace
│       ├── financial-calc.html     # Financial calculation engine
│       ├── report.html             # Report builder & PDF generator
│       └── assets/
│           ├── case-workspace.js   # Case workspace client logic
│           ├── case-workspace.css  # Workspace styles
│           ├── dashboard.js        # Dashboard client logic
│           ├── dashboard.css       # Dashboard styles
│           ├── financial-calc.js   # Financial calc client logic
│           ├── financial-calc.css  # Financial calc styles
│           ├── report.js           # Report builder client logic
│           ├── report.css          # Report styles
│           ├── theme.css           # Global theme
│           ├── SIGN.jpeg           # Officer signature image
│           └── stamp.png           # Official stamp image
│
├── src/
│   ├── index.js                    # CLI entry point
│   ├── scrape.js                   # Web scraping utilities
│   │
│   ├── config/
│   │   ├── config.js               # GST portal config, timeouts, flags
│   │   └── database.js             # MongoDB connection (Mongoose)
│   │
│   ├── core/
│   │   ├── gstModule.js            # GST orchestrator (fetch, validate, cache)
│   │   └── entityResolver.js       # Entity matching & similarity scoring
│   │
│   ├── models/
│   │   ├── Case.js                 # MongoDB Case schema
│   │   └── CaseSnapshot.js         # MongoDB Module snapshot schema
│   │
│   ├── routes/
│   │   ├── financialModelRoutes.js # Financial analysis API routes
│   │   └── financialCalcRoutes.js  # Calculation engine API routes
│   │
│   ├── services/
│   │   ├── gstFetcher.js           # GST data fetching (portal/API)
│   │   ├── gstProxyService.js      # User-assisted CAPTCHA proxy
│   │   ├── searchService.js        # Google-based company autocomplete
│   │   ├── mcaSearchService.js     # MCA company search
│   │   ├── zaubaService.js         # ZaubaCorp company data
│   │   ├── reportService.js        # AI report generation (Bedrock/Claude)
│   │   ├── complianceService.js    # Multi-source compliance checking
│   │   ├── bedrockClient.js        # AWS Bedrock Claude integration
│   │   ├── caseDbService.js        # Case & snapshot CRUD
│   │   ├── thirdPartyAPI.js        # Third-party GST fallback
│   │   ├── dataFormatter.js        # Output formatting
│   │   │
│   │   ├── compliance/             # Compliance sub-services
│   │   │   ├── complianceDecision.js  # Decision logic
│   │   │   ├── courtService.js        # Court records search
│   │   │   ├── exchangeService.js     # NSE/BSE defaulter checks
│   │   │   ├── ncltService.js         # NCLT insolvency checks
│   │   │   ├── sebiService.js         # SEBI enforcement actions
│   │   │   ├── reportNarrator.js      # Narrative generation
│   │   │   └── webEvidenceService.js  # Web evidence collection
│   │   │
│   │   ├── financial-model/        # Financial analysis services (22 files)
│   │   │   ├── financial_analysis_service.js  # Main orchestrator
│   │   │   ├── ratio_engine.js                # Financial ratio calculations
│   │   │   ├── risk_engine.js                 # Risk scoring
│   │   │   ├── summary_engine.js              # AI summary generation
│   │   │   ├── confidence_service.js          # Confidence scoring
│   │   │   ├── data_reliability_service.js    # Data quality assessment
│   │   │   ├── calculation_audit_service.js   # Audit trailing
│   │   │   ├── financial_report_pdf.js        # PDF report generation
│   │   │   ├── trend_analysis_service.js      # Multi-year trend detection
│   │   │   ├── extraction_service.js          # Document extraction
│   │   │   ├── openai_document_service.js     # GPT-based extraction
│   │   │   ├── comparison_service.js          # Vendor vs bank comparison
│   │   │   ├── credit_advisory_service.js     # Lending recommendations
│   │   │   ├── company_profile_service.js     # Company data aggregation
│   │   │   ├── data_conflict_service.js       # Data conflict resolution
│   │   │   ├── decision_dictionary.js         # Decision rules
│   │   │   ├── analyst_formatter.js           # Output formatting
│   │   │   ├── pdf_parser_service.js          # PDF parsing utilities
│   │   │   ├── comparisonService.js           # Legacy comparison
│   │   │   ├── extractionService.js           # Legacy extraction
│   │   │   ├── openaiDocumentService.js       # Legacy OpenAI integration
│   │   │   └── yearwise_vendor_sheet_service.js # Year-wise vendor analysis
│   │   │
│   │   └── templates/
│   │       └── shree.pdf           # Report template
│   │
│   ├── providers/
│   │   └── mcaProvider.js          # MCA API data provider
│   │
│   ├── utils/
│   │   ├── logger.js               # Winston structured logging
│   │   └── validator.js            # GSTIN validation utilities
│   │
│   └── financial-engine/
│       ├── index.js                # Main API: calculateFinancials()
│       ├── calculationEngine.js    # P&L, Balance Sheet, Ratio calculations
│       ├── constants.js            # Financial field definitions
│       ├── validation.js           # Input/output validation
│       └── reportMapper.js         # Financial → report field mapping
│
├── document-intelligence/
│   ├── index.js                    # Main DI API
│   ├── README.md                   # Module documentation
│   │
│   ├── ai/
│   │   ├── agentInterface.js       # AI agent policy guards
│   │   └── prompts.md              # Prompt templates
│   │
│   ├── compare/
│   │   └── compareEngine.js        # Bank vs vendor comparison
│   │
│   ├── confidence/
│   │   └── confidenceEngine.js     # Extraction confidence scoring
│   │
│   ├── contracts/
│   │   ├── ocrOutput.schema.json           # OCR output JSON schema
│   │   └── comparisonOutput.schema.json    # Comparison output JSON schema
│   │
│   ├── evidence/
│   │   ├── hash.js                 # SHA256 integrity hashing
│   │   ├── metadata.js             # Document metadata tracking
│   │   └── store.js                # Evidence file storage
│   │
│   ├── extractors/
│   │   ├── bankExtractor.js        # Bank statement extraction
│   │   ├── financialExtractor.js   # P&L / Balance Sheet extraction
│   │   └── itrExtractor.js         # ITR document extraction
│   │
│   └── ocr/
│       ├── ocrEngine.js            # Tesseract.js OCR orchestrator
│       ├── preprocess.js           # Image preprocessing (deskew, threshold)
│       └── normalize.js            # OCR text normalization
│
├── document-intelligence-data/     # File-based evidence storage
│   ├── cases_registry.json         # Case index
│   └── cases/                      # Per-case folders
│       └── CASE-XXXXXXXX-XXXX/
│           ├── metadata.json
│           ├── documents/
│           └── extractions/
│
├── logs/
│   └── financial-model/            # Financial analysis audit logs
│       └── fa_[timestamp]_[hash].json
│
├── scripts/
│   ├── analyze_financial_xlsx.mjs         # Excel financial analyzer
│   ├── run_financial_analysis_pair.mjs    # Pair comparison runner
│   ├── parse_excel.mjs                    # Excel parser
│   ├── run_km_extraction.mjs              # KM extraction script
│   ├── migrate_to_mongodb.mjs             # Data migration to MongoDB
│   └── print_architecture.mjs             # Architecture ASCII diagram
│
└── Documentation Files
    ├── README.md
    ├── PRODUCT_DOCUMENTATION.md
    ├── SUMMARY.md
    ├── AI_REPORT_GUIDE.md
    ├── BANK_STATEMENT_IDU.md
    └── MONGODB_DOCKER_INSTALLATION_GUIDE.md
```

---

## 5. Backend — Server & API

### Server Entry Point: `server/app.js`

The Express server (~850 lines) is the central hub serving both API routes and static HTML pages.

**Middleware Stack**:

| Middleware | Configuration |
|-----------|-------------|
| `helmet()` | Security headers (CSP relaxed for inline scripts) |
| `cors()` | All origins allowed |
| `express-rate-limit` | 600 requests / 15 minutes per IP |
| `express.json()` | JSON body parsing (50MB limit) |
| `express.urlencoded()` | Form data parsing |
| `express.static()` | Serves `server/public/` |
| `multer` | File uploads (memory storage) |

**Server Port**: `3000` (configurable via `PORT` env variable)

### Route Architecture

Routes are split between inline definitions in `app.js` and external route modules:

- **Inline routes** (in `app.js`): GST, MCA, Compliance, Case Management, OCR, Report
- **External routes**:
  - `src/routes/financialModelRoutes.js` → mounted at `/api/financial-model`
  - `src/routes/financialCalcRoutes.js` → mounted at `/api/financial-calc`

---

## 6. Frontend — Pages & UI

All pages use vanilla HTML5/CSS3/JS with no frameworks. The UI follows an **Odoo-inspired** sidebar design with a modern gradient theme.

### Page Inventory

| Page | File | Purpose | JavaScript |
|------|------|---------|-----------|
| **Landing** | `index.html` | Module card selector | Inline |
| **Dashboard** | `dashboard.html` | Case management hub | `dashboard.js` |
| **Case Workspace** | `case-workspace.html` | Main verification editor | `case-workspace.js` |
| **GST Module** | `gst.html` | GSTIN lookup & verification | Inline |
| **MCA Module** | `mca.html` | Company/CIN search | Inline |
| **Compliance** | `compliance.html` | Regulatory cross-checks | Inline |
| **Director** | `director.html` | Director profile lookup | Inline |
| **OCR** | `ocr.html` | Document OCR workspace | Inline |
| **Financial Calc** | `financial-calc.html` | Multi-year financial engine | `financial-calc.js` |
| **Report** | `report.html` | Report builder & PDF export | `report.js` |

### Landing Page (`index.html`)
- Animated particle background
- 4 module cards (GST, MCA, Compliance, UDYAM) with keyboard shortcuts (1/2/3/4)
- Modern gradient UI with hover effects

### Dashboard (`dashboard.html` + `dashboard.js`)
- KPI cards: Total, Pending, Ongoing, Completed cases
- Case listing table with status badges and risk pills
- Case creation modal
- Status filter dropdowns
- Sidebar navigation with role selector (Executive / Admin / Analyst)

### Case Workspace (`case-workspace.html` + `case-workspace.js`)
- Multi-block layout:
  - **Case Overview**: Manual business data entry
  - **Business Details**: GST, MCA, Compliance, PAN, UDYAM, ITR, Bank Statement, Field Data modules
  - **Personal Information**: Applicant, PAN, Aadhaar
  - **Report**: Final report assembly
- Real-time progress bar tracking
- Auto-save to localStorage + MongoDB
- Module-specific embedded forms (iframes for GST, MCA, Compliance)
- Status lifecycle management

### GST Module (`gst.html`)
- GSTIN input with regex validation
- Multi-method fetching (API → Puppeteer → third-party → demo)
- CAPTCHA-assisted verification workflow
- JSON data display & download

### MCA Module (`mca.html`)
- Company name/CIN search with autocomplete
- Company profile card (CIN, incorporation date, authorized capital)
- Director listing with click-through profiles
- JSON snapshot export

### Compliance Module (`compliance.html`)
- Real-time checks across 5 regulatory sources
- Color-coded risk flags (🟢 Clean / 🔴 Adverse)
- Summary dashboard with total checks count
- Detailed findings table with timestamps

### Financial Calculation (`financial-calc.html` + `financial-calc.js`)
- Schema-driven multi-year (3-year) input forms
- Real-time calculation output
- Ratio panels: Profitability, Liquidity, Leverage, Growth
- MSME eligibility flags
- Sample data loader for testing
- JSON export capability

### Report Builder (`report.html` + `report.js`)
- Module selection checkboxes
- AI summary generation per module
- Two-column layout: Module data + live PDF preview
- Image uploads (field photos, signature, stamp)
- Puppeteer-rendered PDF download
- Print-ready formatting

---

## 7. Core Modules

### GST Module (`src/core/gstModule.js`)

The primary orchestrator for all GST-related operations.

**Capabilities**:
- Single & batch GSTIN validation + fetching
- Rate-limited with concurrency control (max 2 concurrent)
- Multi-method fallback chain:
  1. Official GST Portal API (with session/cookie management)
  2. Puppeteer-based web scraping
  3. Third-party API fallback
  4. Demo data for testing
- In-memory cache with 1-hour TTL
- Queue-based request management (p-queue)
- Structured JSON output with key fields:
  - GSTIN, Legal Name, Trade Name, Status
  - Taxpayer Type, Registration Date
  - Principal Address, Additional Addresses
  - Filing Status by year

### Entity Resolver (`src/core/entityResolver.js`)

Fuzzy entity matching engine for cross-source identity verification.

**Functions**:
| Function | Description |
|----------|-------------|
| `normalizeName()` | Lowercase, abbreviation expansion, punctuation removal |
| `tokenize()` | Split text into filtered tokens |
| `tokenSortRatio()` | Fuzzy token-based string matching |
| `directorCrossMatch()` | Director list overlap scoring |
| `addressSimilarity()` | Address field matching |
| `resolveIdentityConfidence()` | Weighted confidence: 65% name + 20% directors + 15% address |

---

## 8. Document Intelligence Module

**Path**: `document-intelligence/`

A self-contained module for document ingestion, OCR, extraction, comparison, and evidence management.

### Pipeline

```
Document (PDF/Image)
  │
  ▼ (Evidence Store — SHA256 hash)
OCR Engine (Tesseract.js + Canvas)
  │  ↳ Preprocess: deskew, threshold, denoise
  │
  ▼
OCR Output (pages, words, bounding boxes, confidence)
  │
  ▼
Module-Specific Extractor
  │  ├── bankExtractor.js    → Account details, transactions
  │  ├── financialExtractor.js → P&L, Balance Sheet fields
  │  └── itrExtractor.js    → Income, deductions, schedule data
  │
  ▼
Extracted Fields (with confidence scores)
  │
  ▼ (If pair comparison)
Compare Engine → Reconciliation table, Risk flags
  │
  ▼
Confidence Engine → Final confidence scores
```

### Sub-Modules

| Sub-Module | File(s) | Purpose |
|-----------|---------|---------|
| **OCR Engine** | `ocr/ocrEngine.js` | Tesseract.js orchestrator: PDF → PNG → OCR |
| **Preprocessor** | `ocr/preprocess.js` | Image deskew, thresholding, noise removal |
| **Normalizer** | `ocr/normalize.js` | OCR text cleanup & format standardization |
| **Bank Extractor** | `extractors/bankExtractor.js` | Bank statement field extraction |
| **Financial Extractor** | `extractors/financialExtractor.js` | P&L / Balance Sheet extraction |
| **ITR Extractor** | `extractors/itrExtractor.js` | Income Tax Return extraction |
| **Compare Engine** | `compare/compareEngine.js` | Bank vs vendor statement comparison |
| **Confidence Engine** | `confidence/confidenceEngine.js` | Extraction confidence scoring |
| **AI Agent Interface** | `ai/agentInterface.js` | AI policy guards & interaction rules |
| **Evidence Hash** | `evidence/hash.js` | SHA256 document integrity hashing |
| **Evidence Metadata** | `evidence/metadata.js` | Document metadata tracking |
| **Evidence Store** | `evidence/store.js` | File-based evidence storage |

### JSON Schemas (Contracts)

- `contracts/ocrOutput.schema.json` — Defines OCR output structure
- `contracts/comparisonOutput.schema.json` — Defines comparison output structure

---

## 9. Financial Engine

**Path**: `src/financial-engine/`

A standalone calculation engine for multi-year financial analysis.

### Entry Point: `index.js` → `calculateFinancials()`

**Input**: 3 years of financial data with 35+ line items per year

**Calculation Modules** (in `calculationEngine.js`):

| Calculation | Fields Computed |
|------------|-----------------|
| **P&L Statement** | Revenue, COGS, Gross Profit, Operating Expenses, EBITDA, Depreciation, EBIT, Interest, PBT, Tax, PAT, Cash Accruals |
| **Balance Sheet** | Total Assets, Current/Non-Current Assets, Total Liabilities, Current/Non-Current Liabilities, Net Worth, Capital Employed |
| **Profitability Ratios** | Gross Margin, PBILDT Margin, APAT Margin, ROCE, ROE |
| **Liquidity Ratios** | Current Ratio, Quick Ratio, Working Capital, Working Capital Turnover |
| **Leverage Ratios** | Debt-to-Equity, Gearing Ratio, Interest Coverage, Total Debt/Total Assets |
| **Solvency Ratios** | Debt Service Coverage, Total Leverage |
| **Turnover Ratios** | Inventory Turnover, Receivables Turnover, Payables Turnover |
| **Growth Metrics** | Revenue Growth (YoY), PAT Growth (YoY), Asset Growth (YoY) |
| **MSME Eligibility** | Investment threshold, Turnover threshold, Eligibility flags |

### Supporting Files

| File | Purpose |
|------|---------|
| `constants.js` | Financial field definitions, thresholds, label mappings |
| `validation.js` | Input schema validation, output integrity checks |
| `reportMapper.js` | Maps computed financials to report-ready format |

### Reconciliation Tolerances

| Tier | Threshold | Meaning |
|------|-----------|---------|
| Exact | 0.5% | Values match closely |
| Minor | 2% | Acceptable variance |
| Material | 5% | Needs review |
| Critical | >5% | Red flag |

---

## 10. Financial Model Services

**Path**: `src/services/financial-model/`  
**File Count**: 22 specialized service files

### Service Inventory

| Service | File | Purpose |
|---------|------|---------|
| **Main Orchestrator** | `financial_analysis_service.js` | End-to-end financial analysis workflow |
| **Ratio Engine** | `ratio_engine.js` | Financial ratio calculation library |
| **Risk Engine** | `risk_engine.js` | Risk factor detection & scoring |
| **Summary Engine** | `summary_engine.js` | AI-based narrative summary generation |
| **Confidence Service** | `confidence_service.js` | Extraction confidence assessment |
| **Data Reliability** | `data_reliability_service.js` | Source data quality scoring |
| **Calculation Audit** | `calculation_audit_service.js` | Audit trail for all computations |
| **PDF Report** | `financial_report_pdf.js` | Financial analysis PDF generation |
| **Trend Analysis** | `trend_analysis_service.js` | Multi-year trend detection |
| **Extraction Service** | `extraction_service.js` | Document field extraction orchestration |
| **OpenAI Document** | `openai_document_service.js` | GPT-based document parsing |
| **Comparison Service** | `comparison_service.js` | Vendor vs bank statement comparison |
| **Credit Advisory** | `credit_advisory_service.js` | Lending recommendation engine |
| **Company Profile** | `company_profile_service.js` | Company data aggregation |
| **Data Conflict** | `data_conflict_service.js` | Cross-source data conflict resolver |
| **Decision Dictionary** | `decision_dictionary.js` | Decision rules & thresholds |
| **Analyst Formatter** | `analyst_formatter.js` | Credit analyst output formatting |
| **PDF Parser** | `pdf_parser_service.js` | PDF parsing utilities |
| **Yearwise Vendor** | `yearwise_vendor_sheet_service.js` | Year-wise vendor sheet analysis |
| **Comparison (legacy)** | `comparisonService.js` | Legacy comparison service |
| **Extraction (legacy)** | `extractionService.js` | Legacy extraction service |
| **OpenAI (legacy)** | `openaiDocumentService.js` | Legacy OpenAI integration |

---

## 11. Compliance Module

### Main Service: `src/services/complianceService.js`

Performs regulatory compliance checks across 5 independent sources.

### Sub-Services (`src/services/compliance/`)

| Service | File | Source Checked |
|---------|------|---------------|
| **NCLT Service** | `ncltService.js` | National Company Law Tribunal — insolvency/liquidation orders |
| **SEBI Service** | `sebiService.js` | Securities and Exchange Board of India — enforcement actions |
| **Court Service** | `courtService.js` | Court portals — active litigation |
| **Exchange Service** | `exchangeService.js` | NSE/BSE — defaulter & expelled member lists |
| **Web Evidence** | `webEvidenceService.js` | Web-based evidence collection |
| **Decision Engine** | `complianceDecision.js` | Decision logic & risk classification |
| **Report Narrator** | `reportNarrator.js` | Narrative compliance summary generation |

### Output Format

```json
{
  "companyName": "...",
  "cin": "...",
  "checkDate": "2026-03-11",
  "sources": [
    {
      "name": "NCLT",
      "status": "Clean" | "Adverse",
      "findings": [...],
      "timestamp": "..."
    }
  ],
  "overallRisk": "Low" | "Medium" | "High",
  "narrativeSummary": "..."
}
```

---

## 12. Services Layer

### Core Services

| Service | File | Description |
|---------|------|-------------|
| **GST Fetcher** | `gstFetcher.js` | Fetches GST data from official portal with cookie/session management |
| **GST Proxy** | `gstProxyService.js` | User-assisted CAPTCHA solving proxy for GST portal |
| **Search Service** | `searchService.js` | Google-based company name autocomplete |
| **MCA Search** | `mcaSearchService.js` | MCA portal company search wrapper |
| **Zauba Service** | `zaubaService.js` | ZaubaCorp company data provider |
| **Report Service** | `reportService.js` | AI-powered report generation using AWS Bedrock Claude |
| **Bedrock Client** | `bedrockClient.js` | AWS Bedrock Runtime SDK client for Claude invocations |
| **Case DB Service** | `caseDbService.js` | MongoDB CRUD for Cases and CaseSnapshots |
| **Third Party API** | `thirdPartyAPI.js` | Fallback GST data provider |
| **Data Formatter** | `dataFormatter.js` | Output formatting & standardization |

### Provider Layer

| Provider | File | Description |
|----------|------|-------------|
| **MCA Provider** | `mcaProvider.js` | MCA API integration (company masterdata, directors) |

---

## 13. Database Models & Schemas

### MongoDB Database: `gst_module`

### Case Model (`src/models/Case.js`)

```javascript
{
  caseId:        String   // Unique identifier (auto-generated), indexed
  businessName:  String   // Company/business name
  businessType:  String   // Type of business
  purpose:       String   // Purpose of due diligence
  gstin:         String   // GST Identification Number
  cin:           String   // Corporate Identity Number
  assignedTo:    String   // Assigned analyst/executive
  status:        String   // "draft" | "pending" | "ongoing" | "completed"
  risk:          String   // "low" | "medium" | "high"
  progress:      Number   // 0-100 completion percentage
  moduleStatuses: Object  // Per-module status tracking
  extra:         Object   // Flexible additional data store
  createdAt:     Date     // Auto-managed timestamp
  updatedAt:     Date     // Auto-managed timestamp
}
```

### CaseSnapshot Model (`src/models/CaseSnapshot.js`)

```javascript
{
  caseId:    String    // Reference to parent Case, indexed
  moduleKey: String    // Module identifier, indexed
  data:      Mixed     // Module-specific data (any structure)
  isLatest:  Boolean   // Whether this is the latest snapshot, indexed
  savedAt:   Date      // When data was captured
  createdAt: Date      // Auto-managed
  updatedAt: Date      // Auto-managed
}

// Compound Index: (caseId, moduleKey, isLatest)
```

### Stored Module Keys

| Key | Module | Data Stored |
|-----|--------|-------------|
| `gst` | GST Module | GSTIN data, filing status |
| `mca` | MCA Module | Company profile, directors |
| `compliance` | Compliance Module | Check results, risk flags |
| `pan` | PAN Module | PAN details, photos |
| `udyam` | UDYAM Module | Certificate data |
| `itr` | ITR Module | Income tax return data |
| `bank_statement` | Bank Statement | Account & transaction data |
| `financial` | Financial Module | Calculated financials |
| `case_overview` | Case Overview | Manual business data |
| `personal_info` | Personal Info | Applicant details |
| `field_data` | Field Verification | On-ground verification data |
| `business_summary` | Business Summary | Overview text |
| `financial_remark` | Financial Remark | Analyst financial notes |
| `ai_summary` | AI Summary | AI-generated summaries |
| `selected_mca_directors` | Director Selection | Selected directors for report |
| `resident_verification` | Resident Verification | Address verification |
| `report_images` | Report Images | Uploaded images for report |

---

## 14. AI / ML Integrations

### 1. AWS Bedrock + Claude (`src/services/bedrockClient.js`)

| Property | Value |
|----------|-------|
| **Provider** | AWS Bedrock Runtime |
| **Model** | `us.anthropic.claude-sonnet-4-6` |
| **Region** | `ap-south-1` |
| **SDK** | `@aws-sdk/client-bedrock-runtime` |

**Used For**:
- Module AI summary generation
- Overall case observation synthesis
- Financial narrative writing
- Compliance report narration
- Due diligence report text generation

### 2. OpenAI GPT (`src/services/financial-model/openai_document_service.js`)

| Property | Value |
|----------|-------|
| **Provider** | OpenAI |
| **Model** | `gpt-4.1-mini` (configurable) |
| **SDK** | `openai` v6.17.0 |

**Used For**:
- PDF document field extraction
- Financial statement parsing from uploaded documents
- Confidence estimation on extracted values
- Data conflict resolution

### 3. Tesseract.js OCR (`document-intelligence/ocr/ocrEngine.js`)

| Property | Value |
|----------|-------|
| **Library** | Tesseract.js 5.1.0 |
| **Language** | English (`eng.traineddata`) |
| **Preprocessing** | Deskew, threshold, denoise (via sharp + @napi-rs/canvas) |

**Pipeline**:
1. PDF → PNG rasterization (pdfjs-dist + @napi-rs/canvas)
2. Image preprocessing (deskew, threshold, normalize)
3. Tesseract OCR → word-level bounding boxes + confidence
4. Post-processing → clean text, format validation

---

## 15. API Endpoints Reference

### Health & Utility

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Server health check |
| `GET` | `/api/queue/status` | GST request queue status |
| `POST` | `/api/cache/clear` | Clear GST in-memory cache |

### GST Module

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/gst/:gstin` | Fetch GST data by GSTIN |
| `POST` | `/api/gst/search` | GST verification with CAPTCHA flow |
| `POST` | `/api/gst/batch` | Batch GST fetching (multiple GSTINs) |
| `GET` | `/api/captcha` | Get CAPTCHA image from GST portal |
| `GET` | `/api/filing/years` | Get available filing year list |
| `POST` | `/api/filing/status` | Check GST filing status for a year |

### MCA Module

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/fetch-mca` | Fetch company data by CIN |
| `POST` | `/api/search-companies` | Company name autocomplete (Google) |
| `POST` | `/api/mca/search-companies` | MCA direct company search |
| `POST` | `/api/fetch-director` | Fetch director details by DIN |

### Case Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/cases` | List all cases (with filters) |
| `POST` | `/api/cases` | Create new case |
| `DELETE` | `/api/cases/:caseId` | Delete a case |
| `POST` | `/api/case/save-snapshot` | Save module data snapshot |
| `GET` | `/api/case/:caseId/snapshot/:moduleKey` | Get latest module snapshot |
| `GET` | `/api/case/:caseId/meta` | Get case metadata |
| `POST` | `/api/case/:caseId/pan/photo` | Upload PAN photo (multer) |
| `POST` | `/api/case/:caseId/udyam/pdf` | Upload UDYAM PDF (multer) |

### Financial Module

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/financial-reconciliation` | Compare bank vs vendor statements |
| `POST` | `/api/financial-reconciliation/pdf` | Generate reconciliation PDF |
| `POST` | `/api/financial-model/report` | Download financial analysis PDF |
| `POST` | `/api/financial-model/analyze-company` | Run financial analysis |
| `POST` | `/api/financial-model/yearwise-analysis` | Multi-year vendor analysis |
| `GET` | `/api/financial-calc/schema` | Get financial input schema |
| `POST` | `/api/financial-calc/calculate` | Run calculation engine |
| `POST` | `/api/financial-calc/report` | Generate MSME financial report |

### Compliance Module

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/check-compliance` | Run compliance checks (5 sources) |
| `POST` | `/api/check-compliance/pdf` | Generate compliance PDF report |

### OCR & Document Processing

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/ocr/auto-perform` | Auto-OCR a document upload |
| `POST` | `/api/pdf/page-count` | Get PDF page count |

### Reporting & AI

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/module-ai-summary` | Generate AI summary for a module |
| `POST` | `/api/report/module-verification-summary` | Module verification summary |
| `POST` | `/api/report/overall-observation` | Generate final observation |
| `POST` | `/api/generate-report` | Legacy report generation |
| `POST` | `/api/generate-due-diligence-report` | Full DD report (Puppeteer PDF) |

### Frontend Page Routes

| Method | Path | Serves |
|--------|------|--------|
| `GET` | `/` | `index.html` |
| `GET` | `/dashboard` | `dashboard.html` |
| `GET` | `/case-workspace` | `case-workspace.html` |
| `GET` | `/report` | `report.html` |
| `GET` | `/financial-calc` | `financial-calc.html` |
| `GET` | `/ocr` | `ocr.html` |

---

## 16. Frontend Assets

### CSS Files

| File | Scope |
|------|-------|
| `theme.css` | Global theme (colors, fonts, variables, layout primitives) |
| `case-workspace.css` | Case workspace page styles |
| `dashboard.css` | Dashboard page styles |
| `financial-calc.css` | Financial calculator styles |
| `report.css` | Report builder styles |

### JavaScript Files

| File | Lines | Scope |
|------|-------|-------|
| `case-workspace.js` | Large | Full case workspace client-side logic |
| `dashboard.js` | Medium | Dashboard CRUD, filters, KPIs |
| `financial-calc.js` | Large | Schema-driven form generation, calculation display |
| `report.js` | Large | Report assembly, AI summary calls, PDF generation |

### Static Assets

| File | Purpose |
|------|---------|
| `SIGN.jpeg` | Officer signature image for reports |
| `stamp.png` | Official stamp image for reports |

---

## 17. Scripts & Utilities

| Script | Command | Purpose |
|--------|---------|---------|
| `analyze_financial_xlsx.mjs` | `npm run financial:xlsx` | Parse & analyze financial Excel files |
| `run_financial_analysis_pair.mjs` | `npm run financial:pair` | Compare two financial PDF documents |
| `parse_excel.mjs` | (direct) | Parse Excel to JSON |
| `run_km_extraction.mjs` | (direct) | KM document extraction |
| `migrate_to_mongodb.mjs` | `npm run migrate:mongodb` | Migrate file-based data to MongoDB |
| `print_architecture.mjs` | `npm run arch` | Generate ASCII architecture diagram |

### npm Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `start` | `npm start` | Start production server (`src/index.js`) |
| `dev` | `npm run dev` | Start with file watching (`--watch`) |
| `server` | `npm run server` | Start Express server only |
| `server:dev` | `npm run server:dev` | Start server with nodemon |
| `mongo:start` | `npm run mongo:start` | Start MongoDB Docker container |
| `mongo:stop` | `npm run mongo:stop` | Stop MongoDB Docker container |
| `app:start` | `npm run app:start` | Start MongoDB + Express server |
| `app:dev` | `npm run app:dev` | Start MongoDB + Express (dev mode) |
| `app:status` | `npm run app:status` | Check MongoDB + server health |
| `scrape` | `npm run scrape` | Run web scraper |
| `test` | `npm test` | Run Node.js built-in test runner |

---

## 18. Configuration & Environment

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `MONGO_URI` | `mongodb://127.0.0.1:27017/gst_module` | MongoDB connection string |
| `BEDROCK_API_KEY` | — | AWS Bedrock API key |
| `AWS_REGION` | `ap-south-1` | AWS region for Bedrock |
| `OPENAI_API_KEY` | — | OpenAI API key |
| `LOG_LEVEL` | `info` | Winston log level |
| `NODE_ENV` | `development` | Environment mode |

### GST Config (`src/config/config.js`)

- Portal URLs & endpoints
- Session timeout durations
- Retry counts & intervals
- CAPTCHA configuration
- Feature flags (e.g., demo mode)

### Database Config (`src/config/database.js`)

- Mongoose connection using `MONGO_URI`
- Connection options (poolSize, etc.)
- Auto-reconnect handling

---

## 19. Security & Access Control

| Layer | Implementation |
|-------|---------------|
| **HTTP Security** | Helmet.js — CSP, HSTS, X-Frame-Options, X-Content-Type |
| **Rate Limiting** | 600 requests / 15 minutes per IP |
| **CORS** | Enabled (configurable origins) |
| **Input Validation** | GSTIN regex validation; Case ID sanitization |
| **File Uploads** | MIME type restrictions (images, PDFs only); memory storage via multer |
| **Document Integrity** | SHA256 hashing for all ingested documents |
| **Audit Logging** | Winston logs all operations; Financial model audit JSON logs |
| **UI Roles** | Executive / Admin / Analyst role selector in dashboard |

---

## 20. Deployment & DevOps

### Prerequisites

- Node.js 18+
- Docker (for MongoDB)
- AWS credentials (for Bedrock)
- OpenAI API key (for document extraction)

### Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start MongoDB (Docker)
npm run mongo:start

# 3. Start the server
npm run server

# 4. Open browser
# → http://localhost:3000
```

### Development Mode

```bash
# Auto-restart on changes
npm run app:dev

# Or with file watching
npm run dev
```

### Docker MongoDB Container

| Property | Value |
|----------|-------|
| Container Name | `gst-mongo` |
| Image | `mongo:4.4` |
| Port | `27017` |
| Volume | `gst_mongo_data:/data/db` |

### Health Check

```bash
npm run app:status
# → Shows Docker container status + API health response
```

---

## 21. Key Workflows

### Workflow 1: GST + MCA Verification

```
Dashboard → Create Case
  ↓
Case Workspace → Enter GSTIN, CIN
  ↓
GST Module → Auto-fetch GSTIN data (API → Puppeteer → fallback)
  ↓
MCA Module → Search company, fetch profile + directors
  ↓
Entity Resolver → Cross-match GST ↔ MCA (name, address, directors)
  ↓
Save Snapshots → MongoDB (gst, mca module keys)
  ↓
Report → Generate AI summary → PDF download
```

### Workflow 2: Financial Analysis

```
Upload Documents (Bank Statement + Vendor Financials)
  ↓
OCR Pipeline → Tesseract extraction → Structured JSON
  ↓
Financial Extractor → P&L, Balance Sheet fields
  ↓
Comparison Service → Bank vs Vendor reconciliation (tolerance: 0.5%–5%)
  ↓
Financial Engine → Ratios, profitability, leverage, growth
  ↓
Risk Engine → Risk scoring & red flags
  ↓
Credit Advisory → Lending recommendations
  ↓
PDF Report → Financial analysis report download
```

### Workflow 3: Compliance Check

```
Enter Company Name + CIN
  ↓
Parallel Checks:
  ├── NCLT → Insolvency/liquidation orders
  ├── SEBI → Enforcement actions
  ├── Courts → Active litigation
  ├── NSE → Defaulter lists
  └── BSE → Expelled members
  ↓
Risk Classification → Clean / Adverse per source
  ↓
Narrative Summary → AI-generated compliance text
  ↓
PDF Report → Compliance report download
```

### Workflow 4: Due Diligence Report Generation

```
Case Workspace → All modules completed
  ↓
Report Page → Select modules to include
  ↓
AI Summary → Generate per-module summaries (Bedrock Claude)
  ↓
Overall Observation → Synthesize final assessment
  ↓
Add Metadata → Officer signature, stamp, images
  ↓
Puppeteer → Render HTML → Generate PDF
  ↓
Download → Bank-ready due diligence report
```

---

## 22. Dependencies — Full List

### Production Dependencies (30)

| Package | Version | Category |
|---------|---------|----------|
| `@anthropic-ai/sdk` | ^0.78.0 | AI — Claude SDK |
| `@aws-sdk/client-bedrock-runtime` | ^3.1004.0 | AI — AWS Bedrock |
| `@napi-rs/canvas` | ^0.1.74 | Image — Canvas rendering |
| `axios` | ^1.6.5 | HTTP — Client |
| `axios-cookiejar-support` | ^6.0.5 | HTTP — Cookie management |
| `chalk` | ^5.3.0 | CLI — Colored output |
| `cheerio` | ^1.0.0-rc.12 | Scraping — HTML parser |
| `cors` | ^2.8.6 | Server — CORS middleware |
| `dotenv` | ^16.3.1 | Config — Environment variables |
| `express` | ^4.22.1 | Server — Web framework |
| `express-rate-limit` | ^7.5.1 | Security — Rate limiting |
| `file-type` | ^19.6.0 | Utility — MIME detection |
| `helmet` | ^7.2.0 | Security — HTTP headers |
| `mongoose` | ^9.2.4 | Database — MongoDB ODM |
| `multer` | ^1.4.5-lts.1 | Server — File uploads |
| `node-cache` | ^5.1.2 | Cache — In-memory caching |
| `openai` | ^6.17.0 | AI — OpenAI SDK |
| `ora` | ^8.0.1 | CLI — Spinners |
| `p-queue` | ^8.0.1 | Utility — Concurrency control |
| `pdf-lib` | ^1.17.1 | PDF — Manipulation |
| `pdfjs-dist` | ^4.10.38 | PDF — Parsing |
| `pdfkit` | ^0.17.2 | PDF — Creation |
| `puppeteer` | ^22.0.0 | Automation — Browser control |
| `retry` | ^0.13.1 | Utility — Retry logic |
| `sharp` | ^0.33.5 | Image — Processing |
| `tesseract.js` | ^5.1.0 | OCR — Text recognition |
| `tough-cookie` | ^6.0.0 | HTTP — Cookie jar |
| `winston` | ^3.11.0 | Logging — Structured logs |
| `xlsx` | ^0.18.5 | Data — Excel processing |

### Dev Dependencies (1)

| Package | Version | Category |
|---------|---------|----------|
| `nodemon` | ^3.1.11 | Dev — Auto-restart |

---

## 23. Module Status Matrix

| Module | Backend | Frontend | AI | OCR | Database | Status |
|--------|---------|----------|----|-----|----------|--------|
| **GST** | ✅ | ✅ | — | — | ✅ MongoDB | Production |
| **MCA** | ✅ | ✅ | — | — | ✅ MongoDB | Production |
| **Compliance** | ✅ | ✅ | ✅ Bedrock | — | ✅ MongoDB | Active |
| **PAN** | ✅ | ✅ | — | — | ✅ MongoDB | Functional |
| **UDYAM** | ⚠️ Partial | ✅ | — | — | ✅ MongoDB | Partial |
| **ITR** | ✅ | ✅ | — | ✅ Tesseract | ✅ File | Functional |
| **Bank Statement** | ✅ | ✅ | ✅ OpenAI | ✅ Tesseract | ✅ File | Production |
| **Financial Calc** | ✅ | ✅ | — | — | In-memory | Production |
| **Financial Model** | ✅ | ✅ | ✅ Both | ✅ Tesseract | ✅ MongoDB + Logs | Production |
| **OCR Workspace** | ✅ | ✅ | — | ✅ Tesseract | ✅ File | Production |
| **Report Builder** | ✅ | ✅ | ✅ Bedrock | — | ✅ MongoDB | Production |
| **Dashboard** | ✅ | ✅ | — | — | ✅ MongoDB | Production |
| **Case Workspace** | ✅ | ✅ | — | — | ✅ MongoDB + localStorage | Production |
| **Director Lookup** | ✅ | ✅ | — | — | — | Production |

---

## Summary

**CrediVerify 360** is a full-stack, AI-powered due-diligence platform comprising:

- **~85+ source files** across backend, frontend, and modules
- **40+ REST API endpoints**
- **10 frontend pages** (vanilla HTML/CSS/JS)
- **22 financial model services**
- **7 compliance sub-services**
- **3 OCR extractors** (bank, financial, ITR)
- **2 AI providers** (AWS Bedrock Claude + OpenAI GPT)
- **2 database backends** (MongoDB + file system)
- **30 npm dependencies**
- **14 verification modules** tracking full case lifecycle

---

*Document generated on 11 March 2026*
