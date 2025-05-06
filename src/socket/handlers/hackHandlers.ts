import { Server, Socket } from 'socket.io';
import { activeUsers } from '../state.js';
import { broadcastLeaderboard } from '../utils/broadcaster.js';
import HackAccess from '../../models/HackAccess.js';
import { UserStats } from '../../models/UserStats.js';

/**
 * Sets up hack feature event handlers for a socket
 * @param io The Socket.IO server instance
 * @param socket The socket to set up handlers for
 */
export function setupHackHandlers(io: Server, socket: Socket): void {
  // Add handler to check hack access
  socket.on('check_hack_access', async ({ userId }, callback) => {
    const user = activeUsers.get(socket.id);
    if (!user) {
      callback({ hasAccess: false });
      return;
    }

    try {
      const hackAccess = await HackAccess.findOne({
        username: user.username,
        isActive: true
      });

      const hasAccess = hackAccess?.isValid() || false;
      const previousAccess = user.hackAccess || false;
      
      // Store hack access in user state to track changes
      user.hackAccess = hasAccess;
      
      // Prepare response with access details
      const response = {
        hasAccess,
        accessInfo: hackAccess ? {
          type: hackAccess.type,
          usageCount: hackAccess.usageCount,
          maxUsages: hackAccess.maxUsages
        } : null
      };
      
      // Send notification if user just gained hack access
      if (hasAccess && !previousAccess) {
        socket.emit('notification', {
          type: 'success',
          title: '🎯 Hack Access Granted',
          message: hackAccess?.type === 'free' 
            ? 'You now have unlimited hack access!'
            : `You now have hack access! (${hackAccess?.maxUsages || 0} uses)`,
          duration: 5000
        });
      }
      
      callback(response);
    } catch (error) {
      console.error('Error checking hack access:', error);
      callback({ hasAccess: false });
    }
  });

  // Add hack feature handler
  socket.on('execute_hack', async ({ userId, targetMode, targetUsername }) => {
    console.log(`[HACK] Hack attempt from user ID: ${userId}, mode: ${targetMode}, target: ${targetUsername}`);
    const hacker = activeUsers.get(socket.id);
    
    if (!hacker) {
      console.log('[HACK] Hack failed: User not found');
      socket.emit('error', 'Not registered');
      socket.emit('hack_completed', { success: false, message: 'Not registered' });
      return;
    }

    try {
      // Check hack access
      const hackAccess = await HackAccess.findOne({ username: hacker.username, isActive: true });
      
      if (!hackAccess?.isValid()) {
        // Check for random selection (10% chance)
        if (Math.random() < 0.1) {
          // Grant random access for 3 uses
          await HackAccess.create({
            username: hacker.username,
            type: 'random',
            maxUsages: 3,
            usageCount: 0
          });
          socket.emit('notification', {
            type: 'success',
            message: '🎲 You got lucky! Hack access granted for 3 uses!'
          });
        } else {
          socket.emit('error', 'No hack access');
          socket.emit('hack_completed', { success: false, message: 'No hack access' });
          return;
        }
      }

      // Get potential victims based on mode
      let potentialVictims = Array.from(activeUsers.values())
        .filter(user => user.id !== socket.id && user.points > 0);

      // If specific targeting is requested, filter for that username
      if (targetMode === 'specific' && targetUsername) {
        const targetUser = potentialVictims.find(
          user => user.username.toLowerCase() === targetUsername.toLowerCase()
        );
        
        if (!targetUser) {
          socket.emit('error', 'Target user not found or offline');
          socket.emit('hack_completed', { success: false, message: 'Target user not found or offline' });
          return;
        }
        
        potentialVictims = [targetUser];
      } else if (potentialVictims.length < 1) {
        socket.emit('error', 'Not enough victims available');
        socket.emit('hack_completed', { success: false, message: 'Not enough victims available' });
        return;
      }

      console.log(`[HACK] Found ${potentialVictims.length} potential victims`);
      
      // For random mode, we need at least 3 users (or at least 1 if not enough users)
      const numVictimsToHack = targetMode === 'specific' ? 1 : Math.min(3, potentialVictims.length);
      
      // Select victims
      const victims = [];
      const selectedVictims = new Set();
      let totalStolenPoints = 0;

      while (victims.length < numVictimsToHack && selectedVictims.size < potentialVictims.length) {
        // For specific mode, just use the first victim
        // For random mode, select randomly
        const victimIndex = targetMode === 'specific' ? 0 : Math.floor(Math.random() * potentialVictims.length);
        const victim = potentialVictims[victimIndex];
        
        if (!selectedVictims.has(victim.id)) {
          selectedVictims.add(victim.id);
          const stolenPoints = Math.floor(victim.points * 0.5); // Steal 50% of points instead of 10%
          victim.points -= stolenPoints;
          totalStolenPoints += stolenPoints;
          victims.push(victim);

          // Notify victim with a clearer message
          const victimSocket = io.sockets.sockets.get(victim.id);
          if (victimSocket) {
            victimSocket.emit('notification', {
              type: 'error',
              title: '⚠️ Hacked!',
              message: `You've been hacked by ${hacker.username}! Lost ${stolenPoints} points!`,
              duration: 5000 // Show for 5 seconds
            });
            // Broadcast victim's updated points
            victimSocket.emit('user_points_update', { points: victim.points });
          }
        }
      }
      
      // Increment usage count for non-free hack access types
      if (hackAccess && hackAccess.type !== 'free') {
        hackAccess.usageCount += 1;
        await hackAccess.save();
        
        // Notify user of remaining usages
        if (hackAccess.maxUsages !== null) {
          const remaining = hackAccess.maxUsages - hackAccess.usageCount;
          if (remaining <= 0) {
            socket.emit('notification', {
              type: 'warning',
              title: 'Hack Access',
              message: `⚠️ You have used all your hack attempts!`,
              duration: 5000
            });
          } else {
            socket.emit('notification', {
              type: 'info',
              title: 'Hack Access',
              message: `ℹ️ You have ${remaining} hack attempts remaining.`,
              duration: 5000
            });
          }
        }
      }

      // Update hacker's points
      hacker.points += totalStolenPoints;
      
      // Broadcast hacker's updated points
      socket.emit('user_points_update', { points: hacker.points });

      // Update points in the database
      try {
        await UserStats.updateOne(
          { username: hacker.username },
          { $inc: { points: totalStolenPoints } }
        );
        
        for (const victim of victims) {
          await UserStats.updateOne(
            { username: victim.username },
            { $inc: { points: -Math.floor(victim.points * 0.5) } } // Update to 50% here too
          );
        }
      } catch (dbError) {
        console.error('[HACK] Error updating points in database:', dbError);
      }

      // Broadcast system message
      io.emit('message', {
        id: `system-${Date.now()}`,
        username: 'SYSTEM',
        content: `🎯 ${hacker.username} hacked ${victims.map(v => v.username).join(', ')} and stole ${totalStolenPoints} points!`,
        timestamp: new Date(),
        isSystem: true
      });

      // Send clear success notification to hacker
      socket.emit('notification', {
        type: 'success',
        title: '🎯 Hack Successful!',
        message: `You hacked ${victims.map(v => v.username).join(', ')} and stole ${totalStolenPoints} points!`,
        duration: 5000
      });

      // Send success response
      socket.emit('hack_result', {
        success: true,
        stolenPoints: totalStolenPoints,
        victims: victims.map(v => v.username)
      });

      // Send hack_completed event to stop loading state
      socket.emit('hack_completed', { 
        success: true, 
        stolenPoints: totalStolenPoints,
        victims: victims.map(v => v.username)
      });

      // Update leaderboard
      broadcastLeaderboard(io);
    } catch (error) {
      console.error('[HACK] Error:', error);
      socket.emit('error', 'Hack failed');
      socket.emit('hack_completed', { success: false, message: 'Hack failed: Server error' });
    }
  });
}
