const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const serverless = require('serverless-http');
const path = require('path');
const fs = require('fs');

// Use a simple Express app as fallback if module loading fails
let app = express();
let io = null;
let server = null;

// Setup basic error handling for the fallback app
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', '*');
  next();
});

app.get('/', (req, res) => {
  res.json({ 
    status: 'running', 
    message: 'Server is running but failed to load main application module',
    error: 'Module import error'
  });
});

// Attempt to load the application
try {
  console.log('Current directory:', process.cwd());
  console.log('Available files in dist:', fs.existsSync('./dist') ? fs.readdirSync('./dist') : 'dist directory not found');
  
  if (fs.existsSync('./dist/index.js')) {
    console.log('Found dist/index.js, attempting to require it');
    
    // For ESM compiled modules, we need to use the dynamic import
    const appPath = path.resolve(process.cwd(), './dist/index.js');
    console.log('Resolving app path:', appPath);
    
    // Try CommonJS first
    try {
      const appModule = require('../../dist/index.js');
      app = appModule.default || appModule.app || app;
      console.log('Successfully loaded app module via CommonJS require');
    } catch (err) {
      console.error('Failed to load via CommonJS require:', err.message);
      
      // Fallback to direct execution (if the file exports a function)
      if (typeof app === 'function') {
        console.log('App is a function, using directly');
      } else {
        console.log('Using fallback Express app');
      }
    }
  } else {
    console.error('dist/index.js not found, using fallback Express app');
  }
} catch (err) {
  console.error('Error loading application module:', err);
}

// Create a server instance
server = createServer(app);

// Initialize Socket.IO with appropriate settings for Netlify
io = new Server(server, {
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

// Make io available to the app if it accepts it
if (typeof app.set === 'function') {
  app.set('io', io);
  app.set('server', server);
}

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
