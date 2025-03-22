import { Router } from 'express';
import { ipController } from '../middleware/ipMiddleware.js';
import { adminAuthMiddleware } from '../middleware/adminAuthMiddleware.js';

const router = Router();

// Get all IP stats
router.get('/ips', adminAuthMiddleware, (req, res) => {
  const stats = ipController.getIPStats();
  res.json({
    success: true,
    data: stats,
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