import * as vscode from 'vscode'
import type { ResourceItem } from '../types'
import { TYPE_ICONS_48, TYPE_COLORS, getNonce } from './constants'

export class SidebarView implements vscode.WebviewViewProvider {
  public static readonly viewType = 'toolhubSidebar'
  private _view?: vscode.WebviewView
  private _items: ResourceItem[] = []
  private _filter = ''

  constructor(private readonly _extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    }
    webviewView.webview.html = this._getHtml()

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'install' || msg.type === 'update') {
        const item = this._items.find((i) => i.meta.name === msg.id)
        console.log(`[Sidebar] ${msg.type} requested for: ${msg.id}, found: ${!!item}`)
        if (item) {
          vscode.commands.executeCommand('toolhub.install', item)
        }
      } else if (msg.type === 'uninstall') {
        const item = this._items.find((i) => i.meta.name === msg.id)
        if (item) {
          vscode.commands.executeCommand('toolhub.uninstall', item)
        }
      } else if (msg.type === 'viewDetails') {
        vscode.commands.executeCommand('toolhub.viewDetails', this._items.find((i) => i.meta.name === msg.id))
      } else if (msg.type === 'filter') {
        this._filter = msg.text
        this._refreshItems()
      } else if (msg.type === 'refresh') {
        vscode.commands.executeCommand('toolhub.refresh')
      } else if (msg.type === 'manageRegistries') {
        vscode.commands.executeCommand('toolhub.manageRegistries')
      }
    })
  }

  setItems(items: ResourceItem[]): void {
    this._items = items
    this._refreshItems()
  }

  private _refreshItems(): void {
    if (!this._view) return
    const filtered = this._getFilteredItems()
    this._view.webview.postMessage({
      type: 'updateItems',
      items: filtered.map((item) => ({
        id: item.meta.name,
        name: item.meta.displayName,
        publisher: item.meta.publisher || item.registryName,
        version: item.meta.version,
        description: item.meta.description,
        type: item.meta.type,
        status: item.status,
        installedVersion: item.installedVersion,
        tags: item.meta.tags,
        avgRating: item.meta.avgRating ?? 0,
        ratingCount: item.meta.ratingCount ?? 0,
        downloadCount: item.meta.downloadCount ?? 0,
      })),
    })
  }

  private _getFilteredItems(): ResourceItem[] {
    if (!this._filter) return this._items
    const text = this._filter.toLowerCase()
    return this._items.filter((item) => {
      if (text === '@installed') return item.status === 'installed'
      if (text === '@available') return item.status === 'available'
      if (text === '@updatable') return item.status === 'updatable'
      if (text.startsWith('@ext:')) return item.meta.type === text.slice(5)
      const searchable = [item.meta.name, item.meta.displayName, item.meta.description, item.meta.publisher || '', ...item.meta.tags].join(' ').toLowerCase()
      return searchable.includes(text)
    })
  }

  private _getHtml(): string {
    const nonce = getNonce()
    const iconSvgs = JSON.stringify(TYPE_ICONS_48)
    const typeColors = JSON.stringify(TYPE_COLORS)

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
      background: var(--vscode-sideBar-background);
      font-size: var(--vscode-font-size, 13px);
      overflow: hidden;
    }

    /* ── Search ── */
    .search-container { padding: 6px 10px 6px 10px; }
    .search-wrapper { position: relative; }
    .search-input {
      width: 100%; padding: 4px 6px 4px 24px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 2px; font-size: 13px;
      font-family: var(--vscode-font-family);
      outline: none;
    }
    .search-input:focus { border-color: var(--vscode-focusBorder); }
    .search-input::placeholder { color: var(--vscode-input-placeholderForeground); }
    .search-icon {
      position: absolute; left: 6px; top: 50%; transform: translateY(-50%);
      color: var(--vscode-input-placeholderForeground); pointer-events: none;
    }

    /* ── Section header (matches official Extensions) ── */
    .section {
      padding: 3px 10px 3px 20px; font-size: 11px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.3px;
      color: var(--vscode-sideBarSectionHeader-foreground);
      background: var(--vscode-sideBarSectionHeader-background);
      border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));
      cursor: pointer; user-select: none;
      display: flex; align-items: center; gap: 4px;
    }
    .section:hover { background: var(--vscode-sideBarSectionHeader-hoverBackground); }
    .section .chevron {
      font-size: 10px; transition: transform 0.15s;
      color: var(--vscode-sideBarSectionHeader-foreground);
    }
    .section.collapsed .chevron { transform: rotate(-90deg); }

    /* ── Item (VS Code Extensions marketplace style) ── */
    .item {
      display: flex; align-items: flex-start; gap: 10px;
      padding: 8px 12px 8px 20px; cursor: pointer;
      border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.1));
    }
    .item:last-child { border-bottom: none; }
    .item:hover { background: var(--vscode-list-hoverBackground); }
    .item.selected { background: var(--vscode-list-activeSelectionBackground); }

    .item-icon {
      width: 36px; height: 36px; border-radius: 3px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      margin-top: 2px;
    }
    .item-icon svg { width: 24px; height: 24px; }

    .item-info { flex: 1; min-width: 0; }

    /* Line 1: Name + Version */
    .item-header {
      display: flex; align-items: baseline; gap: 6px;
      line-height: 1.3;
    }
    .item-name {
      font-size: 13px; font-weight: 600; color: var(--vscode-foreground);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .item-version {
      font-size: 11px; color: var(--vscode-descriptionForeground);
      white-space: nowrap; flex-shrink: 0;
    }

    /* Line 2: Publisher */
    .item-publisher {
      font-size: 12px; color: var(--vscode-descriptionForeground);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      margin-top: 1px; line-height: 1.3;
    }

    /* Line 3: Description (truncated) */
    .item-description {
      font-size: 11px; color: var(--vscode-descriptionForeground);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      margin-top: 1px; line-height: 1.3;
      opacity: 0.8;
    }

    /* Update badge */
    .item-update-badge {
      font-size: 10px; color: var(--vscode-charts-green, #4ec9b0);
      margin-left: 4px; font-weight: 500;
    }

    .item-actions {
      display: flex; gap: 4px; flex-shrink: 0; align-items: center;
      margin-top: 2px;
    }

    /* ── Buttons ── */
    .btn-icon {
      width: 20px; height: 20px; border: none; border-radius: 3px;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      background: transparent; color: var(--vscode-foreground);
      padding: 0;
    }
    .btn-icon:hover { background: var(--vscode-toolbar-hoverBackground); }
    .btn-icon svg { width: 14px; height: 14px; }
    .btn-action {
      padding: 3px 10px; border: 1px solid var(--vscode-focusBorder);
      border-radius: 2px; cursor: pointer; font-size: 11px; font-weight: 500;
      background: transparent; color: var(--vscode-focusBorder);
      font-family: var(--vscode-font-family);
      white-space: nowrap;
    }
    .btn-action:hover { background: var(--vscode-toolbar-hoverBackground); }
    .btn-action.installing {
      opacity: 0.6; cursor: default;
    }

    /* ── Empty ── */
    .empty {
      padding: 40px 20px; text-align: center;
      color: var(--vscode-descriptionForeground);
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="search-container">
    <div class="search-wrapper">
      <span class="search-icon">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0zm-.82 4.74a6 6 0 1 1 1.06-1.06l3.04 3.04a.75.75 0 1 1-1.06 1.06l-3.04-3.04z"/></svg>
      </span>
      <input class="search-input" id="searchInput" placeholder="Search extensions, skills, agents..." />
    </div>
  </div>

  <div id="listContainer"></div>

  <script nonce="${nonce}">
    var ICONS = ${iconSvgs};
    var COLORS = ${typeColors};
    var vscode = acquireVsCodeApi();
    var allItems = [];
    var collapsedSections = {};

    // Search handler
    document.getElementById('searchInput').addEventListener('input', function() {
      vscode.postMessage({ type: 'filter', text: this.value });
    });

    // Listen for messages from extension
    window.addEventListener('message', function(event) {
      var msg = event.data;
      if (msg.type === 'updateItems') {
        allItems = msg.items;
        renderList();
      }
    });

    function renderList() {
      var container = document.getElementById('listContainer');
      var sections = [
        { key: 'installed', label: 'INSTALLED', items: [] },
        { key: 'updatable', label: 'UPDATES AVAILABLE', items: [] },
        { key: 'available', label: 'AVAILABLE', items: [] },
      ];

      for (var i = 0; i < allItems.length; i++) {
        var item = allItems[i];
        for (var j = 0; j < sections.length; j++) {
          if (sections[j].key === item.status) {
            sections[j].items.push(item);
            break;
          }
        }
      }

      var html = '';
      for (var s = 0; s < sections.length; s++) {
        var sec = sections[s];
        if (sec.items.length === 0) continue;

        var collapsed = collapsedSections[sec.key];
        html += '<div class="section' + (collapsed ? ' collapsed' : '') + '" data-section="' + sec.key + '">';
        html += '<span class="chevron">\u25BC</span> ';
        html += sec.label + ' (' + sec.items.length + ')';
        html += '</div>';
        html += '<div class="section-items" data-section="' + sec.key + '" style="' + (collapsed ? 'display:none' : '') + '">';

        for (var k = 0; k < sec.items.length; k++) {
          var it = sec.items[k];
          var icon = ICONS[it.type] || '';
          var color = COLORS[it.type] || '#888';

          // Version display
          var versionHtml = '<span class="item-version">v' + escHtml(it.version) + '</span>';

          // Publisher
          var publisherHtml = '<div class="item-publisher">' + escHtml(it.publisher) + '</div>';

          // Description (truncated to ~50 chars)
          var descText = it.description ? escHtml(it.description.substring(0, 50)) : '';
          if (it.description && it.description.length > 50) descText += '...';
          var descHtml = descText ? '<div class="item-description">' + descText + '</div>' : '';

          // Rating + downloads meta line
          var metaHtml = '';
          var ratingHtml = '';
          if (it.avgRating > 0) {
            var stars = '';
            for (var r = 1; r <= 5; r++) stars += r <= Math.round(it.avgRating) ? '\u2605' : '\u2606';
            ratingHtml = '<span style="color:#d4a017;font-size:10px">' + stars + '</span>';
            ratingHtml += '<span style="font-size:10px;color:var(--vscode-descriptionForeground)">(' + it.ratingCount + ')</span>';
          }
          var dlHtml = it.downloadCount > 0 ? '<span style="font-size:10px;color:var(--vscode-descriptionForeground)">\u2913' + it.downloadCount + '</span>' : '';
          if (ratingHtml || dlHtml) {
            metaHtml = '<div style="display:flex;align-items:center;gap:6px;margin-top:1px">' + ratingHtml + dlHtml + '</div>';
          }

          // Action button
          var actionHtml = '';
          if (it.status === 'available') {
            actionHtml = '<button class="btn-action" data-action="install" data-id="' + it.id + '">Install</button>';
          } else if (it.status === 'updatable') {
            actionHtml = '<button class="btn-action" data-action="update" data-id="' + it.id + '">Update</button>';
          }

          html += '<div class="item" data-id="' + it.id + '">';
          html += '  <div class="item-icon" style="background:' + color + '18;color:' + color + '">' + icon + '</div>';
          html += '  <div class="item-info">';
          html += '    <div class="item-header">';
          html += '      <span class="item-name">' + escHtml(it.name) + '</span>';
          html += versionHtml;
          html += '    </div>';
          html += publisherHtml;
          html += descHtml;
          html += metaHtml;
          html += '  </div>';
          html += '  <div class="item-actions">';
          html += actionHtml;
          html += '  </div>';
          html += '</div>';
        }
        html += '</div>';
      }

      if (!html) {
        html = '<div class="empty">No resources found</div>';
      }

      container.innerHTML = html;
      bindEvents();
    }

    function bindEvents() {
      // Section toggle
      var sections = document.querySelectorAll('.section');
      for (var i = 0; i < sections.length; i++) {
        sections[i].addEventListener('click', function() {
          var key = this.getAttribute('data-section');
          var items = document.querySelector('.section-items[data-section="' + key + '"]');
          if (items) {
            var hidden = items.style.display === 'none';
            items.style.display = hidden ? '' : 'none';
            collapsedSections[key] = !hidden;
            this.classList.toggle('collapsed', !hidden);
          }
        });
      }

      // Item click → open details
      var items = document.querySelectorAll('.item');
      for (var j = 0; j < items.length; j++) {
        items[j].addEventListener('click', function(e) {
          if (e.target.closest('.btn-action')) return;
          vscode.postMessage({ type: 'viewDetails', id: this.getAttribute('data-id') });
        });
      }

      // Install/Update buttons
      var actionBtns = document.querySelectorAll('.btn-action');
      for (var k = 0; k < actionBtns.length; k++) {
        actionBtns[k].addEventListener('click', function(e) {
          e.stopPropagation();
          vscode.postMessage({ type: this.getAttribute('data-action'), id: this.getAttribute('data-id') });
        });
      }
    }

    function escHtml(text) {
      return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  </script>
</body>
</html>`
  }
}


