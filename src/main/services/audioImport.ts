import { spawn } from 'node:child_process'
import { statSync, existsSync } from 'node:fs'
import { extname } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'

/**
 * Decode an arbitrary audio/video file into the 16 kHz mono 16-bit PCM WAV
 * that Whisper expects, in one ffmpeg pass. Inputs we care about:
 * mp3, wav, m4a, aac, ogg, flac, opus, mp4, mov, avi, mkv, webm.
 *
 * The bundled ffmpeg binary ships via `ffmpeg-static`. In production the
 * binary must be unpacked from the asar archive (see electron-builder
 * `asarUnpack`), and the resolved path is patched to point at the unpacked
 * location.
 */

export const ACCEPTED_EXTENSIONS = [
  'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus', 'wma',
  'mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', 'mpg', 'mpeg'
]

const ACCEPTED_SET = new Set(ACCEPTED_EXTENSIONS.map((e) => '.' + e))

export function isAcceptedFile(path: string): boolean {
  return ACCEPTED_SET.has(extname(path).toLowerCase())
}

function resolveFfmpegPath(): string {
  // ffmpeg-static resolves to a path inside node_modules at build time. In an
  // asar-packed Electron app the file is read-only — we asarUnpack the
  // package so the binary stays executable on disk under app.asar.unpacked.
  const raw = ffmpegStatic as unknown as string | null
  if (!raw) throw new Error('ffmpeg binary path not available — ffmpeg-static failed to resolve')
  return raw.replace('app.asar', 'app.asar.unpacked')
}

/**
 * Convert any supported audio/video file to 16 kHz mono 16-bit WAV at
 * {@link outputPath}. Resolves to the duration in milliseconds (derived from
 * the resulting WAV file size — exact, no probe step needed).
 *
 * Throws with the trailing ffmpeg stderr lines if conversion fails so the UI
 * can surface a useful error.
 */
export async function convertToWav(
  inputPath: string,
  outputPath: string
): Promise<{ durationMs: number }> {
  if (!existsSync(inputPath)) throw new Error(`Input file not found: ${inputPath}`)
  const ffmpeg = resolveFfmpegPath()
  await new Promise<void>((resolve, reject) => {
    // -vn = drop any video stream (video files); -ar = sample rate;
    // -ac 1 = mono; -c:a pcm_s16le = 16-bit little-endian PCM (Whisper's
    // expected raw format); -y = overwrite output if it exists.
    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-i', inputPath,
      '-vn',
      '-ar', '16000',
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      outputPath
    ]
    const proc = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
      // Hard cap to avoid blowing up memory on a noisy decoder.
      if (stderr.length > 16_000) stderr = stderr.slice(-16_000)
    })
    proc.on('error', (e) => reject(e))
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.trim() || '(no stderr)'}`))
    })
  })

  if (!existsSync(outputPath)) {
    throw new Error('ffmpeg ran but no output file appeared')
  }
  const size = statSync(outputPath).size
  // WAV is 44-byte header + 2 bytes per sample at 16 kHz mono.
  const sampleCount = Math.max(0, (size - 44) / 2)
  const durationMs = Math.round((sampleCount / 16000) * 1000)
  return { durationMs }
}
