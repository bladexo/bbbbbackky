import { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { UserStats } from '../../models/UserStats.js';
import { GlobalStats } from '../../models/GlobalStats.js';
import { activeUsers } from '../state.js';
import { emitUserPoints } from '../utils/broadcaster.js';
import { usernameController } from '../../routes/adminRoutes.js';

/**
 * Sets up chat event handlers for a socket
 * @param io The Socket.IO server instance
 * @param socket The socket to set up handlers for
 */
export function setupChatHandlers(io: Server, socket: Socket): void {
  // Handle global chat messages
  socket.on('chat_message', async (data, callback) => {
    console.log(`Chat message received from ${socket.id}:`, data.content.substring(0, 30) + (data.content.length > 30 ? '...' : ''));
    
    try {
      // Check if user is registered
      const user = activeUsers.get(socket.id);
      if (!user) {
        console.log(`Attempt to send message from unregistered user (${socket.id})`);
        socket.emit('error', 'Not registered');
        if (callback) callback({ received: false, error: 'Not registered' });
        return;
      }
      
      // Validate message
      if (!data.content || typeof data.content !== 'string' || data.content.trim().length === 0) {
        console.log(`Invalid message from ${user.username} (${socket.id})`);
        socket.emit('error', 'Invalid message');
        if (callback) callback({ received: false, error: 'Invalid message' });
        return;
      }
      
      // Check for mutes
      if (usernameController && usernameController.isBlocked(user.username)) {
        const muteInfo = usernameController.getBlockedUsers()[user.username.toLowerCase()];
        socket.emit('user_muted', {
          username: user.username,
          duration: muteInfo.duration,
          muteUntil: muteInfo.expiresAt
        });
        return;
      }
      
      // Generate a unique message ID
      const messageId = data.id || uuidv4();
      
      // Create message object
      const message = {
        id: messageId,
        senderId: socket.id,
        senderUsername: user.username,
        userColor: user.color,
        content: data.content,
        timestamp: new Date(),
        replyTo: data.replyTo,
        // Extract mentions if there are any
        mentions: extractMentions(data.content)
      };
      
      // Broadcast to all clients
      io.emit('chat_message', message);
      
      // Update message stats for user in memory and DB
      try {
        // Update memory stats
        user.messageCount++;
        user.points += 5; // 5 points per message
        user.lastActive = new Date();
        
        // Update MongoDB
        await UserStats.findOneAndUpdate(
          { username: user.username },
          { 
            $inc: { messageCount: 1, points: 5 },
            $set: { lastActive: new Date() }
          }
        );
        
        // Update global stats
        await GlobalStats.incrementMessages();
        
        // Emit updated points to user
        await emitUserPoints(socket, user.username);
      } catch (error) {
        console.error('Error updating user stats:', error);
        // Don't return or break the flow for stats errors
      }
      
      // Acknowledge receipt
      if (callback) callback({ received: true });
      
    } catch (error) {
      console.error('Error handling chat message:', error);
      socket.emit('error', 'Failed to process message');
      if (callback) callback({ received: false, error: 'Server error' });
    }
  });
  
  // Handle typing indicators
  socket.on('typing_start', () => {
    const user = activeUsers.get(socket.id);
    if (!user) return;
    
    // Broadcast to all except sender
    socket.broadcast.emit('user_typing', {
      id: socket.id,
      username: user.username,
      color: user.color
    });
  });
  
  socket.on('typing_stop', () => {
    socket.broadcast.emit('user_stopped_typing', { id: socket.id });
  });
  
  // Handle ping/pong for connection testing
  socket.on('ping', () => {
    socket.emit('pong');
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

/**
 * Extract mentions from message content
 * @param content Message content
 * @returns Array of mentioned usernames
 */
function extractMentions(content: string): string[] {
  const mentionRegex = /@(\w+)/g;
  const matches = content.match(mentionRegex) || [];
  return matches.map(match => match.substring(1)); // Remove the @ symbol
}
