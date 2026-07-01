import * as vscode from 'vscode'

export class StatusBarManager {
  private item: vscode.StatusBarItem

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
    this.item.command = 'toolhub.refresh'
    this.hide()
  }

  showUpdateCount(count: number): void {
    if (count > 0) {
      this.item.text = `$(cloud-download) ToolHub: ${count} update${count > 1 ? 's' : ''}`
      this.item.tooltip = `${count} resource update${count > 1 ? 's' : ''} available`
      this.item.show()
    } else {
      this.hide()
    }
  }

  showProgress(message: string): void {
    this.item.text = `$(sync~spin) ${message}`
    this.item.tooltip = message
    this.item.show()
  }

  hide(): void {
    this.item.hide()
  }

  dispose(): void {
    this.item.dispose()
  }
}
