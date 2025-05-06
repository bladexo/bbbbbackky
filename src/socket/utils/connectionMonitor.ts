import { Server, Socket } from 'socket.io';
import { getUser } from '../state.js';

/**
 * Sets up connection monitoring for a socket
 * @param io The Socket.IO server instance
 * @param socket The socket to monitor
 */
export function setupConnectionMonitoring(io: Server, socket: Socket): void {
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
    // Clean up will be handled in disconnect event
  });

  // Clean up interval on disconnect
  socket.on('disconnect', () => {
    clearInterval(healthCheck);
  });
}

/**
 * Log debug information about a socket
 * @param socket The socket to log information about
 */
export function logSocketInfo(socket: Socket): void {
  const user = getUser(socket.id);
  console.log(`Socket info for ${socket.id}:`, {
    connected: socket.connected,
    handshake: {
      address: socket.handshake.address,
      time: socket.handshake.time,
      headers: socket.handshake.headers['user-agent']
    },
    rooms: Array.from(socket.rooms),
    user: user ? { username: user.username, points: user.points } : 'Not registered'
  });
} 