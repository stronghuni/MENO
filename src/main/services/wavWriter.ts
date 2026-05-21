import { createWriteStream, WriteStream } from 'fs'
import { open, FileHandle } from 'fs/promises'

/**
 * 16-bit PCM mono WAV writer. We don't know the total size up front because
 * recording length is variable, so we write a placeholder RIFF header,
 * append raw PCM samples as they arrive, and patch the size fields on close.
 */
export class WavWriter {
  private stream: WriteStream
  private path: string
  private sampleRate: number
  private bytesWritten = 0
  private closed = false

  constructor(path: string, sampleRate: number) {
    this.path = path
    this.sampleRate = sampleRate
    this.stream = createWriteStream(path)
    this.stream.write(this.buildHeader(0))
  }

  appendPcm(float32: Float32Array): void {
    if (this.closed) throw new Error('WavWriter already closed')
    const int16 = new Int16Array(float32.length)
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]))
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
    const buf = Buffer.from(int16.buffer, int16.byteOffset, int16.byteLength)
    this.stream.write(buf)
    this.bytesWritten += buf.length
  }

  async close(): Promise<{ path: string; durationMs: number; bytes: number }> {
    if (this.closed) throw new Error('WavWriter already closed')
    this.closed = true
    await new Promise<void>((resolve, reject) => {
      this.stream.end((err: Error | null | undefined) => (err ? reject(err) : resolve()))
    })
    await this.patchHeader()
    const durationMs = Math.round((this.bytesWritten / 2 / this.sampleRate) * 1000)
    return { path: this.path, durationMs, bytes: this.bytesWritten }
  }

  private async patchHeader(): Promise<void> {
    let fh: FileHandle | null = null
    try {
      fh = await open(this.path, 'r+')
      const header = this.buildHeader(this.bytesWritten)
      await fh.write(header, 0, header.length, 0)
    } finally {
      if (fh) await fh.close()
    }
  }

  private buildHeader(dataLen: number): Buffer {
    const numChannels = 1
    const bitsPerSample = 16
    const byteRate = this.sampleRate * numChannels * (bitsPerSample / 8)
    const blockAlign = numChannels * (bitsPerSample / 8)
    const chunkSize = 36 + dataLen

    const b = Buffer.alloc(44)
    b.write('RIFF', 0)
    b.writeUInt32LE(chunkSize, 4)
    b.write('WAVE', 8)
    b.write('fmt ', 12)
    b.writeUInt32LE(16, 16) // PCM subchunk size
    b.writeUInt16LE(1, 20) // PCM format
    b.writeUInt16LE(numChannels, 22)
    b.writeUInt32LE(this.sampleRate, 24)
    b.writeUInt32LE(byteRate, 28)
    b.writeUInt16LE(blockAlign, 32)
    b.writeUInt16LE(bitsPerSample, 34)
    b.write('data', 36)
    b.writeUInt32LE(dataLen, 40)
    return b
  }
}
