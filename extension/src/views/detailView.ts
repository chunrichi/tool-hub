import * as vscode from 'vscode'
import { marked } from 'marked'
import type { ResourceItem, ContentType, ResourceDetail } from '../types'
import { fetchResourceDetail, submitRating, fetchReadme } from '../utils/api'

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

  static async show(resource: ResourceItem, extensionUri: vscode.Uri): Promise<void> {
    const baseUrl = resource.registryUrl
    const userId = vscode.env.machineId

    // Fetch detail and readme from server
    let detail: ResourceDetail | null = null
    let readmeContent = ''
    try {
      const [d, r] = await Promise.all([
        fetchResourceDetail(baseUrl, resource.meta.type, resource.meta.name, userId),
        fetchReadme(baseUrl, resource.meta.type, resource.meta.name),
      ])
      detail = d
      readmeContent = r
    } catch {
      // Fall back to meta-only display
    }

    if (DetailView.panel) {
      DetailView.panel.reveal(vscode.ViewColumn.Active)
      DetailView.panel.title = resource.meta.displayName
      DetailView.panel.webview.html = DetailView.buildHtml(resource, detail, readmeContent)
      return
    }

    DetailView.panel = vscode.window.createWebviewPanel(
      'toolhubDetail',
      resource.meta.displayName,
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true }
    )

    DetailView.panel.webview.html = DetailView.buildHtml(resource, detail, readmeContent)

    DetailView.panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'install' || msg.type === 'update') {
        vscode.commands.executeCommand('toolhub.install', resource)
      } else if (msg.type === 'uninstall') {
        vscode.commands.executeCommand('toolhub.uninstall', resource)
      } else if (msg.type === 'rate') {
        try {
          const result = await submitRating(baseUrl, resource.meta.type, resource.meta.name, msg.score, userId)
          DetailView.panel?.webview.postMessage({ type: 'ratingUpdated', ...result })
        } catch (err) {
          console.error('Failed to submit rating:', err)
        }
      }
    })

    DetailView.panel.onDidDispose(() => {
      DetailView.panel = undefined
    })
  }

  private static buildHtml(resource: ResourceItem, detail: ResourceDetail | null, readmeContent: string): string {
    const nonce = getNonce()
    const { meta, status } = resource
    const iconSvg = TYPE_SVGS[meta.type]
    const iconColor = TYPE_COLORS[meta.type]
    const typeLabel = TYPE_LABELS[meta.type]

    // Rating data
    const avgRating = detail?.avgRating ?? meta.avgRating ?? 0
    const ratingCount = detail?.ratingCount ?? meta.ratingCount ?? 0
    const userScore = detail?.userScore ?? null
    const downloadCount = detail?.downloadCount ?? meta.downloadCount ?? 0
    const ratingStars = renderStars(avgRating)

    // README: prefer fetched content, fallback to description
    const readmeHtml = readmeContent
      ? marked.parse(readmeContent)
      : marked.parse(meta.description || '*No description provided.*')

    // Action buttons (match official Extensions: Install blue + Manage gray)
    let primaryBtn: string
    let secondaryBtn = ''
    if (status === 'updatable') {
      primaryBtn = '<button class="btn btn-primary" id="actionBtn" data-action="update">Update</button>'
      secondaryBtn = '<button class="btn btn-secondary" id="actionBtn2" data-action="uninstall">Uninstall</button>'
    } else if (status === 'available') {
      primaryBtn = '<button class="btn btn-primary" id="actionBtn" data-action="install">Install</button>'
    } else {
      // Installed: show Disable (like official Extensions view)
      primaryBtn = '<button class="btn btn-secondary" id="actionBtn" data-action="uninstall">Disable</button>'
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

      /* ── Header (VS Code Extensions marketplace style) ── */
      '.header {\n' +
      '  display: flex; align-items: flex-start; gap: 16px;\n' +
      '  padding: 24px 24px 16px;\n' +
      '  border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.15));\n' +
      '}\n' +
      '.icon {\n' +
      '  width: 64px; height: 64px; border-radius: 4px; flex-shrink: 0;\n' +
      '  background: ' + iconColor + '18;\n' +
      '  display: flex; align-items: center; justify-content: center;\n' +
      '  color: ' + iconColor + ';\n' +
      '}\n' +
      '.icon svg { width: 36px; height: 36px; }\n' +
      '.info { flex: 1; min-width: 0; }\n' +
      '.info h1 {\n' +
      '  font-size: 26px; font-weight: 700; margin-bottom: 4px;\n' +
      '  color: var(--vscode-titleBar-activeForeground, var(--vscode-foreground));\n' +
      '  line-height: 1.2;\n' +
      '}\n' +
      '.info .publisher-id {\n' +
      '  color: var(--vscode-descriptionForeground);\n' +
      '  font-size: 12px; margin-bottom: 6px;\n' +
      '}\n' +
      '.info .meta-row {\n' +
      '  display: flex; align-items: center; gap: 12px;\n' +
      '  color: var(--vscode-descriptionForeground);\n' +
      '  font-size: 12px; margin-bottom: 4px;\n' +
      '}\n' +
      '.info .meta-row .rating { color: #d4a017; }\n' +
      '.info .meta-row .installs { display: flex; align-items: center; gap: 4px; }\n' +

      /* ── Star rating interactive ── */
      '.star-rating { display: inline-flex; gap: 2px; cursor: pointer; }\n' +
      '.star-rating .star { font-size: 18px; color: var(--vscode-descriptionForeground); transition: color 0.1s; }\n' +
      '.star-rating .star.filled { color: #d4a017; }\n' +
      '.star-rating .star:hover, .star-rating .star.hover { color: #e8b827; }\n' +
      '.rating-display { display: flex; align-items: center; gap: 8px; }\n' +
      '.rating-display .score { font-size: 14px; font-weight: 600; color: #d4a017; }\n' +
      '.rating-display .count { font-size: 11px; color: var(--vscode-descriptionForeground); }\n' +

      /* Action buttons row (matches official Extensions) */
      '.actions-row {\n' +
      '  display: flex; align-items: center; gap: 8px;\n' +
      '  padding: 12px 24px 16px;\n' +
      '}\n' +
      '.btn {\n' +
      '  padding: 6px 16px; border-radius: 3px; cursor: pointer;\n' +
      '  font-family: var(--vscode-font-family); font-size: 13px; font-weight: 500;\n' +
      '  white-space: nowrap; display: inline-flex; align-items: center; gap: 6px;\n' +
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
      '.btn-icon-only {\n' +
      '  width: 30px; height: 30px; padding: 0; border-radius: 3px;\n' +
      '  background: transparent; border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3));\n' +
      '  color: var(--vscode-foreground); cursor: pointer;\n' +
      '  display: inline-flex; align-items: center; justify-content: center;\n' +
      '}\n' +
      '.btn-icon-only:hover { background: var(--vscode-toolbar-hoverBackground); }\n' +

      /* ── Tabs (official Extensions: README / Features / Changelog / Dependencies) ── */
      '.tabs {\n' +
      '  display: flex; border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));\n' +
      '  padding: 0 24px;\n' +
      '}\n' +
      '.tab {\n' +
      '  padding: 10px 16px; cursor: pointer;\n' +
      '  border-bottom: 2px solid transparent;\n' +
      '  color: var(--vscode-descriptionForeground);\n' +
      '  font-size: 13px; font-weight: 500; user-select: none;\n' +
      '}\n' +
      '.tab:hover { color: var(--vscode-foreground); }\n' +
      '.tab.active {\n' +
      '  color: var(--vscode-foreground);\n' +
      '  border-bottom-color: var(--vscode-focusBorder);\n' +
      '}\n' +

      /* ── Main layout: content + sidebar ── */
      '.main-layout {\n' +
      '  display: flex; min-height: calc(100vh - 200px);\n' +
      '}\n' +
      '.content-area { flex: 1; min-width: 0; overflow-y: auto; }\n' +
      '.sidebar {\n' +
      '  width: 240px; flex-shrink: 0; padding: 20px 24px;\n' +
      '  border-left: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.15));\n' +
      '  background: var(--vscode-sideBar-background, var(--vscode-editor-background));\n' +
      '}\n' +
      '.sidebar h3 {\n' +
      '  font-size: 12px; font-weight: 600; text-transform: uppercase;\n' +
      '  letter-spacing: 0.5px; color: var(--vscode-descriptionForeground);\n' +
      '  margin-bottom: 16px; padding-bottom: 8px;\n' +
      '  border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.15));\n' +
      '}\n' +
      '.sidebar-item {\n' +
      '  margin-bottom: 16px;\n' +
      '}\n' +
      '.sidebar-item .label {\n' +
      '  font-size: 11px; color: var(--vscode-descriptionForeground);\n' +
      '  margin-bottom: 4px; font-weight: 500;\n' +
      '}\n' +
      '.sidebar-item .value {\n' +
      '  font-size: 13px; color: var(--vscode-foreground);\n' +
      '  line-height: 1.4;\n' +
      '}\n' +
      '.sidebar-item .value.muted {\n' +
      '  color: var(--vscode-descriptionForeground);\n' +
      '}\n' +

      /* ── Content area ── */
      '.content { display: none; padding: 20px 24px; max-width: 900px; }\n' +
      '.content.active { display: block; }\n' +

      /* ── Markdown styling (VS Code Extensions README style) ── */
      '.content h1 {\n' +
      '  font-size: 24px; font-weight: 700; margin: 24px 0 12px;\n' +
      '  padding-bottom: 8px; border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));\n' +
      '}\n' +
      '.content h2 {\n' +
      '  font-size: 20px; font-weight: 700; margin: 20px 0 10px;\n' +
      '}\n' +
      '.content h3 {\n' +
      '  font-size: 16px; font-weight: 600; margin: 16px 0 8px;\n' +
      '}\n' +
      '.content p { margin: 10px 0; line-height: 1.6; }\n' +
      '.content ul, .content ol { margin: 10px 0 10px 24px; }\n' +
      '.content li { margin: 4px 0; line-height: 1.5; }\n' +
      '.content code {\n' +
      '  font-family: var(--vscode-editor-font-family);\n' +
      '  background: var(--vscode-textCodeBlock-background);\n' +
      '  padding: 2px 6px; border-radius: 3px; font-size: 12px;\n' +
      '}\n' +
      '.content pre {\n' +
      '  background: var(--vscode-textCodeBlock-background);\n' +
      '  border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));\n' +
      '  border-radius: 4px; padding: 12px 16px;\n' +
      '  overflow-x: auto; margin: 12px 0;\n' +
      '  font-family: var(--vscode-editor-font-family);\n' +
      '  font-size: 13px; line-height: 1.5;\n' +
      '}\n' +
      '.content pre code { background: none; padding: 0; border: none; }\n' +
      '.content a { color: var(--vscode-textLink-foreground); text-decoration: none; }\n' +
      '.content a:hover { color: var(--vscode-textLink-activeForeground); text-decoration: underline; }\n' +
      '.content hr {\n' +
      '  border: none; border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));\n' +
      '  margin: 20px 0;\n' +
      '}\n' +
      '.content img { max-width: 100%; border-radius: 4px; margin: 12px 0; }\n' +
      '.content blockquote {\n' +
      '  border-left: 3px solid var(--vscode-focusBorder);\n' +
      '  padding: 8px 16px; margin: 12px 0;\n' +
      '  color: var(--vscode-descriptionForeground);\n' +
      '  background: var(--vscode-textBlockQuote-background, transparent);\n' +
      '}\n' +
      '.content table {\n' +
      '  border-collapse: collapse; width: 100%; margin: 12px 0;\n' +
      '}\n' +
      '.content th, .content td {\n' +
      '  border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));\n' +
      '  padding: 8px 12px; text-align: left;\n' +
      '}\n' +
      '.content th { background: var(--vscode-editor-background); font-weight: 600; }\n' +

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
      (meta.publisher ? '    <div class="publisher-id">' + esc(meta.publisher) + '</div>\n' : '') +
      '    <div class="meta-row">\n' +
      '      <span class="rating">' + ratingStars + '</span>\n' +
      '      <span>' + esc(typeLabel) + '</span>\n' +
      '      <span>&middot;</span>\n' +
      '      <span>v' + esc(meta.version) + '</span>\n' +
      (downloadCount > 0 ? '      <span>&middot;</span>\n      <span>\u2913 ' + downloadCount + '</span>\n' : '') +
      '    </div>\n' +
      '  </div>\n' +
      '</div>\n' +

      /* Action buttons row */
      '<div class="actions-row">\n' +
      '  ' + primaryBtn + '\n' +
      '  ' + secondaryBtn + '\n' +
      '  <button class="btn-icon-only" title="Settings">\n' +
      '    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8.837 1.626c-.246-.835-1.428-.835-1.674 0l-.727 2.492a.75.75 0 0 1-1.19.456l-2.148-1.074a.75.75 0 0 0-.832.117l-1.5 1.833a.75.75 0 0 0 .117.832l2.148 1.074a.75.75 0 0 1 .456 1.19l-2.492.727c-.835.246-.835 1.428 0 1.674l2.492.727a.75.75 0 0 1-.456 1.19l2.148-1.074a.75.75 0 0 0 .832.117l1.5 1.833a.75.75 0 0 0 .832-.117l2.148-1.074a.75.75 0 0 1 1.19.456l.727 2.492c.246.835 1.428.835 1.674 0l.727-2.492a.75.75 0 0 1 1.19-.456l2.148 1.074a.75.75 0 0 0 .832-.117l1.5-1.833a.75.75 0 0 0-.117-.832l-2.148-1.074a.75.75 0 0 1-.456-1.19l2.492-.727c.835-.246.835-1.428 0-1.674l-2.492-.727a.75.75 0 0 1-.456-1.19l1.074-2.148a.75.75 0 0 0-.117-.832L13.2 4.043a.75.75 0 0 0-.832-.117L10.868 5a.75.75 0 0 1-1.19-.456L8.837 1.626ZM6.872 4.704l-.727 2.492a2.25 2.25 0 0 0 1.368 2.813l2.148 1.074 1.074-2.148a2.25 2.25 0 0 0 2.813 1.368l2.492.727-1.626 5.626-2.492-.727a2.25 2.25 0 0 0-2.813 1.368L7.07 17.36l-5.626-1.626.727-2.492a2.25 2.25 0 0 0-1.368-2.813L.655 9.31l2.148-1.074a2.25 2.25 0 0 0-1.368-2.813L.655 2.71l1.626-5.626 2.492.727a2.25 2.25 0 0 0 2.813-1.368L6.872 4.704z"/></svg>\n' +
      '  </button>\n' +
      '</div>\n' +

      /* Tabs */
      '<div class="tabs">\n' +
      '  <div class="tab active" data-tab="readme">README</div>\n' +
      '  <div class="tab" data-tab="features">Features</div>\n' +
      '  <div class="tab" data-tab="changelog">Changelog</div>\n' +
      '  <div class="tab" data-tab="details">Details</div>\n' +
      '</div>\n' +

      /* Main layout: content + sidebar */
      '<div class="main-layout">\n' +
      '  <div class="content-area">\n' +

      /* README content */
      '    <div id="readme" class="content active">' + readmeHtml + '</div>\n' +

      /* Features content */
      '    <div id="features" class="content">\n' +
      '      <h2>Features</h2>\n' +
      '      <ul>\n' +
      '        <li>' + esc(typeLabel) + ': ' + esc(meta.displayName) + '</li>\n' +
      '        <li>Version: ' + esc(meta.version) + '</li>\n' +
      (meta.tags.length > 0 ? '        <li>Tags: ' + meta.tags.map(esc).join(', ') + '</li>\n' : '') +
      '      </ul>\n' +
      '    </div>\n' +

      /* Changelog content */
      '    <div id="changelog" class="content">\n' +
      '      <h2>Changelog</h2>\n' +
      '      <div style="color: var(--vscode-descriptionForeground); font-style: italic;">\n' +
      '        <p>Version ' + esc(meta.version) + '</p>\n' +
      '        <p style="margin-top: 8px;">Latest release</p>\n' +
      '      </div>\n' +
      '    </div>\n' +

      /* Details content */
      '    <div id="details" class="content">\n' +
      '      <table class="details-table">\n' +
      '        <tr><td>Identifier</td><td><code>' + esc(meta.name) + '</code></td></tr>\n' +
      '        <tr><td>Version</td><td>' + esc(meta.version) + '</td></tr>\n' +
      (meta.publisher ? '        <tr><td>Publisher</td><td>' + esc(meta.publisher) + '</td></tr>\n' : '') +
      '        <tr><td>Type</td><td>' + esc(typeLabel) + '</td></tr>\n' +
      '        <tr><td>Registry</td><td>' + esc(resource.registryName) + '</td></tr>\n' +
      (meta.tags.length > 0 ? '        <tr><td>Tags</td><td>' + meta.tags.map(function(t) { return '<span class="tag">' + esc(t) + '</span>' }).join('') + '</td></tr>\n' : '') +
      '      </table>\n' +
      '    </div>\n' +

      '  </div>\n' + /* end content-area */

      /* Sidebar: More Info */
      '  <div class="sidebar">\n' +
      '    <h3>More Info</h3>\n' +
      '    <div class="sidebar-item">\n' +
      '      <div class="label">Publisher</div>\n' +
      '      <div class="value">' + esc(meta.publisher || 'Unknown') + '</div>\n' +
      '    </div>\n' +
      '    <div class="sidebar-item">\n' +
      '      <div class="label">Rating</div>\n' +
      '      <div class="rating-display">\n' +
      '        <span class="score">' + avgRating.toFixed(1) + '</span>\n' +
      '        <span>' + ratingStars + '</span>\n' +
      '        <span class="count">(' + ratingCount + ')</span>\n' +
      '      </div>\n' +
      '    </div>\n' +
      '    <div class="sidebar-item">\n' +
      '      <div class="label">Your Rating</div>\n' +
      '      <div class="star-rating" id="userRating">\n' +
      '        <span class="star' + (userScore && userScore >= 1 ? ' filled' : '') + '" data-score="1">\u2605</span>\n' +
      '        <span class="star' + (userScore && userScore >= 2 ? ' filled' : '') + '" data-score="2">\u2605</span>\n' +
      '        <span class="star' + (userScore && userScore >= 3 ? ' filled' : '') + '" data-score="3">\u2605</span>\n' +
      '        <span class="star' + (userScore && userScore >= 4 ? ' filled' : '') + '" data-score="4">\u2605</span>\n' +
      '        <span class="star' + (userScore && userScore >= 5 ? ' filled' : '') + '" data-score="5">\u2605</span>\n' +
      '      </div>\n' +
      '    </div>\n' +
      '    <div class="sidebar-item">\n' +
      '      <div class="label">Version</div>\n' +
      '      <div class="value">' + esc(meta.version) + '</div>\n' +
      '    </div>\n' +
      '    <div class="sidebar-item">\n' +
      '      <div class="label">Type</div>\n' +
      '      <div class="value">' + esc(typeLabel) + '</div>\n' +
      '    </div>\n' +
      '    <div class="sidebar-item">\n' +
      '      <div class="label">Registry</div>\n' +
      '      <div class="value muted">' + esc(resource.registryName) + '</div>\n' +
      '    </div>\n' +
      (meta.tags.length > 0 ?
      '    <div class="sidebar-item">\n' +
      '      <div class="label">Tags</div>\n' +
      '      <div class="value">' + meta.tags.map(function(t) { return '<span class="tag">' + esc(t) + '</span>' }).join(' ') + '</div>\n' +
      '    </div>\n' : '') +
      '    <div class="sidebar-item">\n' +
      '      <div class="label">License</div>\n' +
      '      <div class="value muted">MIT</div>\n' +
      '    </div>\n' +
      (downloadCount > 0 ?
      '    <div class="sidebar-item">\n' +
      '      <div class="label">Downloads</div>\n' +
      '      <div class="value">' + downloadCount + '</div>\n' +
      '    </div>\n' : '') +
      '  </div>\n' + /* end sidebar */
      '</div>\n' + /* end main-layout */

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
      // Star rating interaction
      'var userRating = document.getElementById("userRating");\n' +
      'if (userRating) {\n' +
      '  var stars = userRating.querySelectorAll(".star");\n' +
      '  for (var s = 0; s < stars.length; s++) {\n' +
      '    stars[s].addEventListener("mouseenter", function() {\n' +
      '      var score = parseInt(this.getAttribute("data-score"));\n' +
      '      for (var x = 0; x < stars.length; x++) {\n' +
      '        stars[x].classList.toggle("hover", parseInt(stars[x].getAttribute("data-score")) <= score);\n' +
      '      }\n' +
      '    });\n' +
      '    stars[s].addEventListener("mouseleave", function() {\n' +
      '      for (var x = 0; x < stars.length; x++) stars[x].classList.remove("hover");\n' +
      '    });\n' +
      '    stars[s].addEventListener("click", function() {\n' +
      '      var score = parseInt(this.getAttribute("data-score"));\n' +
      '      vscode.postMessage({ type: "rate", score: score });\n' +
      '      for (var x = 0; x < stars.length; x++) {\n' +
      '        stars[x].classList.toggle("filled", parseInt(stars[x].getAttribute("data-score")) <= score);\n' +
      '      }\n' +
      '    });\n' +
      '  }\n' +
      '}\n' +
      // Handle rating update from server
      'window.addEventListener("message", function(event) {\n' +
      '  var msg = event.data;\n' +
      '  if (msg.type === "ratingUpdated") {\n' +
      '    var scoreEl = document.querySelector(".rating-display .score");\n' +
      '    var countEl = document.querySelector(".rating-display .count");\n' +
      '    if (scoreEl) scoreEl.textContent = msg.avgRating.toFixed(1);\n' +
      '    if (countEl) countEl.textContent = "(" + msg.ratingCount + ")";\n' +
      '  }\n' +
      '});\n' +
      '</script>\n</body>\n</html>'
  }
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function renderStars(avg: number): string {
  var stars = ''
  for (var i = 1; i <= 5; i++) {
    stars += i <= Math.round(avg) ? '\u2605' : '\u2606'
  }
  return stars
}

function getNonce(): string {
  var text = ''
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  for (var i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return text
}
