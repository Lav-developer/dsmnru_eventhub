export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  ENV: string;
  RESEND_API_KEY?: string;
}

export type UserRole = 'super_admin' | 'department_head' | 'coordinator' | 'volunteer';

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  status: 'pending' | 'active' | 'suspended';
  phone?: string;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: string;
  user_id: string;
  token: string;
  expires_at: string;
  created_at: string;
}

export interface HonoTypes {
  Bindings: Env;
  Variables: {
    user: User | null;
    session: Session | null;
    requestId: string;
  };
}
