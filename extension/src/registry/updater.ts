import * as vscode from 'vscode'
import { getUpdateInterval } from '../config'

export function startUpdateChecker(
  callback: () => Promise<void>
): vscode.Disposable {
  const intervalMs = getUpdateInterval() * 60 * 1000
  const timer = setInterval(() => {
    callback().catch((err) => console.error('Update check failed:', err))
  }, intervalMs)

  // Run once on startup after a short delay
  setTimeout(() => {
    callback().catch((err) => console.error('Initial update check failed:', err))
  }, 5000)

  return {
    dispose: () => clearInterval(timer),
  }
}
