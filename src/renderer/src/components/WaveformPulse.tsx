import { useEffect, useRef } from 'react'

interface Props {
  /** Mic RMS in roughly [0, 1]. Drives the ambient ripple amplitude. */
  level: number
  /** Live FFT analyser. When provided, each column of dots reacts to its
   *  frequency bin — gives the visual a music-visualizer character on
   *  top of the ambient ripple. */
  analyserRef?: React.MutableRefObject<AnalyserNode | null>
  /** When true the animation freezes into a muted resting state. */
  paused?: boolean
}

/**
 * Canvas dot-grid visualizer for the recording stage.
 *
 * Two layers of motion combine into a single field of dots:
 *  1. **Ambient ripple** — concentric waves traveling outward from the
 *     center, modulated by the smoothed mic RMS. Keeps the field alive
 *     even during quiet moments.
 *  2. **Spectrum column** — each column of dots maps to one FFT
 *     frequency bin. Louder bins produce brighter, larger dots in their
 *     column. Vertical falloff is centered so spikes glow outward.
 */
export default function WaveformPulse({
  level,
  analyserRef,
  paused
}: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const levelRef = useRef(level)
  levelRef.current = level
  const pausedRef = useRef(!!paused)
  pausedRef.current = !!paused

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    let dpr = window.devicePixelRatio || 1
    let cssW = 0
    let cssH = 0

    const resize = (): void => {
      const rect = container.getBoundingClientRect()
      cssW = rect.width
      cssH = rect.height
      dpr = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.floor(cssW * dpr))
      canvas.height = Math.max(1, Math.floor(cssH * dpr))
      canvas.style.width = `${cssW}px`
      canvas.style.height = `${cssH}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(container)

    const parseRgb = (raw: string): [number, number, number] => {
      const trimmed = raw.trim()
      if (trimmed.startsWith('#')) {
        const v = trimmed.slice(1)
        return [
          parseInt(v.slice(0, 2), 16),
          parseInt(v.slice(2, 4), 16),
          parseInt(v.slice(4, 6), 16)
        ]
      }
      const m = trimmed.match(/(\d+(?:\.\d+)?)/g)
      if (!m || m.length < 3) return [96, 165, 250]
      return [Number(m[0]), Number(m[1]), Number(m[2])]
    }

    let t = 0
    let smoothedLevel = 0
    let raf = 0

    // FFT working buffers — sized lazily once an analyser is attached.
    // Typed against ArrayBuffer specifically because getByteFrequencyData
    // refuses Uint8Array<ArrayBufferLike> in TS 5.7+.
    let freqBytes: Uint8Array<ArrayBuffer> | null = null
    let columnEnergy = new Float32Array(0)

    const frame = (): void => {
      const root = document.documentElement
      const accent = parseRgb(getComputedStyle(root).getPropertyValue('--accent'))

      ctx.clearRect(0, 0, cssW, cssH)

      // Asymmetric attack/decay — speech onset rises fast (~80ms), tail
      // decays slowly so the field still glows during pauses.
      const target = pausedRef.current ? 0 : Math.min(1, levelRef.current)
      const k = target > smoothedLevel ? 0.35 : 0.08
      smoothedLevel = smoothedLevel * (1 - k) + target * k

      const spacing = 14
      const cols = Math.max(2, Math.floor(cssW / spacing))
      const rows = Math.max(2, Math.floor(cssH / spacing))
      const offsetX = (cssW - cols * spacing) / 2 + spacing / 2
      const offsetY = (cssH - rows * spacing) / 2 + spacing / 2

      const cx = cols / 2
      const cy = rows / 2
      const maxDist = Math.hypot(cx, cy)

      // Read FFT into our buffer if an analyser is attached. Aggregate
      // 128 bins into `cols` columns (averaged within each column's
      // bin range). Per-column smoothing gives the bars a tactile feel.
      const analyser = analyserRef?.current ?? null
      let useSpectrum = false
      if (analyser && !pausedRef.current) {
        if (!freqBytes || freqBytes.length !== analyser.frequencyBinCount) {
          freqBytes = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount))
        }
        if (columnEnergy.length !== cols) {
          columnEnergy = new Float32Array(cols)
        }
        analyser.getByteFrequencyData(freqBytes)
        const binsPerCol = freqBytes.length / cols
        for (let c = 0; c < cols; c++) {
          // Log-ish skew so each column covers more high frequencies
          // as you move right (voice content sits in the lower bins).
          const t01 = c / Math.max(1, cols - 1)
          const skewed = Math.pow(t01, 1.4)
          const startBin = Math.floor(skewed * (freqBytes.length - binsPerCol))
          const endBin = Math.min(freqBytes.length, startBin + Math.ceil(binsPerCol))
          let sum = 0
          for (let b = startBin; b < endBin; b++) sum += freqBytes[b]
          const avg = sum / Math.max(1, endBin - startBin) / 255 // 0..1
          const prev = columnEnergy[c]
          const ck = avg > prev ? 0.5 : 0.12
          columnEnergy[c] = prev * (1 - ck) + avg * ck
        }
        useSpectrum = true
      } else if (columnEnergy.length > 0) {
        for (let c = 0; c < columnEnergy.length; c++) columnEnergy[c] *= 0.9
      }

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const dx = c - cx + 0.5
          const dy = r - cy + 0.5
          const dist = Math.hypot(dx, dy)

          // Layer 1 — concentric ripples.
          const wave1 = Math.sin(dist * 0.55 - t * 0.05)
          const wave2 = Math.sin(dist * 0.28 - t * 0.028 + 1.6)
          const ripple = wave1 * 0.55 + wave2 * 0.45

          const vignette = Math.max(0, 1 - (dist / maxDist) * 0.85)
          const intensity = ((ripple + 1) / 2) * vignette
          const energy = smoothedLevel * smoothedLevel * 6

          // Layer 2 — spectrum column with vertical Gaussian falloff
          // around mid-height so spikes glow outward horizontally.
          let spectrum = 0
          if (useSpectrum) {
            const colAmp = columnEnergy[c]
            const rowFromCenter = Math.abs(r - cy + 0.5) / (rows / 2)
            const verticalFalloff = Math.exp(-(rowFromCenter * rowFromCenter) * 2.5)
            spectrum = colAmp * verticalFalloff
          }

          const ambientAlpha = 0.06 * vignette + intensity * (0.16 + energy * 0.6)
          const spectrumAlpha = spectrum * 0.95
          const alpha = pausedRef.current
            ? 0.06 * vignette
            : Math.min(1, ambientAlpha + spectrumAlpha)

          const baseR = 1.35
          const radius = pausedRef.current
            ? baseR
            : baseR + intensity * (0.5 + energy * 0.9) + spectrum * 2.1

          ctx.beginPath()
          ctx.fillStyle = pausedRef.current
            ? `rgba(180, 180, 184, ${alpha})`
            : `rgba(${accent[0]}, ${accent[1]}, ${accent[2]}, ${alpha})`
          ctx.arc(offsetX + c * spacing, offsetY + r * spacing, radius, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      t += 1
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [analyserRef])

  return (
    <div ref={containerRef} className="waveform-pulse">
      <canvas ref={canvasRef} />
    </div>
  )
}
