import { Server, Socket } from 'socket.io';
import { UserStats } from '../../models/UserStats.js';
import { GlobalStats } from '../../models/GlobalStats.js';

/**
 * Broadcasts the current leaderboard to all connected clients
 * @param io The Socket.IO server instance
 */
export async function broadcastLeaderboard(io: Server): Promise<void> {
  try {
    const leaderboard = await UserStats.find()
      .sort({ points: -1 })
      .limit(10)
      .lean();
    
    console.log('Broadcasting leaderboard:', leaderboard);
    io.emit('leaderboard:data', { users: leaderboard });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
  }
}

/**
 * Broadcasts global statistics to all connected clients
 * @param io The Socket.IO server instance
 */
export async function broadcastGlobalStats(io: Server): Promise<void> {
  try {
    // Get global stats from the dedicated collection
    const globalStats = await GlobalStats.getStats();
    
    // Get reaction count from user stats
    const [reactionStats] = await UserStats.aggregate([
      {
        $group: {
          _id: null,
          totalReactions: { $sum: '$reactionCount' }
        }
      }
    ]);

    const stats = {
      totalMessages: globalStats.totalMessages,
      totalUsers: globalStats.totalUsers,
      totalReactions: reactionStats?.totalReactions || 0,
      averageMessagesPerUser: globalStats.totalUsers > 0 
        ? globalStats.totalMessages / globalStats.totalUsers 
        : 0
    };

    io.emit('global_stats:data', stats);
  } catch (error) {
    console.error('Error fetching global stats:', error);
  }
}

/**
 * Emits user points to a specific socket
 * @param socket The socket to emit points to
 * @param username The username to get points for
 */
export async function emitUserPoints(socket: Socket, username: string): Promise<void> {
  try {
    const userStats = await UserStats.findOne({ username }).lean();
    if (userStats) {
      socket.emit('user_points_update', { points: userStats.points });
    }
  } catch (error) {
    console.error('Error emitting user points:', error);
  }
} 