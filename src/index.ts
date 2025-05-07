import express, { RequestHandler } from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import path from 'path';
import helmet from 'helmet';
import xss from 'xss';
import dotenv from 'dotenv';
import { ipMiddleware } from './middleware/ipMiddleware.js';
import adminRoutes, { setSocketIO } from './routes/adminRoutes.js';
import { usernameController } from './routes/adminRoutes.js';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';
import { connectDB } from './config/database.js';
import { UserStats } from './models/UserStats.js';
import HackAccess from './models/HackAccess.js';
import GlobalStats from './models/GlobalStats.js';
import { initializeSocket } from './socket/index.js';
import mongoose from 'mongoose';
import statusRoutes from './routes/statusRoutes.js';

// Load environment variables based on NODE_ENV
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env';
dotenv.config({ path: envFile });

// Add debug logging for environment variables
console.log('Environment:', process.env.NODE_ENV);
console.log('Admin password set:', !!process.env.ADMIN_PASSWORD);
console.log('Using env file:', envFile);

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
  ? ['https://dworldchat.vercel.app', `https://nutty-annabell-loganrustyy-25293412.koyeb.app`]
  : ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:8000', 'http://192.168.60.16:8000'];

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
      connectSrc: ["'self'", "wss:", "ws:", "http://localhost:8000", "http://192.168.60.16:8000"],
      imgSrc: ["'self'", "data:", "blob:"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
      formAction: ["'self'", "http://localhost:8000", "http://192.168.60.16:8000"],
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

// Register status routes
app.use(statusRoutes);

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

// Initialize Socket.IO with our modular architecture
const io = initializeSocket(httpServer);

// Set socket.io instance in adminRoutes
setSocketIO(io);

// Make io available to routes
app.set('io', io);

// Admin authentication middleware
const adminAuth: RequestHandler = (req, res, next): void => {
  const authHeader = req.headers.authorization;
  console.log('Auth header:', authHeader); // Debug log

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('No valid auth header found'); // Debug log
    res.status(401).json({ error: 'Unauthorized - No token provided' });
    return;
  }

  const token = authHeader.split(' ')[1];
  const adminPassword = process.env.ADMIN_PASSWORD;
  
  console.log('Admin password set:', !!adminPassword); // Debug log (don't log the actual password)
  console.log('Token received:', token ? 'Yes' : 'No'); // Debug log
  
  if (!adminPassword) {
    console.error('ADMIN_PASSWORD not set in environment variables');
    res.status(500).json({ 
      error: 'Server configuration error',
      details: 'ADMIN_PASSWORD environment variable is not set'
    });
    return;
  }

  if (token !== adminPassword) {
    console.log('Invalid credentials provided'); // Debug log
    res.status(401).json({ 
      error: 'Invalid credentials',
      details: 'The provided password does not match the admin password'
    });
    return;
  }

  console.log('Authentication successful'); // Debug log
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
      users: io.sockets.sockets.size
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
const HOST = '0.0.0.0';

// Initialize database before starting the server
const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();
    
    // Start the server
    httpServer.listen(PORT, HOST, () => {
      console.log(`[${new Date().toISOString()}] Server started`);
      console.log(`[${new Date().toISOString()}] Server running on port ${PORT}`);
      console.log(`[${new Date().toISOString()}] Environment: ${process.env.NODE_ENV}`);
      console.log(`[${new Date().toISOString()}] Allowed origins:`, allowedOrigins);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
