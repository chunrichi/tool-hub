import * as vscode from 'vscode'
import { ToolHubProvider, ResourceTreeItem } from './treeView'
import { DetailView } from './detailView'
import { PublishView } from './publishView'
import { RegistryView } from './registryView'
import { StatusBarManager } from './statusBar'
import { ToolHubDecorationProvider } from './decorationProvider'
import { loadResources, refreshUpdateStatus, installResource, uninstallResource } from './manager'
import { startUpdateChecker } from './updater'
import { getRegistries, setExtensionContext } from './config'
import type { ResourceItem } from './types'

let log: vscode.OutputChannel

export function activate(context: vscode.ExtensionContext) {
  log = vscode.window.createOutputChannel('ToolHub')
  context.subscriptions.push(log)
  log.appendLine('[activate] Extension activating...')

  try {
    doActivate(context)
    log.appendLine('[activate] Extension activated successfully')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.appendLine(`[activate] FATAL ERROR: ${msg}`)
    vscode.window.showErrorMessage(`ToolHub activation failed: ${msg}`)
  }
}

function doActivate(context: vscode.ExtensionContext) {
  setExtensionContext(context)
  const provider = new ToolHubProvider()
  const statusBar = new StatusBarManager()
  const decorationProvider = new ToolHubDecorationProvider()

  // Create TreeView (use createTreeView, not registerTreeDataProvider, for badge support)
  const treeView = vscode.window.createTreeView('toolhubExplorer', {
    treeDataProvider: provider,
    showCollapseAll: true,
  })

  // Register file decoration provider
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(decorationProvider))

  // ── Data loading ──────────────────────────────────────────
  let currentItems: ResourceItem[] = []

  async function refreshAll(): Promise<void> {
    const registries = getRegistries()
    log.appendLine(`[refreshAll] Found ${registries.length} registries`)
    if (registries.length === 0) {
      provider.setItems([])
      treeView.badge = undefined
      statusBar.hide()
      return
    }

    statusBar.showProgress('Loading catalog...')
    try {
      currentItems = await loadResources()
      const updateCount = await refreshUpdateStatus(currentItems)

      provider.setItems(currentItems)
      treeView.badge =
        updateCount > 0
          ? { value: updateCount, tooltip: `${updateCount} update${updateCount > 1 ? 's' : ''} available` }
          : undefined
      statusBar.showUpdateCount(updateCount)

      // Update decorations
      for (const item of currentItems) {
        if (item.status === 'installed' || item.status === 'updatable') {
          decorationProvider.updateStatus(`${item.meta.type}/${item.meta.name}`, item.status)
        }
      }
      decorationProvider.refreshAll()
    } catch (err) {
      statusBar.hide()
      vscode.window.showErrorMessage(`ToolHub: Failed to load catalog: ${err instanceof Error ? err.message : String(err)}`)
    }
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
      input.onDidChangeValue((text) => provider.setFilter(text))
      input.onDidAccept(() => input.hide())
      input.onDidHide(() => provider.setFilter(''))
      input.show()
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('toolhub.install', async (item?: ResourceItem) => {
      if (!item && treeView.selection.length > 0) {
        const selected = treeView.selection[0]
        if (selected instanceof ResourceTreeItem) item = selected.resource
      }
      if (!item) return

      try {
        statusBar.showProgress(`Installing ${item.meta.displayName}...`)
        await installResource(item)
        vscode.window.showInformationMessage(`Installed ${item.meta.displayName} v${item.meta.version}`)
        await refreshAll()
      } catch (err) {
        vscode.window.showErrorMessage(`Install failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('toolhub.update', async (item?: ResourceItem) => {
      // Update is same as install (overwrite)
      await vscode.commands.executeCommand('toolhub.install', item)
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('toolhub.uninstall', async (item?: ResourceItem) => {
      if (!item && treeView.selection.length > 0) {
        const selected = treeView.selection[0]
        if (selected instanceof ResourceTreeItem) item = selected.resource
      }
      if (!item) return

      const confirm = await vscode.window.showWarningMessage(
        `Uninstall ${item.meta.displayName}?`,
        { modal: true },
        'Uninstall'
      )
      if (confirm !== 'Uninstall') return

      try {
        await uninstallResource(item)
        vscode.window.showInformationMessage(`Uninstalled ${item.meta.displayName}`)
        await refreshAll()
      } catch (err) {
        vscode.window.showErrorMessage(`Uninstall failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('toolhub.viewDetails', (item?: ResourceItem) => {
      if (!item && treeView.selection.length > 0) {
        const selected = treeView.selection[0]
        if (selected instanceof ResourceTreeItem) item = selected.resource
      }
      if (!item) return
      DetailView.show(item, context.extensionUri)
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('toolhub.copyId', (item?: ResourceItem) => {
      if (!item && treeView.selection.length > 0) {
        const selected = treeView.selection[0]
        if (selected instanceof ResourceTreeItem) item = selected.resource
      }
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
      log.appendLine('[command] addRegistry triggered')
      RegistryView.show()
    })
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('toolhub.manageRegistries', () => {
      RegistryView.show()
    })
  )

  // ── Startup ───────────────────────────────────────────────
  // Initial load
  refreshAll()

  // Auto-update checker
  const updateChecker = startUpdateChecker(async () => {
    await refreshAll()
  })
  context.subscriptions.push(updateChecker)

  // Watch settings changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('toolhub.registries')) {
        refreshAll()
      }
    })
  )

  context.subscriptions.push(treeView, statusBar)
}

export function deactivate() {
  // Cleanup handled by disposables
}
