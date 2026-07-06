import * as vscode from 'vscode'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { publishResource } from '../utils/api'
import { getRegistries } from '../config'
import { getNonce } from './constants'

interface PublishableItem {
  type: 'extension' | 'skill' | 'agent' | 'instruction'
  name: string
  version: string
  filePath: string
  fileName: string
  folderPath: string
}

export class PublishView {
  private static panel: vscode.WebviewPanel | undefined

  static show(context: vscode.ExtensionContext): void {
    const registries = getRegistries()

    if (registries.length === 0) {
      vscode.window.showErrorMessage('No registries configured. Add a registry first.')
      vscode.commands.executeCommand('toolhub.addRegistry')
      return
    }

    const items = scanWorkspace()

    if (PublishView.panel) {
      PublishView.panel.reveal(vscode.ViewColumn.Active)
      PublishView.panel.webview.postMessage({ type: 'scanResult', items })
      return
    }

    PublishView.panel = vscode.window.createWebviewPanel(
      'toolhubPublish',
      'Publish to ToolHub',
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true }
    )

    PublishView.panel.webview.html = buildHtml(registries, items)

    PublishView.panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'publish') {
        const item = items.find((i) => i.filePath === msg.filePath)
        if (item) {
          await handlePublish(item, msg.registry, msg.token, context)
        }
      } else if (msg.type === 'rescan') {
        const fresh = scanWorkspace()
        items.length = 0
        items.push(...fresh)
        PublishView.panel?.webview.postMessage({ type: 'scanResult', items: fresh })
      }
    })

    PublishView.panel.onDidDispose(() => {
      PublishView.panel = undefined
    })
  }

  static notifyResult(success: boolean, message: string): void {
    PublishView.panel?.webview.postMessage({ type: 'result', success, message })
  }
}

// ── Workspace scanner ────────────────────────────────────────

function scanWorkspace(): PublishableItem[] {
  const results: PublishableItem[] = []
  const folders = vscode.workspace.workspaceFolders
  if (!folders) return results

  for (const folder of folders) {
    scanDir(folder.uri.fsPath, results)
  }
  return results
}

function scanDir(root: string, results: PublishableItem[], depth = 0): void {
  if (!fs.existsSync(root) || depth > 5) return

  const entries = fs.readdirSync(root, { withFileTypes: true })
  const skipDirs = new Set(['node_modules', '.git', 'out', 'dist', 'build', '.vscode'])

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name)

    // .vsix files → extension
    if (entry.isFile() && entry.name.endsWith('.vsix')) {
      results.push({
        type: 'extension',
        name: entry.name.replace(/\.vsix$/, ''),
        version: '',
        filePath: fullPath,
        fileName: entry.name,
        folderPath: root,
      })
      continue
    }

    if (!entry.isDirectory()) continue
    if (skipDirs.has(entry.name)) continue

    // Check for version.json to identify publishable directories
    const versionJsonPath = path.join(fullPath, 'version.json')
    if (fs.existsSync(versionJsonPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(versionJsonPath, 'utf-8'))
        if (meta.type && meta.name) {
          results.push({
            type: meta.type as PublishableItem['type'],
            name: meta.displayName || meta.name,
            version: meta.version || '',
            filePath: fullPath,
            fileName: entry.name,
            folderPath: root,
          })
          continue
        }
      } catch {
        // malformed version.json, skip
      }
    }

    // Detect by marker files
    if (fs.existsSync(path.join(fullPath, 'SKILL.md'))) {
      const pkg = readPackageJson(fullPath)
      results.push({
        type: 'skill',
        name: pkg?.displayName || pkg?.name || entry.name,
        version: pkg?.version || '',
        filePath: fullPath,
        fileName: entry.name,
        folderPath: root,
      })
      continue
    }

    const agentFile = findFileByExt(fullPath, '.agent.md')
    if (agentFile) {
      const pkg = readPackageJson(fullPath)
      results.push({
        type: 'agent',
        name: pkg?.displayName || pkg?.name || entry.name,
        version: pkg?.version || '',
        filePath: fullPath,
        fileName: entry.name,
        folderPath: root,
      })
      continue
    }

    const instrFile = findFileByExt(fullPath, '.instructions.md')
    if (instrFile) {
      const pkg = readPackageJson(fullPath)
      results.push({
        type: 'instruction',
        name: pkg?.displayName || pkg?.name || entry.name,
        version: pkg?.version || '',
        filePath: fullPath,
        fileName: entry.name,
        folderPath: root,
      })
      continue
    }

    // Recurse into subdirectories
    scanDir(fullPath, results, depth + 1)
  }
}

function readPackageJson(dir: string): { name?: string; displayName?: string; version?: string } | null {
  const p = path.join(dir, 'package.json')
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'))
  } catch {
    return null
  }
}

function findFileByExt(dir: string, suffix: string): string | null {
  if (!fs.existsSync(dir)) return null
  try {
    const files = fs.readdirSync(dir)
    const found = files.find((f) => f.endsWith(suffix))
    return found ? path.join(dir, found) : null
  } catch {
    return null
  }
}

// ── Pack directory as zip ────────────────────────────────────

async function packDirectory(dirPath: string): Promise<{ buffer: Buffer; fileName: string }> {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()

  function addDir(dir: string, prefix: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      const zipPath = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        addDir(fullPath, zipPath)
      } else {
        zip.file(zipPath, fs.readFileSync(fullPath))
      }
    }
  }

  addDir(dirPath, '')
  const buffer = await zip.generateAsync({ type: 'nodebuffer' })
  const dirName = path.basename(dirPath)
  return { buffer, fileName: `${dirName}.zip` }
}

// ── Publish handler ──────────────────────────────────────────

async function handlePublish(
  item: PublishableItem,
  registryUrl: string,
  token: string,
  context: vscode.ExtensionContext
): Promise<void> {
  try {
    let fileBuffer: Buffer
    let fileName: string

    if (item.type === 'extension' && item.filePath.endsWith('.vsix')) {
      fileBuffer = fs.readFileSync(item.filePath)
      fileName = item.fileName
    } else {
      const packed = await packDirectory(item.filePath)
      fileBuffer = packed.buffer
      fileName = packed.fileName
    }

    const blob = new Blob([fileBuffer])
    await publishResource(registryUrl, token, blob, fileName)

    await context.secrets.store(`toolhub-token-${registryUrl}`, token)

    PublishView.notifyResult(true, `Successfully published ${item.name}`)
  } catch (err) {
    PublishView.notifyResult(false, `Publish failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ── HTML ─────────────────────────────────────────────────────

function buildHtml(registries: { name: string; url: string }[], items: PublishableItem[]): string {
    const nonce = getNonce()
    const registryOptions = registries
      .map((r) => `<option value="${escapeHtml(r.url)}">${escapeHtml(r.name)}</option>`)
      .join('')

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
      padding: 20px; max-width: 700px; margin: 0 auto;
    }
    h1 { font-size: 20px; margin-bottom: 20px; }
    .toolbar {
      display: flex; align-items: center; gap: 12px; margin-bottom: 20px;
    }
    .toolbar label { color: var(--vscode-descriptionForeground); font-size: 13px; }
    .toolbar select {
      flex: 1; padding: 4px 8px;
      background: var(--vscode-input-background); color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border); border-radius: 4px;
      font-family: var(--vscode-font-family); font-size: 13px;
    }
    .toolbar input[type="password"] {
      width: 180px; padding: 4px 8px;
      background: var(--vscode-input-background); color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border); border-radius: 4px;
      font-family: var(--vscode-font-family); font-size: 13px;
    }
    .btn-sm {
      padding: 4px 12px; border: none; border-radius: 4px; cursor: pointer;
      font-family: var(--vscode-font-family); font-size: 12px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .btn-sm:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .list-header {
      font-size: 12px; font-weight: 600; text-transform: uppercase;
      color: var(--vscode-descriptionForeground); letter-spacing: 0.5px;
      padding: 8px 0; border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));
      margin-bottom: 4px;
    }
    .item-card {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 12px; border-radius: 4px; cursor: pointer;
      border: 1px solid transparent; margin-bottom: 4px;
      transition: background 0.15s, border-color 0.15s;
    }
    .item-card:hover { background: var(--vscode-list-hoverBackground); }
    .item-card.selected {
      background: var(--vscode-list-activeSelectionBackground);
      border-color: var(--vscode-focusBorder);
    }
    .type-badge {
      display: inline-block; padding: 2px 8px; border-radius: 10px;
      font-size: 11px; font-weight: 500; flex-shrink: 0; width: 72px; text-align: center;
    }
    .type-badge.extension { background: #007acc22; color: #007acc; }
    .type-badge.skill { background: #cca70022; color: #cca700; }
    .type-badge.agent { background: #4ec9b022; color: #4ec9b0; }
    .type-badge.instruction { background: #b180d722; color: #b180d7; }
    .item-info { flex: 1; min-width: 0; }
    .item-name { font-size: 13px; font-weight: 600; }
    .item-meta { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 2px; }
    .empty {
      padding: 60px 20px; text-align: center;
      color: var(--vscode-descriptionForeground); font-size: 14px;
    }
    .empty .hint { font-size: 12px; margin-top: 8px; opacity: 0.7; }
    .footer {
      display: flex; align-items: center; justify-content: space-between;
      margin-top: 20px; padding-top: 16px;
      border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));
    }
    .btn {
      padding: 8px 24px; border: none; border-radius: 4px; cursor: pointer;
      font-family: var(--vscode-font-family); font-size: 13px;
      background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    }
    .btn:hover { background: var(--vscode-button-hoverBackground); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .result {
      margin-top: 12px; padding: 10px 14px; border-radius: 4px; display: none; font-size: 13px;
    }
    .result.success { background: rgba(78, 201, 176, 0.15); color: var(--vscode-testing-iconPassed-foreground); }
    .result.error { background: rgba(244, 71, 71, 0.15); color: var(--vscode-errorForeground); }
  </style>
</head>
<body>
  <h1>Publish to ToolHub</h1>

  <div class="toolbar">
    <label>Registry</label>
    <select id="registry">${registryOptions}</select>
    <label>Token</label>
    <input type="password" id="token" placeholder="Bearer token" />
    <button class="btn-sm" onclick="rescan()">Rescan</button>
  </div>

  <div id="listContainer"></div>

  <div class="footer">
    <span id="statusText" style="font-size:12px;color:var(--vscode-descriptionForeground)"></span>
    <button class="btn" id="publishBtn" disabled onclick="doPublish()">Publish</button>
  </div>

  <div class="result" id="result"></div>

  <script nonce="${nonce}">
    var vscode = acquireVsCodeApi();
    var allItems = [];
    var selectedPath = null;

    function rescan() {
      vscode.postMessage({ type: 'rescan' });
    }

    function renderList(items) {
      allItems = items;
      var container = document.getElementById('listContainer');
      var statusEl = document.getElementById('statusText');

      if (!items || items.length === 0) {
        container.innerHTML = '<div class="empty">No publishable content found in workspace<div class="hint">Open a folder containing .vsix files, skills, agents, or instructions</div></div>';
        statusEl.textContent = '';
        return;
      }

      var html = '<div class="list-header">Found ' + items.length + ' item(s) in workspace</div>';
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var selected = it.filePath === selectedPath ? ' selected' : '';
        var versionStr = it.version ? 'v' + escHtml(it.version) : '';
        html += '<div class="item-card' + selected + '" data-path="' + escAttr(it.filePath) + '">';
        html += '  <span class="type-badge ' + it.type + '">' + it.type + '</span>';
        html += '  <div class="item-info">';
        html += '    <div class="item-name">' + escHtml(it.name) + (versionStr ? ' <span style="font-weight:400;color:var(--vscode-descriptionForeground)">' + versionStr + '</span>' : '') + '</div>';
        html += '    <div class="item-meta">' + escHtml(it.fileName) + '</div>';
        html += '  </div>';
        html += '</div>';
      }
      container.innerHTML = html;

      statusEl.textContent = selectedPath ? '1 item selected' : 'Click an item to select';
      bindEvents();
    }

    function bindEvents() {
      var cards = document.querySelectorAll('.item-card');
      for (var i = 0; i < cards.length; i++) {
        cards[i].addEventListener('click', function() {
          var prev = document.querySelector('.item-card.selected');
          if (prev) prev.classList.remove('selected');
          this.classList.add('selected');
          selectedPath = this.getAttribute('data-path');
          document.getElementById('publishBtn').disabled = false;
          document.getElementById('statusText').textContent = '1 item selected';
        });
      }
    }

    function doPublish() {
      if (!selectedPath) return;
      var registry = document.getElementById('registry').value;
      var token = document.getElementById('token').value;
      if (!registry) return;

      document.getElementById('publishBtn').disabled = true;
      document.getElementById('result').style.display = 'none';

      vscode.postMessage({
        type: 'publish',
        registry: registry,
        token: token,
        filePath: selectedPath
      });
    }

    function escHtml(t) { return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function escAttr(t) { return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    renderList(${JSON.stringify(items)});

    window.addEventListener('message', function(event) {
      var msg = event.data;
      if (msg.type === 'scanResult') {
        renderList(msg.items);
      } else if (msg.type === 'result') {
        var el = document.getElementById('result');
        el.textContent = msg.message;
        el.className = 'result ' + (msg.success ? 'success' : 'error');
        el.style.display = 'block';
        document.getElementById('publishBtn').disabled = !selectedPath;
      }
    });
  </script>
</body>
</html>`
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
