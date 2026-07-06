import type { ContentType } from '../types'

// ── SVG icon path data (shared across views) ──────────────
const ICON_PATHS: Record<ContentType, string> = {
  extension:
    '<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>',
  skill:
    '<path d="M12 2a7 7 0 0 1 7 7c0 2.5-1.5 4.5-3 6s-2 3-2 5h-4c0-2-.5-3.5-2-5s-3-3.5-3-6a7 7 0 0 1 7-7z"/><line x1="9" y1="18" x2="15" y2="18"/><line x1="10" y1="22" x2="14" y2="22"/>',
  agent:
    '<rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/>',
  instruction:
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
}

/** Generate an SVG icon string at the given size */
function makeSvg(size: number): Record<ContentType, string> {
  const extra = 'stroke-linecap="round" stroke-linejoin="round"'
  return {
    extension: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" ${extra}>${ICON_PATHS.extension}</svg>`,
    skill: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" ${extra}>${ICON_PATHS.skill}</svg>`,
    agent: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" ${extra}>${ICON_PATHS.agent}</svg>`,
    instruction: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" ${extra}>${ICON_PATHS.instruction}</svg>`,
  }
}

/** SVG icons sized for sidebar list (48px) */
export const TYPE_ICONS_48 = makeSvg(48)

/** SVG icons sized for detail page (64px) */
export const TYPE_ICONS_64 = makeSvg(64)

export const TYPE_COLORS: Record<ContentType, string> = {
  extension: '#007acc',
  skill: '#cca700',
  agent: '#4ec9b0',
  instruction: '#b180d7',
}

export const TYPE_LABELS: Record<ContentType, string> = {
  extension: 'Extension',
  skill: 'Skill',
  agent: 'Agent',
  instruction: 'Instruction',
}

/** Escape HTML special characters */
export function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Generate a CSP nonce */
export function getNonce(): string {
  let text = ''
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return text
}

/** Render star rating string (filled/empty) */
export function renderStars(avg: number): string {
  let stars = ''
  for (let i = 1; i <= 5; i++) {
    stars += i <= Math.round(avg) ? '\u2605' : '\u2606'
  }
  return stars
}
