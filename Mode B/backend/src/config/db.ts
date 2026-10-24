import mongoose from 'mongoose';
import { requiredEnvironment } from './env';

let connectionPromise: Promise<any> | null = null;

async function connectDatabase() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (!connectionPromise) {
    connectionPromise = mongoose.connect(requiredEnvironment('MONGODB_URI'), {
      serverSelectionTimeoutMS: 10000,
    });
  }

  try {
    await connectionPromise;

    console.error('MongoDB connected:', mongoose.connection.name);
    console.error('MongoDB host:', mongoose.connection.host);

    return mongoose.connection;
  } catch (error) {
    connectionPromise = null;
    throw error;
  }
}

async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    console.error('MongoDB disconnected');
  }

  connectionPromise = null;
}

let connectionHeld = false;

async function holdDatabaseConnection(): Promise<void> {
  await connectDatabase();
  connectionHeld = true;
}

async function withDatabase<T>(operation: () => Promise<T>): Promise<T> {
  if (connectionHeld) {
    return operation();
  }

  try {
    await connectDatabase();
    return await operation();
  } finally {
    await disconnectDatabase();
  }
}

function callWithDatabase<A extends unknown[], T>(service: (...args: A) => Promise<T>, ...args: A): Promise<T> {
  return withDatabase(() => service(...args));
}

export { connectDatabase, disconnectDatabase, withDatabase, callWithDatabase, holdDatabaseConnection };
