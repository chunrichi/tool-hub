import * as vscode from 'vscode'
import type { Registry } from '../types'
import { getRegistries, saveRegistries } from '../config'

export class RegistryView {
  private static panel: vscode.WebviewPanel | undefined

  static show(): void {
    if (RegistryView.panel) {
      RegistryView.panel.reveal(vscode.ViewColumn.Active)
      return
    }

    RegistryView.panel = vscode.window.createWebviewPanel(
      'toolhubRegistries',
      'ToolHub Registries',
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true }
    )

    RegistryView.panel.webview.html = RegistryView.buildHtml()

    RegistryView.panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'add') {
        const registries = getRegistries()
        registries.push({ name: msg.name, url: msg.url })
        await saveRegistries(registries)
        RegistryView.refresh()
        vscode.commands.executeCommand('toolhub.refresh')
      } else if (msg.type === 'remove') {
        let registries = getRegistries()
        registries = registries.filter((r) => r.url !== msg.url)
        await saveRegistries(registries)
        RegistryView.refresh()
        vscode.commands.executeCommand('toolhub.refresh')
      } else if (msg.type === 'edit') {
        const registries = getRegistries()
        const idx = registries.findIndex((r) => r.url === msg.oldUrl)
        if (idx >= 0) {
          registries[idx] = { name: msg.name, url: msg.url }
          await saveRegistries(registries)
          RegistryView.refresh()
          vscode.commands.executeCommand('toolhub.refresh')
        }
      }
    })

    RegistryView.panel.onDidDispose(() => {
      RegistryView.panel = undefined
    })
  }

  static refresh(): void {
    if (RegistryView.panel) {
      RegistryView.panel.webview.html = RegistryView.buildHtml()
    }
  }

  private static buildHtml(): string {
    const nonce = getNonce()
    const registries = getRegistries()

    const registryRows = registries
      .map(
        (r) => `
      <tr>
        <td>${escapeHtml(r.name)}</td>
        <td><code>${escapeHtml(r.url)}</code></td>
        <td>
          <button class="btn-icon btn-edit" data-name="${escapeAttr(r.name)}" data-url="${escapeAttr(r.url)}" title="Edit">$(edit)</button>
          <button class="btn-icon btn-danger btn-remove" data-url="${escapeAttr(r.url)}" title="Remove">$(trash)</button>
        </td>
      </tr>`
      )
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
      padding: 24px; max-width: 700px; margin: 0 auto;
    }
    h1 { font-size: 20px; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); }
    th { color: var(--vscode-descriptionForeground); font-weight: normal; font-size: 12px; text-transform: uppercase; }
    code { font-family: var(--vscode-editor-font-family); font-size: 13px; }
    .btn-icon {
      background: none; border: none; cursor: pointer; padding: 4px 8px;
      color: var(--vscode-editor-foreground); font-size: 14px;
    }
    .btn-icon:hover { color: var(--vscode-focusBorder); }
    .btn-danger:hover { color: var(--vscode-errorForeground); }
    .form { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 16px; }
    .form h2 { font-size: 14px; margin: 0 0 12px 0; }
    .form-row { display: flex; gap: 8px; margin-bottom: 8px; }
    .form-row input {
      flex: 1; padding: 6px 8px; font-family: var(--vscode-font-family); font-size: 13px;
      background: var(--vscode-input-background); color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border); border-radius: 4px;
    }
    .form-row input.error { border-color: var(--vscode-inputValidation-errorBorder); }
    .error-msg { color: var(--vscode-errorForeground); font-size: 12px; margin-bottom: 8px; display: none; }
    .toast {
      padding: 8px 12px; border-radius: 4px; margin-bottom: 12px; font-size: 13px; display: none;
    }
    .toast.success { background: rgba(78, 201, 176, 0.15); color: var(--vscode-testing-iconPassed-foreground); display: block; }
    .toast.error { background: rgba(244, 71, 71, 0.15); color: var(--vscode-errorForeground); display: block; }
    .btn {
      padding: 6px 16px;
      background: var(--vscode-button-background); color: var(--vscode-button-foreground);
      border: none; border-radius: 4px; cursor: pointer; font-size: 13px;
      font-family: var(--vscode-font-family);
    }
    .btn:hover { background: var(--vscode-button-hoverBackground); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .empty { color: var(--vscode-descriptionForeground); padding: 24px; text-align: center; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <h1>ToolHub Registries</h1>

  ${registries.length > 0 ? `
  <table>
    <thead>
      <tr><th>Name</th><th>URL</th><th></th></tr>
    </thead>
    <tbody>${registryRows}</tbody>
  </table>
  ` : '<div class="empty">No registries configured. Add one below.</div>'}

  <div class="form">
    <h2 id="formTitle">Add Registry</h2>
    <div class="toast" id="toast"></div>
    <div class="form-row">
      <input id="regName" placeholder="Display name (e.g. My Company)" />
    </div>
    <div class="error-msg" id="nameError">Please enter a name</div>
    <div class="form-row">
      <input id="regUrl" placeholder="Server URL (e.g. https://toolhub.example.com)" />
    </div>
    <div class="error-msg" id="urlError">Please enter a valid URL</div>
    <div class="form-row">
      <button class="btn" id="submitBtn">Add Registry</button>
      <button class="btn hidden" id="cancelBtn">Cancel</button>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let editMode = false;
    let editOldUrl = '';

    // Wire up all event listeners
    document.getElementById('submitBtn').addEventListener('click', submit);
    document.getElementById('cancelBtn').addEventListener('click', cancelEdit);

    document.querySelectorAll('.btn-edit').forEach(function(btn) {
      btn.addEventListener('click', function() {
        editReg(this.getAttribute('data-name'), this.getAttribute('data-url'));
      });
    });
    document.querySelectorAll('.btn-remove').forEach(function(btn) {
      btn.addEventListener('click', function() {
        removeReg(this.getAttribute('data-url'));
      });
    });

    function submit() {
      const nameEl = document.getElementById('regName');
      const urlEl = document.getElementById('regUrl');
      const name = nameEl.value.trim();
      const url = urlEl.value.trim();

      // Clear previous errors
      nameEl.classList.remove('error');
      urlEl.classList.remove('error');
      document.getElementById('nameError').style.display = 'none';
      document.getElementById('urlError').style.display = 'none';
      hideToast();

      let hasError = false;
      if (!name) {
        nameEl.classList.add('error');
        document.getElementById('nameError').style.display = 'block';
        hasError = true;
      }
      if (!url) {
        urlEl.classList.add('error');
        document.getElementById('urlError').style.display = 'block';
        hasError = true;
      }
      if (hasError) return;

      if (editMode) {
        vscode.postMessage({ type: 'edit', name, url, oldUrl: editOldUrl });
      } else {
        vscode.postMessage({ type: 'add', name, url });
      }

      showToast(editMode ? 'Registry updated!' : 'Registry added!', 'success');
      clearForm();
    }

    function removeReg(url) {
      vscode.postMessage({ type: 'remove', url });
    }

    function editReg(name, url) {
      editMode = true;
      editOldUrl = url;
      document.getElementById('regName').value = name;
      document.getElementById('regUrl').value = url;
      document.getElementById('formTitle').textContent = 'Edit Registry';
      document.getElementById('submitBtn').textContent = 'Save Changes';
      document.getElementById('cancelBtn').classList.remove('hidden');
    }

    function cancelEdit() {
      clearForm();
    }

    function clearForm() {
      editMode = false;
      editOldUrl = '';
      document.getElementById('regName').value = '';
      document.getElementById('regUrl').value = '';
      document.getElementById('regName').classList.remove('error');
      document.getElementById('regUrl').classList.remove('error');
      document.getElementById('nameError').style.display = 'none';
      document.getElementById('urlError').style.display = 'none';
      document.getElementById('formTitle').textContent = 'Add Registry';
      document.getElementById('submitBtn').textContent = 'Add Registry';
      document.getElementById('cancelBtn').classList.add('hidden');
    }

    function showToast(msg, type) {
      const el = document.getElementById('toast');
      el.textContent = msg;
      el.className = 'toast ' + type;
    }

    function hideToast() {
      document.getElementById('toast').className = 'toast';
    }
  </script>
</body>
</html>`
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function escapeAttr(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function getNonce(): string {
  let text = ''
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return text
}
