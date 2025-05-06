import { Server, Socket } from 'socket.io';
import { UserStats } from '../../models/UserStats.js';
import { GlobalStats } from '../../models/GlobalStats.js';
import { 
  activeUsers, 
  userIdentities, 
  addUser, 
  removeUser, 
  getUserCount, 
  UserWithStats 
} from '../state.js';
import { broadcastLeaderboard, broadcastGlobalStats, emitUserPoints } from '../utils/broadcaster.js';

/**
 * Sets up user event handlers for a socket
 * @param io The Socket.IO server instance
 * @param socket The socket to set up handlers for
 */
export function setupUserHandlers(io: Server, socket: Socket): void {
  // Handle user registration with identity support
  socket.on('register_user', async ({ identity, username, color }) => {
    console.log('User registering with identity:', { identity, username });
    
    // Validate username and identity
    if (!username || typeof username !== 'string' || username.length < 3) {
      socket.emit('error', 'Invalid username');
      return;
    }
    
    if (!identity || typeof identity !== 'string') {
      socket.emit('error', 'Invalid identity');
      return;
    }
    
    try {
      // Check if this identity already exists and update the socket ID
      if (userIdentities.has(identity)) {
        const oldSocketId = userIdentities.get(identity);
        if (oldSocketId && activeUsers.has(oldSocketId)) {
          // Get the existing user data and ensure it's type-safe
          const existingUser = activeUsers.get(oldSocketId);
          if (existingUser) {
            // Remove old socket mapping
            activeUsers.delete(oldSocketId);
            
            // Create updated user object with new socket ID with explicit typing
            const updatedUser: UserWithStats = {
              id: socket.id,
              username: existingUser.username,
              color: existingUser.color,
              messageCount: existingUser.messageCount,
              reactionCount: existingUser.reactionCount,
              points: existingUser.points,
              lastActive: new Date()
            };
            
            // Store updated user
            activeUsers.set(socket.id, updatedUser);
            userIdentities.set(identity, socket.id);
            
            console.log(`User reconnected with identity: ${identity}, username: ${updatedUser.username} (${socket.id})`);
            console.log('Active users count:', activeUsers.size);
            
            // Emit events for reconnected user
            io.emit('user_joined', {
              id: socket.id,
              username: updatedUser.username,
              onlineCount: activeUsers.size
            });
            
            // Send a welcome back notification
            socket.emit('notification', {
              type: 'success',
              title: 'Reconnected',
              message: `Welcome back, ${updatedUser.username}!`,
              duration: 3000
            });
            
            // Send registration confirmation
            socket.emit('registration_confirmed');
            
            // Emit updated points to the user
            await emitUserPoints(socket, updatedUser.username);
            
            // Broadcast updated stats
            await broadcastLeaderboard(io);
            await broadcastGlobalStats(io);
            return;
          }
        }
      }
      
      // If no existing user with this identity or socket ID not active,
      // register as a new user
      
      // Check for existing username
      const usernameTaken = Array.from(activeUsers.values())
        .some(user => user.username.toLowerCase() === username.toLowerCase());
      
      if (usernameTaken) {
        socket.emit('error', 'Username already taken');
        return;
      }
      
      // First register user in memory
      const newUser = {
        id: socket.id,
        username,
        color,
        messageCount: 0,
        reactionCount: 0,
        points: 0,
        lastActive: new Date()
      };
      
      activeUsers.set(socket.id, newUser);
      userIdentities.set(identity, socket.id);
      
      console.log(`User registered in memory: ${username} (${socket.id}), identity: ${identity}`);
      console.log('Active users count:', activeUsers.size);
      
      // Then add/update in MongoDB
      const result = await UserStats.findOneAndUpdate({ username }, {
        $setOnInsert: {
          username,
          color,
          messageCount: 0,
          reactionCount: 0,
          points: 0,
          lastActive: new Date()
        }
      }, { upsert: true, new: true });
      
      // Update global user count
      await GlobalStats.updateUserCount(activeUsers.size);
      console.log('User added/updated in MongoDB:', result);
      
      // Send a welcome notification
      socket.emit('notification', {
        type: 'success',
        title: 'Welcome',
        message: `Welcome to the chat, ${username}!`,
        duration: 3000
      });
      
      // Send registration confirmation
      socket.emit('registration_confirmed');
      
      // Emit events
      io.emit('user_joined', {
        id: socket.id,
        username,
        onlineCount: activeUsers.size
      });
      
      // Broadcast online count separately to ensure it's received
      io.emit('online_count', { count: activeUsers.size });
      
      // Broadcast updated stats
      await broadcastLeaderboard(io);
      await broadcastGlobalStats(io);
    } catch (error) {
      console.error('Error registering user:', error);
      activeUsers.delete(socket.id);
      userIdentities.delete(identity);
      socket.emit('error', 'Failed to register user');
    }
  });

  // Keep the old register handler for backward compatibility
  socket.on('register', async ({ username, color }) => {
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

    try {
      // First register user in memory
      const newUser: UserWithStats = {
        id: socket.id,
        username,
        color,
        messageCount: 0,
        reactionCount: 0,
        points: 0,
        lastActive: new Date()
      };
      activeUsers.set(socket.id, newUser);
      console.log(`User registered in memory: ${username} (${socket.id})`);
      console.log('Active users count:', activeUsers.size);

      // Then add/update in MongoDB
      const result = await UserStats.findOneAndUpdate(
        { username },
        { 
          $setOnInsert: {
            username,
            color,
            messageCount: 0,
            reactionCount: 0,
            points: 0,
            lastActive: new Date()
          }
        },
        { upsert: true, new: true }
      );

      // Update global user count
      await GlobalStats.updateUserCount(activeUsers.size);
      
      console.log('User added/updated in MongoDB:', result);
    
      // Send a welcome notification
      socket.emit('notification', {
        type: 'success',
        title: 'Welcome',
        message: `Welcome to the chat, ${username}!`,
        duration: 3000
      });
      
      // Emit events
      io.emit('user_joined', {
        id: socket.id,
        username,
        onlineCount: activeUsers.size
      });

      // Broadcast online count separately to ensure it's received
      io.emit('online_count', { count: activeUsers.size });

      // Broadcast updated stats
      await broadcastLeaderboard(io);
      await broadcastGlobalStats(io);

    } catch (error) {
      console.error('Error registering user:', error);
      activeUsers.delete(socket.id);
      socket.emit('error', 'Failed to register user');
    }
  });

  // Handle disconnection with reason and cleanup
  socket.on('disconnect', async (reason) => {
    console.log(`Client ${socket.id} disconnected. Reason: ${reason}`);
    const user = activeUsers.get(socket.id);
    if (user) {
      try {
        // Keep the user in memory for a short time to allow for reconnection
        setTimeout(async () => {
          // Only clean up if the user hasn't reconnected
          if (activeUsers.get(socket.id)?.username === user.username) {
            // Update last active time in MongoDB
            await UserStats.findOneAndUpdate(
              { username: user.username },
              { $set: { lastActive: new Date() } }
            );

            // Clean up user from active users
            activeUsers.delete(socket.id);
            
            // Clean up from identities map
            // Find and remove any identity mapping to this socket
            for (const [identity, socketId] of userIdentities.entries()) {
              if (socketId === socket.id) {
                console.log(`Removing identity mapping for socket ${socket.id} (${identity})`);
                userIdentities.delete(identity);
              }
            }
            
            // Also clean up any other sockets that might have the same username
            for (const [socketId, activeUser] of activeUsers.entries()) {
              if (activeUser.username === user.username && socketId !== socket.id) {
                activeUsers.delete(socketId);
              }
            }

            // Update global user count
            await GlobalStats.updateUserCount(activeUsers.size);

            console.log(`User disconnected: ${user.username} (${socket.id})`);
            console.log('Active users:', activeUsers.size);

            io.emit('user_left', {
              id: socket.id,
              username: user.username,
              onlineCount: activeUsers.size,
              reason: reason
            });

            // Broadcast online count separately to ensure it's received
            io.emit('online_count', { count: activeUsers.size });
            await broadcastLeaderboard(io);
            await broadcastGlobalStats(io);
          }
        }, 5000); // Wait 5 seconds before cleanup to allow for quick reconnects

      } catch (error) {
        console.error('Error handling disconnect:', error);
      }
    }
  });

  // Add handler to check registration status
  socket.on('check_registration', ({ username }, callback) => {
    console.log(`Checking registration for username: ${username}`);
    
    // Check if this socket is registered
    const isSocketRegistered = activeUsers.has(socket.id);
    
    // Check if the username exists in any active user
    const usernameExists = Array.from(activeUsers.values())
      .some(user => user.username === username);
    
    // Check if this socket's username matches the requested username
    const currentUser = activeUsers.get(socket.id);
    const isCorrectUser = currentUser && currentUser.username === username;
    
    console.log(`Registration check: socket registered: ${isSocketRegistered}, username exists: ${usernameExists}, is correct user: ${isCorrectUser}`);
    
    // Only consider registered if this socket has the correct username
    const registered = isSocketRegistered && isCorrectUser;
    
    callback({ registered });
  });
}
