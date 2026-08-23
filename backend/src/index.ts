import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Env, HonoTypes, User, Session } from './types';
import { authenticate } from './utils/auth';
import { handleAppError } from './utils/errors';
import authRouter from './routes/auth';
import adminRouter from './routes/admin';
import departmentsRouter from './routes/departments';
import eventsRouter from './routes/events';
import registrationsRouter from './routes/registrations';
import speakersRouter from './routes/speakers';
import scheduleRouter from './routes/schedule';
import announcementsRouter from './routes/announcements';
import operationsRouter from './routes/operations';
import certificatesRouter from './routes/certificates';
import emailsRouter from './routes/emails';

const app = new Hono<HonoTypes>();

// 1. Generate Request ID and Log Request Details
app.use('*', async (c, next) => {
  const requestId = crypto.randomUUID();
  c.set('requestId', requestId);
  c.header('X-Request-ID', requestId);

  const start = Date.now();
  await next();
  const duration = Date.now() - start;

  console.log(
    `[Request] ID: ${requestId} | Method: ${c.req.method} | Path: ${c.req.path} | Status: ${c.res.status} | Duration: ${duration}ms`
  );
});

// 2. Configure Dynamic CORS to allow credentials and preview domains
app.use(
  '*',
  cors({
    origin: (origin) => {
      // Allow local development ports, and e2b agent workspace preview environments
      if (
        !origin ||
        origin.startsWith('http://localhost:') ||
        origin.startsWith('http://127.0.0.1:') ||
        origin.endsWith('.e2b.app') ||
        origin.endsWith('.pages.dev')
      ) {
        return origin;
      }
      return null;
    },
    allowHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['Content-Length', 'X-Request-ID'],
    credentials: true,
    maxAge: 86400
  })
);

// 3. Security Headers Middleware
app.use('*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('X-XSS-Protection', '1; mode=block');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header(
    'Content-Security-Policy',
    "default-src 'none'; script-src 'self'; connect-src 'self' https://api.resend.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none';"
  );
  await next();
});

// 4. Session Authentication Middleware (loads and binds c.get('user') and c.get('session'))
app.use('*', authenticate);

// 5. Mount API Routers under /api/v1
const apiV1 = new Hono<HonoTypes>();

apiV1.route('/auth', authRouter);
apiV1.route('/admin', adminRouter);
apiV1.route('/departments', departmentsRouter);
apiV1.route('/events', eventsRouter);
apiV1.route('/registrations', registrationsRouter);
apiV1.route('/speakers', speakersRouter);
apiV1.route('/schedule', scheduleRouter);
apiV1.route('/announcements', announcementsRouter);
apiV1.route('/operations', operationsRouter);
apiV1.route('/certificates', certificatesRouter);
apiV1.route('/emails', emailsRouter);

app.route('/api/v1', apiV1);

// 6. Global Error Handling
app.onError(handleAppError);

export default app;
export type { Env };
export type { HonoTypes };
export type { User };
export type { Session };
