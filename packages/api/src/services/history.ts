/**
 * History audit log helper.
 */
import { schema, type DB } from '@sleiz/database';
import { uuid, type HistoryAction } from '@sleiz/shared';

export interface AddHistoryInput {
  action: HistoryAction;
  entityType: string;
  entityId: string;
  entityName?: string | null;
  details?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function addHistory(db: DB, input: AddHistoryInput): Promise<void> {
  try {
    db.insert(schema.history)
      .values({
        id: uuid(),
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        entityName: input.entityName ?? null,
        details: input.details ?? null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
        createdAt: Math.floor(Date.now() / 1000),
      })
      .run();
  } catch (err) {
    // History is best-effort; never let it crash the main operation.
    console.error('[history] failed to log:', err);
  }
}
