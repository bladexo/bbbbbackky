import { Server, Socket } from 'socket.io';
import { activeUsers } from '../state.js';
import { UserStats } from '../../models/UserStats.js';
import { GlobalStats } from '../../models/GlobalStats.js';
import { sanitizeInput } from '../utils/sanitizer.js';
import { broadcastLeaderboard, broadcastGlobalStats, emitUserPoints } from '../utils/broadcaster.js';
import { usernameController } from '../../routes/adminRoutes.js';

/**
 * Sets up chat message event handlers for a socket
 * @param io The Socket.IO server instance
 * @param socket The socket to set up handlers for
 */
export function setupChatHandlers(io: Server, socket: Socket): void {
  // Handle global chat messages
  socket.on('chat_message', async (data) => {
    const user = activeUsers.get(socket.id);
    if (!user) {
      socket.emit('error', 'Not registered');
      return;
    }

    // Check if user is blocked/muted
    if (usernameController && usernameController.isBlocked(user.username)) {
      const muteInfo = usernameController.getBlockedUsers()[user.username.toLowerCase()];
      socket.emit('user_muted', {
        username: user.username,
        duration: muteInfo.duration,
        muteUntil: muteInfo.expiresAt
      });
      return;
    }

    // Sanitize message content
    if (typeof data.content === 'string') {
      data.content = sanitizeInput(data.content);
    }

    // Basic message validation
    if (!data.content || data.content.length > 1000) {
      socket.emit('error', 'Invalid message length');
      return;
    }

    try {
      // Update message stats in MongoDB
      const result = await UserStats.findOneAndUpdate(
        { username: user.username },
        { 
          $inc: { 
            messageCount: 1,
            points: 10
          },
          $set: { lastActive: new Date() }
        },
        { new: true }
      );

      // Increment global message count
      await GlobalStats.incrementMessages();

      if (result) {
        // Update memory stats
        user.messageCount = result.messageCount;
        user.points = result.points;
        user.lastActive = result.lastActive;
        activeUsers.set(socket.id, user);

        // Emit updated points to the user
        await emitUserPoints(socket, user.username);
      }

      // Broadcast message with replyTo data
      io.emit('chat_message', {
        id: data.id || `${socket.id}-${Date.now()}`,
        senderId: socket.id,
        senderUsername: user.username,
        content: data.content,
        timestamp: Date.now(),
        userColor: user.color,
        replyTo: data.replyTo,
        mentions: data.mentions,
        type: 'user'
      });

      // Broadcast updated stats
      await broadcastLeaderboard(io);
      await broadcastGlobalStats(io);

    } catch (error) {
      console.error('Error handling message:', error);
      socket.emit('error', 'Failed to process message');
    }
  });

  // Handle typing status
  socket.on('typing_start', () => {
    const user = activeUsers.get(socket.id);
    if (user) {
      // Broadcast to everyone except the sender
      socket.broadcast.emit('user_typing', {
        id: socket.id,
        username: user.username,
        color: user.color
      });
    }
  });

  socket.on('typing_stop', () => {
    const user = activeUsers.get(socket.id);
    if (user) {
      // Broadcast to everyone except the sender
      socket.broadcast.emit('user_stopped_typing', {
        id: socket.id
      });
    }
  });

  // Update unmute event handler
  socket.on('user_unmuted', (data) => {
    const user = activeUsers.get(socket.id);
    if (user && user.username === data.username) {
      socket.emit('user_unmuted', {
        username: user.username,
        timestamp: Date.now()
      });
    }
  });

  // Update check_mute_status handler
  socket.on('check_mute_status', ({ username }) => {
    if (usernameController && usernameController.isBlocked(username)) {
      const muteInfo = usernameController.getBlockedUsers()[username.toLowerCase()];
      socket.emit('user_muted', {
        username,
        duration: muteInfo.duration,
        muteUntil: muteInfo.expiresAt
      });
    }
  });
}
