import { AppError } from './errors';
import { User, UserRole, VolunteerPermission } from '../types';

export async function getUserDepartmentId(db: D1Database, userId: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT department_id FROM department_members WHERE user_id = ? LIMIT 1')
    .bind(userId)
    .first<{ department_id: string }>();
  return row?.department_id || null;
}

export async function requireUserDepartment(db: D1Database, userId: string): Promise<string> {
  const deptId = await getUserDepartmentId(db, userId);
  if (!deptId) {
    throw new AppError('You are not associated with any department', 'FORBIDDEN', 403);
  }
  return deptId;
}

export async function loadEvent(db: D1Database, eventId: string) {
  const event = await db.prepare('SELECT * FROM events WHERE id = ?').bind(eventId).first<any>();
  if (!event) {
    throw new AppError('Event not found', 'NOT_FOUND', 404);
  }
  return event;
}

export async function getEventMembership(
  db: D1Database,
  eventId: string,
  userId: string
): Promise<{ role: string } | null> {
  const row = await db
    .prepare('SELECT role FROM event_members WHERE event_id = ? AND user_id = ?')
    .bind(eventId, userId)
    .first<{ role: string }>();
  return row || null;
}

export async function getVolunteerPermissions(
  db: D1Database,
  eventId: string,
  userId: string
): Promise<VolunteerPermission[]> {
  const rows = await db
    .prepare('SELECT permission FROM volunteer_event_permissions WHERE event_id = ? AND user_id = ?')
    .bind(eventId, userId)
    .all<{ permission: VolunteerPermission }>();
  return (rows.results || []).map((r) => r.permission);
}

export type EventAction =
  | 'manage_event'
  | 'manage_participants'
  | 'import_participants'
  | 'manage_schedule'
  | 'manage_speakers'
  | 'manage_announcements'
  | 'manage_certificates'
  | 'manage_emails'
  | 'manage_volunteers'
  | 'scan_attendance'
  | 'scan_resource'
  | 'view_ops_dashboard';

export async function authorizeEventAction(
  db: D1Database,
  user: User | null | undefined,
  eventId: string,
  action: EventAction
): Promise<{ event: any; departmentId: string | null }> {
  if (!user) {
    throw new AppError('Unauthorized: Authentication required', 'UNAUTHORIZED', 401);
  }

  const event = await loadEvent(db, eventId);
  const departmentId = event.department_id || null;

  if (user.role === 'super_admin') {
    return { event, departmentId };
  }

  if (user.role === 'department_head') {
    const userDept = await getUserDepartmentId(db, user.id);
    if (!userDept || userDept !== departmentId) {
      throw new AppError('Forbidden: You cannot access another department', 'FORBIDDEN', 403);
    }
    return { event, departmentId };
  }

  if (user.role === 'coordinator') {
    const userDept = await getUserDepartmentId(db, user.id);
    if (!userDept || userDept !== departmentId) {
      throw new AppError('Forbidden: You cannot access another department', 'FORBIDDEN', 403);
    }
    const membership = await getEventMembership(db, eventId, user.id);
    if (membership?.role !== 'coordinator') {
      throw new AppError('Forbidden: You are not assigned to this event', 'FORBIDDEN', 403);
    }
    return { event, departmentId };
  }

  if (user.role === 'volunteer') {
    const membership = await getEventMembership(db, eventId, user.id);
    if (!membership || membership.role !== 'volunteer') {
      throw new AppError('Forbidden: You are not assigned to this event', 'FORBIDDEN', 403);
    }
    const perms = await getVolunteerPermissions(db, eventId, user.id);
    if (action === 'scan_attendance' && perms.includes('SCAN_ATTENDANCE')) {
      return { event, departmentId };
    }
    if (action === 'scan_resource' && perms.includes('SCAN_RESOURCE')) {
      return { event, departmentId };
    }
    if (action === 'view_ops_dashboard') {
      return { event, departmentId };
    }
    throw new AppError('Forbidden: Volunteers cannot perform this action', 'FORBIDDEN', 403);
  }

  throw new AppError('Forbidden', 'FORBIDDEN', 403);
}

export async function authorizeCreateEvent(db: D1Database, user: User | null | undefined): Promise<string | null> {
  if (!user) {
    throw new AppError('Unauthorized: Authentication required', 'UNAUTHORIZED', 401);
  }
  if (user.role === 'volunteer') {
    throw new AppError('Forbidden: Volunteers cannot create events', 'FORBIDDEN', 403);
  }
  if (user.role === 'super_admin') {
    return null;
  }
  if (user.role === 'department_head' || user.role === 'coordinator') {
    return await requireUserDepartment(db, user.id);
  }
  throw new AppError('Forbidden: You do not have permission to create events', 'FORBIDDEN', 403);
}

export async function checkEventAuthority(
  db: D1Database,
  userId: string | undefined,
  role: string | undefined,
  eventId: string | undefined
): Promise<boolean> {
  if (!userId || !role || !eventId) return false;
  try {
    await authorizeEventAction(db, { id: userId, role: role as UserRole } as User, eventId, 'manage_event');
    return true;
  } catch {
    return false;
  }
}

export function requireRoles(user: User | null | undefined, roles: UserRole[]) {
  if (!user) {
    throw new AppError('Unauthorized: Authentication required', 'UNAUTHORIZED', 401);
  }
  if (!roles.includes(user.role)) {
    throw new AppError('Forbidden: You do not have permission to access this resource', 'FORBIDDEN', 403);
  }
}

