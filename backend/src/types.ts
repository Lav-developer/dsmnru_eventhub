export interface Env {
  DB: D1Database;
  ENV: string;
  RESEND_API_KEY?: string;
  FRONTEND_URL?: string;
}

export type UserRole = 'super_admin' | 'department_head' | 'coordinator' | 'volunteer';
export type UserStatus = 'pending' | 'invited' | 'active' | 'suspended';
export type VolunteerPermission = 'SCAN_ATTENDANCE' | 'SCAN_RESOURCE';

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  status: UserStatus;
  phone?: string;
  created_at: string;
  updated_at: string;
  department_id?: string | null;
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
