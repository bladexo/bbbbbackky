import { Request, Response, NextFunction } from 'express';

interface CloudflareResponse {
  success: boolean;
  challenge_ts: string;
  hostname: string;
  'error-codes': string[];
}

export const validateTurnstileToken = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.body.cfToken;
  
  if (!token) {
    return res.status(400).json({ error: 'Missing Turnstile token' });
  }

  try {
    const formData = new URLSearchParams();
    formData.append('secret', process.env.CLOUDFLARE_SECRET_KEY || '');
    formData.append('response', token);
    formData.append('remoteip', req.ip || '127.0.0.1');

    const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: formData,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const data: CloudflareResponse = await result.json();

    if (!data.success) {
      console.error('Turnstile validation failed:', data['error-codes']);
      return res.status(403).json({ error: 'Bot validation failed' });
    }

    next();
  } catch (error) {
    console.error('Error validating Turnstile token:', error);
    res.status(500).json({ error: 'Failed to validate bot protection' });
  }
}; 