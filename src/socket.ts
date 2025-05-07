import { Server } from 'socket.io';
import type { Server as HTTPServer } from 'http';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';

interface User {
  id: string;
  username: string;
  publicKey: string;
  color?: string;
}

export const initializeSocket = (httpServer: HTTPServer) => {
  const isProd = process.env.NODE_ENV === 'production';
  const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
  const KOYEB_URL = process.env.KOYEB_URL;
  
  const allowedOrigins = isProd
    ? [KOYEB_URL ? `https://nutty-annabell-loganrustyy-25293412.koyeb.app` : FRONTEND_URL]
    : ['http://localhost:5173', 'http://127.0.0.1:5173'];

  const io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins,
      methods: ['GET', 'POST'],
      credentials: true
    },
    pingInterval: parseInt(process.env.WS_PING_INTERVAL || '30000', 10),
    pingTimeout: parseInt(process.env.WS_PING_TIMEOUT || '5000', 10)
  });

  const users = new Map<string, User>();

  io.on('connection', async (socket) => {
    console.log('User connected:', socket.id);

    socket.emit('online_users', {
      users: Array.from(users.values()),
      count: users.size
    });

    socket.on('register', async ({ username, publicKey, color }: { username: string; publicKey: string; color: string }) => {
      console.log('User registering:', { username, color });
      
      // Store user in memory
      users.set(socket.id, { 
        id: socket.id, 
        username, 
        publicKey, 
        color
      });
      
      io.emit('user_joined', {
        id: socket.id,
        username,
        onlineCount: users.size
      });
    });

    socket.on('chat_message', async ({ encryptedMessage, recipientId, content, timestamp }) => {
      const sender = users.get(socket.id);
      if (!sender) {
        console.log('Message received but no sender found for socket:', socket.id);
        return;
      }

      console.log('Processing message from:', sender.username);

      io.emit('chat_message', {
        senderId: socket.id,
        senderUsername: sender.username,
        encryptedMessage,
        content,
        timestamp: timestamp || Date.now()
      });
    });

    socket.on('message:react', async ({ messageId, reaction }) => {
      const user = users.get(socket.id);
      if (!user) {
        console.log('Reaction received but no user found for socket:', socket.id);
        return;
      }

      console.log('Processing reaction from:', user.username);
      
      io.emit('reaction:received', {
        messageId,
        reaction,
        username: user.username
      });
    });

    // Handle disconnection
    socket.on('disconnect', async () => {
      const user = users.get(socket.id);
      if (user) {
        console.log('User disconnected:', user.username);
        users.delete(socket.id);
        
        io.emit('user_left', {
          id: socket.id,
          username: user.username,
          onlineCount: users.size
        });
      }
    });

    // Handle ping to keep connection alive
    socket.on('ping', () => {
      socket.emit('pong');
    });
  });

  // Periodic cleanup of stale connections
  setInterval(() => {
    io.sockets.sockets.forEach((socket) => {
      socket.emit('ping');
      const pongTimeout = setTimeout(() => {
        if (users.has(socket.id)) {
          users.delete(socket.id);
          socket.disconnect(true);
        }
      }, 5000);

      socket.once('pong', () => {
        clearTimeout(pongTimeout);
      });
    });
  }, 30000);

  return io;
}; 
