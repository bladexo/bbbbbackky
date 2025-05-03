const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const serverless = require('serverless-http');
const { app } = require('../../dist/index.js');

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
});

// For local development
if (process.env.NETLIFY_DEV) {
  server.listen(8000, () => {
    console.log('Local server listening on port 8000');
  });
}

// Export the serverless handler
const handler = serverless(app);

exports.handler = async (event, context) => {
  // Special handling for WebSocket connections
  if (event.headers && 
      ((event.headers.upgrade && event.headers.upgrade.toLowerCase() === 'websocket') || 
       (event.headers['sec-websocket-key']))) {
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: 'This is a WebSocket request. Please use the WebSocket endpoint directly.',
        socketUrl: `wss://${event.headers.host}`
      })
    };
  }
  
  // For regular HTTP requests
  return handler(event, context);
}; 