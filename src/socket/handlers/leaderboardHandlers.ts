import { Server, Socket } from 'socket.io';
import { broadcastLeaderboard, broadcastGlobalStats } from '../utils/broadcaster.js';

/**
 * Sets up leaderboard event handlers for a socket
 * @param io The Socket.IO server instance
 * @param socket The socket to set up handlers for
 */
export function setupLeaderboardHandlers(io: Server, socket: Socket): void {
  // Add leaderboard request handler
  socket.on('leaderboard:request', () => {
    console.log('Leaderboard requested by socket:', socket.id);
    broadcastLeaderboard(io);
  });

  // Add global stats request handler
  socket.on('global_stats:request', () => {
    console.log('Global stats requested by socket:', socket.id);
    broadcastGlobalStats(io);
  });
} 