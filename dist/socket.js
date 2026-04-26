import { RateLimiterMemory } from 'rate-limiter-flexible';
class IPController {
    constructor() {
        this.ipMap = new Map();
        this.blockedIPs = new Set();
        this.rateLimiter = new RateLimiterMemory({
            points: 100, // Number of requests
            duration: 60, // Per minute
        });
    }
    static getInstance() {
        if (!IPController.instance) {
            IPController.instance = new IPController();
        }
        return IPController.instance;
    }
    trackIP(ip) {
        const stats = this.ipMap.get(ip) || { requests: 0, lastRequest: new Date(), blocked: false };
        stats.requests++;
        stats.lastRequest = new Date();
        this.ipMap.set(ip, stats);
    }
    blockIP(ip) {
        this.blockedIPs.add(ip);
        const stats = this.ipMap.get(ip);
        if (stats) {
            stats.blocked = true;
            this.ipMap.set(ip, stats);
        }
    }
    unblockIP(ip) {
        this.blockedIPs.delete(ip);
        const stats = this.ipMap.get(ip);
        if (stats) {
            stats.blocked = false;
            this.ipMap.set(ip, stats);
        }
    }
    isBlocked(ip) {
        return this.blockedIPs.has(ip);
    }
    getIPStats() {
        return Object.fromEntries(this.ipMap);
    }
    async checkRateLimit(ip) {
        try {
            await this.rateLimiter.consume(ip);
            return true;
        }
        catch (error) {
            return false;
        }
    }
}
export const ipController = IPController.getInstance();
export const ipMiddleware = async (req, res, next) => {
    try {
        const ip = req.ip || req.socket.remoteAddress || 'unknown';
        // Check if IP is blocked
        if (ipController.isBlocked(ip)) {
            res.status(403).json({ error: 'Access denied' });
            return;
        }
        // Check rate limit
        const isAllowed = await ipController.checkRateLimit(ip);
        if (!isAllowed) {
            res.status(429).json({ error: 'Too many requests' });
            return;
        }
        // Track IP
        ipController.trackIP(ip);
        next();
    }
    catch (error) {
        next(error); // Pass errors to Express error handler
    }
};
