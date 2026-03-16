import { mongoose } from '../config/database.js';
import crypto from 'node:crypto';

const { Schema } = mongoose;

const userSchema = new Schema({
  username: { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  salt: { type: String, required: true },
  role: { type: String, enum: ['admin', 'user'], default: 'user' },
  createdBy: { type: String, default: 'system' }
}, { timestamps: true });

userSchema.statics.generateSalt = function () {
  return crypto.randomBytes(16).toString('hex');
};

userSchema.statics.hashPassword = function (password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
};

userSchema.methods.verifyPassword = function (password) {
  const hash = crypto.scryptSync(password, this.salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(this.passwordHash, 'hex'));
};

const User = mongoose.model('User', userSchema);

export default User;
