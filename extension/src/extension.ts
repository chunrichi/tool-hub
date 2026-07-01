import * as vscode from 'vscode'
import { SidebarView } from './sidebarView'
import { DetailView } from './detailView'
import { PublishView } from './publishView'
import { RegistryView } from './registryView'
import { StatusBarManager } from './statusBar'
import { loadResources, refreshUpdateStatus, installResource, uninstallResource, type InstallScope } from './manager'
import { startUpdateChecker } from './updater'
import { getRegistries, setExtensionContext } from './config'
import { initLogger, log } from './logger'
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

  function findItem(id: string): ResourceItem | undefined {
    return currentItems.find((i) => i.meta.name === id)
  }

  // ── Commands ──────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('toolhub.refresh', () => refreshAll())
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('toolhub.filter', async () => {
      const input = vscode.window.createInputBox()
      input.title = 'Search ToolHub'
      input.placeholder = 'Filter resources... (@installed, @available, @updatable, @ext:skill)'
      input.value = ''
      input.onDidChangeValue((text) => {
        // Forward filter to webview
        sidebarView.setItems(currentItems)
      })
      input.onDidAccept(() => input.hide())
      input.onDidHide(() => sidebarView.setItems(currentItems))
      input.show()
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('toolhub.install', async (item?: ResourceItem) => {
      log(`[install] Command triggered, item: ${item?.meta.name || 'undefined'}`)
      if (!item) return

      // Extensions always install globally
      if (item.meta.type === 'extension') {
        try {
          statusBar.showProgress(`Installing ${item.meta.displayName}...`)
          await installResource(item, 'user')
          const msg = `Installed ${item.meta.displayName} v${item.meta.version}`
          log(`[install] ${msg}`)
          vscode.window.showInformationMessage(msg, 'OK')
          await refreshAll()
        } catch (err) {
          vscode.window.showErrorMessage(`Install failed: ${err instanceof Error ? err.message : String(err)}`)
        }
        return
      }

      // For skill/agent/instruction: ask scope
      // Small delay to let webview release focus so QuickPick appears
      await new Promise((r) => setTimeout(r, 200))
      const wsPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      const scopePick = await vscode.window.showQuickPick(
        [
          { label: 'Workspace', description: wsPath ? `.copilot/ in ${wsPath.split('/').pop()}` : 'Current workspace', scope: 'workspace' as InstallScope },
          { label: 'User', description: '~/.agents/, ~/.copilot/ (global)', scope: 'user' as InstallScope },
        ],
        { placeHolder: `Select install scope for ${item.meta.displayName}` }
      )
      if (!scopePick) return

      try {
        statusBar.showProgress(`Installing ${item.meta.displayName}...`)
        await installResource(item, scopePick.scope)
        const msg = `Installed ${item.meta.displayName} v${item.meta.version} (${scopePick.label})`
        log(`[install] ${msg}`)
        vscode.window.showInformationMessage(msg, 'OK')
        await refreshAll()
      } catch (err) {
        vscode.window.showErrorMessage(`Install failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('toolhub.update', async (item?: ResourceItem) => {
      if (!item) return
      await vscode.commands.executeCommand('toolhub.install', item)
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('toolhub.uninstall', async (item?: ResourceItem) => {
      if (!item) return

      const confirm = await vscode.window.showWarningMessage(
        `Uninstall ${item.meta.displayName}?`,
        { modal: true },
        'Uninstall'
      )
      if (confirm !== 'Uninstall') return

      try {
        await uninstallResource(item)
        const msg = `Uninstalled ${item.meta.displayName}`
        log(`[uninstall] ${msg}`)
        vscode.window.showInformationMessage(msg)
        await refreshAll()
      } catch (err) {
        vscode.window.showErrorMessage(`Uninstall failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('toolhub.viewDetails', (item?: ResourceItem) => {
      if (!item) return
      DetailView.show(item, context.extensionUri)
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('toolhub.copyId', (item?: ResourceItem) => {
      if (!item) return
      vscode.env.clipboard.writeText(`${item.meta.type}/${item.meta.name}`)
      vscode.window.showInformationMessage(`Copied: ${item.meta.type}/${item.meta.name}`)
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('toolhub.publish', () => {
      PublishView.show(context)
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('toolhub.addRegistry', () => {
      log('[command] addRegistry triggered')
      RegistryView.show()
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('toolhub.manageRegistries', () => {
      RegistryView.show()
    })
  )

  // ── Startup ───────────────────────────────────────────────
  refreshAll()

  const updateChecker = startUpdateChecker(async () => {
    await refreshAll()
  })
  context.subscriptions.push(updateChecker)

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('toolhub.registries')) {
        refreshAll()
      }
    })
  )
}

export function deactivate() {}
