/**
 * Theme management. Default mode is "auto" (follows OS prefers-color-scheme
 * via plain CSS). When the user explicitly toggles, we set the `theme-light`
 * or `theme-dark` class on <html> to override the media-query rules and
 * persist the choice via the settings IPC so the next app launch starts in
 * the picked mode.
 */
import type { ThemeMode } from '../../../shared/types'

const HTML_CLASSES = ['theme-light', 'theme-dark'] as const

export function applyTheme(mode: ThemeMode): void {
  const html = document.documentElement
  html.classList.remove(...HTML_CLASSES)
  if (mode === 'light') html.classList.add('theme-light')
  else if (mode === 'dark') html.classList.add('theme-dark')
  // 'auto' leaves both classes off so prefers-color-scheme drives it.
}

export function resolveEffective(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}
