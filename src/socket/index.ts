import { Server } from 'socket.io';
import type { Server as HTTPServer } from 'http';
import { shareSocketInstance } from './state.js';
import { setupConnectionMonitoring } from './utils/connectionMonitor.js';
import { broadcastLeaderboard, broadcastGlobalStats } from './utils/broadcaster.js';

// Import handlers
import { setupUserHandlers } from './handlers/userHandlers.js';
import { setupChatHandlers } from './handlers/chatHandlers.js';
import { setupRoomHandlers } from './handlers/roomHandlers.js';
import { setupHackHandlers } from './handlers/hackHandlers.js';
import { setupReactionHandlers } from './handlers/reactionHandlers.js';
import { setupLeaderboardHandlers } from './handlers/leaderboardHandlers.js';

/**
 * Initializes the Socket.IO server with all event handlers
 * @param httpServer The HTTP server to attach Socket.IO to
 * @returns The configured Socket.IO server instance
 */
export function initializeSocket(httpServer: HTTPServer) {
  // Initialize Socket.IO with CORS and enhanced configuration
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.ALLOWED_ORIGINS?.split(',') || 
        (process.env.NODE_ENV === 'production' 
          ? ['https://dworldchat.vercel.app'] 
          : ['http://localhost:5173', 'http://127.0.0.1:5173']),
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
    maxHttpBufferSize: 1e8 // 100 MB
  });

  // Share socket instance for external access
  shareSocketInstance(io);

  // Add connection error handling
  io.engine.on("connection_error", (err) => {
    console.log('Connection error:', err);
  });

  // Handle connections
  io.on('connection', async (socket) => {
    console.log(`[${new Date().toISOString()}] Client connected: ${socket.id}`);
    
    // Setup connection monitoring
    setupConnectionMonitoring(io, socket);
    
    // Broadcast current online users immediately on connection
    io.emit('online_count', { count: io.sockets.sockets.size });
    
    // Setup all feature handlers
    setupUserHandlers(io, socket);
    setupChatHandlers(io, socket);
    setupRoomHandlers(io, socket);
    setupHackHandlers(io, socket);
    setupReactionHandlers(io, socket);
    setupLeaderboardHandlers(io, socket);
    
    // Send initial data
    try {
      await broadcastLeaderboard(io);
      await broadcastGlobalStats(io);
    } catch (error) {
      console.error('Error broadcasting initial data:', error);
    }
  });

  return io;
}
