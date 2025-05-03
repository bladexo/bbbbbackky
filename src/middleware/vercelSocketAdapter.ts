/**
 * This file adapts Socket.IO for better functionality on Vercel
 */
import { Request, Response, NextFunction } from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';

/**
 * Sets headers to properly handle WebSocket connections on Vercel
 */
export const configureVercelHeaders = (req: Request, res: Response, next: NextFunction) => {
  // Always set CORS headers for all requests
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Sec-WebSocket-Key, Sec-WebSocket-Protocol, Sec-WebSocket-Version'
  );

  // Handle OPTIONS method for preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Check for WebSocket upgrade request
  if (req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket') {
    console.log('WebSocket upgrade request detected', {
      url: req.url,
      headers: {
        upgrade: req.headers.upgrade,
        connection: req.headers.connection,
        'sec-websocket-key': req.headers['sec-websocket-key'],
      }
    });
    
    // We can't properly handle the WebSocket upgrade in a middleware
    // Socket.IO will handle this at the server level
    // Just pass through to Socket.IO's handlers
  }

  next();
};

/**
 * Configures Socket.IO server for Vercel
 */
export const configureSocketIOForVercel = (io: SocketIOServer, server: HTTPServer) => {
  console.log('Configuring Socket.IO server for Vercel deployment');
  
  // Add debugging for connection errors
  io.engine.on('connection_error', (err: any) => {
    console.error('Socket.IO connection error on Vercel:', err);
  });

  // Configure Socket.IO for better compatibility with Vercel
  io.on('connection', (socket) => {
    console.log('Socket connected with ID:', socket.id);
    
    // Add handler for transport errors
    socket.conn.on('packet', (packet) => {
      if (packet.type === 'error') {
        console.error('Socket.IO transport error:', packet.data);
      }
    });
    
    socket.conn.on('error', (err) => {
      console.error('Socket connection error:', err);
    });
    
    socket.conn.on('upgrade', (transport) => {
      console.log(`Socket transport upgraded to ${transport.name}`);
    });
  });

  console.log('Socket.IO server configured for Vercel with enhanced error handling');
};

/**
 * Handle WebSocket upgrade requests in Vercel
 * This should be called directly in the index.ts file
 */
export const handleVercelWebSocket = (server: HTTPServer) => {
  // Log WebSocket upgrade events for debugging
  server.on('upgrade', (req, socket, head) => {
    console.log('WebSocket upgrade event received', {
      url: req.url,
      headers: {
        upgrade: req.headers.upgrade,
        connection: req.headers.connection,
        'sec-websocket-key': req.headers['sec-websocket-key'],
      }
    });
  });
}; 
