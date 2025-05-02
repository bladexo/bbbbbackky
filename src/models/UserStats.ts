import mongoose from 'mongoose';

export interface IUserStats {
  username: string;
  color: string;
  messageCount: number;
  reactionCount: number;
  points: number;
  lastActive: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userStatsSchema = new mongoose.Schema({
  username: { 
    type: String, 
    required: true,
    unique: true,
    trim: true,
    index: true
  },
  color: { 
    type: String, 
    required: true 
  },
  messageCount: { 
    type: Number, 
    default: 0,
    min: 0
  },
  reactionCount: { 
    type: Number, 
    default: 0,
    min: 0
  },
  points: { 
    type: Number, 
    default: 0,
    min: 0
  },
  lastActive: { 
    type: Date, 
    default: Date.now,
    index: true
  }
}, {
  timestamps: true,
  versionKey: false,
  collection: 'userstats',
  toJSON: {
    transform: function(doc, ret) {
      delete ret._id;
      return ret;
    }
  }
});

// Create compound indexes for better query performance
userStatsSchema.index({ points: -1, messageCount: -1 });
userStatsSchema.index({ messageCount: -1, lastActive: -1 });

// Add instance methods
userStatsSchema.methods.incrementMessages = async function() {
  this.messageCount += 1;
  this.points += 10;
  this.lastActive = new Date();
  return this.save();
};

userStatsSchema.methods.incrementReactions = async function() {
  this.reactionCount += 1;
  this.points += 5;
  this.lastActive = new Date();
  return this.save();
};

// Add static methods
userStatsSchema.statics.getTopChatters = function(limit = 10) {
  return this.find()
    .sort({ messageCount: -1 })
    .limit(limit)
    .lean();
};

userStatsSchema.statics.getLeaderboard = function(limit = 10) {
  return this.find()
    .sort({ points: -1 })
    .limit(limit)
    .lean();
};

userStatsSchema.statics.getMostActive = function(limit = 10) {
  return this.find()
    .sort({ lastActive: -1 })
    .limit(limit)
    .lean();
};

// Drop and recreate indexes to ensure they're properly set up
userStatsSchema.pre('save', async function() {
  try {
    await UserStats.collection.dropIndexes();
    await UserStats.createIndexes();
  } catch (error) {
    console.log('Index recreation skipped - this is normal for first run');
  }
});

export const UserStats = mongoose.model<IUserStats>('UserStats', userStatsSchema);
export default UserStats; 