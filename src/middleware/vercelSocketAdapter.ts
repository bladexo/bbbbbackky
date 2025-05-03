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
  // Set headers needed for proper WebSocket connections on Vercel
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle OPTIONS method for preflight requests
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Special handling for WebSocket upgrade requests
  if (req.headers['upgrade'] && req.headers['upgrade'].toLowerCase() === 'websocket') {
    console.log('WebSocket upgrade request detected');
  }

  next();
};

/**
 * Configures Socket.IO server for Vercel
 */
export const configureSocketIOForVercel = (io: SocketIOServer, server: HTTPServer) => {
  // Log adapter information
  console.log('Configuring Socket.IO server for Vercel deployment');
  
  // Configure additional Socket.IO options for Vercel
  io.engine.on('connection_error', (err: any) => {
    console.error('Socket.IO connection error on Vercel:', err);
  });

  // Log successful initialization
  console.log('Socket.IO server configured for Vercel');
}; 