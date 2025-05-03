const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const serverless = require('serverless-http');
const mongoose = require('mongoose');

// Import the app module dynamically (ESM imported in CJS)
let appModule;
try {
  // For the deployed version which will have compiled JS files
  appModule = require('../../dist/index.js');
} catch (err) {
  console.error('Failed to import compiled app:', err);
  console.log('Attempting to import source TypeScript file...');
  try {
    // Development fallback (direct ts-node/tsx execution)
    appModule = require('../../src/index.js');
  } catch (err2) {
    console.error('Failed to import source app:', err2);
    throw new Error('Could not import application module');
  }
}

// Get the Express app
const app = appModule.app || appModule.default;

// Create a server instance for local development
const server = createServer(app);

// Initialize Socket.IO with appropriate settings for Netlify
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
    allowedHeaders: ['*']
  },
  path: '/socket.io/',
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  cookie: false
});

// Make io available to the app
app.set('io', io);
app.set('server', server);

// Handle socket.io connections
io.on('connection', (socket) => {
  console.log('Client connected via Netlify function:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
  
  // Debug ping/pong
  socket.on('ping', () => {
    console.log(`Ping received from ${socket.id}`);
    socket.emit('pong');
  });
  
  // Log all events for debugging
  const originalOnEvent = socket.onevent;
  socket.onevent = function(packet) {
    const args = packet.data || [];
    console.log(`[${new Date().toISOString()}] Socket event:`, args[0], 'from:', socket.id);
    originalOnEvent.call(this, packet);
  };
});

// For local development with netlify dev
if (process.env.NETLIFY_DEV) {
  server.listen(8000, () => {
    console.log('Local server listening on port 8000');
  });
}

// Prepare handler with special handling for binary content
const handler = serverless(app, {
  binary: ['image/*', 'audio/*', 'video/*', 'application/octet-stream'],
});

// Export the serverless handler
exports.handler = async (event, context) => {
  // Log the incoming request for debugging
  console.log(`[${new Date().toISOString()}] Netlify function received request:`, {
    path: event.path,
    httpMethod: event.httpMethod,
    headers: {
      host: event.headers.host,
      origin: event.headers.origin,
      referer: event.headers.referer,
      'user-agent': event.headers['user-agent'],
      'content-type': event.headers['content-type'],
    }
  });

  // Special handling for WebSocket connections
  if (event.headers && 
      ((event.headers.upgrade && event.headers.upgrade.toLowerCase() === 'websocket') || 
       (event.headers['sec-websocket-key']))) {
    
    console.log('WebSocket request detected, passing to Socket.IO');
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Connection': 'Upgrade',
        'Upgrade': 'websocket',
      },
      body: JSON.stringify({
        message: 'This is a WebSocket request handled by Netlify Functions',
        socketUrl: `wss://${event.headers.host}`
      })
    };
  }
  
  // For regular HTTP requests
  try {
    // Pass to serverless-http handler
    const result = await handler(event, context);
    return result;
  } catch (error) {
    console.error('Error in Netlify function:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Internal Server Error',
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    };
  }
}; 