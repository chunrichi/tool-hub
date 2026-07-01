import * as vscode from 'vscode'
import type { ResourceItem } from './types'

const STATUS_BADGES: Record<string, { badge: string; color: string; tooltip: string }> = {
  installed: { badge: '\u2713', color: 'testing.iconPassed', tooltip: 'Installed - up to date' },
  updatable: { badge: '\u2191', color: 'testing.iconQueued', tooltip: 'Update available' },
}

export class ToolHubDecorationProvider implements vscode.FileDecorationProvider {
  private _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[]>()
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event

  private statusMap = new Map<string, string>()

  updateStatus(key: string, status: string): void {
    this.statusMap.set(key, status)
  }

  refreshAll(): void {
    this._onDidChangeFileDecorations.fire([])
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== 'toolhub') return undefined

    const status = this.statusMap.get(uri.toString())
    if (!status) return undefined

    const config = STATUS_BADGES[status]
    if (!config) return undefined

    return new vscode.FileDecoration(
      config.badge,
      config.tooltip,
      new vscode.ThemeColor(config.color)
    )
  }
}

export function makeResourceUri(item: ResourceItem): vscode.Uri {
  return vscode.Uri.parse(`toolhub://${item.meta.type}/${item.meta.name}/${item.status}`)
}
