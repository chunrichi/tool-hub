import * as vscode from 'vscode'
import { marked } from 'marked'
import type { ResourceItem } from './types'

export class DetailView {
  private static panel: vscode.WebviewPanel | undefined

  static show(resource: ResourceItem, extensionUri: vscode.Uri): void {
    if (DetailView.panel) {
      DetailView.panel.reveal(vscode.ViewColumn.Active)
      DetailView.panel.title = resource.meta.displayName
      DetailView.panel.webview.html = DetailView.buildHtml(resource, extensionUri)
      return
    }

    DetailView.panel = vscode.window.createWebviewPanel(
      'toolhubDetail',
      resource.meta.displayName,
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true }
    )

    DetailView.panel.webview.html = DetailView.buildHtml(resource, extensionUri)

    DetailView.panel.webview.onDidReceiveMessage((msg) => {
      if (msg.type === 'install' || msg.type === 'update') {
        vscode.commands.executeCommand('toolhub.install', resource)
      } else if (msg.type === 'uninstall') {
        vscode.commands.executeCommand('toolhub.uninstall', resource)
      }
    })

    DetailView.panel.onDidDispose(() => {
      DetailView.panel = undefined
    })
  }

  private static buildHtml(resource: ResourceItem, extensionUri: vscode.Uri): string {
    const nonce = getNonce()
    const description = marked.parse(resource.meta.description || 'No description available.')

    const statusLabel =
      resource.status === 'installed'
        ? '<span class="badge badge-installed">Installed</span>'
        : resource.status === 'updatable'
          ? '<span class="badge badge-updatable">Update Available</span>'
          : '<span class="badge badge-available">Available</span>'

    const actionButton =
      resource.status === 'updatable'
        ? `<button class="btn btn-primary" onclick="doAction('update')">Update to v${resource.meta.version}</button>`
        : resource.status === 'available'
          ? `<button class="btn btn-primary" onclick="doAction('install')">Install v${resource.meta.version}</button>`
          : `<button class="btn btn-secondary" onclick="doAction('uninstall')">Uninstall</button>`

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <style>
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      padding: 20px;
      max-width: 900px;
      margin: 0 auto;
      line-height: 1.6;
    }
    .header { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; }
    .header-icon { font-size: 48px; }
    .header-info { flex: 1; }
    .header-info h1 { margin: 0; font-size: 24px; }
    .header-meta { color: var(--vscode-descriptionForeground); margin-top: 4px; }
    .badge {
      display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px;
    }
    .badge-installed { background: var(--vscode-testing-iconPassed-foreground, #4ec9b0); color: #fff; }
    .badge-updatable { background: var(--vscode-testing-iconQueued-foreground, #cca700); color: #fff; }
    .badge-available { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
    .actions { display: flex; gap: 8px; margin: 20px 0; }
    .btn {
      padding: 6px 16px; border: none; border-radius: 4px; cursor: pointer;
      font-family: var(--vscode-font-family); font-size: 13px;
    }
    .btn-primary {
      background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    }
    .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
    }
    .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .tabs { display: flex; border-bottom: 1px solid var(--vscode-panel-border); margin-bottom: 16px; }
    .tab {
      padding: 8px 16px; cursor: pointer; border-bottom: 2px solid transparent;
      color: var(--vscode-descriptionForeground);
    }
    .tab.active {
      color: var(--vscode-editor-foreground);
      border-bottom-color: var(--vscode-focusBorder);
    }
    .content { display: none; }
    .content.active { display: block; }
    .meta-table { width: 100%; border-collapse: collapse; }
    .meta-table td { padding: 6px 0; }
    .meta-table td:first-child { color: var(--vscode-descriptionForeground); width: 120px; }
    pre {
      background: var(--vscode-textCodeBlock-background);
      padding: 12px; border-radius: 4px; overflow-x: auto;
    }
    code { font-family: var(--vscode-editor-font-family); }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-icon">$({getTypeIcon(resource.meta.type)})</div>
    <div class="header-info">
      <h1>${escapeHtml(resource.meta.displayName)}</h1>
      <div class="header-meta">
        ${escapeHtml(resource.meta.name)} · v${escapeHtml(resource.meta.version)}
        ${resource.meta.publisher ? ' · ' + escapeHtml(resource.meta.publisher) : ''}
        · ${statusLabel}
      </div>
    </div>
  </div>

  <div class="actions">${actionButton}</div>

  <div class="tabs">
    <div class="tab active" onclick="showTab('description')">Description</div>
    <div class="tab" onclick="showTab('details')">Details</div>
  </div>

  <div id="description" class="content active">${description}</div>

  <div id="details" class="content">
    <table class="meta-table">
      <tr><td>Type</td><td>${escapeHtml(resource.meta.type)}</td></tr>
      <tr><td>Name</td><td>${escapeHtml(resource.meta.name)}</td></tr>
      <tr><td>Version</td><td>${escapeHtml(resource.meta.version)}</td></tr>
      ${resource.meta.publisher ? `<tr><td>Publisher</td><td>${escapeHtml(resource.meta.publisher)}</td></tr>` : ''}
      <tr><td>Registry</td><td>${escapeHtml(resource.registryName)}</td></tr>
      ${resource.meta.tags.length > 0 ? `<tr><td>Tags</td><td>${resource.meta.tags.map(escapeHtml).join(', ')}</td></tr>` : ''}
    </table>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    function doAction(type) { vscode.postMessage({ type }); }
    function showTab(id) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.content').forEach(c => c.classList.remove('active'));
      event.target.classList.add('active');
      document.getElementById(id).classList.add('active');
    }
  </script>
</body>
</html>`
  }
}

function getTypeIcon(type: string): string {
  const icons: Record<string, string> = {
    extension: 'extensions',
    skill: 'brain',
    agent: 'robot',
    instruction: 'note',
  }
  return icons[type] || 'package'
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function getNonce(): string {
  let text = ''
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return text
}
