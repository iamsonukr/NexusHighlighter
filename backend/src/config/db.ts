import mongoose from 'mongoose';
import { config } from './env.js';
import { logger } from '../utils/logger.js';

export async function connectDb(): Promise<void> {
  mongoose.set('strictQuery', true);
  await mongoose.connect(config.mongodbUri);
  logger.info('mongodb_connected', { db: mongoose.connection.name });

  mongoose.connection.on('error', (err) => {
    logger.error('mongodb_error', { message: err.message });
  });
}
