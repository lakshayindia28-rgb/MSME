import mongoose from 'mongoose';
import { logger } from '../utils/logger.js';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/gst_module';

let isConnected = false;

export async function connectDB() {
  if (isConnected) return;

  try {
    await mongoose.connect(MONGO_URI);
    isConnected = true;
    logger.info(`MongoDB connected: ${mongoose.connection.host}`);
  } catch (err) {
    logger.error('MongoDB connection error:', err);
    throw err;
  }

  mongoose.connection.on('error', (err) => {
    logger.error('MongoDB runtime error:', err);
    isConnected = false;
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
    isConnected = false;
  });
}

export { mongoose };
