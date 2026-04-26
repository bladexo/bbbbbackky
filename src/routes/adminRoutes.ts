import { Router } from 'express';
import { ipController } from '../middleware/ipMiddleware.js';
import { adminAuthMiddleware } from '../middleware/adminAuthMiddleware.js';

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
  const io = req.app.get('io');
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
  const io = req.app.get('io');
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

export default router; 