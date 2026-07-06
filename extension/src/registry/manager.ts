import * as vscode from 'vscode'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'
import JSZip from 'jszip'
import type { ResourceItem, ResourceMeta, InstallStatus, ContentType } from '../types'
import { getRegistries } from '../config'
import { fetchCatalog, checkUpdates } from '../utils/api'
import { log } from '../utils/logger'

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
          registryUrl: registry.url,
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
      const meta = parseSkillMetadata(path.join(userSkillsDir, name))
      if (meta) {
        result[`skill/${meta.name}`] = { version: meta.version }
        log(`[ToolHub] Found user skill: ${meta.name} v${meta.version}`)
      }
    }
  }

  const userAgentsDir = path.join(os.homedir(), '.copilot', 'agents')
  if (fs.existsSync(userAgentsDir)) {
    for (const file of fs.readdirSync(userAgentsDir)) {
      if (file.endsWith('.agent.md')) {
        const name = file.replace('.agent.md', '')
        const agentPath = path.join(userAgentsDir, file)
        const version = parseAgentVersion(agentPath)
        result[`agent/${name}`] = { version }
        log(`[ToolHub] Found user agent: ${name} v${version}`)
      }
    }
  }

  // Workspace-level directories
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  log(`[ToolHub] Workspace path: ${ws || 'none'}`)
  if (ws) {
    const wsSkillsDir = path.join(ws, '.copilot', 'skills')
    if (fs.existsSync(wsSkillsDir)) {
      for (const name of fs.readdirSync(wsSkillsDir)) {
        const meta = parseSkillMetadata(path.join(wsSkillsDir, name))
        if (meta) {
          result[`skill/${meta.name}`] = { version: meta.version }
          log(`[ToolHub] Found workspace skill: ${meta.name} v${meta.version}`)
        } else {
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
          const agentPath = path.join(wsAgentsDir, file)
          const version = parseAgentVersion(agentPath)
          result[`agent/${name}`] = { version }
          log(`[ToolHub] Found workspace agent: ${name} v${version}`)
        }
      }
    }
  }

  return result
}

// ── Metadata parsing helpers ──
function parseSkillMetadata(dirPath: string): { name: string; version: string } | null {
  // Try SKILL.md header first
  const skillMd = path.join(dirPath, 'SKILL.md')
  if (fs.existsSync(skillMd)) {
    const header = extractFrontmatter(fs.readFileSync(skillMd, 'utf-8'))
    if (header && header.name) {
      return { name: header.name as string, version: (header.version as string) || '0.0.0' }
    }
  }

  // Fallback: version.json
  const versionFile = path.join(dirPath, 'version.json')
  if (fs.existsSync(versionFile)) {
    try {
      const meta = JSON.parse(fs.readFileSync(versionFile, 'utf-8'))
      return { name: meta.name || path.basename(dirPath), version: meta.version || '0.0.0' }
    } catch { /* ignore */ }
  }

  return null
}

function parseAgentVersion(filePath: string): string {
  const content = fs.readFileSync(filePath, 'utf-8')
  const header = extractFrontmatter(content)
  return (header?.version as string) || '0.0.0'
}

function extractFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) return null

  const yaml = match[1]
  const result: Record<string, unknown> = {}
  let currentKey = ''
  let isArray = false
  let arrayValues: string[] = []

  for (const line of yaml.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (trimmed.startsWith('- ')) {
      if (isArray) {
        arrayValues.push(trimmed.slice(2).trim().replace(/^["']|["']$/g, ''))
      }
      continue
    }

    const colonIdx = trimmed.indexOf(':')
    if (colonIdx > 0) {
      if (isArray && currentKey) {
        result[currentKey] = arrayValues
      }

      currentKey = trimmed.slice(0, colonIdx).trim()
      const value = trimmed.slice(colonIdx + 1).trim()

      if (value === '' || value === '[]') {
        isArray = true
        arrayValues = []
      } else {
        isArray = false
        arrayValues = []
        if (value.startsWith('[') && value.endsWith(']')) {
          result[currentKey] = value.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, ''))
        } else if (value === 'true') {
          result[currentKey] = true
        } else if (value === 'false') {
          result[currentKey] = false
        } else if (/^\d+$/.test(value)) {
          result[currentKey] = parseInt(value, 10)
        } else {
          result[currentKey] = value.replace(/^["']|["']$/g, '')
        }
      }
    }
  }

  if (isArray && currentKey) {
    result[currentKey] = arrayValues
  }

  return result
}
