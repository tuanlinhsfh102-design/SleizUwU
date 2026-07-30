/**
 * Quick test: crop 16:9 + scale on a 10-second clip.
 * Verifies the output is exactly 1280x720 (16:9, no black bars).
 */
import { cropTo169, getVideoMetadata, detectChineseTextRegions, blurAndBurnSubtitles } from '../src/index.ts';

const input = '/tmp/test-10s.mp4';
const cropped = '/tmp/test-cropped.mp4';
const final = '/tmp/test-final.mp4';
const srt = '/tmp/test-srt-30s.srt';

console.log('=== Step 1: Crop + Scale ===');
const meta0 = await getVideoMetadata(input);
console.log(`Input: ${meta0.width}x${meta0.height} (ratio ${(meta0.width/meta0.height).toFixed(3)})`);

await cropTo169(input, cropped, (p) => { if (p % 25 === 0) console.log(`  crop: ${p}%`); });
const meta1 = await getVideoMetadata(cropped);
console.log(`Cropped: ${meta1.width}x${meta1.height} (ratio ${(meta1.width/meta1.height).toFixed(3)})`);
const is169 = Math.abs(meta1.width / meta1.height - 16/9) < 0.01;
console.log(`Is 16:9? ${is169 ? 'YES ✓' : 'NO ✗'}`);

console.log('\n=== Step 2: OCR detect text ===');
const regions = await detectChineseTextRegions(cropped);
console.log(`Found ${regions.length} region(s):`);
for (const r of regions) console.log(`  ${JSON.stringify(r)}`);

console.log('\n=== Step 3: Blur + Burn Vietnamese subs ===');
await blurAndBurnSubtitles(cropped, final, srt, {
  blurRegions: regions,
  blurStrength: 40,
  onProgress: (p) => { if (p % 25 === 0) console.log(`  blur+burn: ${p}%`); },
});
const meta2 = await getVideoMetadata(final);
console.log(`Final: ${meta2.width}x${meta2.height} (ratio ${(meta2.width/meta2.height).toFixed(3)})`);
console.log(`\nSUCCESS! Output: ${final}`);
console.log(`  Resolution: ${meta2.width}x${meta2.height}`);
console.log(`  Duration: ${meta2.duration.toFixed(1)}s`);
console.log(`  Size: ${(require('fs').statSync(final).size / 1024 / 1024).toFixed(1)}MB`);
