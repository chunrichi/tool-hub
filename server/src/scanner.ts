import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { saveCatalogToDisk } from './storage.js'
import type { Catalog, ContentType, ResourceMeta } from './types.js'

export async function scanContent(): Promise<Catalog> {
  const items: ResourceMeta[] = []
  const contentDir = config.contentDir

  if (!fs.existsSync(contentDir)) {
    fs.mkdirSync(contentDir, { recursive: true })
    const catalog: Catalog = { items: [], lastScan: new Date().toISOString() }
    saveCatalogToDisk(catalog)
    return catalog
  }

  const entries = fs.readdirSync(contentDir, { withFileTypes: true })

  for (const entry of entries) {
    if (entry.name === '.gitkeep') continue

    if (entry.isFile() && entry.name.endsWith('.vsix')) {
      const meta = scanVsix(path.join(contentDir, entry.name))
      if (meta) items.push(meta)
    }

    if (entry.isDirectory()) {
      const meta = scanDirectory(path.join(contentDir, entry.name), entry.name)
      if (meta) items.push(meta)
    }
  }

  const catalog: Catalog = { items, lastScan: new Date().toISOString() }
  saveCatalogToDisk(catalog)
  return catalog
}

function scanVsix(filePath: string): ResourceMeta | null {
  try {
    const fileName = path.basename(filePath)
    const stat = fs.statSync(filePath)
    const baseName = fileName.replace(/\.vsix$/, '')

    // Parse name-version from filename: publisher.name-version.vsix
    // Fallback to basic extraction
    const parts = baseName.split('-')
    const version = parts.pop() || '0.0.0'
    const name = parts.join('-') || baseName

    return {
      type: 'extension',
      name,
      version,
      displayName: name,
      description: '',
      tags: [],
      fileName,
    }
  } catch {
    return null
  }
}

function scanDirectory(dirPath: string, dirName: string): ResourceMeta | null {
  const versionJsonPath = path.join(dirPath, 'version.json')
  if (!fs.existsSync(versionJsonPath)) return null

  try {
    const raw = fs.readFileSync(versionJsonPath, 'utf-8')
    const meta = JSON.parse(raw) as Record<string, unknown>

    const type = meta.type as ContentType
    if (!['skill', 'agent', 'instruction'].includes(type)) return null

    return {
      type,
      name: (meta.name as string) || dirName,
      version: (meta.version as string) || '0.0.0',
      displayName: (meta.displayName as string) || dirName,
      description: (meta.description as string) || '',
      tags: (meta.tags as string[]) || [],
      fileName: dirName,
    }
  } catch {
    return null
  }
}
