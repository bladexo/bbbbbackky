import { Request, Response, NextFunction } from 'express';
import { RateLimiterMemory } from 'rate-limiter-flexible';

interface IPStats {
  requests: number;
  lastRequest: Date;
  blocked: boolean;
}

class IPController {
  private static instance: IPController;
  private ipMap: Map<string, IPStats>;
  private blockedIPs: Set<string>;
  private rateLimiter: RateLimiterMemory;

  private constructor() {
    this.ipMap = new Map();
    this.blockedIPs = new Set();
    this.rateLimiter = new RateLimiterMemory({
      points: 100, // Number of requests
      duration: 60, // Per minute
    });
  }

  public static getInstance(): IPController {
    if (!IPController.instance) {
      IPController.instance = new IPController();
    }
    return IPController.instance;
  }

  public trackIP(ip: string): void {
    const stats = this.ipMap.get(ip) || { requests: 0, lastRequest: new Date(), blocked: false };
    stats.requests++;
    stats.lastRequest = new Date();
    this.ipMap.set(ip, stats);
  }

  public blockIP(ip: string): void {
    this.blockedIPs.add(ip);
    const stats = this.ipMap.get(ip);
    if (stats) {
      stats.blocked = true;
      this.ipMap.set(ip, stats);
    }
  }

  public unblockIP(ip: string): void {
    this.blockedIPs.delete(ip);
    const stats = this.ipMap.get(ip);
    if (stats) {
      stats.blocked = false;
      this.ipMap.set(ip, stats);
    }
  }

  public isBlocked(ip: string): boolean {
    return this.blockedIPs.has(ip);
  }

  public getIPStats(): { [key: string]: IPStats } {
    return Object.fromEntries(this.ipMap);
  }

  public async checkRateLimit(ip: string): Promise<boolean> {
    try {
      await this.rateLimiter.consume(ip);
      return true;
    } catch (error) {
      return false;
    }
  }
}

export const ipController = IPController.getInstance();

export const ipMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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
  } catch (error) {
    next(error); // Pass errors to Express error handler
  }
}; 