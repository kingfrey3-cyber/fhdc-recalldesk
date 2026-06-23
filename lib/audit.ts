import { newId, nowIso, updateStore } from './localDb';
import { useTableStorage, writeAudit as writeTableAudit } from './tableDb';

export async function writeAudit(actorId: string, action: string, entityType: string, entityId: string, details: any = {}) {
  if (useTableStorage()) {
    await writeTableAudit(actorId, action, entityType, entityId, details);
    return;
  }
  try {
    await updateStore(store => {
      store.audit_logs.push({ id: newId('audit_'), actor_id: actorId, action, entity_type: entityType, entity_id: entityId, details, created_at: nowIso() });
    });
  } catch (error) {
    console.warn('Audit write failed:', error);
  }
}
