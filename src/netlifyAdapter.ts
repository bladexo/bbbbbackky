/**
 * This file adapts the Express app for use with Netlify Functions
 */
import { Express } from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { Server as HTTPServer } from 'http';

// Export the necessary configuration for Netlify
export const configureForNetlify = (app: Express): void => {
  // Special route for Netlify function health check
  app.get('/.netlify/functions/server', (req, res) => {
    res.json({ 
      status: 'ok',
      timestamp: new Date().toISOString(),
      message: 'Netlify function is running'
    });
  });

  // Log to help with debugging
  console.log('Configured Express app for Netlify deployment');
};

// Function to get Socket.IO instance from app
export const getIO = (app: Express): SocketIOServer | null => {
  return app.get('io') || null;
};

// Function to get HTTP server instance from app
export const getServer = (app: Express): HTTPServer | null => {
  return app.get('server') || null;
}; 