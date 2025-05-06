import { Router, Request, Response } from 'express';
import { ipController } from '../middleware/ipMiddleware.js';
import { adminAuthMiddleware } from '../middleware/adminAuthMiddleware.js';
import HackAccess from '../models/HackAccess.js';

const router = Router();

// Username blocking controller
class UsernameBlockController {
  private blockedUsers: Map<string, {
    blockedAt: number;
    duration: number;
    expiresAt: number;
    username: string;
  }> = new Map();

  blockUsername(username: string, duration: number) {
    const now = Date.now();
    const expiresAt = now + (duration * 60 * 1000); // Convert minutes to milliseconds
    this.blockedUsers.set(username.toLowerCase(), {
      blockedAt: now,
      duration: duration * 60 * 1000, // Store duration in milliseconds
      expiresAt,
      username // Store original username to preserve case
    });
  }

  unblockUsername(username: string) {
    this.blockedUsers.delete(username.toLowerCase());
  }

  isBlocked(username: string) {
    const blockInfo = this.blockedUsers.get(username.toLowerCase());
    if (!blockInfo) return false;
    
    // Check if block has expired
    if (Date.now() >= blockInfo.expiresAt) {
      this.blockedUsers.delete(username.toLowerCase());
      return false;
    }
    return true;
  }

  getBlockedUsers() {
    const now = Date.now();
    const users: Record<string, any> = {};
    
    this.blockedUsers.forEach((info, username) => {
      // Clean up expired blocks
      if (now >= info.expiresAt) {
        this.blockedUsers.delete(username);
      } else {
        users[username] = info;
      }
    });
    
    return users;
  }
}

export const usernameController = new UsernameBlockController();

// Store socket.io instance
let io: any = null;

// Function to set socket.io instance
export const setSocketIO = (socketIO: any) => {
  io = socketIO;
};

// Get all IP stats
router.get('/ips', adminAuthMiddleware, (req, res) => {
  const stats = ipController.getIPStats();
  res.json({
    success: true,
    data: stats,
    timestamp: new Date().toISOString()
  });
});

// Username management routes
router.get('/usernames', adminAuthMiddleware, (req, res) => {
  const blockedUsers = usernameController.getBlockedUsers();
  res.json({
    success: true,
    data: blockedUsers,
    timestamp: new Date().toISOString()
  });
});

router.post('/usernames/block/:username', adminAuthMiddleware, (req, res) => {
  const { username } = req.params;
  const { duration } = req.body;

  if (!username || !duration || duration < 1) {
    res.status(400).json({
      success: false,
      error: 'Invalid username or duration'
    });
    return;
  }

  // Block the username first
  usernameController.blockUsername(username, duration);

  // Get the stored block info
  const blockInfo = usernameController.getBlockedUsers()[username.toLowerCase()];
  
  // Emit mute event and system message to all connected clients
  if (io) {
    // Emit mute event
    io.emit('user_muted', {
      username: blockInfo.username,
      duration: blockInfo.duration,
      muteUntil: blockInfo.expiresAt
    });

    // Emit system message
    io.emit('chat_message', {
      id: `mute-${Date.now()}`,
      username: 'SYSTEM',
      content: `${blockInfo.username} has been muted for ${Math.ceil(blockInfo.duration / 60000)} minute(s)`,
      timestamp: Date.now(),
      userColor: '#ff0000',
      isSystem: true,
      type: 'system'
    });
  }

  res.json({
    success: true,
    message: `Username ${username} has been blocked for ${duration} minutes`,
    timestamp: new Date().toISOString()
  });
});

router.post('/usernames/unblock/:username', adminAuthMiddleware, (req, res) => {
  const { username } = req.params;
  usernameController.unblockUsername(username);
  
  // Emit unmute event and system message to all connected clients
  if (io) {
    // Emit unmute event
    io.emit('user_unmuted', {
      username: username,
      timestamp: new Date().toISOString()
    });

    // Emit system message
    io.emit('chat_message', {
      id: `unmute-${Date.now()}`,
      username: 'SYSTEM',
      content: `${username} has been unmuted`,
      timestamp: Date.now(),
      userColor: '#00ff00',
      isSystem: true,
      type: 'system'
    });
  }
  
  res.json({
    success: true,
    message: `Username ${username} has been unblocked`,
    timestamp: new Date().toISOString()
  });
});

// Get specific IP stats
router.get('/ips/:ip', adminAuthMiddleware, (req, res) => {
  const { ip } = req.params;
  const stats = ipController.getIPStats()[ip];
  
  if (!stats) {
    res.status(404).json({
      success: false,
      error: 'IP not found'
    });
    return;
  }

  res.json({
    success: true,
    data: {
      ip,
      ...stats,
      isBlocked: ipController.isBlocked(ip)
    }
  });
});

// Block an IP
router.post('/ips/block/:ip', adminAuthMiddleware, (req, res) => {
  const { ip } = req.params;
  ipController.blockIP(ip);
  res.json({
    success: true,
    message: `IP ${ip} has been blocked`,
    timestamp: new Date().toISOString()
  });
});

// Unblock an IP
router.post('/ips/unblock/:ip', adminAuthMiddleware, (req, res) => {
  const { ip } = req.params;
  ipController.unblockIP(ip);
  res.json({
    success: true,
    message: `IP ${ip} has been unblocked`,
    timestamp: new Date().toISOString()
  });
});

interface AccessData {
  type: string;
  grantedAt: Date;
  usageCount: number;
  maxUsages: number | null;
  isActive: boolean;
}

interface FormattedList {
  [username: string]: AccessData;
}

interface HackAccessBody {
  username?: string;
  type: 'free' | 'specific' | 'random';
  maxUsages?: number;
}

// Get hack access list
router.get('/hack-access', adminAuthMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const accessList = await HackAccess.find({ isActive: true });
    
    const formattedList = accessList.reduce<FormattedList>((acc, access) => {
      acc[access.username] = {
        type: access.type,
        grantedAt: access.grantedAt,
        usageCount: access.usageCount,
        maxUsages: access.maxUsages,
        isActive: access.isActive
      };
      return acc;
    }, {});
    
    res.json({ success: true, data: formattedList });
  } catch (error) {
    console.error('Error fetching hack access list:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch hack access list' });
  }
});

// Update hack access
router.post('/hack-access/update', adminAuthMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, type, maxUsages } = req.body;
    
    if (type === 'specific' && !username) {
      res.status(400).json({ success: false, error: 'Username required for specific access' });
      return;
    }

    // Handle free access type separately since it doesn't need maxUsages
    if (type === 'free') {
      const hackAccess = await HackAccess.findOneAndUpdate(
        { username },
        {
          type,
          grantedAt: new Date(),
          maxUsages: null,
          usageCount: 0,
          isActive: true
        },
        { upsert: true, new: true }
      );

      // Emit hack access update to the user
      if (io) {
        const sockets = await io.fetchSockets();
        const userSocket = sockets.find((socket: any) => {
          const user = socket.data.user;
          return user && user.username === username;
        });

        if (userSocket) {
          userSocket.emit('hack_access_update', {
            hasAccess: true,
            accessInfo: {
              type: hackAccess.type,
              usageCount: hackAccess.usageCount,
              maxUsages: hackAccess.maxUsages
            }
          });
        }
      }

      res.json({ success: true });
      return;
    }

    // For non-free types, maxUsages is required and must be a number
    const maxUsagesCount = Number(maxUsages);
    if (isNaN(maxUsagesCount) || maxUsagesCount < 1) {
      res.status(400).json({ success: false, error: 'Valid maxUsages required' });
      return;
    }

    // Update or create the hack access
    const hackAccess = await HackAccess.findOneAndUpdate(
      { username },
      {
        type,
        grantedAt: new Date(),
        maxUsages: maxUsagesCount,
        usageCount: 0,
        isActive: true
      },
      { upsert: true, new: true }
    );

    // Emit hack access update to the user
    if (io) {
      const sockets = await io.fetchSockets();
      const userSocket = sockets.find((socket: any) => {
        const user = socket.data.user;
        return user && user.username === username;
      });

      if (userSocket) {
        userSocket.emit('hack_access_update', {
          hasAccess: true,
          accessInfo: {
            type: hackAccess.type,
            usageCount: hackAccess.usageCount,
            maxUsages: hackAccess.maxUsages
          }
        });
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating hack access:', error);
    res.status(500).json({ success: false, error: 'Failed to update hack access' });
  }
});

// Revoke hack access
router.post('/hack-access/revoke/:username', adminAuthMiddleware, async (req: Request<{ username: string }>, res: Response): Promise<void> => {
  try {
    const { username } = req.params;
    await HackAccess.findOneAndUpdate(
      { username },
      { isActive: false }
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error revoking hack access:', error);
    res.status(500).json({ success: false, error: 'Failed to revoke hack access' });
  }
});

export default router; 