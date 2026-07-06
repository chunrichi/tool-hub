import * as vscode from 'vscode'
import { SidebarView } from './views/sidebarView'
import { StatusBarManager } from './views/statusBar'
import { loadResources, refreshUpdateStatus } from './registry/manager'
import { startUpdateChecker } from './registry/updater'
import { getRegistries, setExtensionContext } from './config'
import { initLogger, log } from './utils/logger'
import { registerCommands } from './commands'
import type { ResourceItem } from './types'

let outputChannel: vscode.OutputChannel

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('ToolHub')
  initLogger(outputChannel)
  context.subscriptions.push(outputChannel)
  log('[activate] Extension activating...')

  try {
    doActivate(context)
    log('[activate] Extension activated successfully')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log(`[activate] FATAL ERROR: ${msg}`)
    vscode.window.showErrorMessage(`ToolHub activation failed: ${msg}`)
  }
}

function doActivate(context: vscode.ExtensionContext) {
  setExtensionContext(context)
  const statusBar = new StatusBarManager()

  // Register WebviewViewProvider for sidebar
  const sidebarView = new SidebarView(context.extensionUri)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarView.viewType, sidebarView, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  )

  // Shared item storage for commands
  let currentItems: ResourceItem[] = []

  async function refreshAll(): Promise<void> {
    const registries = getRegistries()
    log(`[refreshAll] Found ${registries.length} registries`)
    if (registries.length === 0) {
      sidebarView.setItems([])
      statusBar.hide()
      return
    }

    statusBar.showProgress('Loading catalog...')
    try {
      currentItems = await loadResources()
      const updateCount = await refreshUpdateStatus(currentItems)

      sidebarView.setItems(currentItems)
      statusBar.showUpdateCount(updateCount)
    } catch (err) {
      statusBar.hide()
      vscode.window.showErrorMessage(`ToolHub: Failed to load catalog: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // Register all commands
  registerCommands(context, sidebarView, statusBar, () => currentItems, refreshAll)

  // Start background update checker
  startUpdateChecker(async () => {
    await refreshAll()
  })

  // Initial load
  refreshAll()
}

export function deactivate() {}
