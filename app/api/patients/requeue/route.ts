import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { requeuePatient, useTableStorage } from '@/lib/tableDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  try {
    const user = await requireUser(['admin', 'manager']);
    if (!useTableStorage()) return NextResponse.json({ error: 'Patient requeue requires relational Supabase tables.' }, { status: 400 });
    const body = await req.json();
    const patient = await requeuePatient(user, String(body.patientId || '').trim());
    return NextResponse.json({ ok: true, patient });
  } catch (error: any) {
    const status = error.message === 'UNAUTHENTICATED' ? 401 : error.message === 'FORBIDDEN' ? 403 : error.message === 'Patient not found' ? 404 : 400;
    return NextResponse.json({ error: error.message || 'Failed to requeue patient' }, { status });
  }
}
