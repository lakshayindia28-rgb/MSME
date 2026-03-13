import { mongoose } from '../config/database.js';

const { Schema } = mongoose;

const caseSchema = new Schema({
  caseId: { type: String, required: true, unique: true, index: true },
  businessName: { type: String, default: '' },
  businessType: { type: String, default: '' },
  purpose: { type: String, default: '' },
  gstin: { type: String, default: '' },
  cin: { type: String, default: '' },
  assignedTo: { type: String, default: '' },
  status: { type: String, default: 'pending', index: true },
  risk: { type: String, default: 'medium' },
  progress: { type: Number, default: 0 },
  moduleStatuses: { type: Schema.Types.Mixed, default: {} },
  // Store any extra fields the frontend sends
  extra: { type: Schema.Types.Mixed, default: {} }
}, {
  timestamps: true,
  strict: false  // allow unstructured extra fields
});

const Case = mongoose.model('Case', caseSchema);
export default Case;
