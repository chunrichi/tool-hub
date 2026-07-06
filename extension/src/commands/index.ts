import * as vscode from 'vscode'
import type { ResourceItem } from '../types'
import type { InstallScope } from '../registry/manager'
import { log } from '../utils/logger'
import { installResource, uninstallResource } from '../registry/manager'
import type { SidebarView } from '../views/sidebarView'
import type { StatusBarManager } from '../views/statusBar'

export function registerCommands(
  context: vscode.ExtensionContext,
  sidebarView: SidebarView,
  statusBar: StatusBarManager,
  getCurrentItems: () => ResourceItem[],
  refreshAll: () => Promise<void>
): void {
  // ── Refresh ──
  context.subscriptions.push(
    vscode.commands.registerCommand('toolhub.refresh', () => refreshAll())
  )

  // ── Install ──
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

  // ── Update ──
  context.subscriptions.push(
    vscode.commands.registerCommand('toolhub.update', async (item?: ResourceItem) => {
      if (!item) return
      await vscode.commands.executeCommand('toolhub.install', item)
    })
  )

  // ── Uninstall ──
  context.subscriptions.push(
    vscode.commands.registerCommand('toolhub.uninstall', async (item?: ResourceItem) => {
      if (!item) return

      const confirm = await vscode.window.showWarningMessage(
        `Uninstall ${item.meta.displayName}?`,
        { modal: true },
        'Yes'
      )
      if (confirm !== 'Yes') return

      try {
        statusBar.showProgress(`Uninstalling ${item.meta.displayName}...`)
        await uninstallResource(item)
        const msg = `Uninstalled ${item.meta.displayName}`
        log(`[uninstall] ${msg}`)
        vscode.window.showInformationMessage(msg, 'OK')
        await refreshAll()
      } catch (err) {
        vscode.window.showErrorMessage(`Uninstall failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
  )

  // ── View Details ──
  context.subscriptions.push(
    vscode.commands.registerCommand('toolhub.viewDetails', async (item?: ResourceItem) => {
      if (!item) return
      const { DetailView } = await import('../views/detailView')
      DetailView.show(item, context.extensionUri)
    })
  )

  // ── Copy ID ──
  context.subscriptions.push(
    vscode.commands.registerCommand('toolhub.copyId', async (item?: ResourceItem) => {
      if (!item) return
      await vscode.env.clipboard.writeText(item.meta.name)
      vscode.window.showInformationMessage(`Copied: ${item.meta.name}`)
    })
  )

  // ── Publish ──
  context.subscriptions.push(
    vscode.commands.registerCommand('toolhub.publish', async () => {
      const { PublishView } = await import('../views/publishView')
      PublishView.show(context)
    })
  )

  // ── Add Registry ──
  context.subscriptions.push(
    vscode.commands.registerCommand('toolhub.addRegistry', async () => {
      const { RegistryView } = await import('../views/registryView')
      RegistryView.show()
    })
  )

  // ── Manage Registries ──
  context.subscriptions.push(
    vscode.commands.registerCommand('toolhub.manageRegistries', async () => {
      const { RegistryView } = await import('../views/registryView')
      RegistryView.show()
    })
  )
}
