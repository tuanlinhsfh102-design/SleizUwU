# @sleiz/capcut-stt

CapCut Speech-to-Text integration for Sleiz Studio.

## Features

- Convert audio/video files to SRT subtitles using CapCut's STT API
- Support multiple languages (Vietnamese, Chinese, English, etc.)
- Automatic polling for task completion
- TypeScript wrapper around Python implementation

## Installation

1. Ensure Python 3.9+ is installed and in PATH
2. Install Python dependencies:

```bash
cd packages/capcut-stt/python
pip install -r requirements.txt
```

## Usage

### TypeScript/Bun

```typescript
import { transcribeAudioToSRT } from '@sleiz/capcut-stt';

const result = await transcribeAudioToSRT(
  '/path/to/audio.mp3',
  'vi-VN',  // Vietnamese
  true      // Wait for completion
);

console.log(result.srt);  // SRT subtitle content
```

### Python CLI

```bash
# Transcribe audio to SRT
python packages/capcut-stt/python/capcut_stt_wrapper.py transcribe audio.mp3 vi-VN

# Query task status
python packages/capcut-stt/python/capcut_stt_wrapper.py query <task_id> <token>
```

## Supported Languages

- `vi-VN` - Vietnamese
- `zh-CN` - Chinese (Simplified)
- `zh-TW` - Chinese (Traditional)
- `en-US` - English (US)
- `ja-JP` - Japanese
- `ko-KR` - Korean
- And more...

## How It Works

1. Upload audio/video file to CapCut VOD storage
2. Create STT (Speech Recognition) task
3. Poll task status until completion
4. Extract and format subtitles as SRT

## API Reference

### `transcribeAudioToSRT(audioPath, language, wait)`

Convert audio/video to SRT subtitles.

**Parameters:**
- `audioPath`: Path to audio/video file
- `language`: Language code (default: 'vi-VN')
- `wait`: Wait for completion (default: true)

**Returns:** `TranscribeResult` with SRT content

### `querySTTTask(taskId, token)`

Query STT task status.

**Parameters:**
- `taskId`: Task ID from transcribe call
- `token`: Token from transcribe call

**Returns:** `QueryResult` with current status

### `checkPythonAvailability()`

Check if Python is available.

**Returns:** Object with availability status and version
