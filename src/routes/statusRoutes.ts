import { Router } from 'express';
import { activeUsers } from '../socket/state.js';

const router = Router();

/**
 * Status endpoint - returns server status information
 */
router.get('/status', (req, res) => {
  try {
    // Return basic status info
    res.json({
      status: 'ok',
      serverTime: new Date().toISOString(),
      activeUsers: activeUsers.size,
      uptime: process.uptime()
    });
  } catch (error) {
    console.error('Error in status endpoint:', error);
    res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

export default router; 
