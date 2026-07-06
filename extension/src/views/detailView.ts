import * as vscode from 'vscode'
import { marked } from 'marked'
import type { ResourceItem, ResourceDetail } from '../types'
import { fetchResourceDetail, submitRating, fetchReadme } from '../utils/api'
import { TYPE_ICONS_64, TYPE_COLORS, TYPE_LABELS, esc, getNonce, renderStars } from './constants'

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
    const iconSvg = TYPE_ICONS_64[meta.type]
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

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-size: 13px;
      line-height: 1.5;
    }
    .header {
      display: flex; align-items: flex-start; gap: 16px;
      padding: 24px 24px 16px;
      border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.15));
    }
    .icon {
      width: 64px; height: 64px; border-radius: 4px; flex-shrink: 0;
      background: ${iconColor}18;
      display: flex; align-items: center; justify-content: center;
      color: ${iconColor};
    }
    .icon svg { width: 36px; height: 36px; }
    .info { flex: 1; min-width: 0; }
    .info h1 {
      font-size: 26px; font-weight: 700; margin-bottom: 4px;
      color: var(--vscode-titleBar-activeForeground, var(--vscode-foreground));
      line-height: 1.2;
    }
    .info .publisher-id {
      color: var(--vscode-descriptionForeground);
      font-size: 12px; margin-bottom: 6px;
    }
    .info .meta-row {
      display: flex; align-items: center; gap: 12px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px; margin-bottom: 4px;
    }
    .info .meta-row .rating { color: #d4a017; }
    .info .meta-row .installs { display: flex; align-items: center; gap: 4px; }
    .star-rating { display: inline-flex; gap: 2px; cursor: pointer; }
    .star-rating .star { font-size: 18px; color: var(--vscode-descriptionForeground); transition: color 0.1s; }
    .star-rating .star.filled { color: #d4a017; }
    .star-rating .star:hover, .star-rating .star.hover { color: #e8b827; }
    .rating-display { display: flex; align-items: center; gap: 8px; }
    .rating-display .score { font-size: 14px; font-weight: 600; color: #d4a017; }
    .rating-display .count { font-size: 11px; color: var(--vscode-descriptionForeground); }
    .actions-row {
      display: flex; align-items: center; gap: 8px;
      padding: 12px 24px 16px;
    }
    .btn {
      padding: 6px 16px; border-radius: 3px; cursor: pointer;
      font-family: var(--vscode-font-family); font-size: 13px; font-weight: 500;
      white-space: nowrap; display: inline-flex; align-items: center; gap: 6px;
    }
    .btn-primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
    }
    .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
    .btn-secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3));
    }
    .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .btn-icon-only {
      width: 30px; height: 30px; padding: 0; border-radius: 3px;
      background: transparent; border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.3));
      color: var(--vscode-foreground); cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
    }
    .btn-icon-only:hover { background: var(--vscode-toolbar-hoverBackground); }
    .tabs {
      display: flex; border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));
      padding: 0 24px;
    }
    .tab {
      padding: 10px 16px; cursor: pointer;
      border-bottom: 2px solid transparent;
      color: var(--vscode-descriptionForeground);
      font-size: 13px; font-weight: 500; user-select: none;
    }
    .tab:hover { color: var(--vscode-foreground); }
    .tab.active {
      color: var(--vscode-foreground);
      border-bottom-color: var(--vscode-focusBorder);
    }
    .main-layout {
      display: flex; min-height: calc(100vh - 200px);
    }
    .content-area { flex: 1; min-width: 0; overflow-y: auto; }
    .sidebar {
      width: 240px; flex-shrink: 0; padding: 20px 24px;
      border-left: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.15));
      background: var(--vscode-sideBar-background, var(--vscode-editor-background));
    }
    .sidebar h3 {
      font-size: 12px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.5px; color: var(--vscode-descriptionForeground);
      margin-bottom: 16px; padding-bottom: 8px;
      border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.15));
    }
    .sidebar-item { margin-bottom: 16px; }
    .sidebar-item .label {
      font-size: 11px; color: var(--vscode-descriptionForeground);
      margin-bottom: 4px; font-weight: 500;
    }
    .sidebar-item .value {
      font-size: 13px; color: var(--vscode-foreground);
      line-height: 1.4;
    }
    .sidebar-item .value.muted {
      color: var(--vscode-descriptionForeground);
    }
    .content { display: none; padding: 20px 24px; max-width: 900px; }
    .content.active { display: block; }
    .content h1 {
      font-size: 24px; font-weight: 700; margin: 24px 0 12px;
      padding-bottom: 8px; border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));
    }
    .content h2 { font-size: 20px; font-weight: 700; margin: 20px 0 10px; }
    .content h3 { font-size: 16px; font-weight: 600; margin: 16px 0 8px; }
    .content p { margin: 10px 0; line-height: 1.6; }
    .content ul, .content ol { margin: 10px 0 10px 24px; }
    .content li { margin: 4px 0; line-height: 1.5; }
    .content code {
      font-family: var(--vscode-editor-font-family);
      background: var(--vscode-textCodeBlock-background);
      padding: 2px 6px; border-radius: 3px; font-size: 12px;
    }
    .content pre {
      background: var(--vscode-textCodeBlock-background);
      border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));
      border-radius: 4px; padding: 12px 16px;
      overflow-x: auto; margin: 12px 0;
      font-family: var(--vscode-editor-font-family);
      font-size: 13px; line-height: 1.5;
    }
    .content pre code { background: none; padding: 0; border: none; }
    .content a { color: var(--vscode-textLink-foreground); text-decoration: none; }
    .content a:hover { color: var(--vscode-textLink-activeForeground); text-decoration: underline; }
    .content hr {
      border: none; border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));
      margin: 20px 0;
    }
    .content img { max-width: 100%; border-radius: 4px; margin: 12px 0; }
    .content blockquote {
      border-left: 3px solid var(--vscode-focusBorder);
      padding: 8px 16px; margin: 12px 0;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-textBlockQuote-background, transparent);
    }
    .content table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    .content th, .content td {
      border: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));
      padding: 8px 12px; text-align: left;
    }
    .content th { background: var(--vscode-editor-background); font-weight: 600; }
    .details-table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    .details-table tr { border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.1)); }
    .details-table td { padding: 8px 0; vertical-align: top; }
    .details-table td:first-child {
      color: var(--vscode-descriptionForeground); width: 130px;
      font-size: 12px;
    }
    .tag {
      display: inline-block; padding: 2px 8px; margin: 2px 4px 2px 0;
      background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
      border-radius: 10px; font-size: 11px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="icon">${iconSvg}</div>
    <div class="info">
      <h1>${esc(meta.displayName)}</h1>
      ${meta.publisher ? `<div class="publisher-id">${esc(meta.publisher)}</div>` : ''}
      <div class="meta-row">
        <span class="rating">${ratingStars}</span>
        <span>${esc(typeLabel)}</span>
        <span>&middot;</span>
        <span>v${esc(meta.version)}</span>
        ${downloadCount > 0 ? `<span>&middot;</span><span>\u2913 ${downloadCount}</span>` : ''}
      </div>
    </div>
  </div>

  <div class="actions-row">
    ${primaryBtn}
    ${secondaryBtn}
    <button class="btn-icon-only" title="Settings">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8.837 1.626c-.246-.835-1.428-.835-1.674 0l-.727 2.492a.75.75 0 0 1-1.19.456l-2.148-1.074a.75.75 0 0 0-.832.117l-1.5 1.833a.75.75 0 0 0 .117.832l2.148 1.074a.75.75 0 0 1 .456 1.19l-2.492.727c-.835.246-.835 1.428 0 1.674l2.492.727a.75.75 0 0 1-.456 1.19l2.148-1.074a.75.75 0 0 0 .832.117l1.5 1.833a.75.75 0 0 0 .832-.117l2.148-1.074a.75.75 0 0 1 1.19.456l.727 2.492c.246.835 1.428.835 1.674 0l.727-2.492a.75.75 0 0 1 1.19-.456l2.148 1.074a.75.75 0 0 0 .832-.117l1.5-1.833a.75.75 0 0 0-.117-.832l-2.148-1.074a.75.75 0 0 1-.456-1.19l2.492-.727c.835-.246.835-1.428 0-1.674l-2.492-.727a.75.75 0 0 1-.456-1.19l1.074-2.148a.75.75 0 0 0-.117-.832L13.2 4.043a.75.75 0 0 0-.832-.117L10.868 5a.75.75 0 0 1-1.19-.456L8.837 1.626ZM6.872 4.704l-.727 2.492a2.25 2.25 0 0 0 1.368 2.813l2.148 1.074 1.074-2.148a2.25 2.25 0 0 0 2.813 1.368l2.492.727-1.626 5.626-2.492-.727a2.25 2.25 0 0 0-2.813 1.368L7.07 17.36l-5.626-1.626.727-2.492a2.25 2.25 0 0 0-1.368-2.813L.655 9.31l2.148-1.074a2.25 2.25 0 0 0-1.368-2.813L.655 2.71l1.626-5.626 2.492.727a2.25 2.25 0 0 0 2.813-1.368L6.872 4.704z"/></svg>
    </button>
  </div>

  <div class="tabs">
    <div class="tab active" data-tab="readme">README</div>
    <div class="tab" data-tab="features">Features</div>
    <div class="tab" data-tab="changelog">Changelog</div>
    <div class="tab" data-tab="details">Details</div>
  </div>

  <div class="main-layout">
    <div class="content-area">
      <div id="readme" class="content active">${readmeHtml}</div>

      <div id="features" class="content">
        <h2>Features</h2>
        <ul>
          <li>${esc(typeLabel)}: ${esc(meta.displayName)}</li>
          <li>Version: ${esc(meta.version)}</li>
          ${meta.tags.length > 0 ? `<li>Tags: ${meta.tags.map(esc).join(', ')}</li>` : ''}
        </ul>
      </div>

      <div id="changelog" class="content">
        <h2>Changelog</h2>
        <div style="color: var(--vscode-descriptionForeground); font-style: italic;">
          <p>Version ${esc(meta.version)}</p>
          <p style="margin-top: 8px;">Latest release</p>
        </div>
      </div>

      <div id="details" class="content">
        <table class="details-table">
          <tr><td>Identifier</td><td><code>${esc(meta.name)}</code></td></tr>
          <tr><td>Version</td><td>${esc(meta.version)}</td></tr>
          ${meta.publisher ? `<tr><td>Publisher</td><td>${esc(meta.publisher)}</td></tr>` : ''}
          <tr><td>Type</td><td>${esc(typeLabel)}</td></tr>
          <tr><td>Registry</td><td>${esc(resource.registryName)}</td></tr>
          ${meta.tags.length > 0 ? `<tr><td>Tags</td><td>${meta.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</td></tr>` : ''}
        </table>
      </div>
    </div>

    <div class="sidebar">
      <h3>More Info</h3>
      <div class="sidebar-item">
        <div class="label">Publisher</div>
        <div class="value">${esc(meta.publisher || 'Unknown')}</div>
      </div>
      <div class="sidebar-item">
        <div class="label">Rating</div>
        <div class="rating-display">
          <span class="score">${avgRating.toFixed(1)}</span>
          <span>${ratingStars}</span>
          <span class="count">(${ratingCount})</span>
        </div>
      </div>
      <div class="sidebar-item">
        <div class="label">Your Rating</div>
        <div class="star-rating" id="userRating">
          <span class="star${userScore && userScore >= 1 ? ' filled' : ''}" data-score="1">\u2605</span>
          <span class="star${userScore && userScore >= 2 ? ' filled' : ''}" data-score="2">\u2605</span>
          <span class="star${userScore && userScore >= 3 ? ' filled' : ''}" data-score="3">\u2605</span>
          <span class="star${userScore && userScore >= 4 ? ' filled' : ''}" data-score="4">\u2605</span>
          <span class="star${userScore && userScore >= 5 ? ' filled' : ''}" data-score="5">\u2605</span>
        </div>
      </div>
      <div class="sidebar-item">
        <div class="label">Version</div>
        <div class="value">${esc(meta.version)}</div>
      </div>
      <div class="sidebar-item">
        <div class="label">Type</div>
        <div class="value">${esc(typeLabel)}</div>
      </div>
      <div class="sidebar-item">
        <div class="label">Registry</div>
        <div class="value muted">${esc(resource.registryName)}</div>
      </div>
      ${meta.tags.length > 0 ? `
      <div class="sidebar-item">
        <div class="label">Tags</div>
        <div class="value">${meta.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join(' ')}</div>
      </div>` : ''}
      <div class="sidebar-item">
        <div class="label">License</div>
        <div class="value muted">MIT</div>
      </div>
      ${downloadCount > 0 ? `
      <div class="sidebar-item">
        <div class="label">Downloads</div>
        <div class="value">${downloadCount}</div>
      </div>` : ''}
    </div>
  </div>

  <script nonce="${nonce}">
    var vscode = acquireVsCodeApi();
    document.getElementById("actionBtn").addEventListener("click", function() {
      vscode.postMessage({ type: this.getAttribute("data-action") });
    });
    var btn2 = document.getElementById("actionBtn2");
    if (btn2) btn2.addEventListener("click", function() {
      vscode.postMessage({ type: this.getAttribute("data-action") });
    });
    var tabs = document.querySelectorAll(".tab");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener("click", function() {
        for (var j = 0; j < tabs.length; j++) tabs[j].classList.remove("active");
        var allContent = document.querySelectorAll(".content");
        for (var k = 0; k < allContent.length; k++) allContent[k].classList.remove("active");
        this.classList.add("active");
        document.getElementById(this.getAttribute("data-tab")).classList.add("active");
      });
    }
    var userRating = document.getElementById("userRating");
    if (userRating) {
      var stars = userRating.querySelectorAll(".star");
      for (var s = 0; s < stars.length; s++) {
        stars[s].addEventListener("mouseenter", function() {
          var score = parseInt(this.getAttribute("data-score"));
          for (var x = 0; x < stars.length; x++) {
            stars[x].classList.toggle("hover", parseInt(stars[x].getAttribute("data-score")) <= score);
          }
        });
        stars[s].addEventListener("mouseleave", function() {
          for (var x = 0; x < stars.length; x++) stars[x].classList.remove("hover");
        });
        stars[s].addEventListener("click", function() {
          var score = parseInt(this.getAttribute("data-score"));
          vscode.postMessage({ type: "rate", score: score });
          for (var x = 0; x < stars.length; x++) {
            stars[x].classList.toggle("filled", parseInt(stars[x].getAttribute("data-score")) <= score);
          }
        });
      }
    }
    window.addEventListener("message", function(event) {
      var msg = event.data;
      if (msg.type === "ratingUpdated") {
        var scoreEl = document.querySelector(".rating-display .score");
        var countEl = document.querySelector(".rating-display .count");
        if (scoreEl) scoreEl.textContent = msg.avgRating.toFixed(1);
        if (countEl) countEl.textContent = "(" + msg.ratingCount + ")";
      }
    });
  </script>
</body>
</html>`
  }
}
