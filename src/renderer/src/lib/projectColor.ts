import type { Project } from '../../../shared/types'

/**
 * Deterministic project color. Uses the project's explicit color when set,
 * otherwise derives a stable HSL hue from its id. Hash-based generation
 * means an unlimited number of projects each get a consistent color across
 * the app (calendar, graph) without a fixed palette running out.
 *
 * Fixed saturation/lightness keep contrast reasonable on both light and
 * dark themes; color-mix() tints handle the soft-background variants.
 */
function hashHue(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % 360
}

export const NO_PROJECT_COLOR = '#8a8f98'

export function projectColor(p: Pick<Project, 'id' | 'color'> | null | undefined): string {
  if (!p) return NO_PROJECT_COLOR
  if (p.color) return p.color
  return `hsl(${hashHue(p.id)} 60% 50%)`
}
