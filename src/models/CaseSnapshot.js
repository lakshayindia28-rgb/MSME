import { mongoose } from '../config/database.js';

const { Schema } = mongoose;

const snapshotSchema = new Schema({
  caseId: { type: String, required: true, index: true },
  moduleKey: { type: String, required: true, index: true },
  data: { type: Schema.Types.Mixed, required: true },
  isLatest: { type: Boolean, default: true, index: true },
  savedAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

// Compound index for fast latest-snapshot lookup
snapshotSchema.index({ caseId: 1, moduleKey: 1, isLatest: 1 });
// Compound index for efficient history queries and retention cleanup
snapshotSchema.index({ caseId: 1, moduleKey: 1, savedAt: -1 });

const CaseSnapshot = mongoose.model('CaseSnapshot', snapshotSchema);
export default CaseSnapshot;
