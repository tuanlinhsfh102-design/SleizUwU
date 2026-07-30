/**
 * Higher-level AI services:
 *  - generateDescription: builds YouTube title/description/hashtags/SEO
 *  - generateThumbnailPrompt: suggests a thumbnail text + image prompt
 *  - runConsistencyCheck: scans translated cues for naming/terminology issues
 */
import { eq } from 'drizzle-orm';
import { schema, type DB } from '@sleiz/database';
import { uuid, resolveAIModel, type AIProviderType, type SubtitleCue } from '@sleiz/shared';
import { createProvider, loadGlossary } from '@sleiz/translator';
import { parseSubtitle } from '@sleiz/subtitle';
import { addHistory } from './history.js';

function resolveProvider(db: DB) {
  const settings = db.select().from(schema.settings).where(eq(schema.settings.id, 'default')).get();
  if (!settings) throw new Error('Settings not initialized');
  const providerType = (settings.defaultProvider || 'gemini') as AIProviderType;
  const apiKey = getApiKey(settings, providerType);
  if (!apiKey) throw new Error(`No API key configured for ${providerType}`);
  const modelId = resolveAIModel(providerType, settings.defaultModel);
  return { provider: createProvider({ provider: providerType, model: modelId, apiKey }), type: providerType, model: modelId, settings };
}

function getApiKey(settings: typeof schema.settings.$inferSelect, provider: AIProviderType): string {
  const map = {
    gemini: settings.geminiApiKey || process.env.GEMINI_API_KEY,
    openai: settings.openaiApiKey || process.env.OPENAI_API_KEY,
    claude: settings.claudeApiKey || process.env.CLAUDE_API_KEY,
    deepseek: settings.deepseekApiKey || process.env.DEEPSEEK_API_KEY,
    openrouter: settings.openrouterApiKey || process.env.OPENROUTER_API_KEY,
    qwen: settings.qwenApiKey || process.env.QWEN_API_KEY,
    local: 'ollama',
  }[provider];
  return map || '';
}

export async function generateDescription(db: DB, episodeId: string) {
  const episode = db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId)).get();
  if (!episode) throw new Error('Episode not found');
  const movie = episode.movieId
    ? db.select().from(schema.movies).where(eq(schema.movies.id, episode.movieId)).get()
    : null;
  if (!movie) throw new Error('Movie not found');
  const channel = movie.channelId
    ? db.select().from(schema.channels).where(eq(schema.channels.id, movie.channelId)).get()
    : null;

  if (!episode.subtitleId) throw new Error('A translated subtitle is required to generate an episode description.');
  const sub = db.select().from(schema.subtitles).where(eq(schema.subtitles.id, episode.subtitleId)).get();
  if (!sub) throw new Error('Subtitle not found');

  const cues = JSON.parse(sub.cues) as SubtitleCue[];
  if (cues.length === 0) throw new Error('Subtitle has no cues to describe.');
  const untranslated = cues.find((cue) => !cue.textTranslated?.trim());
  if (untranslated) {
    throw new Error(`Subtitle translation is incomplete (cue ${untranslated.index + 1}).`);
  }

  // Include representative dialogue from the beginning, middle, and end of
  // the SRT rather than only its opening scene. A character limit prevents a
  // long episode from exhausting the provider context window.
  const subtitleContext = buildSubtitleContext(cues);

  const { provider, type, model } = resolveProvider(db);

  const template = channel?.templateDescription || `👉 Chúc Các Bạn Xem Phim Vui Vẻ! ❤️
━━━━━━━━━━━━━━━━━━━━━━
🎬 Tên Phim: {{movieTitle}}
🎞️ Tập: {{episode}}
🎥 Vietsub & Biên Tập: Sleiz Vietsub
📱 TikTok: @sleiz.vietsub
━━━━━━━━━━━━━━━━━━━━━━
💖 ỦNG HỘ SLEIZ VIETSUB
{{donateMessage}}
━━━━━━━━━━━━━━━━━━━━━━
📌 Giới thiệu tập mới
{{introduction}}

✨ Những điểm nổi bật không thể bỏ qua:
{{highlights}}
━━━━━━━━━━━━━━━━━━━━━━
🏷️ Hashtag:
{{hashtags}}
👍 Like • 💬 Comment • 🔔 Đăng ký kênh để không bỏ lỡ những tập mới nhất từ Sleiz Vietsub!`;
  const hashtagTemplate = channel?.templateHashtag || '#SleizVietsub #{{movieSlug}}';

  const prompt = `Bạn là một nhà sáng tạo nội dung YouTube chuyên nghiệp. Hãy tạo metadata cho bộ phim sau:

PHIM: ${movie.titleVi} (${movie.titleZh})
WORKSPACE: ${episode.title}
MÔ TẢ PHIM: ${movie.description || ''}
THỂ LOẠI: ${movie.genres || ''}
NỘI DUNG PHỤ ĐỀ ĐÃ DỊCH (trích đoạn đại diện toàn bộ tập, theo thứ tự thời gian):
${subtitleContext}

YÊU CẦU: Trả về JSON hợp lệ với các trường:
{
  "title": "tiêu đề YouTube hấp dẫn (60-90 ký tự, có emoji phù hợp)",
  "youtubeDescription": "TOÀN BỘ mô tả hoàn chỉnh để dán thẳng vào YouTube. Bắt buộc theo đúng cấu trúc template bên dưới, điền nội dung thật từ phụ đề. Trong youtubeDescription phải có: lời chúc, tên phim/tập, phần ủng hộ, giới thiệu tập (2-3 đoạn ngắn gọn súc tích), các điểm nổi bật (3-5 dòng), hashtag (nhiều, có # ở đầu mỗi hashtag), lời kêu gọi đăng ký. KHÔNG tách tiêu đề và hashtag ra ngoài youtubeDescription — gom tất cả vào trong.",
  "introduction": "1-2 câu giới thiệu ngắn (lưu để tham khảo)",
  "highlights": "3-5 điểm nổi bật, mỗi điểm một dòng (lưu để tham khảo)",
  "callToAction": "lời kêu gọi đăng ký ngắn gọn (lưu để tham khảo)",
  "donateMessage": "${channel?.donateInfo ? 'Thông tin ủng hộ: ' + channel.donateInfo : '🏦 Ngân hàng: MB BANK\\n💳 STK: 998809062005\\nMọi sự ủng hộ từ các bạn sẽ là động lực để Sleiz Vietsub tiếp tục dịch và mang đến nhiều bộ phim chất lượng hơn trong tương lai. Xin chân thành cảm ơn tất cả mọi người đã luôn theo dõi và ủng hộ kênh! ❤️'}",
  "hashtags": "để trống nếu đã có hashtag trong youtubeDescription (bắt buộc ưu tiên đưa hashtag vào youtubeDescription)",
  "seoKeywords": "10 từ khóa SEO cách nhau bởi dấu phẩy"
}

Template mô tả (BẮT BUỘC điền theo đúng cấu trúc này vào youtubeDescription; không được bịa chi tiết không có trong phụ đề; giữ nguyên các dấu ━━━━, emoji và thứ tự section. Thay {{movieTitle}} bằng tên phim, {{episode}} bằng số/tên tập, và giữ nguyên phần Vietsub & Biên Tập, TikTok, ủng hộ, CTA):
${template}
Template hashtag (chỉ tham khảo, vẫn phải đưa hashtag vào youtubeDescription): ${hashtagTemplate}

Chỉ trả về JSON thuần, không kèm giải thích.`;

  const result = await provider.translate(
    [
      { role: 'system', content: 'Bạn là trợ lý tạo metadata cho kênh phim hoạt hình Trung Quốc thuyết minh/vietsub. Luôn trả về JSON hợp lệ.' },
      { role: 'user', content: prompt },
    ],
    { temperature: 0.7 },
  );

  // Try to parse JSON from the response (LLMs sometimes wrap in ```json blocks)
  let parsed: Record<string, string> = {};
  try {
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : result.text);
  } catch {
    parsed = { youtubeDescription: result.text };
  }

  // Persist
  const existing = db.select().from(schema.aiDescriptions).where(eq(schema.aiDescriptions.episodeId, episodeId)).get();
  const id = existing?.id || uuid();
  const now = Math.floor(Date.now() / 1000);
  if (existing) {
    db.update(schema.aiDescriptions)
      .set({
        title: parsed.title ?? null,
        youtubeDescription: parsed.youtubeDescription ?? null,
        introduction: parsed.introduction ?? null,
        highlights: parsed.highlights ?? null,
        callToAction: parsed.callToAction ?? null,
        donateMessage: parsed.donateMessage ?? null,
        hashtags: parsed.hashtags ?? null,
        seoKeywords: parsed.seoKeywords ?? null,
        updatedAt: now,
      })
      .where(eq(schema.aiDescriptions.id, id))
      .run();
  } else {
    db.insert(schema.aiDescriptions)
      .values({
        id,
        episodeId,
        title: parsed.title ?? null,
        youtubeDescription: parsed.youtubeDescription ?? null,
        introduction: parsed.introduction ?? null,
        highlights: parsed.highlights ?? null,
        callToAction: parsed.callToAction ?? null,
        donateMessage: parsed.donateMessage ?? null,
        hashtags: parsed.hashtags ?? null,
        seoKeywords: parsed.seoKeywords ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  await addHistory(db, {
    action: 'create',
    entityType: 'ai-description',
    entityId: id,
    entityName: parsed.title || `Episode ${episode.episodeNumber}`,
    details: `Generated via ${type}/${model}, ${result.usage.totalTokens} tokens`,
  });

  return { id, ...parsed, usage: result.usage };
}

function buildSubtitleContext(cues: SubtitleCue[], maxCharacters = 18_000): string {
  const lines = cues.map((cue) => cue.textTranslated!.trim()).filter(Boolean);
  const targetLines = Math.min(lines.length, 180);
  const step = lines.length / targetLines;
  const selected = Array.from(
    { length: targetLines },
    (_, position) => lines[Math.min(lines.length - 1, Math.floor(position * step))],
  );

  let length = 0;
  return selected.filter((line) => {
    if (length + line.length + 1 > maxCharacters) return false;
    length += line.length + 1;
    return true;
  }).join('\n');
}

export async function generateThumbnailPrompt(db: DB, episodeId: string) {
  const episode = db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId)).get();
  if (!episode) throw new Error('Episode not found');
  const movie = episode.movieId
    ? db.select().from(schema.movies).where(eq(schema.movies.id, episode.movieId)).get()
    : null;
  if (!movie) throw new Error('Movie not found');

  const { provider, type, model } = resolveProvider(db);

  const prompt = `Hãy gợi ý thiết kế thumbnail YouTube cho tập phim sau:

PHIM: ${movie.titleVi} (${movie.titleZh})
TẬP: ${episode.episodeNumber} - ${episode.title}
MÔ TẢ: ${movie.description || ''}
THỂ LOẠI: ${movie.genres || ''}

Trả về JSON:
{
  "thumbnailText": "chữ trên thumbnail (ngắn, 4-8 chữ, gây tò mò)",
  "title": "tiêu đề phụ dưới thumbnail",
  "primaryColor": "màu hex chính (VD: #FF3B30)",
  "secondaryColor": "màu hex phụ",
  "emotion": "cảm xúc chính (VD: huyền bí, kịch tính, hài hước)",
  "background": "mô tả background",
  "mainCharacter": "mô tả nhân vật chính xuất hiện",
  "imagePrompt": "prompt tiếng Anh để AI tạo ảnh thumbnail chi tiết"
}

Chỉ trả về JSON thuần.`;

  const result = await provider.translate(
    [
      { role: 'system', content: 'Bạn là art director cho kênh phim hoạt hình. Luôn trả về JSON hợp lệ.' },
      { role: 'user', content: prompt },
    ],
    { temperature: 0.8 },
  );

  let parsed: Record<string, string> = {};
  try {
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : result.text);
  } catch {
    parsed = { imagePrompt: result.text };
  }

  await addHistory(db, {
    action: 'create',
    entityType: 'ai-thumbnail',
    entityId: episodeId,
    entityName: parsed.thumbnailText || `Episode ${episode.episodeNumber}`,
    details: `Generated via ${type}/${model}`,
  });

  return { ...parsed, usage: result.usage };
}

export interface ConsistencyIssue {
  type: 'name' | 'place' | 'skill' | 'item' | 'title' | 'term' | 'spelling' | 'timing' | 'newline';
  severity: 'info' | 'warning' | 'error';
  cueIndex: number;
  message: string;
  suggestion?: string;
}

export async function runConsistencyCheck(db: DB, subtitleId: string) {
  const sub = db.select().from(schema.subtitles).where(eq(schema.subtitles.id, subtitleId)).get();
  if (!sub) throw new Error('Subtitle not found');
  const cues = JSON.parse(sub.cues) as SubtitleCue[];

  // Load glossary to find missing translations
  const episode = db.select().from(schema.episodes).where(eq(schema.episodes.id, sub.episodeId)).get();
  const movie = episode?.movieId
    ? db.select().from(schema.movies).where(eq(schema.movies.id, episode.movieId)).get()
    : null;
  const glossary = await loadGlossary(db, { movieId: movie?.id });
  const terms = glossary.getTerms();

  const issues: ConsistencyIssue[] = [];

  // 1. Glossary enforcement: original term still present in translated text
  cues.forEach((cue, idx) => {
    const text = cue.textTranslated || '';
    if (!text) return;
    for (const t of terms) {
      if (text.includes(t.original)) {
        issues.push({
          type: t.original.length >= 4 ? 'name' : 'term',
          severity: 'warning',
          cueIndex: idx,
          message: `Thuật ngữ gốc "${t.original}" vẫn xuất hiện trong bản dịch`,
          suggestion: `Nên thay bằng "${t.translated}"`,
        });
      }
    }
  });

  // 2. Empty translations
  cues.forEach((cue, idx) => {
    if (!cue.textTranslated || !cue.textTranslated.trim()) {
      issues.push({
        type: 'spelling',
        severity: 'error',
        cueIndex: idx,
        message: 'Câu chưa được dịch',
      });
    }
  });

  // 3. Timing issues (end < start, or zero-length)
  cues.forEach((cue, idx) => {
    if (cue.endMs <= cue.startMs) {
      issues.push({
        type: 'timing',
        severity: 'warning',
        cueIndex: idx,
        message: `Thời gian không hợp lệ: ${cue.startMs}ms → ${cue.endMs}ms`,
      });
    }
    if (cue.endMs - cue.startMs > 30_000) {
      issues.push({
        type: 'timing',
        severity: 'info',
        cueIndex: idx,
        message: 'Câu hiển thị quá 30 giây',
      });
    }
  });

  // 4. Newline issues (translated text has Windows-style \r\n)
  cues.forEach((cue, idx) => {
    if (cue.textTranslated?.includes('\r\n')) {
      issues.push({
        type: 'newline',
        severity: 'info',
        cueIndex: idx,
        message: 'Có xuống dòng \\r\\n, nên thay bằng \\n',
      });
    }
  });

  // 5. Optional AI-based check (only if < 50 cues to keep cost low)
  if (cues.length > 0 && cues.length <= 50) {
    try {
      const { provider, type, model } = resolveProvider(db);
      const sample = cues.slice(0, 50).map((c, i) => `${i + 1}. [ZH] ${c.textOriginal}\n   [VI] ${c.textTranslated || '(chưa dịch)'}`).join('\n');
      const aiResult = await provider.translate(
        [
          {
            role: 'system',
            content:
              'Bạn là biên tập viên vietsub. Kiểm tra các lỗi: chính tả, ngữ pháp, nhất quán tên nhân vật/địa danh, thuật ngữ. Trả về JSON mảng các issue: [{cueIndex, type, severity, message, suggestion}]. Type ∈ name|place|skill|term|spelling|timing. Severity ∈ info|warning|error. Nếu không có lỗi, trả về [].',
          },
          { role: 'user', content: sample },
        ],
        { temperature: 0.2 },
      );
      const match = aiResult.text.match(/\[[\s\S]*\]/);
      if (match) {
        const aiIssues = JSON.parse(match[0]) as Array<Record<string, unknown>>;
        for (const i of aiIssues) {
          issues.push({
            type: (i.type as ConsistencyIssue['type']) || 'spelling',
            severity: (i.severity as ConsistencyIssue['severity']) || 'info',
            cueIndex: Number(i.cueIndex || 0),
            message: String(i.message || ''),
            suggestion: i.suggestion ? String(i.suggestion) : undefined,
          });
        }
      }
    } catch (err) {
      console.error('[consistency] AI check failed:', err);
    }
  }

  await addHistory(db, {
    action: 'review',
    entityType: 'subtitle',
    entityId: subtitleId,
    details: `Consistency check: ${issues.length} issue(s) found`,
  });

  return {
    subtitleId,
    totalCues: cues.length,
    totalIssues: issues.length,
    bySeverity: {
      error: issues.filter((i) => i.severity === 'error').length,
      warning: issues.filter((i) => i.severity === 'warning').length,
      info: issues.filter((i) => i.severity === 'info').length,
    },
    issues,
  };
}

export async function rewriteSubtitleWithAI(db: DB, subtitleId: string, instruction: string) {
  if (!instruction.trim()) {
    throw new Error('Instruction is required');
  }

  const sub = db.select().from(schema.subtitles).where(eq(schema.subtitles.id, subtitleId)).get();
  if (!sub) throw new Error('Subtitle not found');

  const episode = db.select().from(schema.episodes).where(eq(schema.episodes.id, sub.episodeId)).get();
  const movie = episode?.movieId
    ? db.select().from(schema.movies).where(eq(schema.movies.id, episode.movieId)).get()
    : null;
  const glossary = movie ? await loadGlossary(db, { movieId: movie.id }) : await loadGlossary(db, {});
  const cues = JSON.parse(sub.cues) as SubtitleCue[];
  const { provider, type, model } = resolveProvider(db);
  const batchSize = 100;
  let totalTokens = 0;

  for (let index = 0; index < cues.length; index += batchSize) {
    const batch = cues.slice(index, index + batchSize);
    const payload = batch.map((cue) => ({
      id: cue.id,
      original: cue.textOriginal,
      current: cue.textTranslated || cue.textOriginal,
    }));

    const result = await provider.translate(
      [
        {
          role: 'system',
          content:
            'Bạn là biên tập viên phụ đề tiếng Việt. Hãy chỉnh sửa câu chữ theo yêu cầu của người dùng nhưng vẫn giữ đúng ý gốc, ngắn gọn, sát nghĩa, giữ số dòng ổn định và không thêm giải thích hoặc chi tiết mới. Luôn trả về JSON hợp lệ theo dạng {"items":[{"id":"cue-id","text":"noi dung da sua"}]}.',
        },
        {
          role: 'user',
          content: `Phim: ${movie?.titleVi || 'Không rõ'}\nYêu cầu chỉnh sửa: ${instruction}\n${glossary.buildPromptBlock()}\nDữ liệu cần chỉnh:\n${JSON.stringify(payload)}`,
        },
      ],
      { temperature: 0.4 },
    );

    totalTokens += result.usage.totalTokens;
    const match = result.text.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error(`AI returned invalid rewrite payload for batch ${index / batchSize + 1}`);
    }

    const parsed = JSON.parse(match[0]) as { items?: Array<{ id: string; text: string }> };
    const map = new Map((parsed.items || []).map((item) => [item.id, item.text]));

    for (const cue of batch) {
      const nextText = map.get(cue.id);
      if (nextText?.trim()) {
        cue.textTranslated = nextText.trim();
        cue.status = 'reviewed';
      }
    }
  }

  db.update(schema.subtitles)
    .set({ cues: JSON.stringify(cues), updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(schema.subtitles.id, subtitleId))
    .run();

  await addHistory(db, {
    action: 'review',
    entityType: 'subtitle',
    entityId: subtitleId,
    details: `AI rewrite via ${type}/${model}: ${instruction}`,
  });

  return {
    subtitleId,
    updatedCues: cues.filter((cue) => cue.textTranslated?.trim()).length,
    tokensUsed: totalTokens,
  };
}

export async function suggestMovieTitle(
  db: DB,
  input: { content: string; filename?: string; currentTitle?: string | null },
) {
  const content = input.content.trim();
  if (!content) {
    throw new Error('Content is required');
  }

  const { provider, type, model } = resolveProvider(db);
  const titleContext = await buildMovieTitleContext(content, input.filename);
  const prompt = `Bạn là biên tập viên đặt tên phim hoạt hình Trung Quốc cho khán giả Việt.

Hãy đọc dữ liệu bên dưới và suy đoán tên bộ phim hợp lý nhất.
- Nếu dữ liệu là phụ đề/json thì ưu tiên nhận diện tên riêng, thế giới quan, nhân vật trung tâm.
- Nếu chưa thể chắc chắn 100%, vẫn phải gợi ý tên tự nhiên, dễ dùng cho quản lý dự án.
- Không bịa dài dòng. Không mô tả lan man.
- titleVi phải là tên tiếng Việt tự nhiên, dễ đọc.
- titleZh chỉ điền khi suy ra được tên gốc tiếng Trung; nếu không chắc thì để chuỗi rỗng.
- titleEn chỉ điền khi có thể suy ra tương đối rõ; nếu không thì để chuỗi rỗng.
- aliases có thể là mảng rỗng.

Trả về JSON hợp lệ đúng format:
{
  "titleVi": "Tên gợi ý chính",
  "titleZh": "Tên gốc nếu có",
  "titleEn": "Tên tiếng Anh nếu có",
  "aliases": ["bí danh 1", "bí danh 2"],
  "confidence": 0.0,
  "reason": "giải thích ngắn gọn vì sao chọn tên này"
}

Tên hiện tại (nếu có): ${input.currentTitle || '(chưa có)'}

Ngữ liệu:
${titleContext}`;

  const result = await provider.translate(
    [
      {
        role: 'system',
        content: 'Bạn là chuyên gia đặt tên phim. Luôn trả về JSON hợp lệ, không bọc markdown.',
      },
      { role: 'user', content: prompt },
    ],
    { temperature: 0.35 },
  );

  let parsed: {
    titleVi?: string;
    titleZh?: string;
    titleEn?: string;
    aliases?: string[];
    confidence?: number;
    reason?: string;
  } = {};
  try {
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : result.text);
  } catch {
    parsed = {
      titleVi: result.text.trim(),
      titleZh: '',
      titleEn: '',
      aliases: [],
      confidence: 0.3,
      reason: 'AI trả về văn bản thường nên hệ thống dùng trực tiếp làm tên gợi ý.',
    };
  }

  const normalized = {
    titleVi: String(parsed.titleVi || '').trim(),
    titleZh: String(parsed.titleZh || '').trim(),
    titleEn: String(parsed.titleEn || '').trim(),
    aliases: Array.isArray(parsed.aliases)
      ? parsed.aliases.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
    reason: String(parsed.reason || '').trim(),
    provider: type,
    model,
    usage: result.usage,
  };

  if (!normalized.titleVi) {
    throw new Error('AI did not return a valid Vietnamese movie title');
  }

  await addHistory(db, {
    action: 'create',
    entityType: 'ai-movie-title',
    entityId: uuid(),
    entityName: normalized.titleVi,
    details: `Suggested via ${type}/${model}`,
  });

  return normalized;
}

async function buildMovieTitleContext(content: string, filename?: string) {
  const trimmed = content.trim();

  try {
    const parsed = await parseSubtitle(trimmed, filename || inferFilename(trimmed));
    const cues = parsed.cues
      .map((cue) => cue.textOriginal?.trim())
      .filter(Boolean)
      .slice(0, 80);
    if (cues.length > 0) {
      return [
        `Định dạng nhận diện: ${parsed.format.toUpperCase()}`,
        `Số câu mẫu: ${cues.length}`,
        cues.map((line, index) => `${index + 1}. ${line}`).join('\n'),
      ].join('\n');
    }
  } catch {
    // Fall back to raw content below.
  }

  let raw = trimmed;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const value = JSON.parse(trimmed);
      raw = JSON.stringify(extractInterestingJson(value), null, 2);
    } catch {
      raw = trimmed;
    }
  }

  return raw.length > 12_000 ? raw.slice(0, 12_000) : raw;
}

function inferFilename(content: string) {
  const lower = content.toLowerCase();
  if (lower.startsWith('{') || lower.startsWith('[')) return 'movie.json';
  if (/^\s*\d+\s*\n\d{2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/.test(content)) return 'movie.srt';
  return 'movie.txt';
}

function extractInterestingJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => extractInterestingJson(item));
  }
  if (!value || typeof value !== 'object') return value;

  const src = value as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const key of Object.keys(src)) {
    const lower = key.toLowerCase();
    if (
      lower.includes('title')
      || lower.includes('name')
      || lower.includes('text')
      || lower.includes('dialog')
      || lower.includes('subtitle')
      || lower.includes('content')
      || lower.includes('character')
      || lower.includes('desc')
    ) {
      picked[key] = extractInterestingJson(src[key]);
    }
  }

  if (Object.keys(picked).length > 0) return picked;

  return Object.fromEntries(
    Object.entries(src)
      .slice(0, 20)
      .map(([key, item]) => [key, extractInterestingJson(item)]),
  );
}
