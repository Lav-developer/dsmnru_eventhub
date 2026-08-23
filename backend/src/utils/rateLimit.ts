import { Context, Next } from 'hono';
import { AppError } from './errors';
import { HonoTypes } from '../types';

interface RateLimitConfig {
  windowMs: number;
  max: number;
}

// In-memory store for rate limiting per Worker isolate
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

// Cleanup routine to prevent memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if (now > record.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 60000); // Clean up every minute

export function rateLimit(category: string, config: RateLimitConfig) {
  return async (c: Context<HonoTypes>, next: Next) => {
    // Determine client identifier (IP address, or user ID if authenticated)
    const ip = c.req.header('CF-Connecting-IP') || '127.0.0.1';
    const user = c.get('user');
    const identifier = user ? `user:${user.id}` : `ip:${ip}`;
    const key = `${category}:${identifier}`;

    const now = Date.now();
    const record = rateLimitStore.get(key);

    if (!record || now > record.resetTime) {
      // Create new record
      rateLimitStore.set(key, {
        count: 1,
        resetTime: now + config.windowMs
      });
      c.header('X-RateLimit-Limit', config.max.toString());
      c.header('X-RateLimit-Remaining', (config.max - 1).toString());
      c.header('X-RateLimit-Reset', Math.ceil((now + config.windowMs) / 1000).toString());
      return await next();
    }

    if (record.count >= config.max) {
      throw new AppError(
        `Too many requests. Please try again in ${Math.ceil(
          (record.resetTime - now) / 1000
        )} seconds.`,
        'RATE_LIMITED',
        429
      );
    }

    record.count += 1;
    c.header('X-RateLimit-Limit', config.max.toString());
    c.header('X-RateLimit-Remaining', (config.max - record.count).toString());
    c.header('X-RateLimit-Reset', Math.ceil(record.resetTime / 1000).toString());

    await next();
  };
}

// Pre-defined rate-limiting configurations
export const limits = {
  auth: { windowMs: 15 * 60 * 1000, max: 20 }, // 20 requests per 15 mins (login/register)
  registration: { windowMs: 1 * 60 * 1000, max: 30 }, // 30 registrations per minute per IP
  verification: { windowMs: 1 * 60 * 1000, max: 60 }, // 60 certificate verifications per minute
  csv: { windowMs: 5 * 60 * 1000, max: 15 }, // 15 imports/exports per 5 mins
  email: { windowMs: 10 * 60 * 1000, max: 10 }, // 10 campaigns per 10 mins
  scan: { windowMs: 1 * 60 * 1000, max: 120 }, // 120 scans per minute (high throughout allowed)
  general: { windowMs: 1 * 60 * 1000, max: 150 } // 150 general requests per minute
};
