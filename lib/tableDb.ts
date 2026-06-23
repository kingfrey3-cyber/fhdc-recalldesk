import bcrypt from 'bcryptjs';
import { supabaseAdmin } from './supabaseAdmin';
import { chunkArray } from './chunk';
import { defaultAssumptions, newId, nowIso, publicUser, type AppRole, type AppUser } from './localDb';
import { recallPriority } from './recallLogic';

function db() {
  if (!supabaseAdmin) throw new Error('Supabase is not configured. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  return supabaseAdmin;
}

export function useTableStorage() {
  return process.env.STORAGE_DRIVER === 'supabase_tables';
}

function cleanEmail(email: any) { return String(email || '').trim().toLowerCase(); }
function asArray(value: any): any[] { return Array.isArray(value) ? value : []; }
function cleanString(value: any) { return String(value ?? '').trim(); }
function num(value: any, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function uniqueSorted(values: any[]) { return Array.from(new Set(values.filter(v => v !== null && v !== undefined && String(v).trim() !== '').map(v => String(v).trim()))).sort(); }
function jsonArray(value: any) { return Array.isArray(value) ? value : []; }
function inDateWindow(value: string | null | undefined, startDate: string, endDate: string) {
  if (!value) return false;
  const d = String(value).slice(0, 10);
  return d >= startDate && d <= endDate;
}
function laterOrEqual(a: any, b: any) {
  const left = String(a || ''); const right = String(b || '');
  if (!left) return false; if (!right) return true; return left >= right;
}

async function selectAll<T = any>(table: string, columns = '*', order?: { column: string; ascending?: boolean }): Promise<T[]> {
  const rows: T[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let q = db().from(table).select(columns).range(from, from + pageSize - 1);
    if (order) q = q.order(order.column, { ascending: order.ascending ?? true }) as any;
    const { data, error } = await q;
    if (error) throw new Error(`${table} read failed: ${error.message}`);
    rows.push(...((data || []) as T[]));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function countRows(table: string, filter?: (q: any) => any) {
  let q = db().from(table).select('*', { count: 'exact', head: true });
  if (filter) q = filter(q);
  const { count, error } = await q;
  if (error) throw new Error(`${table} count failed: ${error.message}`);
  return count || 0;
}

async function upsertChunks(table: string, rows: any[], size = 500) {
  for (const chunk of chunkArray(rows, size)) {
    const { error } = await db().from(table).upsert(chunk);
    if (error) throw new Error(`${table} save failed: ${error.message}`);
  }
}

async function insertChunks(table: string, rows: any[], size = 500) {
  for (const chunk of chunkArray(rows, size)) {
    const { error } = await db().from(table).insert(chunk);
    if (error) throw new Error(`${table} insert failed: ${error.message}`);
  }
}

export async function ensureDefaultAssumptions() {
  const existing = await selectAll<any>('payment_assumptions', 'key,value');
  const existingKeys = new Set(existing.map(r => r.key));
  const missing = defaultAssumptions.filter(a => !existingKeys.has(a.key)).map(a => ({ ...a, id: newId('assumption_'), updated_at: nowIso() }));
  if (missing.length) await insertChunks('payment_assumptions', missing);
}

export async function getUserByEmail(email: string): Promise<AppUser | null> {
  const { data, error } = await db().from('app_users').select('*').eq('email', cleanEmail(email)).maybeSingle();
  if (error) throw new Error(`User lookup failed: ${error.message}`);
  return data as any;
}

export async function getUserById(id: string): Promise<AppUser | null> {
  const { data, error } = await db().from('app_users').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`User lookup failed: ${error.message}`);
  return data as any;
}

export async function listUsers(session?: { id: string; role: AppRole }) {
  let rows = await selectAll<AppUser>('app_users', '*', { column: 'name', ascending: true });
  if (session?.role === 'recall_staff') rows = rows.filter(u => u.id === session.id);
  return rows.map(publicUser);
}

export async function createUser(input: { name: string; email: string; role: AppRole; password: string; is_active?: boolean }) {
  const email = cleanEmail(input.email);
  if (!String(input.name || '').trim()) throw new Error('Name is required');
  if (!email) throw new Error('Email is required');
  if (!String(input.password || '').trim() || String(input.password || '').trim().length < 8) throw new Error('Temporary password must be at least 8 characters');
  const existing = await getUserByEmail(email);
  if (existing) throw new Error('A user with this email already exists');
  const row: AppUser = {
    id: newId('user_'),
    name: String(input.name || '').trim(),
    email,
    role: input.role,
    is_active: input.is_active ?? true,
    password_hash: await bcrypt.hash(input.password, 12),
    created_at: nowIso()
  };
  const { data, error } = await db().from('app_users').insert(row).select('*').single();
  if (error) throw new Error(`Create user failed: ${error.message}`);
  return publicUser(data as AppUser);
}

const validRoles: AppRole[] = ['admin', 'manager', 'recall_staff', 'verifier', 'finance', 'viewer'];
export async function updateUser(session: { id: string }, id: string, body: any) {
  const target = await getUserById(id);
  if (!target) throw new Error('User not found');
  const isSelf = target.id === session.id;
  const nextName = typeof body.name === 'string' ? body.name.trim() : target.name;
  const nextEmail = typeof body.email === 'string' ? cleanEmail(body.email) : target.email;
  const nextRole = typeof body.role === 'string' ? body.role : target.role;
  const nextActive = typeof body.is_active === 'boolean' ? body.is_active : target.is_active;
  const nextPassword = typeof body.password === 'string' ? body.password : '';
  if (!nextName) throw new Error('Name is required');
  if (!nextEmail) throw new Error('Email is required');
  if (!validRoles.includes(nextRole as AppRole)) throw new Error('Invalid role selected');
  if (isSelf && nextRole !== target.role) throw new Error('You cannot change your own role while signed in');
  if (isSelf && nextActive === false) throw new Error('You cannot deactivate your own account while signed in');
  const duplicate = await getUserByEmail(nextEmail);
  if (duplicate && duplicate.id !== target.id) throw new Error('Another user already has that email address');
  if (target.role === 'admin' && (!(nextRole === 'admin' && nextActive))) {
    const activeAdminCount = await countRows('app_users', q => q.eq('role', 'admin').eq('is_active', true).neq('id', target.id));
    if (activeAdminCount < 1) throw new Error('At least one active admin account must remain');
  }
  const patch: any = { name: nextName, email: nextEmail, role: nextRole, is_active: nextActive, updated_at: nowIso() };
  if (nextPassword.trim()) {
    if (nextPassword.trim().length < 8) throw new Error('New password must be at least 8 characters');
    patch.password_hash = await bcrypt.hash(nextPassword.trim(), 12);
    patch.password_reset_at = nowIso();
  }
  const { data, error } = await db().from('app_users').update(patch).eq('id', id).select('*').single();
  if (error) throw new Error(`Update user failed: ${error.message}`);
  return publicUser(data as AppUser);
}

export async function deleteUser(session: { id: string }, id: string) {
  const target = await getUserById(id);
  if (!target) throw new Error('User not found');
  if (target.id === session.id) throw new Error('You cannot delete your own account while signed in');
  if (target.role === 'admin' && target.is_active) {
    const remainingAdmins = await countRows('app_users', q => q.eq('role', 'admin').eq('is_active', true).neq('id', target.id));
    if (remainingAdmins < 1) throw new Error('At least one active admin account must remain');
  }
  const { count: unassignedPatients, error: updErr } = await db()
    .from('clean_patients')
    .update({ assigned_to: null, assignment_status: 'unassigned', updated_at: nowIso() }, { count: 'exact' })
    .eq('assigned_to', id)
    .eq('assignment_status', 'assigned');
  if (updErr) throw new Error(`Patient release failed: ${updErr.message}`);
  const callCount = await countRows('call_attempts', q => q.eq('staff_id', id));
  const bookingCount = await countRows('bookings', q => q.eq('staff_id', id));
  const { error } = await db().from('app_users').delete().eq('id', id);
  if (error) throw new Error(`Delete user failed: ${error.message}`);
  return { deletedUser: publicUser(target), unassignedPatients: unassignedPatients || 0, preservedCallLogs: callCount, preservedBookings: bookingCount };
}

export async function writeAudit(actorId: string, action: string, entityType: string, entityId: string, details: any = {}) {
  const { error } = await db().from('audit_logs').insert({ id: newId('audit_'), actor_id: actorId, action, entity_type: entityType, entity_id: entityId, details, created_at: nowIso() });
  if (error) console.warn('Audit write failed:', error.message);
}

export async function getDashboard(session: { id: string; role: AppRole }) {
  const staffScope = session.role === 'recall_staff' ? session.id : null;
  const patientFilter = (q: any) => staffScope ? q.eq('assigned_to', staffScope) : q;
  const patients = await countRows('clean_patients', patientFilter);
  const assigned = staffScope ? await countRows('clean_patients', q => q.eq('assigned_to', staffScope)) : await countRows('clean_patients', q => q.not('assigned_to', 'is', null));
  const unassigned = staffScope ? 0 : await countRows('clean_patients', q => q.eq('assignment_status', 'unassigned'));
  const calls = await selectAll<any>('call_attempts', 'patient_id,staff_id');
  const scopedCalls = staffScope ? calls.filter(c => c.staff_id === staffScope) : calls;
  const uniqueCalled = new Set(scopedCalls.map(c => c.patient_id)).size;
  const bookings = staffScope ? await selectAll<any>('bookings', '*').then(rows => rows.filter(b => b.staff_id === staffScope)) : await selectAll<any>('bookings', '*');
  const selfReportedBookings = bookings.filter(b => b.booking_status === 'self_reported').length;
  const verifiedBookings = bookings.filter(b => b.booking_status === 'verified').length;
  const attended = bookings.filter(b => b.attendance_status === 'attended').length;
  const openFlags = staffScope ? await countRows('data_quality_flags', q => q.eq('status', 'open').or(`staff_id.eq.${staffScope},patient_id.not.is.null`)) : await countRows('data_quality_flags', q => q.eq('status', 'open'));
  const { data: recentUploads, error: upErr } = staffScope ? { data: [], error: null as any } : await db().from('upload_batches').select('*').order('created_at', { ascending: false }).limit(5);
  if (upErr) throw new Error(`Upload summary failed: ${upErr.message}`);
  const { data: flags, error: flagErr } = await db().from('data_quality_flags').select('*').eq('status', 'open').order('created_at', { ascending: false }).limit(50);
  if (flagErr) throw new Error(`Flag summary failed: ${flagErr.message}`);
  return { metrics: { patients, assigned, unassigned, uniqueCalled, selfReportedBookings, verifiedBookings, attended, openFlags }, recentUploads: recentUploads || [], flags: flags || [] };
}

export async function listPatients(params: { user: { id: string; role: AppRole }; search?: string; status?: string; staffId?: string; mine?: boolean; limit?: number }) {
  const { user } = params;
  const limit = Math.min(Number(params.limit || 250), 1000);
  const search = cleanString(params.search).toLowerCase();
  const staffScope = user.role === 'recall_staff' ? user.id : (params.staffId || (params.mine ? user.id : ''));

  let q = db().from('clean_patients').select('*').order('last_visit_date', { ascending: true, nullsFirst: false }).order('display_name', { ascending: true }).limit(limit);

  if (params.status === 'logged') {
    // Logged view must be based on the call_attempts table, not only assignment_status.
    // This prevents called patients from being "lost" if status recalculation/caching lags.
    let callQ = db().from('call_attempts').select('patient_id,attempt_at,staff_id').order('attempt_at', { ascending: false }).limit(5000);
    if (staffScope) callQ = callQ.eq('staff_id', staffScope);
    const { data: callRows, error: callErr } = await callQ;
    if (callErr) throw new Error(`Logged patient selection failed: ${callErr.message}`);
    const loggedIds = Array.from(new Set((callRows || []).map((c: any) => c.patient_id).filter(Boolean)));
    if (!loggedIds.length) return [];

    let patients: any[] = [];
    for (const chunk of chunkArray(loggedIds, 500)) {
      let patientQ = db().from('clean_patients').select('*').in('id', chunk);
      if (search) patientQ = patientQ.or(`display_name.ilike.%${search}%,standard_phone.ilike.%${search}%,original_phones_text.ilike.%${search}%`);
      const { data, error } = await patientQ;
      if (error) throw new Error(`Logged patients load failed: ${error.message}`);
      patients.push(...(data || []));
    }
    patients = patients.sort((a: any, b: any) => String(a.last_visit_date || '9999-12-31').localeCompare(String(b.last_visit_date || '9999-12-31')) || String(a.display_name || '').localeCompare(String(b.display_name || ''))).slice(0, limit);
    return attachPatientContext(patients);
  }

  if (user.role === 'recall_staff') q = q.eq('assigned_to', user.id);
  else {
    if (params.mine) q = q.eq('assigned_to', user.id);
    if (params.staffId) q = q.eq('assigned_to', params.staffId);
  }
  if (params.status === 'active_queue') {
    if (user.role === 'recall_staff') q = q.eq('assignment_status', 'assigned');
    else q = q.in('assignment_status', ['unassigned', 'assigned']);
    q = q.eq('do_not_call', false);
  } else if (params.status) q = q.eq('assignment_status', params.status);
  if (search) q = q.or(`display_name.ilike.%${search}%,standard_phone.ilike.%${search}%,original_phones_text.ilike.%${search}%`);
  const { data, error } = await q;
  if (error) throw new Error(`Patients load failed: ${error.message}`);
  return attachPatientContext(data || []);
}

async function attachPatientContext(patients: any[]) {
  const staffIds = Array.from(new Set(patients.map((p: any) => p.assigned_to).filter(Boolean)));
  const usersById = new Map<string, any>();
  for (const chunk of chunkArray(staffIds, 500)) {
    const { data: users, error: userErr } = await db().from('app_users').select('id,name,email,role,is_active,created_at').in('id', chunk);
    if (userErr) throw new Error(`Assigned user load failed: ${userErr.message}`);
    for (const u of users || []) usersById.set(u.id, u);
  }
  const ids = patients.map((p: any) => p.id);
  const callCountByPatient = new Map<string, number>();
  const latestCallByPatient = new Map<string, any>();
  const callerIds = new Set<string>();
  for (const chunk of chunkArray(ids, 500)) {
    const { data: calls, error: callErr } = await db().from('call_attempts').select('*').in('patient_id', chunk).order('attempt_at', { ascending: false });
    if (callErr) throw new Error(`Call count load failed: ${callErr.message}`);
    for (const c of calls || []) {
      callCountByPatient.set(c.patient_id, (callCountByPatient.get(c.patient_id) || 0) + 1);
      if (!latestCallByPatient.has(c.patient_id)) latestCallByPatient.set(c.patient_id, c);
      if (c.staff_id) callerIds.add(c.staff_id);
    }
  }
  const callersById = new Map<string, any>();
  for (const chunk of chunkArray(Array.from(callerIds), 500)) {
    const { data: callers, error: callerErr } = await db().from('app_users').select('id,name,email,role,is_active').in('id', chunk);
    if (callerErr) throw new Error(`Caller load failed: ${callerErr.message}`);
    for (const u of callers || []) callersById.set(u.id, u);
  }
  return patients.map((p: any) => {
    const latestCall = latestCallByPatient.get(p.id) || null;
    return {
      ...p,
      original_phones: jsonArray(p.original_phones),
      all_names: jsonArray(p.all_names),
      years_visited: jsonArray(p.years_visited),
      patient_name_keys: jsonArray(p.patient_name_keys),
      assigned_user: p.assigned_to ? usersById.get(p.assigned_to) || null : null,
      call_count: callCountByPatient.get(p.id) || 0,
      latest_call: latestCall ? { ...latestCall, staff: latestCall.staff_id ? callersById.get(latestCall.staff_id) || null : null } : null
    };
  });
}

export async function requeuePatient(user: any, patientId: string) {
  if (!['admin', 'manager'].includes(user.role)) throw new Error('FORBIDDEN');
  if (!patientId) throw new Error('Select a patient to requeue.');
  const patient = await getPatient(patientId);
  if (!patient) throw new Error('Patient not found');
  const { data: calls, error: callErr } = await db().from('call_attempts').select('id').eq('patient_id', patientId).limit(1);
  if (callErr) throw new Error(`Call check failed: ${callErr.message}`);
  if ((calls || []).length) throw new Error('This patient still has call history. Use Unlog on the specific call first.');
  const nextStatus = patient.assigned_to ? 'assigned' : 'unassigned';
  const { data, error } = await db().from('clean_patients').update({ assignment_status: nextStatus, do_not_call: false, updated_at: nowIso() }).eq('id', patientId).select('*').single();
  if (error) throw new Error(`Requeue failed: ${error.message}`);
  return data;
}

export async function assignPatients(staffId: string, patientIds: string[] = [], count = 0) {
  if (!staffId) throw new Error('Select staff member');
  const staff = await getUserById(staffId);
  if (!staff || !staff.is_active) throw new Error('Selected staff user is not active');
  let ids = patientIds.filter(Boolean);
  if (!ids.length && count > 0) {
    const { data, error } = await db().from('clean_patients').select('id').eq('assignment_status', 'unassigned').eq('do_not_call', false).order('last_visit_date', { ascending: true, nullsFirst: false }).limit(count);
    if (error) throw new Error(`Assignment selection failed: ${error.message}`);
    ids = (data || []).map((p: any) => p.id);
  }
  if (!ids.length) return 0;
  let total = 0;
  for (const chunk of chunkArray(ids, 500)) {
    const { count: n, error } = await db().from('clean_patients').update({ assigned_to: staffId, assignment_status: 'assigned', updated_at: nowIso() }, { count: 'exact' }).in('id', chunk);
    if (error) throw new Error(`Assignment failed: ${error.message}`);
    total += n || 0;
  }
  return total;
}

export async function unassignPatients(patientIds: string[] = [], staffId = '') {
  if (!patientIds.length && !staffId) throw new Error('Select a patient or staff member to unassign.');
  let targets: any[] = [];
  if (patientIds.length) {
    for (const chunk of chunkArray(patientIds, 500)) {
      const { data, error } = await db().from('clean_patients').select('id,assigned_to,assignment_status').in('id', chunk);
      if (error) throw new Error(`Unassign selection failed: ${error.message}`);
      targets.push(...(data || []));
    }
  } else {
    targets = await selectAll<any>('clean_patients', 'id,assigned_to,assignment_status').then(rows => rows.filter(p => p.assigned_to === staffId));
  }
  const ids = targets.map(p => p.id);
  const workedIds = new Set<string>();
  for (const chunk of chunkArray(ids, 500)) {
    const { data: calls } = await db().from('call_attempts').select('patient_id').in('patient_id', chunk);
    const { data: bookings } = await db().from('bookings').select('patient_id').in('patient_id', chunk);
    for (const c of calls || []) workedIds.add(c.patient_id);
    for (const b of bookings || []) workedIds.add(b.patient_id);
  }
  const toUnassign = targets.filter(p => p.assigned_to && !workedIds.has(p.id) && ['assigned', 'unassigned'].includes(p.assignment_status || 'assigned')).map(p => p.id);
  let unassigned = 0;
  for (const chunk of chunkArray(toUnassign, 500)) {
    const { count, error } = await db().from('clean_patients').update({ assigned_to: null, assignment_status: 'unassigned', updated_at: nowIso() }, { count: 'exact' }).in('id', chunk);
    if (error) throw new Error(`Unassign failed: ${error.message}`);
    unassigned += count || 0;
  }
  return { requested: targets.length, unassigned, skippedWorked: ids.filter(id => workedIds.has(id)).length, skippedAlreadyUnassigned: targets.filter(p => !p.assigned_to).length };
}

const reachedOutcomes = new Set(['Booked appointment','Interested but not booked','Call back later','Patient declined','Already visited recently']);
function isBookingOutcome(outcome: string | undefined, bookingMade?: boolean) { return outcome === 'Booked appointment' || bookingMade === true; }
async function getPatient(id: string) {
  const { data, error } = await db().from('clean_patients').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Patient lookup failed: ${error.message}`);
  return data as any;
}
function assertCanWorkPatient(user: any, patient: any) {
  if (user.role === 'recall_staff') {
    if (!patient.assigned_to) throw new Error('This patient has not been assigned to you. Ask admin to assign the patient before logging a call.');
    if (patient.assigned_to !== user.id) throw new Error('This patient is assigned to another user. You cannot view or log this patient.');
  }
}
async function recomputePatientStatus(patientId: string) {
  const { data: latest, error } = await db().from('call_attempts').select('*').eq('patient_id', patientId).order('attempt_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Patient status check failed: ${error.message}`);
  const patient = await getPatient(patientId);
  if (!patient) return;
  let patch: any = { updated_at: nowIso() };
  if (!latest) patch.assignment_status = patient.assigned_to ? 'assigned' : 'unassigned';
  else if (latest.outcome === 'Do not call') patch = { ...patch, assignment_status: 'do_not_call', do_not_call: true };
  else if (latest.booking_made) patch.assignment_status = 'booked';
  else if (latest.next_action_date || latest.next_action) patch.assignment_status = 'follow_up';
  else patch.assignment_status = 'called';
  const { error: updErr } = await db().from('clean_patients').update(patch).eq('id', patientId);
  if (updErr) throw new Error(`Patient status update failed: ${updErr.message}`);
}

export async function listCalls(user: any, opts: { patientId?: string; staffId?: string; limit?: number; startDate?: string; endDate?: string }) {
  const limit = Math.min(Number(opts.limit || 100), 2000);
  let q = db().from('call_attempts').select('*').order('attempt_at', { ascending: false }).limit(limit);
  if (opts.patientId) q = q.eq('patient_id', opts.patientId);
  if (opts.startDate) q = q.gte('attempt_at', `${String(opts.startDate).slice(0, 10)}T00:00:00`);
  if (opts.endDate) q = q.lte('attempt_at', `${String(opts.endDate).slice(0, 10)}T23:59:59`);
  if (user.role === 'recall_staff') q = q.eq('staff_id', user.id); else if (opts.staffId) q = q.eq('staff_id', opts.staffId);
  const { data: rows, error } = await q;
  if (error) throw new Error(`Call history load failed: ${error.message}`);
  const calls = rows || [];
  const staffIds = Array.from(new Set(calls.map((c: any) => c.staff_id).filter(Boolean)));
  const patientIds = Array.from(new Set(calls.map((c: any) => c.patient_id).filter(Boolean)));
  const usersById = new Map<string, any>(); const patientsById = new Map<string, any>(); const bookingsByCallId = new Map<string, any>();
  for (const chunk of chunkArray(staffIds, 500)) {
    const { data: users, error: userErr } = await db().from('app_users').select('id,name,email,role,is_active').in('id', chunk);
    if (userErr) throw new Error(`Call staff load failed: ${userErr.message}`);
    for (const u of users || []) usersById.set(u.id, u);
  }
  for (const chunk of chunkArray(patientIds, 500)) {
    const { data: patients, error: patientErr } = await db().from('clean_patients').select('*').in('id', chunk);
    if (patientErr) throw new Error(`Call patient load failed: ${patientErr.message}`);
    for (const p of patients || []) patientsById.set(p.id, p);
  }
  for (const chunk of chunkArray(calls.map((c: any) => c.id), 500)) {
    const { data: bookings, error: bookingErr } = await db().from('bookings').select('*').in('call_attempt_id', chunk);
    if (bookingErr) throw new Error(`Call booking load failed: ${bookingErr.message}`);
    for (const b of bookings || []) bookingsByCallId.set(b.call_attempt_id, b);
  }
  return calls.map((c: any) => ({ ...c, staff: usersById.get(c.staff_id) || null, patient: patientsById.get(c.patient_id) || null, booking: bookingsByCallId.get(c.id) || null }));
}

export async function getCallMonitoring(user: any, opts: { staffId?: string; startDate?: string; endDate?: string; limit?: number }) {
  const calls = await listCalls(user, { staffId: opts.staffId, startDate: opts.startDate, endDate: opts.endDate, limit: opts.limit || 2000 });
  const uniquePatients = new Set(calls.map((c: any) => c.patient_id).filter(Boolean));
  const bookings = calls.filter((c: any) => c.booking_made).length;
  const reached = calls.filter((c: any) => c.reached).length;
  const staffMap = new Map<string, any>();
  const staffDailyMap = new Map<string, any>();
  const dailyTotalMap = new Map<string, any>();
  for (const c of calls) {
    const staffId = c.staff_id || 'unknown';
    const staffName = c.staff?.name || 'Unknown staff';
    const date = String(c.attempt_at || c.created_at || '').slice(0, 10) || 'Undated';
    const total = staffMap.get(staffId) || { staff_id: staffId, staff_name: staffName, calls: 0, uniquePatients: new Set<string>(), bookings: 0, reached: 0 };
    total.calls += 1;
    if (c.patient_id) total.uniquePatients.add(c.patient_id);
    if (c.booking_made) total.bookings += 1;
    if (c.reached) total.reached += 1;
    staffMap.set(staffId, total);
    const k = `${date}|${staffId}`;
    const day = staffDailyMap.get(k) || { date, staff_id: staffId, staff_name: staffName, calls: 0, bookings: 0, reached: 0 };
    day.calls += 1;
    if (c.booking_made) day.bookings += 1;
    if (c.reached) day.reached += 1;
    staffDailyMap.set(k, day);
    const d = dailyTotalMap.get(date) || { date, calls: 0, bookings: 0, reached: 0 };
    d.calls += 1;
    if (c.booking_made) d.bookings += 1;
    if (c.reached) d.reached += 1;
    dailyTotalMap.set(date, d);
  }
  const staffTotals = Array.from(staffMap.values()).map((s: any) => ({ ...s, uniquePatients: s.uniquePatients.size })).sort((a, b) => b.calls - a.calls || a.staff_name.localeCompare(b.staff_name));
  const staffDaily = Array.from(staffDailyMap.values()).sort((a, b) => a.date.localeCompare(b.date) || a.staff_name.localeCompare(b.staff_name));
  const dailyTotals = Array.from(dailyTotalMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  return { summary: { totalCalls: calls.length, uniquePatients: uniquePatients.size, bookings, reached }, staffTotals, staffDaily, dailyTotals, recentCalls: calls.slice(0, 200) };
}

function csvEscape(value: any) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export async function exportCallsCsv(user: any, opts: { staffId?: string; startDate?: string; endDate?: string }) {
  const calls = await listCalls(user, { staffId: opts.staffId, startDate: opts.startDate, endDate: opts.endDate, limit: 10000 });
  const headers = ['Call date','Patient','Phone','Assigned to','Caller','Outcome','Reached','Booking made','Appointment date','Next action','Next action date','Patient feedback','Notes'];
  const rows = calls.map((c: any) => [
    String(c.attempt_at || c.created_at || '').slice(0, 19).replace('T', ' '),
    c.patient?.display_name || '',
    c.patient?.standard_phone || '',
    c.patient?.assigned_user?.name || c.patient?.assigned_to || '',
    c.staff?.name || '',
    c.outcome || '',
    c.reached ? 'Yes' : 'No',
    c.booking_made ? 'Yes' : 'No',
    c.appointment_date || c.booking?.appointment_date || '',
    c.next_action || '',
    c.next_action_date || '',
    c.patient_feedback || '',
    c.notes || ''
  ]);
  return [headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\n');
}

export async function createCall(user: any, body: any) {
  if (!body.patientId || !body.outcome) throw new Error('Patient and outcome are required');
  const bookingMade = isBookingOutcome(body.outcome, body.bookingMade);
  if (bookingMade && !body.appointmentDate) throw new Error('Appointment date is required when booking is made');
  const patient = await getPatient(body.patientId);
  if (!patient) throw new Error('Patient not found');
  assertCanWorkPatient(user, patient);
  const { count, error: countErr } = await db().from('call_attempts').select('*', { count: 'exact', head: true }).eq('patient_id', body.patientId);
  if (countErr) throw new Error(`Call count failed: ${countErr.message}`);
  const row: any = {
    id: newId('call_'), patient_id: body.patientId, staff_id: user.id, attempt_no: (count || 0) + 1,
    outcome: body.outcome, reached: reachedOutcomes.has(body.outcome), booking_made: bookingMade,
    appointment_date: body.appointmentDate || null, patient_feedback: body.patientFeedback || '', notes: body.notes || '',
    next_action: body.nextAction || '', next_action_date: body.nextActionDate || null, attempt_at: nowIso(), created_at: nowIso(), updated_at: nowIso()
  };
  const { data, error } = await db().from('call_attempts').insert(row).select('*').single();
  if (error) throw new Error(`Call save failed: ${error.message}`);
  if (bookingMade) {
    const booking = { id: newId('booking_'), patient_id: body.patientId, staff_id: user.id, call_attempt_id: row.id, appointment_date: body.appointmentDate, booking_status: 'self_reported', attendance_status: 'not_matured', created_at: nowIso(), updated_at: nowIso() };
    const { error: bErr } = await db().from('bookings').insert(booking);
    if (bErr) throw new Error(`Booking save failed: ${bErr.message}`);
  }
  if (body.outcome === 'Wrong number' || body.outcome === 'Number not in service') {
    await db().from('data_quality_flags').insert({ id: newId('flag_'), batch_id: null, patient_id: body.patientId, staff_id: user.id, call_attempt_id: row.id, flag_type: 'bad_phone_number', severity: 'high', status: 'open', description: `Call outcome marked as ${body.outcome}. Phone requires review before further recall.`, created_at: nowIso() });
  }
  await recomputePatientStatus(body.patientId);
  return data;
}

export async function updateCall(user: any, id: string, body: any) {
  const { data: call, error } = await db().from('call_attempts').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Call lookup failed: ${error.message}`);
  if (!call) throw new Error('Call log not found');
  const patient = await getPatient(call.patient_id);
  if (!['admin', 'manager'].includes(user.role) && !(user.role === 'recall_staff' && call.staff_id === user.id && patient?.assigned_to === user.id)) throw new Error('FORBIDDEN');
  const bookingMade = isBookingOutcome(body.outcome, body.bookingMade);
  if (bookingMade && !body.appointmentDate) throw new Error('Appointment date is required when booking is made');
  const patch = { outcome: body.outcome, reached: reachedOutcomes.has(body.outcome), booking_made: bookingMade, appointment_date: body.appointmentDate || null, patient_feedback: body.patientFeedback || '', notes: body.notes || '', next_action: body.nextAction || '', next_action_date: body.nextActionDate || null, updated_at: nowIso(), edited_by: user.id };
  const { data, error: updErr } = await db().from('call_attempts').update(patch).eq('id', id).select('*').single();
  if (updErr) throw new Error(`Call update failed: ${updErr.message}`);
  await db().from('bookings').delete().eq('call_attempt_id', id);
  if (bookingMade) await db().from('bookings').insert({ id: newId('booking_'), patient_id: call.patient_id, staff_id: call.staff_id, call_attempt_id: id, appointment_date: body.appointmentDate, booking_status: 'self_reported', attendance_status: 'not_matured', created_at: nowIso(), updated_at: nowIso() });
  await recomputePatientStatus(call.patient_id);
  return data;
}

export async function deleteCall(user: any, id: string) {
  const { data: call, error } = await db().from('call_attempts').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Call lookup failed: ${error.message}`);
  if (!call) throw new Error('Call log not found');
  const patient = await getPatient(call.patient_id);
  if (!['admin', 'manager'].includes(user.role) && !(user.role === 'recall_staff' && call.staff_id === user.id && patient?.assigned_to === user.id)) throw new Error('FORBIDDEN');
  await db().from('bookings').delete().eq('call_attempt_id', id);
  await db().from('call_attempts').delete().eq('id', id);
  await db().from('data_quality_flags').update({ status: 'closed', closed_at: nowIso(), closed_by: user.id }).eq('call_attempt_id', id).eq('status', 'open');
  await recomputePatientStatus(call.patient_id);
  return { patientId: call.patient_id };
}

export async function clearStaffCalls(session: any, staffId: string, confirmText: string) {
  if (!staffId) throw new Error('Select a staff member whose call logs should be cleared.');
  if (String(confirmText || '').trim().toUpperCase() !== 'CLEAR') throw new Error('Type CLEAR to confirm call log cleanup.');
  const staff = await getUserById(staffId);
  if (!staff) throw new Error('Staff user not found');
  const calls: any[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db().from('call_attempts').select('*').eq('staff_id', staffId).range(from, from + pageSize - 1);
    if (error) throw new Error(`Call cleanup selection failed: ${error.message}`);
    calls.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  const callIds = calls.map(c => c.id);
  const affectedPatientIds = Array.from(new Set(calls.map(c => c.patient_id).filter(Boolean)));
  let removedBookings = 0;
  for (const chunk of chunkArray(callIds, 500)) {
    const { count, error: bErr } = await db().from('bookings').delete({ count: 'exact' }).in('call_attempt_id', chunk);
    if (bErr) throw new Error(`Booking cleanup failed: ${bErr.message}`);
    removedBookings += count || 0;
    const { error: cErr } = await db().from('call_attempts').delete().in('id', chunk);
    if (cErr) throw new Error(`Call cleanup failed: ${cErr.message}`);
  }
  const { count: extraBookings } = await db().from('bookings').delete({ count: 'exact' }).eq('staff_id', staffId);
  removedBookings += extraBookings || 0;
  await db().from('data_quality_flags').update({ status: 'closed', closed_at: nowIso(), closed_by: session.id, closure_note: 'Closed during admin test/training call cleanup.' }).eq('staff_id', staffId).eq('status', 'open');
  for (const pid of affectedPatientIds) await recomputePatientStatus(pid);
  // Safety reset: after training cleanup, patients that are still assigned to this staff member and now have no calls
  // must return to the active assigned queue instead of remaining hidden as called/follow-up/booked.
  for (const chunk of chunkArray(affectedPatientIds, 500)) {
    const { data: remaining, error: remainErr } = await db().from('call_attempts').select('patient_id').in('patient_id', chunk);
    if (remainErr) throw new Error(`Post-cleanup call check failed: ${remainErr.message}`);
    const stillWorked = new Set((remaining || []).map((r: any) => r.patient_id));
    const resetIds = chunk.filter(id => !stillWorked.has(id));
    if (resetIds.length) {
      const { error: resetErr } = await db().from('clean_patients').update({ assignment_status: 'assigned', do_not_call: false, updated_at: nowIso() }).eq('assigned_to', staffId).in('id', resetIds);
      if (resetErr) throw new Error(`Post-cleanup patient reset failed: ${resetErr.message}`);
    }
  }
  return { staff: publicUser(staff), removedCalls: calls.length, removedBookings, affectedPatients: affectedPatientIds.length, closedFlags: 0 };
}

function ensurePatientShape(existing: any, phone: string, firstVisit: any) {
  const originalPhones = uniqueSorted(asArray(existing?.original_phones));
  const allNames = uniqueSorted([...(asArray(existing?.all_names)), existing?.display_name].filter(Boolean));
  const yearsVisited = uniqueSorted(asArray(existing?.years_visited)).map(y => Number(y)).filter(y => !Number.isNaN(y)).sort((a,b)=>a-b);
  const nameKeys = uniqueSorted([...(asArray(existing?.patient_name_keys)), existing?.patient_name_key].filter(Boolean));
  return { id: existing?.id || newId('patient_'), standard_phone: existing?.standard_phone || phone, display_name: existing?.display_name || 'Unknown patient', patient_name_key: existing?.patient_name_key || '', patient_name_keys: nameKeys, all_names: allNames, original_phones: originalPhones, original_phones_text: originalPhones.join(' '), first_visit_date: existing?.first_visit_date || firstVisit || null, last_visit_date: existing?.last_visit_date || firstVisit || null, visit_count: num(existing?.visit_count), years_visited: yearsVisited, last_doctor: existing?.last_doctor || '', last_company: existing?.last_company || '', duplicate_risk_level: existing?.duplicate_risk_level || 'low', duplicate_risk_notes: existing?.duplicate_risk_notes || '', recall_priority: existing?.recall_priority || recallPriority(existing?.last_visit_date || firstVisit), assignment_status: existing?.assignment_status || (existing?.assigned_to ? 'assigned' : 'unassigned'), assigned_to: existing?.assigned_to || null, do_not_call: Boolean(existing?.do_not_call), created_at: existing?.created_at || nowIso(), updated_at: nowIso() };
}
function mergeVisitIntoPatient(existing: any, visit: any) {
  const p = ensurePatientShape(existing || {}, visit.standard_phone, visit.visit_date);
  const name = cleanString(visit.patient_name); const nameKey = cleanString(visit.patient_name_key); const originalPhone = cleanString(visit.original_phone); const year = Number(visit.visit_year || 0);
  if (name) { p.all_names = uniqueSorted([...asArray(p.all_names), name]); if (!p.display_name || p.display_name === 'Unknown patient') p.display_name = name; }
  if (nameKey) { p.patient_name_keys = uniqueSorted([...asArray(p.patient_name_keys), nameKey]); if (!p.patient_name_key) p.patient_name_key = nameKey; }
  if (originalPhone) p.original_phones = uniqueSorted([...asArray(p.original_phones), originalPhone]);
  p.original_phones_text = p.original_phones.join(' ');
  if (year && !Number.isNaN(year)) p.years_visited = uniqueSorted([...asArray(p.years_visited), year]).map(y => Number(y)).sort((a,b)=>a-b);
  const visitDate = cleanString(visit.visit_date);
  if (visitDate) { if (!p.first_visit_date || visitDate < String(p.first_visit_date)) p.first_visit_date = visitDate; if (laterOrEqual(visitDate, p.last_visit_date)) { p.last_visit_date = visitDate; if (cleanString(visit.doctor)) p.last_doctor = cleanString(visit.doctor); if (cleanString(visit.company)) p.last_company = cleanString(visit.company); } }
  p.visit_count = num(p.visit_count) + 1; p.recall_priority = recallPriority(p.last_visit_date); p.updated_at = nowIso(); return p;
}

export async function processVisitUpload(user: any, files: File[], visitCandidates: any[], rawRowCount: number, invalidPhoneCount: number, filenameSummary: string) {
  const batch = { id: newId('batch_'), filename_summary: filenameSummary, uploaded_by: user.id, raw_row_count: rawRowCount, unique_visit_count: 0, clean_patient_count: 0, duplicate_row_count: 0, invalid_phone_count: invalidPhoneCount, notes: '', storage_mode: 'relational_supabase_tables', created_at: nowIso() } as any;
  const existingHashes = new Set<string>();
  for (const row of await selectAll<any>('visit_hashes', 'visit_hash')) existingHashes.add(row.visit_hash);
  const batchHashes = new Set<string>(); const newVisits: any[] = []; let duplicates = 0;
  for (const v of visitCandidates) {
    if (existingHashes.has(v.visit_hash) || batchHashes.has(v.visit_hash)) { duplicates += 1; continue; }
    batchHashes.add(v.visit_hash); newVisits.push(v);
  }
  const phones = Array.from(new Set(newVisits.map(v => v.standard_phone).filter(Boolean)));
  const patientsByPhone = new Map<string, any>();
  for (const chunk of chunkArray(phones, 500)) {
    const { data, error } = await db().from('clean_patients').select('*').in('standard_phone', chunk);
    if (error) throw new Error(`Existing patient load failed: ${error.message}`);
    for (const p of data || []) patientsByPhone.set(p.standard_phone, p);
  }
  for (const visit of newVisits) patientsByPhone.set(visit.standard_phone, mergeVisitIntoPatient(patientsByPhone.get(visit.standard_phone), visit));
  const patientRows = Array.from(patientsByPhone.values());
  batch.unique_visit_count = newVisits.length; batch.clean_patient_count = await countRows('clean_patients') + patientRows.filter((p: any) => !p.created_at || p.created_at === p.updated_at).length; batch.duplicate_row_count = duplicates;
  const { error: batchErr } = await db().from('upload_batches').insert(batch);
  if (batchErr) throw new Error(`Upload batch save failed: ${batchErr.message}`);
  await upsertChunks('visit_hashes', newVisits.map(v => ({ visit_hash: v.visit_hash, batch_id: batch.id, standard_phone: v.standard_phone, visit_date: v.visit_date, created_at: nowIso() })), 1000);
  await upsertChunks('clean_patients', patientRows, 500);
  if (invalidPhoneCount) await db().from('data_quality_flags').insert({ id: newId('flag_'), batch_id: batch.id, flag_type: 'invalid_or_missing_phone', severity: 'medium', status: 'open', description: `${invalidPhoneCount} raw visit rows in this upload had missing or invalid phone numbers and were excluded from the clean calling list.`, created_at: nowIso() });
  const cleanCount = await countRows('clean_patients');
  await db().from('upload_batches').update({ clean_patient_count: cleanCount }).eq('id', batch.id);
  return { batch: { ...batch, clean_patient_count: cleanCount } };
}

export async function getHealthCounts() {
  return {
    users: await countRows('app_users'),
    uploadBatches: await countRows('upload_batches'),
    rawVisitsStored: 0,
    uniqueVisitsStored: 0,
    uniqueVisitHashes: await countRows('visit_hashes'),
    cleanPatients: await countRows('clean_patients'),
    callAttempts: await countRows('call_attempts'),
    bookings: await countRows('bookings'),
    openFlags: await countRows('data_quality_flags', q => q.eq('status', 'open'))
  };
}

export async function getAssumptions() { await ensureDefaultAssumptions(); return selectAll<any>('payment_assumptions', '*', { column: 'sort_order', ascending: true }); }
export async function updateAssumptions(rows: any[]) { for (const row of rows) { await db().from('payment_assumptions').update({ value: String(row.value), updated_at: nowIso() }).eq('key', row.key); } }
export async function calculatePayments(user: any, body: any, calculateStaffPay: any) {
  const { periodName, startDate, endDate, workDays, teamTargetAchieved } = body;
  if (!periodName || !startDate || !endDate) throw new Error('Period name, start date and end date are required');
  const period = { id: newId('period_'), period_name: periodName, start_date: startDate, end_date: endDate, work_days: Number(workDays || 0), team_target_achieved: !!teamTargetAchieved, status: 'calculated', created_by: user.id, created_at: nowIso() };
  const { error: pErr } = await db().from('payment_periods').insert(period);
  if (pErr) throw new Error(`Payment period save failed: ${pErr.message}`);
  const assumptionsRows = await getAssumptions(); const assumptions: any = {}; assumptionsRows.forEach((r: any) => assumptions[r.key] = Number(r.value));
  const staff = (await listUsers()).filter((u: any) => u.is_active && ['recall_staff','manager'].includes(u.role));
  const results: any[] = [];
  for (const s of staff) {
    const calls = (await selectAll<any>('call_attempts', '*')).filter(c => c.staff_id === s.id && inDateWindow(c.attempt_at || c.created_at, startDate, endDate));
    const bookings = (await selectAll<any>('bookings', '*')).filter(b => b.staff_id === s.id && inDateWindow(b.created_at, startDate, endDate));
    const uniquePatientsCalled = new Set(calls.map(c => c.patient_id)).size;
    const verifiedBookings = bookings.filter(b => b.booking_status === 'verified').length;
    const maturedBookings = bookings.filter(b => String(b.appointment_date || '').slice(0,10) <= endDate).length;
    const attendedPatients = bookings.filter(b => b.attendance_status === 'attended').length;
    const flags = (await selectAll<any>('data_quality_flags', '*')).filter(f => f.staff_id === s.id && (f.status || 'open') === 'open' && inDateWindow(f.created_at, startDate, endDate));
    const criticalIssue = flags.some(f => f.severity === 'critical'); const dataQualityMet = !flags.some(f => f.severity === 'critical' || f.severity === 'high');
    const calc = calculateStaffPay({ workDays: Number(workDays), teamTargetAchieved: !!teamTargetAchieved, uniquePatientsCalled, verifiedBookings, maturedBookings, attendedPatients, dataQualityMet, criticalIssue, assumptions });
    const stats = { staff: s, uniquePatientsCalled, verifiedBookings, maturedBookings, attendedPatients, dataQualityMet, criticalIssue, ...calc };
    results.push({ id: newId('paycalc_'), period_id: period.id, staff_id: s.id, stats, base_pay: calc.basePay, gross_incentive: calc.grossIncentive, incentive_after_cap: calc.incentiveAfterCap, total_pay: calc.totalPay, payment_flags: calc.flags, approval_status: calc.flags.length ? 'review_required' : 'pending', created_at: nowIso() });
  }
  await insertChunks('staff_payment_calculations', results);
  return { period, results };
}
