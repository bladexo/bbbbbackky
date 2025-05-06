import { Server, Socket } from 'socket.io';
import { activeUsers } from '../state.js';
import { UserStats } from '../../models/UserStats.js';
import { broadcastLeaderboard, broadcastGlobalStats, emitUserPoints } from '../utils/broadcaster.js';

/**
 * Sets up reaction event handlers for a socket
 * @param io The Socket.IO server instance
 * @param socket The socket to set up handlers for
 */
export function setupReactionHandlers(io: Server, socket: Socket): void {
  // Add server-side handler for message reactions
  socket.on('message_reaction', async (data) => {
    const reactor = activeUsers.get(socket.id);
    if (!reactor) {
      socket.emit('error', 'Not registered');
      return;
    }
    
    const { messageId, reactionType, messageAuthorUsername, roomId } = data;
    
    if (!messageId || !reactionType || !messageAuthorUsername) {
      console.error('Missing reaction data:', { messageId, reactionType, messageAuthorUsername });
      socket.emit('error', 'Missing reaction data');
      return;
    }
    
    try {
      // First, verify we're not liking our own message
      if (reactor.username === messageAuthorUsername) {
        console.log('Self-reaction attempt:', { reactor: reactor.username, messageAuthor: messageAuthorUsername });
        socket.emit('error', 'Cannot react to your own message');
        return;
      }

      console.log('Processing reaction:', {
        reactor: reactor.username,
        messageAuthor: messageAuthorUsername,
        reactionType,
        messageId,
        roomId
      });

      // Update reaction count for the reactor (no points)
      const reactorStats = await UserStats.findOneAndUpdate(
        { username: reactor.username },
        { 
          $inc: { reactionCount: 1 },
          $set: { lastActive: new Date() }
        },
        { new: true }
      );
      console.log('Updated reactor stats:', {
        username: reactor.username,
        reactionCount: reactorStats?.reactionCount
      });

      // Award points to the message author
      const authorStats = await UserStats.findOneAndUpdate(
        { username: messageAuthorUsername },
        { 
          $inc: { points: 5 },  // Give 5 points to the message author
          $set: { lastActive: new Date() }
        },
        { new: true }
      );
      console.log('Updated author stats:', {
        username: messageAuthorUsername,
        points: authorStats?.points
      });
    
      // Update in-memory stats for the message author if they're online
      const messageAuthor = Array.from(activeUsers.values())
        .find(user => user.username === messageAuthorUsername);
      
      if (messageAuthor && authorStats) {
        messageAuthor.points = authorStats.points;
        messageAuthor.lastActive = authorStats.lastActive;
        console.log('Updated in-memory author stats:', {
          username: messageAuthor.username,
          points: messageAuthor.points
        });
      } else {
        console.log('Message author not found in memory or stats update failed:', {
          authorInMemory: !!messageAuthor,
          authorStatsUpdated: !!authorStats
        });
      }
      
      console.log(`${reactor.username} reacted with ${reactionType} to ${messageAuthorUsername}'s message in room ${roomId || 'global'}`);
      
      // Create reaction data for broadcast
      const reactionData = {
        messageId,
        reactionType,
        reactorUsername: reactor.username,  // Who gave the reaction
        messageAuthorUsername,              // Who received the reaction
        roomId,
        userColor: reactor.color,
        timestamp: Date.now()
      };
    
      // Broadcast the reaction
      if (roomId && roomId !== 'global') {
        io.in(roomId).emit('message_reaction_broadcast', reactionData);
      } else {
        io.emit('message_reaction_broadcast', {
          ...reactionData,
          roomId: 'global'
        });
      }
    
      // Send confirmation to reactor
      socket.emit('reaction_confirmed', {
        messageId,
        reactionType,
        success: true
      });

      // Find the message author's socket and emit their updated points
      const messageAuthorSocket = Array.from(io.sockets.sockets.values())
        .find(s => activeUsers.get(s.id)?.username === messageAuthorUsername);
      
      if (messageAuthorSocket) {
        await emitUserPoints(messageAuthorSocket, messageAuthorUsername);
      }

      // Broadcast updated stats
      await broadcastLeaderboard(io);
      await broadcastGlobalStats(io);

    } catch (error) {
      console.error('Error handling reaction:', error);
      socket.emit('error', 'Failed to process reaction');
    }
  });
} 