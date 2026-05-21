import { useEffect, useRef } from 'react'

interface Props {
  level: number
  active: boolean
  bars?: number
}

/**
 * Lightweight rolling level meter. Pushes the current RMS into a small ring
 * buffer on every paint and renders bars from oldest (left) to newest (right).
 */
export default function LevelMeter({ level, active, bars = 28 }: Props): React.JSX.Element {
  const historyRef = useRef<number[]>(new Array(bars).fill(0))

  useEffect(() => {
    if (!active) {
      historyRef.current = new Array(bars).fill(0)
    }
  }, [active, bars])

  if (active) {
    historyRef.current.push(Math.min(1, level * 4))
    if (historyRef.current.length > bars) historyRef.current.shift()
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'end',
        gap: 3,
        height: 36
      }}
      aria-hidden
    >
      {historyRef.current.map((v, i) => (
        <div
          key={i}
          style={{
            width: 3,
            height: `${Math.max(8, v * 100)}%`,
            background: active ? 'var(--accent)' : 'var(--border-strong)',
            borderRadius: 2,
            transition: 'height 80ms linear'
          }}
        />
      ))}
    </div>
  )
}
