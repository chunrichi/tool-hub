import * as vscode from 'vscode'
import { marked } from 'marked'
import type { ResourceItem, ContentType } from './types'

const TYPE_SVGS: Record<ContentType, string> = {
  extension: '<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>',
  skill: '<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 1 7 7c0 2.5-1.5 4.5-3 6s-2 3-2 5h-4c0-2-.5-3.5-2-5s-3-3.5-3-6a7 7 0 0 1 7-7z"/><line x1="9" y1="18" x2="15" y2="18"/><line x1="10" y1="22" x2="14" y2="22"/></svg>',
  agent: '<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/></svg>',
  instruction: '<svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
}

const TYPE_COLORS: Record<ContentType, string> = {
  extension: '#007acc',
  skill: '#cca700',
  agent: '#4ec9b0',
  instruction: '#b180d7',
}

const TYPE_LABELS: Record<ContentType, string> = {
  extension: 'Extension',
  skill: 'Skill',
  agent: 'Agent',
  instruction: 'Instruction',
}

export class DetailView {
  private static panel: vscode.WebviewPanel | undefined

  static show(resource: ResourceItem, extensionUri: vscode.Uri): void {
    if (DetailView.panel) {
      DetailView.panel.reveal(vscode.ViewColumn.Active)
      DetailView.panel.title = resource.meta.displayName
      DetailView.panel.webview.html = DetailView.buildHtml(resource)
      return
    }

    DetailView.panel = vscode.window.createWebviewPanel(
      'toolhubDetail',
      resource.meta.displayName,
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true }
    )

    DetailView.panel.webview.html = DetailView.buildHtml(resource)

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

  private static buildHtml(resource: ResourceItem): string {
    const nonce = getNonce()
    const { meta, status } = resource
    const iconSvg = TYPE_SVGS[meta.type]
    const iconColor = TYPE_COLORS[meta.type]
    const typeLabel = TYPE_LABELS[meta.type]
    const descriptionHtml = marked.parse(meta.description || '*No description provided.*')

    // Action buttons (match official Extensions: Install blue + Manage gray)
    let primaryBtn: string
    let secondaryBtn = ''
    if (status === 'updatable') {
      primaryBtn = '<button class="btn btn-primary" id="actionBtn" data-action="update">Update</button>'
      secondaryBtn = '<button class="btn btn-secondary" id="actionBtn2" data-action="uninstall">Uninstall</button>'
    } else if (status === 'available') {
      primaryBtn = '<button class="btn btn-primary" id="actionBtn" data-action="install">Install</button>'
    } else {
      primaryBtn = '<button class="btn btn-secondary" id="actionBtn" data-action="uninstall">Uninstall</button>'
    }

    // Version line
    const versionLine = status === 'updatable' && resource.installedVersion
      ? resource.installedVersion + ' \u2192 ' + meta.version
      : 'v' + meta.version

    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
      '<meta charset="UTF-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'nonce-' + nonce + '\';">\n' +
      '<style>\n' +
      '* { box-sizing: border-box; margin: 0; padding: 0; }\n' +
      'body {\n' +
      '  font-family: var(--vscode-font-family);\n' +
      '  color: var(--vscode-foreground);\n' +
      '  background: var(--vscode-editor-background);\n' +
      '  font-size: 13px;\n' +
      '  line-height: 1.5;\n' +
      '}\n' +

      /* Header: icon + info + buttons (matches official) */
      '.header {\n' +
      '  display: flex; align-items: flex-start; gap: 16px;\n' +
      '  padding: 24px 24px 20px;\n' +
      '}\n' +
      '.icon {\n' +
      '  width: 72px; height: 72px; border-radius: 8px; flex-shrink: 0;\n' +
      '  background: ' + iconColor + '15;\n' +
      '  display: flex; align-items: center; justify-content: center;\n' +
      '  color: ' + iconColor + ';\n' +
      '}\n' +
      '.icon svg { width: 40px; height: 40px; }\n' +
      '.info { flex: 1; min-width: 0; }\n' +
      '.info h1 { font-size: 22px; font-weight: 600; margin-bottom: 2px; }\n' +
      '.info .publisher {\n' +
      '  color: var(--vscode-textLink-foreground);\n' +
      '  font-size: 12px; margin-bottom: 4px;\n' +
      '}\n' +
      '.info .version-line {\n' +
      '  color: var(--vscode-descriptionForeground);\n' +
      '  font-size: 12px;\n' +
      '}\n' +

      /* Action buttons row (below header, matches official) */
      '.actions-row {\n' +
      '  display: flex; align-items: center; gap: 8px;\n' +
      '  padding: 0 24px 16px;\n' +
      '}\n' +
      '.btn {\n' +
      '  padding: 6px 20px; border-radius: 4px; cursor: pointer;\n' +
      '  font-family: var(--vscode-font-family); font-size: 13px; font-weight: 500;\n' +
      '  white-space: nowrap;\n' +
      '}\n' +
      '.btn-primary {\n' +
      '  background: var(--vscode-button-background);\n' +
      '  color: var(--vscode-button-foreground);\n' +
      '  border: none;\n' +
      '}\n' +
      '.btn-primary:hover { background: var(--vscode-button-hoverBackground); }\n' +
      '.btn-secondary {\n' +
      '  background: var(--vscode-button-secondaryBackground);\n' +
      '  color: var(--vscode-button-secondaryForeground);\n' +
      '  border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3));\n' +
      '}\n' +
      '.btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }\n' +
      '.btn-text {\n' +
      '  background: transparent; color: var(--vscode-textLink-foreground);\n' +
      '  border: none; padding: 6px 8px;\n' +
      '}\n' +
      '.btn-text:hover { text-decoration: underline; }\n' +

      /* Tabs (match official: Features/Changelog/Dependencies/README) */
      '.tabs {\n' +
      '  display: flex; border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));\n' +
      '  padding: 0 24px;\n' +
      '}\n' +
      '.tab {\n' +
      '  padding: 8px 16px; cursor: pointer;\n' +
      '  border-bottom: 2px solid transparent;\n' +
      '  color: var(--vscode-descriptionForeground);\n' +
      '  font-size: 13px; user-select: none;\n' +
      '}\n' +
      '.tab:hover { color: var(--vscode-foreground); }\n' +
      '.tab.active {\n' +
      '  color: var(--vscode-foreground);\n' +
      '  border-bottom-color: var(--vscode-focusBorder);\n' +
      '}\n' +

      /* Content area */
      '.content { display: none; padding: 20px 24px; max-width: 900px; }\n' +
      '.content.active { display: block; }\n' +

      /* Markdown styling */
      '.content h1, .content h2, .content h3 { margin: 20px 0 8px; font-weight: 600; }\n' +
      '.content h1 { font-size: 20px; }\n' +
      '.content h2 { font-size: 16px; }\n' +
      '.content h3 { font-size: 14px; }\n' +
      '.content p { margin: 8px 0; }\n' +
      '.content ul, .content ol { margin: 8px 0 8px 24px; }\n' +
      '.content li { margin: 2px 0; }\n' +
      '.content code {\n' +
      '  font-family: var(--vscode-editor-font-family);\n' +
      '  background: var(--vscode-textCodeBlock-background);\n' +
      '  padding: 1px 4px; border-radius: 3px; font-size: 12px;\n' +
      '}\n' +
      '.content pre {\n' +
      '  background: var(--vscode-textCodeBlock-background);\n' +
      '  padding: 12px; border-radius: 4px; overflow-x: auto; margin: 8px 0;\n' +
      '}\n' +
      '.content pre code { background: none; padding: 0; }\n' +
      '.content a { color: var(--vscode-textLink-foreground); }\n' +
      '.content a:hover { color: var(--vscode-textLink-activeForeground); }\n' +
      '.content hr {\n' +
      '  border: none; border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));\n' +
      '  margin: 16px 0;\n' +
      '}\n' +
      '.content img { max-width: 100%; border-radius: 4px; }\n' +

      /* Details table */
      '.details-table { width: 100%; border-collapse: collapse; margin-top: 8px; }\n' +
      '.details-table tr { border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.1)); }\n' +
      '.details-table td { padding: 8px 0; vertical-align: top; }\n' +
      '.details-table td:first-child {\n' +
      '  color: var(--vscode-descriptionForeground); width: 130px;\n' +
      '  font-size: 12px;\n' +
      '}\n' +
      '.tag {\n' +
      '  display: inline-block; padding: 2px 8px; margin: 2px 4px 2px 0;\n' +
      '  background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);\n' +
      '  border-radius: 10px; font-size: 11px;\n' +
      '}\n' +
      '</style>\n</head>\n<body>\n' +

      /* Header */
      '<div class="header">\n' +
      '  <div class="icon">' + iconSvg + '</div>\n' +
      '  <div class="info">\n' +
      '    <h1>' + esc(meta.displayName) + '</h1>\n' +
      (meta.publisher ? '    <div class="publisher">' + esc(meta.publisher) + '</div>\n' : '') +
      '    <div class="version-line">' + esc(typeLabel) + ' &middot; ' + esc(versionLine) + '</div>\n' +
      '  </div>\n' +
      '</div>\n' +

      /* Action buttons row */
      '<div class="actions-row">\n' +
      '  ' + primaryBtn + '\n' +
      '  ' + secondaryBtn + '\n' +
      '</div>\n' +

      /* Tabs */
      '<div class="tabs">\n' +
      '  <div class="tab active" data-tab="readme">README</div>\n' +
      '  <div class="tab" data-tab="features">Features</div>\n' +
      '  <div class="tab" data-tab="details">Details</div>\n' +
      '</div>\n' +

      /* README content */
      '<div id="readme" class="content active">' + descriptionHtml + '</div>\n' +

      /* Features content */
      '<div id="features" class="content">\n' +
      '  <h2>Features</h2>\n' +
      '  <ul>\n' +
      '    <li>' + esc(typeLabel) + ': ' + esc(meta.displayName) + '</li>\n' +
      '    <li>Version: ' + esc(meta.version) + '</li>\n' +
      (meta.tags.length > 0 ? '    <li>Tags: ' + meta.tags.map(esc).join(', ') + '</li>\n' : '') +
      '  </ul>\n' +
      '</div>\n' +

      /* Details content */
      '<div id="details" class="content">\n' +
      '  <table class="details-table">\n' +
      '    <tr><td>Identifier</td><td><code>' + esc(meta.name) + '</code></td></tr>\n' +
      '    <tr><td>Version</td><td>' + esc(meta.version) + '</td></tr>\n' +
      (meta.publisher ? '    <tr><td>Publisher</td><td>' + esc(meta.publisher) + '</td></tr>\n' : '') +
      '    <tr><td>Type</td><td>' + esc(typeLabel) + '</td></tr>\n' +
      '    <tr><td>Registry</td><td>' + esc(resource.registryName) + '</td></tr>\n' +
      (meta.tags.length > 0 ? '    <tr><td>Tags</td><td>' + meta.tags.map(function(t) { return '<span class="tag">' + esc(t) + '</span>' }).join('') + '</td></tr>\n' : '') +
      '  </table>\n' +
      '</div>\n' +

      /* Script */
      '<script nonce="' + nonce + '">\n' +
      'var vscode = acquireVsCodeApi();\n' +
      'document.getElementById("actionBtn").addEventListener("click", function() {\n' +
      '  vscode.postMessage({ type: this.getAttribute("data-action") });\n' +
      '});\n' +
      'var btn2 = document.getElementById("actionBtn2");\n' +
      'if (btn2) btn2.addEventListener("click", function() {\n' +
      '  vscode.postMessage({ type: this.getAttribute("data-action") });\n' +
      '});\n' +
      'var tabs = document.querySelectorAll(".tab");\n' +
      'for (var i = 0; i < tabs.length; i++) {\n' +
      '  tabs[i].addEventListener("click", function() {\n' +
      '    for (var j = 0; j < tabs.length; j++) tabs[j].classList.remove("active");\n' +
      '    var allContent = document.querySelectorAll(".content");\n' +
      '    for (var k = 0; k < allContent.length; k++) allContent[k].classList.remove("active");\n' +
      '    this.classList.add("active");\n' +
      '    document.getElementById(this.getAttribute("data-tab")).classList.add("active");\n' +
      '  });\n' +
      '}\n' +
      '</script>\n</body>\n</html>'
  }
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function getNonce(): string {
  var text = ''
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  for (var i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return text
}
