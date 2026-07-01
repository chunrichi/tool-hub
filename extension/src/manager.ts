import * as vscode from 'vscode'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as os from 'node:os'
import type { ResourceItem, ResourceMeta, InstallStatus, ContentType } from './types'
import { getRegistries } from './config'
import { fetchCatalog, checkUpdates } from './api'

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

export async function installResource(item: ResourceItem): Promise<void> {
  const registries = getRegistries()
  const registry = registries.find((r) => r.name === item.registryName)
  if (!registry) throw new Error('Registry not found')

  const url = `${registry.url.replace(/\/+$/, '')}/api/download/${item.meta.type}/${item.meta.name}/${item.meta.version}`

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)

  const buffer = Buffer.from(await res.arrayBuffer())

  switch (item.meta.type) {
    case 'extension':
      await installExtension(buffer, item.meta)
      break
    case 'skill':
      installToDir(buffer, getSkillDir(item.meta.name), item.meta)
      break
    case 'agent':
      installFile(buffer, getAgentPath(item.meta.name))
      break
    case 'instruction':
      installFile(buffer, getInstructionPath(item.meta.name))
      break
  }
}

export async function uninstallResource(item: ResourceItem): Promise<void> {
  switch (item.meta.type) {
    case 'extension':
      await uninstallExtension(item.meta.name)
      break
    case 'skill':
      removeDir(getSkillDir(item.meta.name))
      break
    case 'agent':
      removeFile(getAgentPath(item.meta.name))
      break
    case 'instruction':
      removeFile(getInstructionPath(item.meta.name))
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
function getSkillDir(name: string): string {
  return path.join(os.homedir(), '.agents', 'skills', name)
}

function getAgentPath(name: string): string {
  return path.join(os.homedir(), '.copilot', 'agents', `${name}.agent.md`)
}

function getInstructionPath(name: string): string {
  return path.join(os.homedir(), '.copilot', `${name}.instructions.md`)
}

function installToDir(buffer: Buffer, dirPath: string, _meta: ResourceMeta): void {
  // For zip files, we'd extract. For now, save directly
  fs.mkdirSync(dirPath, { recursive: true })
  const filePath = path.join(dirPath, `SKILL.md`)
  fs.writeFileSync(filePath, buffer)
}

function installFile(buffer: Buffer, filePath: string): void {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(filePath, buffer)
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

  // Check VS Code extensions
  for (const ext of vscode.extensions.all) {
    if (ext.id.startsWith('toolhub.')) continue
    if (ext.packageJSON?.__toolhub) {
      const meta = ext.packageJSON.__toolhub
      result[`${meta.type}/${meta.name}`] = { version: meta.version }
    }
  }

  // Check skills
  const skillsDir = path.join(os.homedir(), '.agents', 'skills')
  if (fs.existsSync(skillsDir)) {
    for (const name of fs.readdirSync(skillsDir)) {
      const versionFile = path.join(skillsDir, name, 'version.json')
      if (fs.existsSync(versionFile)) {
        try {
          const meta = JSON.parse(fs.readFileSync(versionFile, 'utf-8'))
          result[`skill/${meta.name || name}`] = { version: meta.version }
        } catch { /* ignore */ }
      }
    }
  }

  // Check agents
  const agentsDir = path.join(os.homedir(), '.copilot', 'agents')
  if (fs.existsSync(agentsDir)) {
    for (const file of fs.readdirSync(agentsDir)) {
      if (file.endsWith('.agent.md')) {
        const name = file.replace('.agent.md', '')
        result[`agent/${name}`] = { version: '0.0.0' }
      }
    }
  }

  return result
}
