import { promises as fs } from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

export type AppRole = 'admin' | 'manager' | 'recall_staff' | 'verifier' | 'finance' | 'viewer';

export type AppUser = {
  id: string;
  name: string;
  email: string;
  role: AppRole;
  is_active: boolean;
  password_hash: string;
  created_at: string;
};

export type Store = {
  app_users: AppUser[];
  upload_batches: any[];
  raw_visits: any[];
  unique_visits: any[];
  patient_master: any[];
  call_attempts: any[];
  bookings: any[];
  data_quality_flags: any[];
  payment_assumptions: any[];
  payment_periods: any[];
  staff_payment_calculations: any[];
  audit_logs: any[];
};

const dataDir = path.join(process.cwd(), 'data');
const dataFile = path.join(dataDir, 'recalldesk-db.json');

export const defaultAssumptions = [
  { key: 'base_pay', label: 'Guaranteed Base Pay', value: '20000', sort_order: 1 },
  { key: 'daily_call_target', label: 'Daily Unique Patient Target', value: '150', sort_order: 2 },
  { key: 'monthly_incentive_cap', label: 'Monthly Incentive Cap', value: '20000', sort_order: 3 },
  { key: 'booking_bonus_per_verified_booking', label: 'Booking Bonus per Verified Booking', value: '20', sort_order: 4 },
  { key: 'attendance_bonus_per_attended_patient', label: 'Attendance Bonus per Attended Patient', value: '50', sort_order: 5 },
  { key: 'data_quality_bonus', label: 'Data Quality Bonus', value: '2000', sort_order: 6 },
  { key: 'team_target_bonus', label: 'Team Target Bonus', value: '5000', sort_order: 7 },
  { key: 'minimum_conversion_target', label: 'Minimum Booking Conversion Target', value: '0.10', sort_order: 8 },
  { key: 'conversion_bonus_5_percent', label: 'Conversion Bonus at 5%', value: '1000', sort_order: 9 },
  { key: 'conversion_bonus_8_percent', label: 'Conversion Bonus at 8%', value: '2000', sort_order: 10 },
  { key: 'conversion_bonus_10_percent', label: 'Conversion Bonus at 10%', value: '4000', sort_order: 11 },
  { key: 'conversion_bonus_12_5_percent', label: 'Conversion Bonus at 12.5%', value: '6000', sort_order: 12 },
  { key: 'show_up_multiplier_40_percent', label: 'Show Up Multiplier at 40%', value: '0.5', sort_order: 13 },
  { key: 'show_up_multiplier_50_percent', label: 'Show Up Multiplier at 50%', value: '0.75', sort_order: 14 },
  { key: 'show_up_multiplier_60_percent', label: 'Show Up Multiplier at 60%', value: '1', sort_order: 15 }
];

export function nowIso() {
  return new Date().toISOString();
}

export function newId(prefix = '') {
  return `${prefix}${randomUUID()}`;
}

function emptyStore(): Store {
  return {
    app_users: [],
    upload_batches: [],
    raw_visits: [],
    unique_visits: [],
    patient_master: [],
    call_attempts: [],
    bookings: [],
    data_quality_flags: [],
    payment_assumptions: defaultAssumptions.map(a => ({ ...a, id: newId('assumption_'), updated_at: nowIso() })),
    payment_periods: [],
    staff_payment_calculations: [],
    audit_logs: []
  };
}

export async function ensureDataDir() {
  await fs.mkdir(dataDir, { recursive: true });
}

function mergeAssumptions(existing: any[] | undefined) {
  const byKey = new Map((existing || []).map((row: any) => [row.key, row]));
  const merged = defaultAssumptions.map(template => {
    const current = byKey.get(template.key);
    return {
      ...template,
      ...current,
      label: template.label,
      sort_order: template.sort_order,
      id: current?.id || newId('assumption_'),
      value: current?.value ?? template.value,
      updated_at: current?.updated_at || nowIso()
    };
  });

  for (const row of existing || []) {
    if (!defaultAssumptions.some(template => template.key === row.key)) {
      merged.push(row);
    }
  }
  return merged.sort((a: any, b: any) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
}

export async function readStore(): Promise<Store> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(dataFile, 'utf8');
    const parsed = JSON.parse(raw);
    const base = emptyStore();
    return { ...base, ...parsed, payment_assumptions: mergeAssumptions(parsed.payment_assumptions) };
  } catch {
    const store = emptyStore();
    await writeStore(store);
    return store;
  }
}

export async function writeStore(store: Store) {
  await ensureDataDir();
  await fs.writeFile(dataFile, JSON.stringify(store, null, 2), 'utf8');
}

export async function updateStore<T>(fn: (store: Store) => T | Promise<T>): Promise<T> {
  const store = await readStore();
  const result = await fn(store);
  await writeStore(store);
  return result;
}

export function publicUser(user: AppUser) {
  const { password_hash, ...safe } = user;
  return safe;
}

export async function createLocalUser(input: { name: string; email: string; role: AppRole; password: string; is_active?: boolean }) {
  return updateStore(async store => {
    const email = String(input.email || '').trim().toLowerCase();
    if (!email) throw new Error('Email is required');
    if (store.app_users.some(u => u.email === email)) throw new Error('A user with this email already exists');
    const user: AppUser = {
      id: newId('user_'),
      name: String(input.name || '').trim() || email,
      email,
      role: input.role,
      is_active: input.is_active ?? true,
      password_hash: await bcrypt.hash(String(input.password || 'ChangeMe123!'), 12),
      created_at: nowIso()
    };
    store.app_users.push(user);
    return publicUser(user);
  });
}
