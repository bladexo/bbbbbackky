import mongoose, { Model } from 'mongoose';

export interface IGlobalStats {
  totalMessages: number;
  totalUsers: number;
  lastUpdated: Date;
}

// Define interface for static methods
interface IGlobalStatsModel extends Model<IGlobalStats> {
  getStats(): Promise<IGlobalStats>;
  incrementMessages(): Promise<IGlobalStats>;
  updateUserCount(count: number): Promise<IGlobalStats>;
}

const globalStatsSchema = new mongoose.Schema({
  totalMessages: {
    type: Number,
    default: 0,
    min: 0
  },
  totalUsers: {
    type: Number,
    default: 0,
    min: 0
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  versionKey: false,
  collection: 'globalstats'
});

// Ensure we only have one document
globalStatsSchema.statics.getStats = async function() {
  const stats = await this.findOne();
  if (!stats) {
    return this.create({
      totalMessages: 0,
      totalUsers: 0,
      lastUpdated: new Date()
    });
  }
  return stats;
};

// Increment message count
globalStatsSchema.statics.incrementMessages = async function() {
  const stats = await this.findOne();
  if (stats) {
    stats.totalMessages += 1;
    stats.lastUpdated = new Date();
    return stats.save();
  }
  return this.create({
    totalMessages: 1,
    totalUsers: 0,
    lastUpdated: new Date()
  });
};

// Update user count
globalStatsSchema.statics.updateUserCount = async function(count: number) {
  const stats = await this.findOne();
  if (stats) {
    stats.totalUsers = count;
    stats.lastUpdated = new Date();
    return stats.save();
  }
  return this.create({
    totalMessages: 0,
    totalUsers: count,
    lastUpdated: new Date()
  });
};

export const GlobalStats = mongoose.model<IGlobalStats, IGlobalStatsModel>('GlobalStats', globalStatsSchema);
export default GlobalStats; 