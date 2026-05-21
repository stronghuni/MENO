import { ChangeEvent, KeyboardEvent, useState } from 'react'

interface Props {
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
}

/**
 * Chip-style multi-value input.
 *
 * Why we detect commas in the value (onChange) rather than on keydown:
 * Korean IME finishes the in-progress syllable composition only when the
 * next non-Korean character arrives. With a keydown('comma') handler, the
 * React state still held the pre-composition text — committing it as a
 * chip while the IME-finalized final syllable + comma got pushed into the
 * DOM by the input event right after. Result: an orphan "태," would
 * remain in the input after the chip was created.
 *
 * Watching the post-IME value for commas dodges the race entirely: by
 * the time onChange fires, the full composed string ("김기태,") is in
 * `e.target.value`, and we just split on commas.
 */
export default function AttendeesInput({
  value,
  onChange,
  placeholder
}: Props): React.JSX.Element {
  const [text, setText] = useState('')

  const handleInput = (e: ChangeEvent<HTMLInputElement>): void => {
    const v = e.target.value
    if (!v.includes(',')) {
      setText(v)
      return
    }
    // One or more chips' worth of input arrived; split on every comma.
    // Everything before the trailing comma becomes chips; anything typed
    // after the last comma (rare but possible if pasted) stays as the
    // editable tail.
    const parts = v.split(',')
    const tail = parts.pop() ?? ''
    const newChips: string[] = []
    for (const part of parts) {
      const t = part.trim()
      if (!t) continue
      if (value.includes(t) || newChips.includes(t)) continue
      newChips.push(t)
    }
    if (newChips.length > 0) onChange([...value, ...newChips])
    setText(tail.trim())
  }

  const handleKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const t = text.trim()
      if (t && !value.includes(t)) onChange([...value, t])
      setText('')
    } else if (e.key === 'Backspace' && !text && value.length > 0) {
      onChange(value.slice(0, -1))
    }
  }

  const handleBlur = (): void => {
    const t = text.trim()
    if (t && !value.includes(t)) onChange([...value, t])
    setText('')
  }

  return (
    <div className="chip-input">
      {value.map((v, i) => (
        <span key={`${v}-${i}`} className="chip">
          {v}
          <button
            type="button"
            className="chip-remove"
            onClick={() => onChange(value.filter((_, idx) => idx !== i))}
            aria-label={`${v} 제거`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="chip-input-field"
        value={text}
        onChange={handleInput}
        onKeyDown={handleKey}
        onBlur={handleBlur}
        placeholder={value.length === 0 ? (placeholder ?? '') : ''}
      />
    </div>
  )
}
