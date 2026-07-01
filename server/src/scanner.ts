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
  // Try SKILL.md / *.agent.md / *.instructions.md header first
  const headerFile = findHeaderFile(dirPath)
  if (headerFile) {
    const meta = parseHeaderFile(headerFile, dirName)
    if (meta) return meta
  }

  // Fallback: version.json (legacy format)
  const versionJsonPath = path.join(dirPath, 'version.json')
  if (fs.existsSync(versionJsonPath)) {
    try {
      const raw = fs.readFileSync(versionJsonPath, 'utf-8')
      const meta = JSON.parse(raw) as Record<string, unknown>
      const type = meta.type as ContentType
      if (['skill', 'agent', 'instruction'].includes(type)) {
        return {
          type,
          name: (meta.name as string) || dirName,
          version: (meta.version as string) || '0.0.0',
          displayName: (meta.displayName as string) || dirName,
          description: (meta.description as string) || '',
          tags: (meta.tags as string[]) || [],
          fileName: dirName,
        }
      }
    } catch { /* ignore */ }
  }

  return null
}

function findHeaderFile(dirPath: string): string | null {
  const candidates = ['SKILL.md', 'AGENT.md', 'INSTRUCTIONS.md']
  for (const name of candidates) {
    const p = path.join(dirPath, name)
    if (fs.existsSync(p)) return p
  }
  // Also check for *.agent.md, *.instructions.md
  const files = fs.readdirSync(dirPath)
  for (const f of files) {
    if (f.endsWith('.agent.md') || f.endsWith('.instructions.md')) {
      return path.join(dirPath, f)
    }
  }
  return null
}

function parseHeaderFile(filePath: string, dirName: string): ResourceMeta | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const header = extractFrontmatter(raw)
    if (!header) return null

    const type = header.type as string
    if (!['skill', 'agent', 'instruction'].includes(type)) return null

    return {
      type: type as ContentType,
      name: (header.name as string) || dirName,
      version: (header.version as string) || '0.0.0',
      displayName: (header.displayName as string) || (header.name as string) || dirName,
      description: (header.description as string) || '',
      tags: (header.tags as string[]) || [],
      fileName: dirName,
    }
  } catch {
    return null
  }
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

    // Array item
    if (trimmed.startsWith('- ')) {
      if (isArray) {
        arrayValues.push(trimmed.slice(2).trim().replace(/^["']|["']$/g, ''))
      }
      continue
    }

    // New key
    const colonIdx = trimmed.indexOf(':')
    if (colonIdx > 0) {
      // Save previous array
      if (isArray && currentKey) {
        result[currentKey] = arrayValues
      }

      currentKey = trimmed.slice(0, colonIdx).trim()
      const value = trimmed.slice(colonIdx + 1).trim()

      if (value === '' || value === '[]') {
        // Could be an array
        isArray = true
        arrayValues = []
      } else {
        isArray = false
        arrayValues = []
        // Parse value
        if (value.startsWith('[') && value.endsWith(']')) {
          // Inline array: [tag1, tag2]
          result[currentKey] = value
            .slice(1, -1)
            .split(',')
            .map((s) => s.trim().replace(/^["']|["']$/g, ''))
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

  // Save last array
  if (isArray && currentKey) {
    result[currentKey] = arrayValues
  }

  return result
}
