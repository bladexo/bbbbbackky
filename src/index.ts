import express, { RequestHandler } from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import path from 'path';
import helmet from 'helmet';
import xss from 'xss';
import dotenv from 'dotenv';
import { ipMiddleware } from './middleware/ipMiddleware.js';
import adminRoutes from './routes/adminRoutes.js';
import { usernameController } from './routes/adminRoutes.js';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';
import { connectDB } from './config/database.js';
import { UserStats } from './models/UserStats.js';
import HackAccess from './models/HackAccess.js';
import GlobalStats from './models/GlobalStats.js';

// Load environment variables based on NODE_ENV
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
dotenv.config({ path: envFile });

// Add debug logging for environment variables
console.log('Environment:', process.env.NODE_ENV);
console.log('Admin password set:', !!process.env.ADMIN_PASSWORD);
console.log('Using env file:', envFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express(); 
const httpServer = createServer(app);

// Configure security headers with proper CSP
const isProd = process.env.NODE_ENV === 'production';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const KOYEB_URL = process.env.KOYEB_URL;

// Configure CORS and allowed origins
const allowedOrigins = isProd 
  ? ['https://dworldchat.vercel.app', 'https://bbbbbackky.vercel.app']
  : ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:8000', 'http://192.168.60.16:8000'];

// Apply CORS configuration before other middleware
app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      connectSrc: ["'self'", "wss:", "ws:", "http://localhost:8000", "http://192.168.60.16:8000"],
      imgSrc: ["'self'", "data:", "blob:"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      formAction: ["'self'", "http://localhost:8000", "http://192.168.60.16:8000"],
      upgradeInsecureRequests: []
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginOpenerPolicy: { policy: "same-origin" }
}));

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public directory
app.use(express.static(join(__dirname, '../public')));

// Root endpoint redirects to status page
app.get('/', (_req, res) => {
  res.redirect('/status');
});

// Status endpoint
app.get('/status', (_req, res) => {
  const statusPath = join(__dirname, '../public/status.html');
  console.log(`[${new Date().toISOString()}] Serving status page from: ${statusPath}`);
  
  if (fs.existsSync(statusPath)) {
    res.sendFile(statusPath);
  } else {
    console.error(`[${new Date().toISOString()}] Status page not found at: ${statusPath}`);
    res.status(404).send('Status page not found. Please check server configuration.');
  }
});

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    cors: {
      allowedOrigins,
      corsEnabled: true
    },
    socket: {
      transports: ['websocket', 'polling'],
      path: '/socket.io/',
      pingInterval: 25000,
      pingTimeout: 20000
    }
  });
});

// Test CORS endpoint
app.options('/test-cors', cors());
app.get('/test-cors', (req, res) => {
  res.json({
    success: true,
    origin: req.headers.origin,
    message: 'CORS is working'
  });
});

// Initialize Socket.IO with CORS and enhanced configuration
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: ["*"]
  },
  path: '/socket.io/',
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    skipMiddlewares: true,
  },
  pingTimeout: 30000,
  pingInterval: 25000,
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 1e8, // 100 MB
  allowEIO3: true // Enable Engine.IO v3 compatibility
});

// Add connection error handling
io.engine.on("connection_error", (err) => {
  console.log('Connection error:', err);
});

// Make io available to routes
app.set('io', io);

// Simple user tracking with extended stats
interface UserWithStats {
  id: string;
  username: string;
  color: string;
  messageCount: number;
  reactionCount: number;
  points: number;
  lastActive: Date;
}

const activeUsers = new Map<string, UserWithStats>();

// Room metadata storage - maps room IDs and codes to their metadata
const roomMetadata = new Map();

// Sanitize user input function with additional security measures
const sanitizeInput = (input: string): string => {
  if (typeof input !== 'string') return '';
  
  // Remove any potential script tags and attributes
  input = input.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
              .replace(/<[^>]*>/g, ''); // Remove HTML tags
              
  // Sanitize using xss package
  input = xss(input.trim(), {
    whiteList: {}, // No HTML allowed
    stripIgnoreTag: true,
    stripIgnoreTagBody: ['script', 'style', 'xml'],
  });
  
  // Additional checks
  if (input.length > 1000) {
    input = input.substring(0, 1000);
  }
  
  return input;
};

// Helper function to broadcast leaderboard
const broadcastLeaderboard = async (io: Server) => {
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
};

// Helper function to broadcast global stats
const broadcastGlobalStats = async (io: Server) => {
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
};

// Add helper function to emit user points
const emitUserPoints = async (socket: Socket, username: string) => {
  try {
    const userStats = await UserStats.findOne({ username }).lean();
    if (userStats) {
      socket.emit('user_points_update', { points: userStats.points });
    }
  } catch (error) {
    console.error('Error emitting user points:', error);
  }
};

// Enhanced connection handling
io.on('connection', async (socket) => {
  console.log(`[${new Date().toISOString()}] Client connected: ${socket.id}`);
  
  // Set up ping/pong for connection monitoring
  let lastPing = Date.now();
  
  socket.on('ping', () => {
    lastPing = Date.now();
    socket.emit('pong');
  });

  // Monitor connection health
  const healthCheck = setInterval(() => {
    const now = Date.now();
    if (now - lastPing > 60000) { // No ping for 1 minute
      console.log(`[${new Date().toISOString()}] Client ${socket.id} health check failed. Last ping: ${new Date(lastPing).toISOString()}`);
      socket.disconnect(true);
    }
  }, 30000);

  // Handle connection errors
  socket.on('error', (error) => {
    console.error(`Socket error for ${socket.id}:`, error);
    // Attempt to clean up if needed
    const user = activeUsers.get(socket.id);
    if (user) {
      console.log(`Cleaning up user ${user.username} due to socket error`);
      activeUsers.delete(socket.id);
      io.emit('online_count', { count: activeUsers.size });
    }
  });

  // Handle disconnection with reason and cleanup
  socket.on('disconnect', async (reason) => {
    clearInterval(healthCheck);
    console.log(`Client ${socket.id} disconnected. Reason: ${reason}`);
    const user = activeUsers.get(socket.id);
    if (user) {
      try {
        // Keep the user in memory for a short time to allow for reconnection
        setTimeout(async () => {
          // Only clean up if the user hasn't reconnected
          if (activeUsers.get(socket.id)?.username === user.username) {
            // Update last active time in MongoDB
            await UserStats.findOneAndUpdate(
              { username: user.username },
              { $set: { lastActive: new Date() } }
            );

            // Clean up user from active users
            activeUsers.delete(socket.id);
            
            // Also clean up any other sockets that might have the same username
            for (const [socketId, activeUser] of activeUsers.entries()) {
              if (activeUser.username === user.username) {
                activeUsers.delete(socketId);
              }
            }

            // Update global user count
            await GlobalStats.updateUserCount(activeUsers.size);

            console.log(`User disconnected: ${user.username} (${socket.id})`);
            console.log('Active users:', activeUsers.size);

            io.emit('user_left', {
              id: socket.id,
              username: user.username,
              onlineCount: activeUsers.size,
              reason: reason
            });

            // Broadcast online count separately to ensure it's received
            io.emit('online_count', { count: activeUsers.size });
            await broadcastLeaderboard(io);
            await broadcastGlobalStats(io);
          }
        }, 5000); // Wait 5 seconds before cleanup to allow for quick reconnects

      } catch (error) {
        console.error('Error handling disconnect:', error);
      }
    }
  });

  // Handle reconnection attempts
  socket.on('reconnect_attempt', () => {
    console.log(`Client ${socket.id} attempting to reconnect`);
  });

  // Handle successful reconnection
  socket.on('reconnect', () => {
    console.log(`Client ${socket.id} successfully reconnected`);
  });

  // Handle failed reconnection
  socket.on('reconnect_failed', () => {
    console.error(`Client ${socket.id} failed to reconnect`);
  });

  // Broadcast current online users immediately on connection
  io.emit('online_count', { count: activeUsers.size });
  socket.emit('online_users', {
    users: Array.from(activeUsers.values()),
    count: activeUsers.size
  });

  socket.on('register', async ({ username, color }) => {
    // Validate username
    if (!username || typeof username !== 'string' || username.length < 3) {
      socket.emit('error', 'Invalid username');
      return;
    }

    // Check for existing username
    const usernameTaken = Array.from(activeUsers.values())
      .some(user => user.username.toLowerCase() === username.toLowerCase());
    if (usernameTaken) {
      socket.emit('error', 'Username already taken');
      return;
    }

    try {
      // First register user in memory
      const newUser: UserWithStats = {
        id: socket.id,
        username,
        color,
        messageCount: 0,
        reactionCount: 0,
        points: 0,
        lastActive: new Date()
      };
      activeUsers.set(socket.id, newUser);
      console.log(`User registered in memory: ${username} (${socket.id})`);
      console.log('Active users count:', activeUsers.size);

      // Then add/update in MongoDB
      const result = await UserStats.findOneAndUpdate(
        { username },
        { 
          $setOnInsert: {
            username,
            color,
            messageCount: 0,
            reactionCount: 0,
            points: 0,
            lastActive: new Date()
          }
        },
        { upsert: true, new: true }
      );

      // Update global user count
      await GlobalStats.updateUserCount(activeUsers.size);
      
      console.log('User added/updated in MongoDB:', result);

      // Emit events
      io.emit('user_joined', {
        id: socket.id,
        username,
        onlineCount: activeUsers.size
      });

      // Broadcast online count separately to ensure it's received
    io.emit('online_count', { count: activeUsers.size });

      // Broadcast updated stats
      await broadcastLeaderboard(io);
      await broadcastGlobalStats(io);

    } catch (error) {
      console.error('Error registering user:', error);
      activeUsers.delete(socket.id);
      socket.emit('error', 'Failed to register user');
    }
  });

  socket.on('chat_message', async (data) => {
    const user = activeUsers.get(socket.id);
    if (!user) {
      socket.emit('error', 'Not registered');
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

  // Handle room messages
  socket.on('room_message', (data) => {
    const user = activeUsers.get(socket.id);
    if (!user) {
      socket.emit('error', 'Not registered');
      return;
    }

    // Check if user is blocked
    if (usernameController.isBlocked(user.username)) {
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
  });

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
    const metadataObj = {
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
    if (usernameController.isBlocked(username)) {
      const muteInfo = usernameController.getBlockedUsers()[username.toLowerCase()];
      socket.emit('user_muted', {
        username,
        duration: muteInfo.duration,
        muteUntil: muteInfo.expiresAt
      });
    }
  });

  // Remove the user_muted event listener since system messages are now handled in adminRoutes
  socket.on('user_muted', ({ username, duration, muteUntil }) => {
    // No need to emit system message here as it's handled in adminRoutes
  });

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

  // Add leaderboard request handler
  socket.on('leaderboard:request', () => {
    console.log('Leaderboard requested by socket:', socket.id);
    broadcastLeaderboard(io);
  });

  // Add hack feature handler
  socket.on('execute_hack', async ({ userId }) => {
    console.log(`[HACK] Hack attempt from user ID: ${userId}`);
    const hacker = activeUsers.get(socket.id);
    
    if (!hacker) {
      console.log('[HACK] Hack failed: User not found');
      socket.emit('error', 'Not registered');
      return;
    }

    try {
      // Check hack access
      const hackAccess = await HackAccess.findOne({ username: hacker.username, isActive: true });
      
      if (!hackAccess?.isValid()) {
        // Check for random selection (10% chance)
        if (Math.random() < 0.1) {
          // Grant random access for 5 minutes
          await HackAccess.create({
            username: hacker.username,
            type: 'random',
            expiresAt: new Date(Date.now() + 5 * 60000)
          });
          socket.emit('notification', {
            type: 'success',
            message: '🎲 You got lucky! Hack access granted for 5 minutes!'
          });
        } else {
          socket.emit('error', 'No hack access');
          return;
        }
      }

      // Get all active users except the hacker
      const potentialVictims = Array.from(activeUsers.values())
        .filter(user => user.id !== socket.id && user.points > 0);

      console.log(`[HACK] Found ${potentialVictims.length} potential victims`);
      
      if (potentialVictims.length < 3) {
        socket.emit('error', 'Not enough victims available');
        return;
      }

      // Randomly select 3 victims
      const victims = [];
      const selectedVictims = new Set();
      let totalStolenPoints = 0;

      while (victims.length < 3 && selectedVictims.size < potentialVictims.length) {
        const randomIndex = Math.floor(Math.random() * potentialVictims.length);
        const victim = potentialVictims[randomIndex];
        
        if (!selectedVictims.has(victim.id)) {
          selectedVictims.add(victim.id);
          const stolenPoints = Math.floor(victim.points * 0.1); // Steal 10% of points
          victim.points -= stolenPoints;
          totalStolenPoints += stolenPoints;
          victims.push(victim);

          // Notify victim
          const victimSocket = io.sockets.sockets.get(victim.id);
          if (victimSocket) {
            victimSocket.emit('notification', {
              type: 'error',
              message: `⚠️ You've been hacked by ${hacker.username}! Lost ${stolenPoints} points!`
            });
          }
        }
      }

      // Update hacker's points
      hacker.points += totalStolenPoints;

      // Broadcast system message
      io.emit('message', {
        id: `system-${Date.now()}`,
        username: 'SYSTEM',
        content: `🎯 ${hacker.username} hacked ${victims.map(v => v.username).join(', ')} and stole ${totalStolenPoints} points!`,
        timestamp: new Date(),
        isSystem: true
      });

      // Send success response
      socket.emit('hack_result', {
        success: true,
        stolenPoints: totalStolenPoints,
        victims: victims.map(v => v.username)
      });

      // Update leaderboard
      broadcastLeaderboard(io);

    } catch (error) {
      console.error('[HACK] Error:', error);
      socket.emit('error', 'Hack failed');
    }
  });
});

// Admin authentication middleware
const adminAuth: RequestHandler = (req, res, next): void => {
  const authHeader = req.headers.authorization;
  console.log('Auth header:', authHeader); // Debug log

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('No valid auth header found'); // Debug log
    res.status(401).json({ error: 'Unauthorized - No token provided' });
    return;
  }

  const token = authHeader.split(' ')[1];
  const adminPassword = process.env.ADMIN_PASSWORD;
  
  console.log('Admin password set:', !!adminPassword); // Debug log (don't log the actual password)
  console.log('Token received:', token ? 'Yes' : 'No'); // Debug log
  
  if (!adminPassword) {
    console.error('ADMIN_PASSWORD not set in environment variables');
    res.status(500).json({ 
      error: 'Server configuration error',
      details: 'ADMIN_PASSWORD environment variable is not set'
    });
    return;
  }

  if (token !== adminPassword) {
    console.log('Invalid credentials provided'); // Debug log
    res.status(401).json({ 
      error: 'Invalid credentials',
      details: 'The provided password does not match the admin password'
    });
    return;
  }

  console.log('Authentication successful'); // Debug log
  next();
};

// Apply IP middleware to all routes
app.use(ipMiddleware);

// Admin status page - serve without authentication
app.get('/admin/status', (_req, res) => {
  const statusPath = join(__dirname, '../public/admin-status.html');
  if (fs.existsSync(statusPath)) {
    res.sendFile(statusPath);
  } else {
    res.status(404).send('Admin status page not found');
  }
});

// Admin API endpoints - require authentication
app.get('/admin/health', adminAuth, (req, res) => {
  const connectedSockets = io.sockets.sockets.size;
  const uptime = process.uptime();
  
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    uptime: {
      seconds: Math.floor(uptime),
      formatted: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`
    },
    memory: process.memoryUsage(),
    connections: {
      active: connectedSockets,
      users: activeUsers.size
    },
    cors: {
      allowedOrigins,
      corsEnabled: true
    },
    socket: {
      transports: ['websocket', 'polling'],
      path: '/socket.io/',
      pingInterval: 25000,
      pingTimeout: 20000
    }
  });
});

// Admin message endpoint
app.post('/admin/message', adminAuth, (req, res): void => {
  const { message } = req.body;
  
  if (!message || typeof message !== 'string' || message.length > 1000) {
    res.status(400).json({ error: 'Invalid message' });
    return;
  }

  const systemMessageId = `backend-${Math.random().toString(36).substr(2, 9)}`;
  
  // Create message data with consistent format
  const messageData = {
    id: systemMessageId,
    senderId: 'system',
    username: 'SYSTEM',
    content: sanitizeInput(message),
    timestamp: Date.now(),
    userColor: '#39ff14',
    mentions: [],
    isSystem: true,
    type: 'system'
  };

  // Log the message being sent
  console.log('[System Message] Sending:', messageData);
  
  // Send system message to all clients
  io.emit('chat_message', messageData);

  res.json({ success: true });
});

// Admin routes from external file
app.use('/admin', adminRoutes);

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  // In production, the dist directory is at the root of the app
  const distPath = process.env.NODE_ENV === 'production' 
    ? join('/app', 'dist')
    : join(__dirname, '../dist');
    
  console.log('Static files path:', distPath);
  console.log('Current directory:', __dirname);
  
  // Configure proper MIME types
  app.use(express.static(distPath, {
    setHeaders: (res, path) => {
      if (path.endsWith('.js')) {
        res.setHeader('Content-Type', 'application/javascript');
      }
      if (path.endsWith('.mjs') || path.match(/\.js\?v=\w+$/)) {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      }
    }
  }));

  if (!fs.existsSync(distPath)) {
    console.error('Error: dist directory does not exist at:', distPath);
    // Try alternative path
    const altPath = join(__dirname, '../../dist');
    console.log('Trying alternative path:', altPath);
    if (fs.existsSync(altPath)) {
      console.log('Found dist directory at alternative path');
      app.use(express.static(altPath, {
        setHeaders: (res, path) => {
          if (path.endsWith('.js')) {
            res.setHeader('Content-Type', 'application/javascript');
          }
          if (path.endsWith('.mjs') || path.match(/\.js\?v=\w+$/)) {
            res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
          }
        }
      }));
      
      app.get('*', (_req, res) => {
        const indexPath = join(altPath, 'index.html');
        console.log('Serving index.html from:', indexPath);
        if (fs.existsSync(indexPath)) {
          res.sendFile(indexPath);
        } else {
          res.status(404).send('index.html not found');
        }
      });
    }
  } else {
    console.log('dist directory found at:', distPath);
    
    app.get('*', (_req, res) => {
      const indexPath = join(distPath, 'index.html');
      console.log('Serving index.html from:', indexPath);
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('index.html not found');
      }
    });
  }
}

// Update port configuration for deployment
const PORT = parseInt(process.env.PORT || '8000', 10);
const HOST = process.env.HOST || '0.0.0.0';

// Initialize database before starting the server
const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();
    
    // Start the server
httpServer.listen(PORT, HOST, () => {
  console.log(`[${new Date().toISOString()}] Server started`);
  console.log(`[${new Date().toISOString()}] Server running on http://${HOST}:${PORT}`);
  console.log(`[${new Date().toISOString()}] Status page available at http://${HOST}:${PORT}/status`);
  console.log(`[${new Date().toISOString()}] Admin panel available at http://${HOST}:${PORT}/admin`);
  console.log(`[${new Date().toISOString()}] Environment: ${process.env.NODE_ENV}`);
  console.log(`[${new Date().toISOString()}] Allowed origins:`, allowedOrigins);
});
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Start the server
startServer();
