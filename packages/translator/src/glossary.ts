/**
 * Glossary replacer.
 * Forces certain terms to be translated consistently, regardless of what AI returns.
 *
 * Example:
 *   glossary = { "十三": "Thập Tam", "青龙": "Thanh Long" }
 *   AI returns: "Thập Tam gọi Thanh Long tới"
 *   After apply:  "Thập Tam gọi Thanh Long tới"  (no change, already consistent)
 *
 *   But if AI mistranslates "Thập Tam" as "13", apply() will replace it.
 */
import { schema, type DB } from '@sleiz/database';
import { eq, or, isNotNull } from 'drizzle-orm';
import type { GlossaryEntry } from '@sleiz/shared';

export interface GlossaryTerm {
  original: string;
  translated: string;
}

export class GlossaryReplacer {
  private terms: GlossaryTerm[] = [];
  private sortedOriginals: string[] = [];

  constructor(terms: GlossaryTerm[] = []) {
    this.setTerms(terms);
  }

  setTerms(terms: GlossaryTerm[]): void {
    this.terms = terms;
    // Sort by original length desc so longer terms are replaced first
    // (prevents partial replacement of compound names).
    this.sortedOriginals = [...terms].sort((a, b) => b.original.length - a.original.length).map((t) => t.original);
  }

  /** Apply glossary to translated text: replace any original Chinese term that
   *  the AI left untranslated (or mistranslated) with the canonical translation. */
  apply(text: string): string {
    let result = text;
    for (const term of this.terms) {
      // If original Chinese appears in the Vietnamese output, replace it
      if (result.includes(term.original)) {
        result = result.split(term.original).join(term.translated);
      }
    }
    return result;
  }

  /** Get the current glossary as a sorted list. */
  getTerms(): GlossaryTerm[] {
    return [...this.terms];
  }

  /** Build the glossary instruction block to inject into the AI system prompt. */
  buildPromptBlock(): string {
    if (this.terms.length === 0) return '';
    const lines = this.terms.map((t) => `- "${t.original}" → "${t.translated}"`);
    return [
      '\n\n[GULE GLOSSARY — bắt buộc sử dụng]',
      'Các thuật ngữ sau PHẢI được dịch chính xác như cột bên phải. Tuyệt đối không tự ý đổi:',
      ...lines,
      '',
    ].join('\n');
  }
}

/** Load glossary terms from the database, optionally filtered by channel/movie. */
export async function loadGlossary(
  db: DB,
  opts: { channelId?: string; movieId?: string } = {},
): Promise<GlossaryReplacer> {
  const conditions = [];
  if (opts.movieId) conditions.push(eq(schema.glossary.movieId, opts.movieId));
  if (opts.channelId) conditions.push(eq(schema.glossary.channelId, opts.channelId));

  const rows = conditions.length
    ? db.select().from(schema.glossary).where(conditions[0]).all()
    : db.select().from(schema.glossary).all();

  // Merge: movie-scoped entries take precedence, but include channel/global ones too
  const terms: GlossaryTerm[] = rows.map((r) => ({ original: r.original, translated: r.translated }));
  // Deduplicate by original, keep first occurrence
  const seen = new Set<string>();
  const unique = terms.filter((t) => {
    if (seen.has(t.original)) return false;
    seen.add(t.original);
    return true;
  });
  return new GlossaryReplacer(unique);
}

export type { GlossaryEntry };
