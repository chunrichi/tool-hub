import * as vscode from 'vscode'
import type { ResourceItem, ContentType } from './types'

const TYPE_ICONS: Record<ContentType, string> = {
  extension: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`,
  skill: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2a7 7 0 0 1 7 7c0 2.5-1.5 4.5-3 6s-2 3-2 5h-4c0-2-.5-3.5-2-5s-3-3.5-3-6a7 7 0 0 1 7-7z"/><line x1="9" y1="18" x2="15" y2="18"/><line x1="10" y1="22" x2="14" y2="22"/></svg>`,
  agent: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/></svg>`,
  instruction: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
}

const TYPE_COLORS: Record<ContentType, string> = {
  extension: '#007acc',
  skill: '#cca700',
  agent: '#4ec9b0',
  instruction: '#b180d7',
}

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
        vscode.commands.executeCommand('toolhub.install', this._items.find((i) => i.meta.name === msg.id))
      } else if (msg.type === 'uninstall') {
        vscode.commands.executeCommand('toolhub.uninstall', this._items.find((i) => i.meta.name === msg.id))
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
    const iconSvgs = JSON.stringify(TYPE_ICONS)
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

    /* ── Item (matches official Extensions layout) ── */
    .item {
      display: flex; align-items: center; gap: 8px;
      padding: 6px 10px 6px 20px; cursor: pointer;
    }
    .item:hover { background: var(--vscode-list-activeSelectionBackground); }
    .item-icon {
      width: 32px; height: 32px; border-radius: 4px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
    }
    .item-icon svg { width: 20px; height: 20px; }
    .item-info { flex: 1; min-width: 0; }
    .item-row1 {
      display: flex; align-items: baseline; gap: 6px;
    }
    .item-name {
      font-size: 13px; font-weight: 600; color: var(--vscode-foreground);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .item-publisher {
      font-size: 11px; color: var(--vscode-descriptionForeground);
      white-space: nowrap;
    }
    .item-row2 {
      font-size: 11px; color: var(--vscode-descriptionForeground);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      margin-top: 1px;
    }
    .item-actions { display: flex; gap: 4px; flex-shrink: 0; align-items: center; }

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
      <input class="search-input" id="searchInput" placeholder="Search ToolHub..." />
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

          // Row 2: version info
          var row2 = '';
          if (it.status === 'updatable' && it.installedVersion) {
            row2 = it.installedVersion + ' \u2192 ' + it.version;
          } else {
            row2 = 'v' + it.version;
          }
          if (it.description) {
            row2 += ' \u00B7 ' + it.description.substring(0, 60);
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
          html += '    <div class="item-row1">';
          html += '      <span class="item-name">' + escHtml(it.name) + '</span>';
          html += '      <span class="item-publisher">' + escHtml(it.publisher) + '</span>';
          html += '    </div>';
          html += '    <div class="item-row2">' + row2 + '</div>';
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

function getNonce(): string {
  var text = ''
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  for (var i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return text
}
