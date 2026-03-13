# GST Record Fetcher Module

A modular Node.js application to fetch and display GST records from the official Indian Government GST portal.

## Product Description
The system compares financial information across two submitted documents and produces a structured reconciliation dataset for MSME credit appraisal workflows.

## Clarification
This system provides verified comparable financial evidence. Final interpretation and lending decision remains with the credit analyst or chartered accountant.

## 🎯 Features

- ✅ Validates GSTIN format
- 📡 Fetches data from official GST portal
- 🖨️ Displays data in exact format as shown on government portal
- 🔄 Retry mechanism for network failures
- 📦 Modular architecture for easy integration
- 🚀 Can be integrated into larger systems

## 📁 Project Structure

```
GST MODULE/
├── src/
│   ├── config/
│   │   └── config.js           # Configuration settings
│   ├── core/
│   │   └── gstModule.js        # Main orchestrator
│   ├── services/
│   │   ├── gstFetcher.js       # API/Portal interaction
│   │   └── dataFormatter.js    # Output formatting
│   ├── utils/
│   │   └── validator.js        # GSTIN validation
│   └── index.js                # Entry point
├── package.json
├── .env.example
└── README.md
```

## 🚀 Installation

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file (optional):
```bash
cp .env.example .env
```

## 📖 Usage

### Command Line

```bash
# Using npm
npm start 27AAPFU0939F1ZV

# Or directly with node
node src/index.js 27AAPFU0939F1ZV
```

### As a Module (for integration)

```javascript
import { GSTModule } from './src/core/gstModule.js';

const gstModule = new GSTModule();

// Fetch single record
const result = await gstModule.getGSTRecord('27AAPFU0939F1ZV');
console.log(result.formatted);

// Fetch multiple records
const results = await gstModule.getMultipleGSTRecords([
  '27AAPFU0939F1ZV',
  '29AAGCB7383E1Z1'
]);
```

## 🔧 Configuration

Edit `.env` file to customize:

```env
GST_PORTAL_BASE_URL=https://services.gst.gov.in
REQUEST_TIMEOUT=30000
MAX_RETRIES=3
OUTPUT_FORMAT=console
```

## 🧩 Modular Design

This module is designed to be part of a larger system:

1. **Independent Operation**: Can run standalone
2. **Easy Integration**: Import `GSTModule` class into other projects
3. **Configurable**: All settings via config files
4. **Extensible**: Add more features without breaking existing code

## ⚠️ Important Notes

1. **API Endpoint**: The actual GST portal may require:
   - Captcha solving
   - Authentication tokens
   - Different API endpoints
   
2. **Rate Limiting**: Implement delays between requests to avoid blocking

3. **Legal Compliance**: Ensure usage complies with government portal terms of service

## 🔜 Future Enhancements

- PDF export functionality
- Database integration
- Web interface
- Bulk processing with CSV import/export
- Integration with reconciliation evidence workflows

## 📝 License

ISC

---

**Part of a larger modular system** - More modules will be added and integrated over time.
