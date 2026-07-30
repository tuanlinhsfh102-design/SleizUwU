/**
 * Seed script - inserts a sample channel + movie + episode so the UI has data on first run.
 */
import { createDb, schema, eq } from './index.js';
import { SUBTITLE_TRANSLATION_SYSTEM_PROMPT, uuid, slugify } from '@sleiz/shared';

const db = createDb();

const existing = db.select().from(schema.channels).all();
if (existing.length > 0) {
  console.log('Database already has channels. Skipping seed.');
  process.exit(0);
}

// Sample channel
const channelId = uuid();
db.insert(schema.channels)
  .values({
    id: channelId,
    name: 'Sleiz Vietsub',
    slug: slugify('Sleiz Vietsub'),
    youtube: 'https://youtube.com/@sleiz-vietsub',
    description: undefined,
    aiProvider: 'gemini',
    aiModel: 'gemini-3.1-flash-lite-preview',
    aiPrompt: SUBTITLE_TRANSLATION_SYSTEM_PROMPT,
    templateDescription:
      '🎬 {{movieTitleVi}} ({{movieTitleZh}})\n📺 Tập {{episodeNumber}}: {{episodeTitle}}\n\n{{introduction}}\n\n✨ Điểm nổi bật:\n{{highlights}}\n\n🔔 Đừng quên Like, Share và Subscribe để ủng hộ kênh!\n\n{{donateMessage}}\n\n{{hashtags}}',
    templateHashtag:
      '#SleizVietsub #{{movieSlug}} #AnimeVietSub #HoatHinhTrungQuoc #Tập{{episodeNumber}}',
  })
  .run();

// Sample movie
const movieId = uuid();
db.insert(schema.movies)
  .values({
    id: movieId,
    channelId,
    titleVi: 'Thập Tam',
    titleZh: '十三',
    titleEn: 'Thirteen',
    aliases: '13, Thirteen',
    studio: 'Bilibili',
    genres: 'Huyền Huyễn, Cổ Đại, Hoạt Hình',
    year: 2024,
    country: 'Trung Quốc',
    director: 'Studio Sleiz',
    author: 'Nguyên tác',
    description: 'Câu chuyện về Thập Tam - một thiếu niên mang trong mình bí ẩn của Thanh Long.',
    tags: 'huyền huyễn, cổ đại, hoạt hình',
    status: 'ongoing',
  })
  .run();

// Sample episode
const episodeId = uuid();
db.insert(schema.episodes)
  .values({
    id: episodeId,
    movieId,
    title: 'Tập 1 - Khởi đầu',
    episodeNumber: 1,
    status: 'pending',
  })
  .run();

// Sample glossary entries
const glossary = [
  { original: '十三', translated: 'Thập Tam', type: 'name' as const, note: 'Tên nhân vật chính' },
  { original: '青龙', translated: 'Thanh Long', type: 'name' as const, note: 'Thanh Long Tứ Thánh Thú' },
  { original: '陆王子', translated: 'Lục Vương Tử', type: 'title' as const },
  { original: '五行剑法', translated: 'Ngũ Hành Kiếm Pháp', type: 'skill' as const },
  { original: '灵气', translated: 'Linh Khí', type: 'term' as const },
  { original: '境界', translated: 'Cảnh Giới', type: 'term' as const },
];

for (const g of glossary) {
  db.insert(schema.glossary)
    .values({
      id: uuid(),
      movieId,
      original: g.original,
      translated: g.translated,
      type: g.type,
      note: g.note,
    })
    .run();
}

console.log('✓ Seed completed:');
console.log('  Channel:', channelId);
console.log('  Movie:', movieId);
console.log('  Episode:', episodeId);
console.log('  Glossary entries:', glossary.length);

process.exit(0);
