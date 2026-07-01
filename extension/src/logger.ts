import * as vscode from 'vscode'

let outputChannel: vscode.OutputChannel

export function initLogger(channel: vscode.OutputChannel): void {
  outputChannel = channel
}

export function log(message: string): void {
  if (outputChannel) {
    outputChannel.appendLine(message)
  }
  console.log(message)
}
