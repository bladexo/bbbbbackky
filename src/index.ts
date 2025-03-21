import express, { RequestHandler } from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import path from 'path';
import helmet from 'helmet';
import xss from 'xss';
import dotenv from 'dotenv';

// Load environment variables based on NODE_ENV
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
dotenv.config({ path: envFile });

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
  ? [KOYEB_URL ? `https://${KOYEB_URL}` : FRONTEND_URL]
  : ['http://localhost:5173', 'http://127.0.0.1:5173'];

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      connectSrc: ["'self'", "wss:", "ws:", ...allowedOrigins],
      imgSrc: ["'self'", "data:", "blob:"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
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
    environment: process.env.NODE_ENV
  });
});

// Apply CORS configuration
app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST'],
  credentials: true
}));

// Initialize Socket.IO with CORS
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true
  },
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
  }
});

// Simple user tracking
const activeUsers = new Map<string, { username: string; color: string }>();

// Sanitize user input function
const sanitizeInput = (input: string): string => {
  return xss(input.trim());
};

// Connection logging
io.on('connection', (socket) => {
  console.log(`[${new Date().toISOString()}] Client connected: ${socket.id}`);
  
  socket.on('disconnect', (reason) => {
    console.log(`[${new Date().toISOString()}] Client disconnected: ${socket.id}, Reason: ${reason}`);
  });

  socket.on('error', (error) => {
    console.error(`[${new Date().toISOString()}] Socket error for ${socket.id}:`, error);
  });

  socket.on('register', ({ username, color }) => {
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

    // Register user
    activeUsers.set(socket.id, { username, color });
    console.log(`User registered: ${username} (${socket.id})`);
    console.log('Active users:', activeUsers.size);

    io.emit('user_joined', {
      id: socket.id,
      username
    });

    io.emit('online_count', { count: activeUsers.size });
  });

  socket.on('chat_message', (data) => {
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

    // Validate reply if present
    if (data.replyTo) {
      data.replyTo.content = sanitizeInput(data.replyTo.content);
    }

    // Extract mentions from message content
    const mentions: string[] = [];
    const mentionRegex = /@([\w_]+)/g;
    let match;
    while ((match = mentionRegex.exec(data.content)) !== null) {
      const mentionedUsername = match[1];
      // Find the user ID for the mentioned username
      const mentionedUserId = Array.from(activeUsers.entries())
        .find(([_, user]) => user.username === mentionedUsername)?.[0];
      if (mentionedUserId) {
        mentions.push(mentionedUserId);
      }
    }

    // Add mentions to the message data
    const messageData = {
      ...data,
      mentions,
      timestamp: Date.now()
    };

    io.emit('chat_message', messageData);

    // Send notifications to mentioned users
    mentions.forEach(userId => {
      const mentionedSocket = io.sockets.sockets.get(userId);
      if (mentionedSocket) {
        mentionedSocket.emit('mention', {
          type: 'mention',
          username: user.username,
          timestamp: Date.now()
        });
      }
    });
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

  socket.on('disconnect', () => {
    const user = activeUsers.get(socket.id);
    if (user) {
      activeUsers.delete(socket.id);
      console.log(`User disconnected: ${user.username} (${socket.id})`);
      console.log('Active users:', activeUsers.size);

      io.emit('user_left', {
        id: socket.id,
        username: user.username
      });

      io.emit('online_count', { count: activeUsers.size });
    }
  });
});

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

httpServer.listen(PORT, HOST, () => {
  console.log(`[${new Date().toISOString()}] Server started`);
  console.log(`[${new Date().toISOString()}] Server running on http://${HOST}:${PORT}`);
  console.log(`[${new Date().toISOString()}] Status page available at http://${HOST}:${PORT}/status`);
  console.log(`[${new Date().toISOString()}] Environment: ${process.env.NODE_ENV}`);
  console.log(`[${new Date().toISOString()}] Allowed origins:`, allowedOrigins);
});
