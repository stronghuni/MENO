import { useEffect, useRef } from 'react'

interface Props {
  /** Mic RMS in roughly [0, 1]. Drives the ripple amplitude. */
  level: number
  /** When true the animation freezes into a muted resting state. */
  paused?: boolean
}

/**
 * Canvas-based dot-grid pulse. Two ripple waves travel outward from the
 * center at different frequencies; the live mic level smoothly amplifies
 * both the dot opacity and dot radius. A vignette dims the corners so
 * the eye focuses on the middle. Designed to feel "alive" — even at
 * silence the dots breathe gently; speaking explodes the field with
 * concentric rings that fade outward.
 *
 * Implementation notes:
 *  - requestAnimationFrame for 60fps with negligible CPU
 *  - DevicePixelRatio scaling so retina screens stay sharp
 *  - ResizeObserver to follow flex/grid layout changes
 *  - All Canvas state lives in refs to avoid React re-render storms
 */
export default function WaveformPulse({ level, paused }: Props): React.JSX.Element {
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

    // Pull the accent color from CSS so the canvas matches the theme.
    const styles = getComputedStyle(document.documentElement)
    const parseRgb = (raw: string): [number, number, number] => {
      // Supports "#rrggbb", "rgb(...)", "rgba(...)"
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
    let accent = parseRgb(styles.getPropertyValue('--accent') || '#2563eb')

    let t = 0
    let smoothedLevel = 0
    let raf = 0

    const frame = (): void => {
      // Re-read the accent each frame so a theme toggle is reflected in
      // the next paint without a full canvas teardown.
      accent = parseRgb(getComputedStyle(document.documentElement).getPropertyValue('--accent'))

      ctx.clearRect(0, 0, cssW, cssH)

      // Exponential smoothing — feels organic; spike fast, decay slow.
      const target = pausedRef.current ? 0 : Math.min(1, levelRef.current)
      smoothedLevel = smoothedLevel * 0.85 + target * 0.15

      const spacing = 14
      const cols = Math.max(2, Math.floor(cssW / spacing))
      const rows = Math.max(2, Math.floor(cssH / spacing))
      const offsetX = (cssW - cols * spacing) / 2 + spacing / 2
      const offsetY = (cssH - rows * spacing) / 2 + spacing / 2

      const cx = cols / 2
      const cy = rows / 2
      const maxDist = Math.hypot(cx, cy)

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const dx = c - cx + 0.5
          const dy = r - cy + 0.5
          const dist = Math.hypot(dx, dy)

          // Two outward-traveling ripples at slightly different rates so
          // the field never looks fully periodic. Phase offset gives a
          // sense of layered motion.
          const wave1 = Math.sin(dist * 0.55 - t * 0.05)
          const wave2 = Math.sin(dist * 0.28 - t * 0.028 + 1.6)
          const ripple = wave1 * 0.55 + wave2 * 0.45

          // Vignette so corners are subtler than the middle.
          const vignette = Math.max(0, 1 - (dist / maxDist) * 0.85)

          // Baseline keeps the dot visible even at total silence; the
          // level term explodes it during speech. Squaring smoothedLevel
          // gives a more reactive feel to louder sounds.
          const intensity = ((ripple + 1) / 2) * vignette
          const energy = (smoothedLevel * smoothedLevel) * 6
          const alpha = pausedRef.current
            ? 0.06 * vignette
            : Math.min(1, 0.08 * vignette + intensity * (0.18 + energy))

          // Radius pulses with the same energy, so loud moments expand
          // the dots into soft blobs.
          const baseR = 1.4
          const radius = pausedRef.current
            ? baseR
            : baseR + intensity * (0.6 + energy * 1.2)

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
  }, [])

  return (
    <div ref={containerRef} className="waveform-pulse">
      <canvas ref={canvasRef} />
    </div>
  )
}
