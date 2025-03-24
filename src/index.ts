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
import { ipMiddleware } from './middleware/ipMiddleware.js';
import adminRoutes from './routes/adminRoutes.js';

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
  ? ['https://dworldchat.vercel.app', `https://${KOYEB_URL}`]
  : ['http://localhost:5173', 'http://127.0.0.1:5173'];

// Apply CORS configuration before other middleware
app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      connectSrc: ["'self'", "wss:", "ws:"],
      imgSrc: ["'self'", "data:", "blob:"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: []
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
    environment: process.env.NODE_ENV,
    cors: {
      allowedOrigins,
      corsEnabled: true
    },
    socket: {
      transports: ['websocket', 'polling'],
      path: '/socket.io/',
      pingInterval: 25000,
      pingTimeout: 20000
    }
  });
});

// Test CORS endpoint
app.options('/test-cors', cors());
app.get('/test-cors', (req, res) => {
  res.json({
    success: true,
    origin: req.headers.origin,
    message: 'CORS is working'
  });
});

// Initialize Socket.IO with CORS
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: ["*"]
  },
  allowEIO3: true,
  path: '/socket.io/',
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
  },
  transports: ['websocket', 'polling'],
  pingInterval: 25000,
  pingTimeout: 20000
});

// Simple user tracking
const activeUsers = new Map<string, { username: string; color: string }>();

// Sanitize user input function with additional security measures
const sanitizeInput = (input: string): string => {
  if (typeof input !== 'string') return '';
  
  // Remove any potential script tags and attributes
  input = input.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
              .replace(/<[^>]*>/g, ''); // Remove HTML tags
              
  // Sanitize using xss package
  input = xss(input.trim(), {
    whiteList: {}, // No HTML allowed
    stripIgnoreTag: true,
    stripIgnoreTagBody: ['script', 'style', 'xml'],
  });
  
  // Additional checks
  if (input.length > 1000) {
    input = input.substring(0, 1000);
  }
  
  return input;
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

  socket.on('register', async ({ username, color, cfToken }) => {
    console.log(`[${new Date().toISOString()}] Registration attempt for ${username}`);
    console.log(`[${new Date().toISOString()}] Received cfToken:`, cfToken ? 'Token present' : 'No token');
    
    // Validate username
    if (!username || typeof username !== 'string' || username.length < 3) {
      console.log(`[${new Date().toISOString()}] Invalid username: ${username}`);
      socket.emit('error', 'Invalid username');
      return;
    }

    // Validate Turnstile token
    if (!cfToken) {
      console.log(`[${new Date().toISOString()}] No Cloudflare token provided`);
      socket.emit('error', 'Bot verification token missing');
      return;
    }

    try {
      console.log(`[${new Date().toISOString()}] Validating Turnstile token for ${username}`);
      const formData = new URLSearchParams();
      formData.append('secret', process.env.CLOUDFLARE_SECRET_KEY || '');
      formData.append('response', cfToken);
      formData.append('remoteip', socket.handshake.address);

      console.log(`[${new Date().toISOString()}] Sending request to Cloudflare with token length: ${cfToken.length}`);
      const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: formData,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      const data = await result.json();
      console.log(`[${new Date().toISOString()}] Cloudflare response:`, data);
      
      if (!data.success) {
        console.log(`[${new Date().toISOString()}] Bot validation failed for ${username}. Response:`, data);
        socket.emit('error', `Bot validation failed: ${data['error-codes']?.join(', ') || 'Unknown error'}`);
        return;
      }

      console.log(`[${new Date().toISOString()}] Bot validation successful for ${username}`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Error validating Turnstile token:`, error);
      socket.emit('error', 'Failed to validate bot protection');
      return;
    }

    // Check for existing username
    const usernameTaken = Array.from(activeUsers.values())
      .some(user => user.username.toLowerCase() === username.toLowerCase());
    
    if (usernameTaken) {
      console.log(`[${new Date().toISOString()}] Username already taken: ${username}`);
      socket.emit('error', 'Username already taken');
      return;
    }

    // Register user
    activeUsers.set(socket.id, { username, color });
    console.log(`[${new Date().toISOString()}] User registered successfully: ${username} (${socket.id})`);
    console.log(`[${new Date().toISOString()}] Active users count:`, activeUsers.size);

    // Emit success event to the user
    socket.emit('registration_success', { username, color });

    // Emit user joined event to all clients
    io.emit('user_joined', {
      id: socket.id,
      username,
      color,
      onlineCount: activeUsers.size
    });

    // Emit online count update
    io.emit('online_count', { count: activeUsers.size });
  });

  socket.on('chat_message', (data) => {
    const user = activeUsers.get(socket.id);
    if (!user) {
      socket.emit('error', 'Not registered');
      return;
    }

    // Validate message structure
    if (!data || typeof data !== 'object') {
      socket.emit('error', 'Invalid message format');
      return;
    }

    // Sanitize message content
    if (typeof data.content !== 'string' || !data.content.trim()) {
      socket.emit('error', 'Invalid message content');
      return;
    }

    data.content = sanitizeInput(data.content);

    // Validate message length
    if (data.content.length > 1000) {
      socket.emit('error', 'Message too long');
      return;
    }

    // Validate reply if present
    if (data.replyTo) {
      if (typeof data.replyTo !== 'object' || !data.replyTo.id || !data.replyTo.content) {
        socket.emit('error', 'Invalid reply format');
        return;
      }
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

// Admin authentication middleware
const adminAuth: RequestHandler = (req, res, next): void => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized - No token provided' });
    return;
  }

  const token = authHeader.split(' ')[1];
  const adminPassword = process.env.ADMIN_PASSWORD;
  
  if (!adminPassword) {
    console.error('ADMIN_PASSWORD not set in environment variables');
    res.status(500).json({ error: 'Server configuration error' });
    return;
  }

  if (token !== adminPassword) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  next();
};

// Apply IP middleware to all routes
app.use(ipMiddleware);

// Admin status page - serve without authentication
app.get('/admin/status', (_req, res) => {
  const statusPath = join(__dirname, '../public/admin-status.html');
  if (fs.existsSync(statusPath)) {
    res.sendFile(statusPath);
  } else {
    res.status(404).send('Admin status page not found');
  }
});

// Admin API endpoints - require authentication
app.get('/admin/health', adminAuth, (req, res) => {
  const connectedSockets = io.sockets.sockets.size;
  const uptime = process.uptime();
  
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    uptime: {
      seconds: Math.floor(uptime),
      formatted: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`
    },
    memory: process.memoryUsage(),
    connections: {
      active: connectedSockets,
      users: activeUsers.size
    },
    cors: {
      allowedOrigins,
      corsEnabled: true
    },
    socket: {
      transports: ['websocket', 'polling'],
      path: '/socket.io/',
      pingInterval: 25000,
      pingTimeout: 20000
    }
  });
});

// Admin message endpoint
app.post('/admin/message', adminAuth, (req, res): void => {
  const { message } = req.body;
  
  if (!message || typeof message !== 'string' || message.length > 1000) {
    res.status(400).json({ error: 'Invalid message' });
    return;
  }

  const systemMessageId = `backend-${Math.random().toString(36).substr(2, 9)}`;
  
  // Create message data with consistent format
  const messageData = {
    id: systemMessageId,
    senderId: 'system',
    username: 'SYSTEM',
    content: sanitizeInput(message),
    timestamp: Date.now(),
    userColor: '#39ff14',
    mentions: [],
    isSystem: true,
    type: 'system'
  };

  // Log the message being sent
  console.log('[System Message] Sending:', messageData);
  
  // Send system message to all clients
  io.emit('chat_message', messageData);

  res.json({ success: true });
});

// Admin routes from external file
app.use('/admin', adminRoutes);

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
