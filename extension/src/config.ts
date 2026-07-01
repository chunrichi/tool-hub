import * as vscode from 'vscode'
import type { Registry } from './types'

const REGISTRIES_KEY = 'toolhub.registries'

let _context: vscode.ExtensionContext

export function setExtensionContext(ctx: vscode.ExtensionContext): void {
  _context = ctx
}

export function getRegistries(): Registry[] {
  // Try globalState first (primary storage)
  if (_context) {
    const stored = _context.globalState.get<Registry[]>(REGISTRIES_KEY)
    if (stored && stored.length > 0) return stored
  }
  // Fallback to workspace settings
  return vscode.workspace.getConfiguration('toolhub').get<Registry[]>('registries', [])
}

export async function saveRegistries(registries: Registry[]): Promise<void> {
  if (_context) {
    await _context.globalState.update(REGISTRIES_KEY, registries)
  }
}

export function getUpdateInterval(): number {
  return vscode.workspace.getConfiguration('toolhub').get<number>('updateInterval', 360)
}

export function getAutoUpdate(): boolean {
  return vscode.workspace.getConfiguration('toolhub').get<boolean>('autoUpdate', false)
}
