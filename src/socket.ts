import { Server } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';

interface User {
  id: string;
  username: string;
  publicKey: string;
}

export const initializeSocket = (httpServer: HTTPServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.NODE_ENV === 'production'
        ? 'your-production-domain.com'
        : ['http://localhost:5173', 'http://127.0.0.1:5173'], // Vite's default ports
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  const users = new Map<string, User>();

  const broadcastUserCount = () => {
    io.emit('online_users', {
      users: Array.from(users.values()),
      count: users.size
    });
  };

  io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Send initial online users count to the new connection
    socket.emit('online_users', {
      users: Array.from(users.values()),
      count: users.size
    });

    // Handle user registration with their public key
    socket.on('register', ({ username, publicKey }: { username: string; publicKey: string }) => {
      users.set(socket.id, { id: socket.id, username, publicKey });
      
      // Broadcast user joined and updated count
      io.emit('user_joined', {
        id: socket.id,
        username,
        onlineCount: users.size
      });

      // Broadcast updated user list
      broadcastUserCount();
    });

    // Handle encrypted message broadcasting
    socket.on('chat_message', ({ encryptedMessage, recipientId }) => {
      const sender = users.get(socket.id);
      if (!sender) return;

      // Broadcast the encrypted message
      io.emit('chat_message', {
        senderId: socket.id,
        senderUsername: sender.username,
        encryptedMessage,
        timestamp: Date.now()
      });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      const user = users.get(socket.id);
      if (user) {
        users.delete(socket.id);
        io.emit('user_left', {
          id: socket.id,
          username: user.username,
          onlineCount: users.size
        });
        
        // Broadcast updated user list
        broadcastUserCount();
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
          broadcastUserCount();
        }
      }, 5000);

      socket.once('pong', () => {
        clearTimeout(pongTimeout);
      });
    });
  }, 30000);

  return io;
}; 