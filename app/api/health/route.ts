import { NextResponse } from 'next/server';
import { readStore } from '@/lib/localDb';
import { useTableStorage, getHealthCounts } from '@/lib/tableDb';

export async function GET() {
  try {
    if (useTableStorage()) {
      return NextResponse.json({
        ok: true,
        mode: 'supabase-relational-tables',
        storageProfile: 'relational-supabase-v2',
        message: 'FHDC RecallDesk is connected to proper Supabase tables.',
        counts: await getHealthCounts()
      });
    }
    const store: any = await readStore();
    const usingSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.STORAGE_DRIVER !== 'local');
    return NextResponse.json({ ok: true, mode: usingSupabase ? 'supabase-app-store' : 'local-file-database', storageProfile: 'operational-clean-recall-dataset', message: usingSupabase ? 'FHDC RecallDesk is connected to Supabase storage.' : 'FHDC RecallDesk is running locally.', counts: { users: store.app_users.length, uploadBatches: store.upload_batches.length, rawVisitsStored: store.raw_visits.length, uniqueVisitsStored: store.unique_visits.length, uniqueVisitHashes: Array.isArray(store.visit_hashes) ? store.visit_hashes.length : 0, cleanPatients: store.patient_master.length, callAttempts: store.call_attempts.length, bookings: store.bookings.length, openFlags: store.data_quality_flags.filter((f: any) => f.status !== 'closed').length } });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message || 'Health check failed' }, { status: 500 });
  }
}
