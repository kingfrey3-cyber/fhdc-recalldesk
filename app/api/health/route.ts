import { NextResponse } from 'next/server';
import { readStore } from '@/lib/localDb';

export async function GET() {
  try {
    const store = await readStore();
    return NextResponse.json({
      ok: true,
      mode: 'local-file-database',
      message: 'FHDC RecallDesk is running locally. No Supabase URL or key is required.',
      counts: {
        users: store.app_users.length,
        uploadBatches: store.upload_batches.length,
        rawVisits: store.raw_visits.length,
        uniqueVisits: store.unique_visits.length,
        cleanPatients: store.patient_master.length,
        callAttempts: store.call_attempts.length,
        bookings: store.bookings.length,
        openFlags: store.data_quality_flags.filter(f => f.status !== 'closed').length
      }
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message || 'Health check failed' }, { status: 500 });
  }
}
