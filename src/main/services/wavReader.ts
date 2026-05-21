import { readFile } from 'fs/promises'

export interface WavData {
  sampleRate: number
  channels: number
  bitsPerSample: number
  pcm: Float32Array
}

/**
 * Minimal WAV reader for 16-bit PCM mono WAV files written by WavWriter.
 * Returns Float32Array in [-1, 1] range, suitable for Whisper.
 */
export async function readWav(path: string): Promise<WavData> {
  const buf = await readFile(path)
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error(`Not a RIFF file: ${path}`)
  }
  if (buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`Not a WAVE file: ${path}`)
  }

  let offset = 12
  let fmt: {
    channels: number
    sampleRate: number
    bitsPerSample: number
    audioFormat: number
  } | null = null
  let pcmBytes: Buffer | null = null

  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    const dataStart = offset + 8
    if (id === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(dataStart),
        channels: buf.readUInt16LE(dataStart + 2),
        sampleRate: buf.readUInt32LE(dataStart + 4),
        bitsPerSample: buf.readUInt16LE(dataStart + 14)
      }
    } else if (id === 'data') {
      pcmBytes = buf.subarray(dataStart, dataStart + size)
    }
    offset = dataStart + size + (size % 2)
  }

  if (!fmt) throw new Error('Missing fmt chunk')
  if (!pcmBytes) throw new Error('Missing data chunk')
  if (fmt.audioFormat !== 1) throw new Error(`Unsupported audio format: ${fmt.audioFormat}`)
  if (fmt.bitsPerSample !== 16) {
    throw new Error(`Unsupported bits/sample: ${fmt.bitsPerSample}`)
  }

  const samples = pcmBytes.length / 2 / fmt.channels
  const pcm = new Float32Array(samples)
  if (fmt.channels === 1) {
    for (let i = 0; i < samples; i++) {
      pcm[i] = pcmBytes.readInt16LE(i * 2) / 0x8000
    }
  } else {
    // Mixdown to mono by averaging channels.
    for (let i = 0; i < samples; i++) {
      let sum = 0
      for (let c = 0; c < fmt.channels; c++) {
        sum += pcmBytes.readInt16LE((i * fmt.channels + c) * 2) / 0x8000
      }
      pcm[i] = sum / fmt.channels
    }
  }

  return {
    sampleRate: fmt.sampleRate,
    channels: fmt.channels,
    bitsPerSample: fmt.bitsPerSample,
    pcm
  }
}
