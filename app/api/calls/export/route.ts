import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { exportCallsCsv, useTableStorage } from '@/lib/tableDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const user = await requireUser(['admin', 'manager', 'finance', 'recall_staff']);
    if (!useTableStorage()) return NextResponse.json({ error: 'Call export requires relational Supabase tables.' }, { status: 400 });
    const url = new URL(req.url);
    const staffId = (url.searchParams.get('staffId') || '').trim();
    const startDate = (url.searchParams.get('startDate') || '').trim();
    const endDate = (url.searchParams.get('endDate') || '').trim();
    const csv = await exportCallsCsv(user, { staffId, startDate, endDate });
    const suffix = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="fhdc-recall-calls-${suffix}.csv"`,
        'Cache-Control': 'no-store'
      }
    });
  } catch (error: any) {
    const status = error.message === 'UNAUTHENTICATED' ? 401 : error.message === 'FORBIDDEN' ? 403 : 500;
    return NextResponse.json({ error: error.message || 'Failed to export call logs' }, { status });
  }
}
