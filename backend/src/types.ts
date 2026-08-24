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
  /** 1 once the user has chosen their own password (never the provisioned default). */
  password_set?: boolean;
  /**
   * True while the account still uses its provisioned email-as-password and
   * must change it before reaching any authenticated route. Server-side truth;
   * never trust a client-supplied value.
   */
  force_password_change?: boolean;
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
