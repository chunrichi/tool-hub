import * as vscode from 'vscode'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'
import JSZip from 'jszip'
import type { ResourceItem, ResourceMeta, InstallStatus, ContentType } from './types'
import { getRegistries } from './config'
import { fetchCatalog, checkUpdates } from './api'
import { log } from './logger'

export async function loadResources(): Promise<ResourceItem[]> {
  const registries = getRegistries()
  if (registries.length === 0) return []

  const installedMap = getInstalledResources()
  const allItems: ResourceItem[] = []

  for (const registry of registries) {
    try {
      const catalog = await fetchCatalog(registry.url)

      for (const meta of catalog) {
        const key = `${meta.type}/${meta.name}`
        const installed = installedMap[key]
        const status: InstallStatus = installed
          ? installed.version !== meta.version
            ? 'updatable'
            : 'installed'
          : 'available'

        allItems.push({
          meta,
          status,
          installedVersion: installed?.version,
          registryName: registry.name,
        })
      }
    } catch (err) {
      console.error(`Failed to fetch catalog from ${registry.name}:`, err)
    }
  }

  return allItems
}

export async function refreshUpdateStatus(items: ResourceItem[]): Promise<number> {
  const registries = getRegistries()
  const installedItems = items.filter((i) => i.status === 'installed' || i.status === 'updatable')

  if (installedItems.length === 0) return 0

  let updateCount = 0

  for (const registry of registries) {
    const checkItems = installedItems
      .filter((i) => i.registryName === registry.name)
      .map((i) => ({ id: i.meta.name, type: i.meta.type, version: i.installedVersion || i.meta.version }))

    if (checkItems.length === 0) continue

    try {
      const results = await checkUpdates(registry.url, checkItems)
      for (const result of results) {
        if (result.hasUpdate) {
          const item = items.find(
            (i) => i.meta.name === result.id && i.meta.type === result.type
          )
          if (item) {
            item.status = 'updatable'
            updateCount++
          }
        }
      }
    } catch (err) {
      console.error(`Failed to check updates from ${registry.name}:`, err)
    }
  }

  return updateCount
}

export async function installResource(item: ResourceItem, scope: InstallScope = 'workspace'): Promise<void> {
  const registries = getRegistries()
  const registry = registries.find((r) => r.name === item.registryName)
  if (!registry) throw new Error('Registry not found')

  const url = `${registry.url.replace(/\/+$/, '')}/api/download/${item.meta.type}/${item.meta.name}/${item.meta.version}`

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)

  const buffer = Buffer.from(await res.arrayBuffer())

  // Determine install path for logging
  let installPath = ''
  switch (item.meta.type) {
    case 'extension':
      installPath = '(VS Code extensions directory)'
      await installExtension(buffer, item.meta)
      break
    case 'skill':
      installPath = getSkillDir(item.meta.name, scope)
      await installToDir(buffer, installPath, item.meta)
      break
    case 'agent':
      installPath = getAgentPath(item.meta.name, scope)
      await installFile(buffer, installPath)
      break
    case 'instruction':
      installPath = getInstructionPath(item.meta.name, scope)
      await installFile(buffer, installPath)
      break
  }

  log(`[ToolHub] Installed ${item.meta.type} "${item.meta.displayName}" v${item.meta.version} → ${installPath}`)
}

export async function uninstallResource(item: ResourceItem, scope: InstallScope = 'workspace'): Promise<void> {
  switch (item.meta.type) {
    case 'extension':
      await uninstallExtension(item.meta.name)
      break
    case 'skill':
      removeDir(getSkillDir(item.meta.name, scope))
      break
    case 'agent':
      removeFile(getAgentPath(item.meta.name, scope))
      break
    case 'instruction':
      removeFile(getInstructionPath(item.meta.name, scope))
      break
  }
}

// ── Extension install via VS Code command ──
async function installExtension(buffer: Buffer, _meta: ResourceMeta): Promise<void> {
  const tmpDir = path.join(os.tmpdir(), 'toolhub')
  fs.mkdirSync(tmpDir, { recursive: true })
  const vsixPath = path.join(tmpDir, `${_meta.name}-${_meta.version}.vsix`)
  fs.writeFileSync(vsixPath, buffer)

  const uri = vscode.Uri.file(vsixPath)
  await vscode.commands.executeCommand('workbench.extensions.installExtension', uri)

  fs.unlinkSync(vsixPath)
}

async function uninstallExtension(name: string): Promise<void> {
  await vscode.commands.executeCommand('workbench.extensions.uninstallExtension', name)
}

// ── File-based install for skills/agents/instructions ──
export type InstallScope = 'workspace' | 'user'

function getSkillDir(name: string, scope: InstallScope): string {
  if (scope === 'workspace') {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd()
    return path.join(ws, '.copilot', 'skills', name)
  }
  return path.join(os.homedir(), '.agents', 'skills', name)
}

function getAgentPath(name: string, scope: InstallScope): string {
  if (scope === 'workspace') {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd()
    return path.join(ws, '.copilot', 'agents', `${name}.agent.md`)
  }
  return path.join(os.homedir(), '.copilot', 'agents', `${name}.agent.md`)
}

function getInstructionPath(name: string, scope: InstallScope): string {
  if (scope === 'workspace') {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd()
    return path.join(ws, '.copilot', `${name}.instructions.md`)
  }
  return path.join(os.homedir(), '.copilot', `${name}.instructions.md`)
}

async function installToDir(buffer: Buffer, dirPath: string, meta: ResourceMeta): Promise<void> {
  // Server sends zip for directory-based resources
  const zip = await JSZip.loadAsync(buffer)
  fs.mkdirSync(dirPath, { recursive: true })

  for (const [zipPath, file] of Object.entries(zip.files)) {
    if (file.dir) continue
    // Strip the top-level directory from zip path (e.g. "hello-world/SKILL.md" → "SKILL.md")
    const parts = zipPath.split('/')
    const relativePath = parts.length > 1 ? parts.slice(1).join('/') : zipPath
    if (!relativePath) continue
    const fullPath = path.join(dirPath, relativePath)
    const fileDir = path.dirname(fullPath)
    fs.mkdirSync(fileDir, { recursive: true })
    const content = await file.async('nodebuffer')
    fs.writeFileSync(fullPath, content)
  }
}

async function installFile(buffer: Buffer, filePath: string): Promise<void> {
  // Server sends zip for all directory-based resources
  const zip = await JSZip.loadAsync(buffer)
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })

  for (const [zipPath, file] of Object.entries(zip.files)) {
    if (file.dir) continue
    // Strip the top-level directory from zip path
    const parts = zipPath.split('/')
    const relativePath = parts.length > 1 ? parts.slice(1).join('/') : zipPath
    if (!relativePath) continue
    const fullPath = path.join(dir, relativePath)
    const fileDir = path.dirname(fullPath)
    fs.mkdirSync(fileDir, { recursive: true })
    const content = await file.async('nodebuffer')
    fs.writeFileSync(fullPath, content)
  }
}

function removeDir(dirPath: string): void {
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true })
  }
}

function removeFile(filePath: string): void {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }
}

// ── Installed resources tracking ──
function getInstalledResources(): Record<string, { version: string }> {
  const result: Record<string, { version: string }> = {}
  log('[ToolHub] Scanning installed resources...')

  // Check VS Code extensions
  for (const ext of vscode.extensions.all) {
    if (ext.id.startsWith('toolhub.')) continue
    if (ext.packageJSON?.__toolhub) {
      const meta = ext.packageJSON.__toolhub
      result[`${meta.type}/${meta.name}`] = { version: meta.version }
    }
  }

  // User-level directories
  const userSkillsDir = path.join(os.homedir(), '.agents', 'skills')
  if (fs.existsSync(userSkillsDir)) {
    for (const name of fs.readdirSync(userSkillsDir)) {
      const versionFile = path.join(userSkillsDir, name, 'version.json')
      if (fs.existsSync(versionFile)) {
        try {
          const meta = JSON.parse(fs.readFileSync(versionFile, 'utf-8'))
          result[`skill/${meta.name || name}`] = { version: meta.version }
          log(`[ToolHub] Found user skill: ${meta.name || name}`)
        } catch { /* ignore */ }
      }
    }
  }

  const userAgentsDir = path.join(os.homedir(), '.copilot', 'agents')
  if (fs.existsSync(userAgentsDir)) {
    for (const file of fs.readdirSync(userAgentsDir)) {
      if (file.endsWith('.agent.md')) {
        const name = file.replace('.agent.md', '')
        result[`agent/${name}`] = { version: '0.0.0' }
        log(`[ToolHub] Found user agent: ${name}`)
      }
    }
  }

  // Workspace-level directories
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  log(`[ToolHub] Workspace path: ${ws || 'none'}`)
  if (ws) {
    const wsSkillsDir = path.join(ws, '.copilot', 'skills')
    log(`[ToolHub] Checking workspace skills dir: ${wsSkillsDir}, exists: ${fs.existsSync(wsSkillsDir)}`)
    if (fs.existsSync(wsSkillsDir)) {
      for (const name of fs.readdirSync(wsSkillsDir)) {
        log(`[ToolHub] Found workspace skill dir: ${name}`)
        const versionFile = path.join(wsSkillsDir, name, 'version.json')
        const exists = fs.existsSync(versionFile)
        log(`[ToolHub] version.json exists: ${exists}, path: ${versionFile}`)
        if (exists) {
          try {
            const raw = fs.readFileSync(versionFile, 'utf-8')
            log(`[ToolHub] version.json content: ${raw}`)
            const meta = JSON.parse(raw)
            result[`skill/${meta.name || name}`] = { version: meta.version }
            log(`[ToolHub] Found workspace skill: ${meta.name || name} v${meta.version}`)
          } catch (e) {
            log(`[ToolHub] Error reading version.json: ${e}`)
          }
        } else {
          // List files in the directory to debug
          const files = fs.readdirSync(path.join(wsSkillsDir, name))
          log(`[ToolHub] Files in ${name}: ${files.join(', ')}`)
        }
      }
    }

    const wsAgentsDir = path.join(ws, '.copilot', 'agents')
    if (fs.existsSync(wsAgentsDir)) {
      for (const file of fs.readdirSync(wsAgentsDir)) {
        if (file.endsWith('.agent.md')) {
          const name = file.replace('.agent.md', '')
          result[`agent/${name}`] = { version: '0.0.0' }
          log(`[ToolHub] Found workspace agent: ${name}`)
        }
      }
    }
  }

  return result
}
