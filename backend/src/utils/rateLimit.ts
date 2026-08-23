import { Context, Next } from 'hono';
import { AppError } from './errors';
import { HonoTypes } from '../types';

interface RateLimitConfig {
  windowMs: number;
  max: number;
  useDb?: boolean;
}

// In-memory store for rate limiting per Worker isolate (lightweight pre-shield)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

export function rateLimit(category: string, config: RateLimitConfig) {
  return async (c: Context<HonoTypes>, next: Next) => {
    const now = Date.now();

    // Inline memory cleanup (safeguards isolate memory from swelling without global timers)
    for (const [k, r] of rateLimitStore.entries()) {
      if (now > r.resetTime) {
        rateLimitStore.delete(k);
      }
    }

    // Determine client identifier (IP address, or user ID if authenticated)
    const ip = c.req.header('CF-Connecting-IP') || '127.0.0.1';
    const user = c.get('user');
    const identifier = user ? `user:${user.id}` : `ip:${ip}`;
    const key = `${category}:${identifier}`;

    let count = 0;
    let resetTime = 0;

    if (config.useDb && c.env.DB) {
      const db = c.env.DB;
      try {
        // Probabilistic background cleanup (5% chance) to avoid database write amplification on every request
        if (Math.random() < 0.05 && c.executionCtx) {
          c.executionCtx.waitUntil(
            db.prepare('DELETE FROM rate_limit_records WHERE reset_time < ?').bind(now).run()
              .catch((err) => console.error('Rate limit cleanup failed:', err))
          );
        }

        // Check/Update database count
        const record = await db
          .prepare('SELECT count, reset_time FROM rate_limit_records WHERE key = ?')
          .bind(key)
          .first<{ count: number; reset_time: number }>();

        if (!record) {
          resetTime = now + config.windowMs;
          count = 1;
          await db
            .prepare('INSERT INTO rate_limit_records (key, count, reset_time) VALUES (?, 1, ?)')
            .bind(key, resetTime)
            .run();
        } else {
          resetTime = record.reset_time;
          count = record.count + 1;
          await db
            .prepare('UPDATE rate_limit_records SET count = count + 1 WHERE key = ?')
            .bind(key)
            .run();
        }
      } catch (err) {
        console.error('Database rate limiter error (falling back to memory):', err);
        // Fallback to in-memory if DB transaction fails
        const memRecord = rateLimitStore.get(key);
        if (!memRecord || now > memRecord.resetTime) {
          resetTime = now + config.windowMs;
          count = 1;
          rateLimitStore.set(key, { count: 1, resetTime });
        } else {
          resetTime = memRecord.resetTime;
          memRecord.count += 1;
          count = memRecord.count;
        }
      }
    } else {
      // Memory-only rate limiter (fast path)
      const record = rateLimitStore.get(key);
      if (!record || now > record.resetTime) {
        resetTime = now + config.windowMs;
        count = 1;
        rateLimitStore.set(key, { count: 1, resetTime });
      } else {
        resetTime = record.resetTime;
        record.count += 1;
        count = record.count;
      }
    }

    c.header('X-RateLimit-Limit', config.max.toString());
    c.header('X-RateLimit-Remaining', Math.max(0, config.max - count).toString());
    c.header('X-RateLimit-Reset', Math.ceil(resetTime / 1000).toString());

    if (count > config.max) {
      const retryAfter = Math.ceil((resetTime - now) / 1000);
      c.header('Retry-After', retryAfter.toString());
      throw new AppError(
        `Too many requests. Please try again in ${retryAfter} seconds.`,
        'RATE_LIMITED',
        429
      );
    }

    await next();
  };
}

// Pre-defined rate-limiting configurations
export const limits = {
  auth: { windowMs: 15 * 60 * 1000, max: 20, useDb: true }, // 20 requests per 15 mins (login/register) - DB backed
  registration: { windowMs: 1 * 60 * 1000, max: 15, useDb: true }, // 15 registrations per minute per IP - DB backed
  verification: { windowMs: 1 * 60 * 1000, max: 30 }, // 30 certificate verifications per minute - memory only
  csv: { windowMs: 5 * 60 * 1000, max: 10, useDb: true }, // 10 imports/exports per 5 mins - DB backed
  email: { windowMs: 10 * 60 * 1000, max: 5, useDb: true }, // 5 campaigns per 10 mins - DB backed
  scan: { windowMs: 1 * 60 * 1000, max: 120 }, // 120 scans per minute (high throughout allowed, memory only)
  general: { windowMs: 1 * 60 * 1000, max: 150 } // 150 general requests per minute
};
