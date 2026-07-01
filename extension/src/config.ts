import * as vscode from 'vscode'
import type { Registry } from './types'

export function getRegistries(): Registry[] {
  return vscode.workspace.getConfiguration('toolhub').get<Registry[]>('registries', [])
}

export function getUpdateInterval(): number {
  return vscode.workspace.getConfiguration('toolhub').get<number>('updateInterval', 360)
}

export function getAutoUpdate(): boolean {
  return vscode.workspace.getConfiguration('toolhub').get<boolean>('autoUpdate', false)
}
