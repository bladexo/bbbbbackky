import mongoose from 'mongoose';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const MONGODB_URI = 'mongodb+srv://dinnodee2:Tuzqyw4IEbnUqYLb@cluster0.aic2jaq.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const DB_OPTIONS = {
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
};

const DB_NAME = 'chatapp';

// Connection states for better logging
const STATES = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
  99: 'uninitialized'
};

export const getConnectionStatus = () => {
  const state = mongoose.connection.readyState;
  return {
    state: STATES[state as keyof typeof STATES],
    host: mongoose.connection.host,
    name: mongoose.connection.name,
    port: mongoose.connection.port
  };
};

export const logConnectionStatus = () => {
  const status = getConnectionStatus();
  console.log('🔍 MongoDB Connection Status:', {
    state: status.state,
    host: status.host || 'N/A',
    database: status.name || 'N/A',
    port: status.port || 'N/A'
  });
};

// Function to initialize collections
async function initializeCollections(db: mongoose.Connection) {
  try {
    // Create collections if they don't exist
    const collections = [
      'users',
      'messages',
      'leaderboard',
      'chatrooms'
    ];

    const database = db.db;
    if (!database) {
      throw new Error('Database not initialized');
    }

    for (const collectionName of collections) {
      if (!(await database.listCollections({ name: collectionName }).next())) {
        await database.createCollection(collectionName);
        console.log(`✨ Created collection: ${collectionName}`);
      } else {
        console.log(`📦 Collection exists: ${collectionName}`);
      }
    }
  } catch (error) {
    console.error('❌ Error initializing collections:', error);
    throw error;
  }
}

export const connectDB = async () => {
  try {
    console.log('\n🚀 Initializing MongoDB connection...');
    console.log('📝 Using MongoDB URI:', MONGODB_URI.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@'));

    // Log initial connection state
    console.log('Initial connection state:', STATES[mongoose.connection.readyState as keyof typeof STATES]);

    // Connect with specific database name
    await mongoose.connect(MONGODB_URI, {
      ...DB_OPTIONS,
      dbName: DB_NAME
    });
    
    console.log('✅ MongoDB Atlas connected successfully');
    console.log(`📁 Using database: ${DB_NAME}`);

    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('Database connection not established');
    }

    // List all collections
    const collections = await db.listCollections().toArray();
    console.log('\n📚 Available collections:', collections.map(c => c.name));

    // Create userstats collection if it doesn't exist
    if (!collections.find(c => c.name === 'userstats')) {
      console.log('Creating userstats collection...');
      await db.createCollection('userstats');
      console.log('✅ Created userstats collection');
    }

    // Verify indexes
    const userStatsCollection = db.collection('userstats');
    const indexes = await userStatsCollection.indexes();
    console.log('\n📑 UserStats collection indexes:', indexes);

    console.log('\n📊 Connection Details:');
    console.log('- Database Name:', db.databaseName);
    console.log('- Host:', mongoose.connection.host);
    console.log('- Port:', mongoose.connection.port);

    // Add connection event listeners
    mongoose.connection.on('error', (err: Error) => {
      console.error('❌ MongoDB connection error:', err);
      logConnectionStatus();
    });

    mongoose.connection.on('disconnected', () => {
      console.log('🔌 MongoDB disconnected');
      logConnectionStatus();
    });

    mongoose.connection.on('reconnected', () => {
      console.log('🔄 MongoDB reconnected');
      logConnectionStatus();
    });

    mongoose.connection.on('connected', () => {
      console.log('🔗 MongoDB connected');
      logConnectionStatus();
    });

    // Log final connection status
    logConnectionStatus();
    return true;

  } catch (error: unknown) {
    console.error('\n❌ MongoDB connection error:');
    if (error instanceof Error) {
      console.error('Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
    }
    logConnectionStatus();
    
    // On Vercel, we don't want to exit the process on connection error
    if (process.env.VERCEL) {
      console.log('Running on Vercel - continuing without DB connection');
      return false;
    } else {
      // In development or other environments, we may want to exit
      process.exit(1);
    }
  }
};

export const disconnectDB = async () => {
  try {
    console.log('\n🔌 Attempting to disconnect from MongoDB...');
    await mongoose.disconnect();
    console.log('✅ MongoDB disconnected successfully');
    logConnectionStatus();
  } catch (error: unknown) {
    console.error('❌ MongoDB disconnection error:');
    if (error instanceof Error) {
      console.error('Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
    }
    logConnectionStatus();
  }
}; 