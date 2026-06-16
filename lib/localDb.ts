import { promises as fs } from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { supabaseAdmin } from './supabaseAdmin';

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
  visit_hashes?: string[];
};

const dataDir = path.join(process.cwd(), 'data');
const dataFile = path.join(dataDir, 'recalldesk-db.json');
const supabaseStoreId = 'main';

type StoreCache = { store: Store; fetchedAt: number } | null;
const globalCache = globalThis as typeof globalThis & { __FHDC_RECALLDESK_STORE_CACHE__?: StoreCache };
if (!globalCache.__FHDC_RECALLDESK_STORE_CACHE__) globalCache.__FHDC_RECALLDESK_STORE_CACHE__ = null;

function cacheTtlMs() {
  const configured = Number(process.env.APP_STORE_CACHE_TTL_MS || 120000);
  return Number.isFinite(configured) && configured >= 0 ? configured : 120000;
}

function getCachedStore(): Store | null {
  const cached = globalCache.__FHDC_RECALLDESK_STORE_CACHE__;
  if (!cached) return null;
  if (Date.now() - cached.fetchedAt > cacheTtlMs()) return null;
  return cached.store;
}

function setCachedStore(store: Store) {
  globalCache.__FHDC_RECALLDESK_STORE_CACHE__ = { store, fetchedAt: Date.now() };
}

export function clearStoreCache() {
  globalCache.__FHDC_RECALLDESK_STORE_CACHE__ = null;
}

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
    audit_logs: [],
    visit_hashes: []
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

function normalizeStore(input: any): Store {
  const base = emptyStore();
  const parsed = input && typeof input === 'object' ? input : {};
  return { ...base, ...parsed, payment_assumptions: mergeAssumptions(parsed.payment_assumptions) };
}

function hasUsefulData(store: Store) {
  return Boolean(
    store.app_users?.length ||
    store.upload_batches?.length ||
    store.raw_visits?.length ||
    store.patient_master?.length ||
    store.call_attempts?.length ||
    store.bookings?.length
  );
}

async function readLocalFileStore(): Promise<Store | null> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(dataFile, 'utf8');
    return normalizeStore(JSON.parse(raw));
  } catch {
    return null;
  }
}

function useSupabaseStorage() {
  return Boolean(supabaseAdmin && process.env.STORAGE_DRIVER !== 'local');
}

async function readSupabaseStore(): Promise<Store> {
  if (!supabaseAdmin) throw new Error('Supabase is not configured. Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');

  const cached = getCachedStore();
  if (cached) return cached;

  const { data, error } = await supabaseAdmin
    .from('recalldesk_app_store')
    .select('data')
    .eq('id', supabaseStoreId)
    .maybeSingle();

  if (error) {
    throw new Error(`Supabase storage read failed. Run supabase/schema.sql in the Supabase SQL Editor first. Details: ${error.message}`);
  }

  const store = normalizeStore(data?.data || {});
  setCachedStore(store);
  return store;
}

function compactForSupabase(store: Store): Store {
  // The first Supabase bridge stores the app state in one JSONB record.
  // Full raw Excel rows and full visit rows make that record too large for reliable uploads.
  // Keep the operational recall dataset, call/payment state, and visit hashes for duplicate prevention.
  const copy: any = { ...store };
  const existingHashes = new Set<string>([
    ...((Array.isArray(copy.visit_hashes) ? copy.visit_hashes : []) as string[]),
    ...((Array.isArray(copy.unique_visits) ? copy.unique_visits : []) as any[]).map((v: any) => String(v.visit_hash || '')).filter(Boolean)
  ]);
  copy.visit_hashes = Array.from(existingHashes);
  copy.raw_visits = [];
  copy.unique_visits = [];
  return copy as Store;
}

async function writeSupabaseStore(store: Store) {
  if (!supabaseAdmin) throw new Error('Supabase is not configured.');

  const dataToSave = compactForSupabase(store);
  const { error } = await supabaseAdmin
    .from('recalldesk_app_store')
    .upsert({ id: supabaseStoreId, data: dataToSave, updated_at: nowIso() }, { onConflict: 'id' });

  if (error) {
    throw new Error(`Supabase storage write failed. Details: ${error.message}`);
  }

  setCachedStore(dataToSave);
}

export async function readStore(): Promise<Store> {
  if (useSupabaseStorage()) return readSupabaseStore();

  const local = await readLocalFileStore();
  if (local) return local;

  const store = emptyStore();
  await writeStore(store);
  return store;
}

export async function writeStore(store: Store) {
  if (useSupabaseStorage()) {
    await writeSupabaseStore(store);
    return;
  }

  await ensureDataDir();
  await fs.writeFile(dataFile, JSON.stringify(store, null, 2), 'utf8');
  setCachedStore(store);
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
