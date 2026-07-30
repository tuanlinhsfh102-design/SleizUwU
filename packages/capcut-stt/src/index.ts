/**
 * @sleiz/capcut-stt - CapCut Speech-to-Text integration
 *
 * Wrapper around Python capcut-tts-api for audio/video transcription.
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnPython, PYTHON_BINARIES } from './python.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface TranscribeResult {
  task_id: string;
  token: string;
  vid: string;
  status: 'processing' | 'completed' | 'failed';
  srt?: string;
  utterances?: Array<{
    start_time: number;
    end_time: number;
    text: string;
    words?: Array<{
      word: string;
      start_time: number;
      end_time: number;
    }>;
  }>;
  duration_ms?: number;
  error?: string;
}

export interface QueryResult {
  task_id: string;
  status: 'processing' | 'completed' | 'failed';
  srt?: string;
  utterances?: TranscribeResult['utterances'];
  duration_ms?: number;
  error?: string;
}

/**
 * Run the CapCut STT Python wrapper and accumulate its output.
 * Resolves with the parsed JSON result, rejects with a descriptive error
 * (including which Python binary was attempted).
 */
function runPythonScript(
  script: string,
  args: readonly string[],
  opName: string
): Promise<string> {
  return new Promise(async (resolve, reject) => {
    let child;
    try {
      const spawned = await spawnPython([script, ...args], {
        onFallback: (tried, err) => {
          console.warn(
            `[CapCut STT] '${tried}' not found (${err.code ?? err.message}), trying next...`
          );
        },
      });
      child = spawned.process;
    } catch (err) {
      reject(
        new Error(
          `${opName} failed: ${(err as Error).message} (tried ${PYTHON_BINARIES.join(', ')})`
        )
      );
      return;
    }

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;
      // Log progress messages from Python
      if (stderr.includes('[CapCut STT]')) {
        console.log(chunk.trim());
      }
    });

    child.on('close', (code) => {
      if (code !== 0) {
        const errorMsg = stderr || stdout || 'Python process failed';
        reject(new Error(`${opName} failed: ${errorMsg}`));
        return;
      }
      resolve(stdout);
    });

    child.on('error', (err) => {
      reject(new Error(`${opName} failed: ${err.message}`));
    });
  });
}

/**
 * Convert audio/video file to SRT subtitles using CapCut STT API.
 *
 * @param audioPath - Path to audio/video file
 * @param language - Language code (default: vi-VN for Vietnamese)
 * @param wait - Wait for completion (default: true)
 * @returns Transcription result with SRT content
 */
export async function transcribeAudioToSRT(
  audioPath: string,
  language: string = 'vi-VN',
  wait: boolean = true
): Promise<TranscribeResult> {
  const pythonScript = join(__dirname, '..', 'python', 'capcut_stt_wrapper.py');
  const stdout = await runPythonScript(
    pythonScript,
    ['transcribe', audioPath, language],
    'CapCut STT'
  );
  try {
    return JSON.parse(stdout) as TranscribeResult;
  } catch (err) {
    throw new Error(`Failed to parse STT result: ${err}`);
  }
}

/**
 * Query the status of an STT task.
 *
 * @param taskId - Task ID from transcribe call
 * @param token - Token from transcribe call
 * @returns Task status and result (if completed)
 */
export async function querySTTTask(
  taskId: string,
  token: string
): Promise<QueryResult> {
  const pythonScript = join(__dirname, '..', 'python', 'capcut_stt_wrapper.py');
  const stdout = await runPythonScript(
    pythonScript,
    ['query', taskId, token],
    'Query STT'
  );
  try {
    return JSON.parse(stdout) as QueryResult;
  } catch (err) {
    throw new Error(`Failed to parse query result: ${err}`);
  }
}

/**
 * Check if Python and required dependencies are available.
 */
export async function checkPythonAvailability(): Promise<{
  available: boolean;
  version?: string;
  error?: string;
}> {
  try {
    const { binary, process: child } = await spawnPython(['--version'], {
      onFallback: (tried) => {
        console.warn(`[CapCut STT] '${tried}' not found, trying next...`);
      },
    });

    let output = '';

    child.stdout?.on('data', (data: Buffer) => {
      output += data.toString();
    });
    child.stderr?.on('data', (data: Buffer) => {
      output += data.toString();
    });

    return await new Promise((resolve) => {
      child.on('close', (code) => {
        if (code === 0) {
          resolve({
            available: true,
            version: `${output.trim()} (via ${binary})`,
          });
        } else {
          resolve({
            available: false,
            error: `Python (${binary}) exited with code ${code}: ${output.trim()}`,
          });
        }
      });
      child.on('error', (err) => {
        resolve({
          available: false,
          error: `Failed to spawn ${binary}: ${err.message}`,
        });
      });
    });
  } catch (err) {
    return {
      available: false,
      error: (err as Error).message,
    };
  }
}
