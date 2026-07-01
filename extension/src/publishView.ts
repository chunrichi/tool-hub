import * as vscode from 'vscode'
import { publishResource } from './api'
import { getRegistries } from './config'

export class PublishView {
  private static panel: vscode.WebviewPanel | undefined

  static show(context: vscode.ExtensionContext): void {
    const registries = getRegistries()

    if (registries.length === 0) {
      vscode.window.showErrorMessage('No registries configured. Add a registry first.')
      vscode.commands.executeCommand('toolhub.addRegistry')
      return
    }

    if (PublishView.panel) {
      PublishView.panel.reveal(vscode.ViewColumn.Active)
      return
    }

    PublishView.panel = vscode.window.createWebviewPanel(
      'toolhubPublish',
      'Publish to ToolHub',
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true }
    )

    PublishView.panel.webview.html = PublishView.buildHtml(registries)

    PublishView.panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'publish') {
        await handlePublish(msg, context)
      } else if (msg.type === 'browse') {
        const uris = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectMany: false,
          filters: {
            'ToolHub packages': ['vsix', 'zip'],
          },
        })
        if (uris && uris.length > 0) {
          PublishView.panel?.webview.postMessage({
            type: 'fileSelected',
            fileName: uris[0].fsPath.split('/').pop(),
            filePath: uris[0].fsPath,
          })
        }
      }
    })

    PublishView.panel.onDidDispose(() => {
      PublishView.panel = undefined
    })
  }

  static notifyResult(success: boolean, message: string): void {
    PublishView.panel?.webview.postMessage({
      type: 'result',
      success,
      message,
    })
  }

  private static buildHtml(registries: { name: string; url: string }[]): string {
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
      padding: 20px; max-width: 600px; margin: 0 auto;
    }
    h1 { font-size: 20px; margin-bottom: 24px; }
    label { display: block; margin-top: 16px; margin-bottom: 4px; color: var(--vscode-descriptionForeground); font-size: 13px; }
    select, input[type="password"] {
      width: 100%; padding: 6px 8px; font-family: var(--vscode-font-family); font-size: 13px;
      background: var(--vscode-input-background); color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border); border-radius: 4px;
    }
    .drop-zone {
      border: 2px dashed var(--vscode-input-border); border-radius: 8px;
      padding: 40px; text-align: center; margin-top: 16px; cursor: pointer;
      transition: border-color 0.2s;
    }
    .drop-zone:hover { border-color: var(--vscode-focusBorder); }
    .drop-zone .icon { font-size: 32px; margin-bottom: 8px; }
    .file-info {
      margin-top: 12px; padding: 8px 12px;
      background: var(--vscode-textCodeBlock-background); border-radius: 4px;
      display: none;
    }
    .btn {
      display: inline-block; margin-top: 24px; padding: 8px 24px;
      background: var(--vscode-button-background); color: var(--vscode-button-foreground);
      border: none; border-radius: 4px; cursor: pointer; font-size: 13px;
      font-family: var(--vscode-font-family);
    }
    .btn:hover { background: var(--vscode-button-hoverBackground); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .result {
      margin-top: 16px; padding: 12px; border-radius: 4px; display: none;
    }
    .result.success { background: rgba(78, 201, 176, 0.15); color: var(--vscode-testing-iconPassed-foreground); }
    .result.error { background: rgba(244, 71, 71, 0.15); color: var(--vscode-errorForeground); }
  </style>
</head>
<body>
  <h1>Publish to ToolHub</h1>

  <label>Registry</label>
  <select id="registry">${registryOptions}</select>

  <label>Auth Token</label>
  <input type="password" id="token" placeholder="Bearer token" />

  <div class="drop-zone" id="dropZone" onclick="document.getElementById('fileInput').click()">
    <div class="icon">$(cloud-upload)</div>
    <div>Drop .vsix or .zip here, or click to browse</div>
    <input type="file" id="fileInput" accept=".vsix,.zip" style="display:none" />
  </div>

  <div class="file-info" id="fileInfo"></div>

  <button class="btn" id="publishBtn" disabled onclick="doPublish()">Publish</button>

  <div class="result" id="result"></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let selectedFile = null;

    document.getElementById('fileInput').addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        setFile(e.target.files[0].name, e.target.files[0]);
      }
    });

    function setFile(name, file) {
      selectedFile = { name, file };
      document.getElementById('fileInfo').textContent = 'Selected: ' + name;
      document.getElementById('fileInfo').style.display = 'block';
      document.getElementById('publishBtn').disabled = false;
    }

    function doPublish() {
      const registry = document.getElementById('registry').value;
      const token = document.getElementById('token').value;
      if (!selectedFile || !registry) return;

      document.getElementById('publishBtn').disabled = true;
      document.getElementById('result').style.display = 'none';

      vscode.postMessage({
        type: 'publish',
        registry: registry,
        token: token,
        fileName: selectedFile.name
      });
    }

    // Handle file selection from VS Code dialog
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'fileSelected') {
        setFile(msg.fileName, null);
        selectedFile.filePath = msg.filePath;
      } else if (msg.type === 'result') {
        const el = document.getElementById('result');
        el.textContent = msg.message;
        el.className = 'result ' + (msg.success ? 'success' : 'error');
        el.style.display = 'block';
        document.getElementById('publishBtn').disabled = false;
      }
    });
  </script>
</body>
</html>`
  }
}

async function handlePublish(
  msg: { registry: string; token: string; fileName: string; filePath?: string },
  context: vscode.ExtensionContext
): Promise<void> {
  try {
    if (!msg.filePath) {
      // Ask user to select a file
      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectMany: false,
        filters: { 'ToolHub packages': ['vsix', 'zip'] },
      })
      if (!uris || uris.length === 0) {
        PublishView.notifyResult(false, 'No file selected')
        return
      }
      msg.filePath = uris[0].fsPath
      msg.fileName = msg.filePath.split('/').pop() || msg.fileName
    }

    // Read file and publish
    const fs = await import('node:fs')
    const fileBuffer = fs.readFileSync(msg.filePath)
    const blob = new Blob([fileBuffer])

    await publishResource(msg.registry, msg.token, blob, msg.fileName)

    // Save token to secret storage
    await context.secrets.store(`toolhub-token-${msg.registry}`, msg.token)

    PublishView.notifyResult(true, `Successfully published ${msg.fileName}`)
  } catch (err) {
    PublishView.notifyResult(false, `Publish failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function getNonce(): string {
  let text = ''
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return text
}
