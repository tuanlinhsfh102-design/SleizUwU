/**
 * Translation Memory - persistent cache of past translations.
 * When the same source text appears again, we skip the AI call entirely.
 */
import { schema, type DB } from '@sleiz/database';
import { eq, inArray } from 'drizzle-orm';
import { hashString, type AIProviderType } from '@sleiz/shared';

export class TranslationMemoryStore {
  constructor(private db: DB) {}

  async lookup(sourceText: string): Promise<string | null> {
    const hash = await hashString(sourceText.trim());
    const rows = this.db
      .select()
      .from(schema.translationMemory)
      .where(eq(schema.translationMemory.sourceHash, hash))
      .all();
    if (rows.length === 0) return null;
    const row = rows[0];
    // bump hit count
    this.db
      .update(schema.translationMemory)
      .set({ hitCount: row.hitCount + 1, updatedAt: Date.now() / 1000 })
      .where(eq(schema.translationMemory.id, row.id))
      .run();
    return row.targetText;
  }

  async store(
    sourceText: string,
    targetText: string,
    provider: AIProviderType,
    movieId?: string,
  ): Promise<void> {
    const hash = await hashString(sourceText.trim());
    const existing = this.db
      .select()
      .from(schema.translationMemory)
      .where(eq(schema.translationMemory.sourceHash, hash))
      .all();
    if (existing.length > 0) {
      this.db
        .update(schema.translationMemory)
        .set({
          targetText,
          provider,
          movieId: movieId || null,
          updatedAt: Date.now() / 1000,
        })
        .where(eq(schema.translationMemory.id, existing[0].id))
        .run();
      return;
    }
    this.db
      .insert(schema.translationMemory)
      .values({
        id: crypto.randomUUID(),
        sourceText: sourceText.trim(),
        sourceHash: hash,
        targetText,
        provider,
        movieId: movieId || null,
        hitCount: 0,
      })
      .run();
  }

  async stats(): Promise<{ total: number; totalHits: number }> {
    const rows = this.db.select().from(schema.translationMemory).all();
    return {
      total: rows.length,
      totalHits: rows.reduce((sum, r) => sum + r.hitCount, 0),
    };
  }

  async clear(): Promise<void> {
    this.db.delete(schema.translationMemory).run();
  }

  /**
   * Remove cached translations for source cues that are about to be reset or
   * discarded. This ensures the next run calls the selected AI provider again
   * instead of restoring the just-deleted result from translation memory.
   */
  async clearForSources(sourceTexts: Iterable<string | null | undefined>): Promise<void> {
    const texts = [...new Set(
      [...sourceTexts]
        .map((text) => text?.trim())
        .filter((text): text is string => Boolean(text)),
    )];
    if (texts.length === 0) return;

    const hashes = await Promise.all(texts.map((text) => hashString(text)));
    this.db
      .delete(schema.translationMemory)
      .where(inArray(schema.translationMemory.sourceHash, hashes))
      .run();
  }
}
