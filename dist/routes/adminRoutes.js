import { Router } from 'express';
import { ipController } from '../middleware/ipMiddleware.js';
import { adminAuthMiddleware } from '../middleware/adminAuthMiddleware.js';
const router = Router();
// Get all IP stats
router.get('/ips', adminAuthMiddleware, (req, res) => {
    const stats = ipController.getIPStats();
    res.json({
        success: true,
        data: stats
    });
});
// Block an IP
router.post('/block-ip', adminAuthMiddleware, (req, res) => {
    const { ip } = req.body;
    if (!ip) {
        res.status(400).json({
            success: false,
            error: 'IP address is required'
        });
        return;
    }
    ipController.blockIP(ip);
    res.json({
        success: true,
        message: `IP ${ip} has been blocked`
    });
});
// Unblock an IP
router.post('/unblock-ip', adminAuthMiddleware, (req, res) => {
    const { ip } = req.body;
    if (!ip) {
        res.status(400).json({
            success: false,
            error: 'IP address is required'
        });
        return;
    }
    ipController.unblockIP(ip);
    res.json({
        success: true,
        message: `IP ${ip} has been unblocked`
    });
});
export default router;
