import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import type { Catalog, ResourceMeta } from './types.js'

let catalogCache: Catalog = { items: [], lastScan: '' }

const catalogPath = () => path.join(config.dataDir, 'catalog.json')

export function getCatalog(): Catalog {
  return catalogCache
}

export function setCatalog(catalog: Catalog): void {
  catalogCache = catalog
}

export function loadCatalogFromDisk(): Catalog {
  const p = catalogPath()
  try {
    const raw = fs.readFileSync(p, 'utf-8')
    catalogCache = JSON.parse(raw) as Catalog
  } catch {
    catalogCache = { items: [], lastScan: '' }
  }
  return catalogCache
}

export function saveCatalogToDisk(catalog: Catalog): void {
  const p = catalogPath()
  const tmp = p + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(catalog, null, 2), 'utf-8')
  fs.renameSync(tmp, p)
  catalogCache = catalog
}

export function upsertResource(meta: ResourceMeta): void {
  const existing = catalogCache.items.findIndex(
    (i) => i.type === meta.type && i.name === meta.name
  )
  if (existing >= 0) {
    catalogCache.items[existing] = meta
  } else {
    catalogCache.items.push(meta)
  }
  saveCatalogToDisk(catalogCache)
}
