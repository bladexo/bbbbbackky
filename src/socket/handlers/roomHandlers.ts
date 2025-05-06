import { Server, Socket } from 'socket.io';
import { activeUsers, roomMetadata, RoomMetadata } from '../state.js';
import { sanitizeInput } from '../utils/sanitizer.js';
import { usernameController } from '../../routes/adminRoutes.js';
import { UserStats } from '../../models/UserStats.js';

/**
 * Sets up room event handlers for a socket
 * @param io The Socket.IO server instance
 * @param socket The socket to set up handlers for
 */
export function setupRoomHandlers(io: Server, socket: Socket): void {
  // Socket.io room joining
  socket.on('join', (roomId) => {
    if (typeof roomId === 'string') {
      console.log(`User ${socket.id} joining room: ${roomId}`);
      socket.join(roomId);
      
      // Confirm room joining was successful
      socket.emit('room:joined:confirm', { 
        success: true, 
        roomId 
      });
    }
  });

  // Handle room metadata sharing
  socket.on('room:metadata', (data) => {
    const { roomId, roomCode, name, theme, adminId } = data;
    
    if (!roomId || !roomCode || !name) {
      socket.emit('error', 'Invalid room metadata');
      return;
    }
    
    console.log(`Storing metadata for room ${roomId} with name "${name}" and code ${roomCode}`);
    
    // Store the metadata keyed by both roomId and roomCode
    const metadataObj: RoomMetadata = {
      roomId,
      roomCode,
      name,
      theme,
      adminId
    };
    
    // Store by ID
    roomMetadata.set(roomId, metadataObj);
    
    // Also store by code for easier lookup
    roomMetadata.set(roomCode, metadataObj);
    
    // Log all stored room metadata for debugging
    console.log('Current rooms in registry:');
    roomMetadata.forEach((meta, key) => {
      console.log(`- ${key}: ${meta.name} (ID: ${meta.roomId}, Code: ${meta.roomCode})`);
    });
    
    // Broadcast metadata to everyone in the room
    io.in(roomId).emit('room:metadata_update', metadataObj);
  });
  
  // Handle requests for room metadata
  socket.on('room:request_metadata', (data) => {
    const { roomCode } = data;
    
    if (!roomCode) {
      socket.emit('error', 'Invalid room code');
      return;
    }
    
    console.log(`Looking up room with code: ${roomCode}`);
    console.log('Available room codes:');
    roomMetadata.forEach((meta, key) => {
      console.log(`- ${key}: ${meta.name} (ID: ${meta.roomId}, Code: ${meta.roomCode})`);
    });
    
    // First try direct lookup by code
    let metadata = roomMetadata.get(roomCode);
    
    // If not found, try case-insensitive search through all entries
    if (!metadata) {
      const normalizedCode = roomCode.toUpperCase();
      roomMetadata.forEach((meta, key) => {
        if (typeof key === 'string' && key.toUpperCase() === normalizedCode) {
          metadata = meta;
        }
        if (meta.roomCode && meta.roomCode.toUpperCase() === normalizedCode) {
          metadata = meta;
        }
      });
    }
    
    if (metadata) {
      console.log(`Found metadata for room ${metadata.roomId} with name "${metadata.name}" for code ${roomCode}`);
      
      // Send metadata only to the requesting client
      socket.emit('room:metadata_update', metadata);
    } else {
      console.log(`No metadata found for room code ${roomCode}`);
      socket.emit('error', `No room found with code: ${roomCode}`);
    }
  });
  
  // Handle room leaving
  socket.on('leave', (roomId) => {
    if (typeof roomId === 'string') {
      console.log(`User ${socket.id} leaving room: ${roomId}`);
      socket.leave(roomId);
    }
  });

  // Alternative room joining event name
  socket.on('socket:join-room', (roomId) => {
    if (typeof roomId === 'string') {
      console.log(`User ${socket.id} joining room via socket:join-room: ${roomId}`);
      socket.join(roomId);
    }
  });

  // Handle room messages
  socket.on('room_message', (data) => {
    const user = activeUsers.get(socket.id);
    if (!user) {
      socket.emit('error', 'Not registered');
      return;
    }

    // Check if user is blocked
    if (usernameController && usernameController.isBlocked(user.username)) {
      const muteInfo = usernameController.getBlockedUsers()[user.username.toLowerCase()];
      socket.emit('user_muted', {
        username: user.username,
        duration: muteInfo.duration,
        muteUntil: muteInfo.expiresAt
      });
      return;
    }

    // Validate message structure
    if (!data || !data.roomId || !data.content || typeof data.content !== 'string') {
      socket.emit('error', 'Invalid room message format');
      return;
    }

    // Sanitize content
    data.content = sanitizeInput(data.content);

    // Validate message length
    if (data.content.length > 1000) {
      socket.emit('error', 'Message too long');
      return;
    }

    console.log(`Broadcasting room message from ${user.username} to room: ${data.roomId}:`, 
      { id: data.id, content: data.content });
    
    // Broadcast to everyone in the room, including the sender
    io.in(data.roomId).emit('room_message_broadcast', {
      id: data.id,
      roomId: data.roomId,
      username: user.username,
      userColor: user.color,
      content: data.content,
      timestamp: Date.now(),
      mentions: data.mentions,
      replyTo: data.replyTo,
      type: 'user'
    });

    // Also emit back to sender for confirmation
    socket.emit('message_sent', {
      success: true,
      messageId: data.id
    });
    
    // Update user's last active time
    UserStats.findOneAndUpdate(
      { username: user.username },
      { $set: { lastActive: new Date() } }
    ).catch(error => {
      console.error('Error updating user last active time:', error);
    });
  });

  // Add room admin settings handling
  socket.on('room:update_settings', (data) => {
    const user = activeUsers.get(socket.id);
    if (!user) {
      socket.emit('error', 'Not registered');
      return;
    }
    
    const { roomId, settings } = data;
    
    if (!roomId || !settings) {
      socket.emit('error', 'Invalid room settings data');
      return;
    }
    
    // Get room metadata
    const roomMetadataObj = roomMetadata.get(roomId);
    if (!roomMetadataObj) {
      socket.emit('error', 'Room not found');
      return;
    }
    
    // Check if user is the room admin
    if (roomMetadataObj.adminId !== socket.id) {
      socket.emit('error', 'You are not the room admin');
      return;
    }
    
    console.log(`Admin ${user.username} updated settings for room ${roomId}:`, settings);
    
    // Update room metadata with new settings
    const updatedMetadata = {
      ...roomMetadataObj,
      settings: {
        ...roomMetadataObj.settings || {},
        ...settings
      }
    };
    
    roomMetadata.set(roomId, updatedMetadata);
    
    // Broadcast updated settings to everyone in the room
    io.in(roomId).emit('room:settings_updated', {
      roomId,
      settings: updatedMetadata.settings
    });
  });
}

