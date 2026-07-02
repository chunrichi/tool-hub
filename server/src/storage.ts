import { queryAll, queryOne, run, runAndGetId, saveDb } from './database.js'
import type { Catalog, ResourceMeta, Rating, PublishLogEntry } from './types.js'

// --- Resource queries ---

interface ResourceRow {
  id: number
  type: string
  name: string
  version: string
  display_name: string
  description: string
  readme: string
  tags: string
  publisher: string | null
  file_name: string
  avg_rating: number
  rating_count: number
  download_count: number
  created_at: string
  updated_at: string
}

function rowToMeta(row: ResourceRow): ResourceMeta & { id: number } {
  return {
    id: row.id,
    type: row.type as ResourceMeta['type'],
    name: row.name,
    version: row.version,
    displayName: row.display_name,
    description: row.description,
    readme: row.readme,
    tags: JSON.parse(row.tags || '[]'),
    publisher: row.publisher ?? undefined,
    fileName: row.file_name,
    avgRating: row.avg_rating,
    ratingCount: row.rating_count,
    downloadCount: row.download_count,
  }
}

export function getCatalog(): Catalog {
  const rows = queryAll<ResourceRow>('SELECT * FROM resources ORDER BY type, name')
  return {
    items: rows.map(rowToMeta),
    lastScan: new Date().toISOString(),
  }
}

export function upsertResource(meta: ResourceMeta & { readme?: string }): void {
  const existing = queryOne<ResourceRow>(
    'SELECT * FROM resources WHERE type = ? AND name = ?',
    [meta.type, meta.name]
  )

  if (existing) {
    run(
      `UPDATE resources SET
        version = ?, display_name = ?, description = ?, readme = ?,
        tags = ?, publisher = ?, file_name = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [
        meta.version,
        meta.displayName,
        meta.description,
        meta.readme ?? '',
        JSON.stringify(meta.tags),
        meta.publisher ?? null,
        meta.fileName,
        existing.id,
      ]
    )
  } else {
    run(
      `INSERT INTO resources (type, name, version, display_name, description, readme, tags, publisher, file_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        meta.type,
        meta.name,
        meta.version,
        meta.displayName,
        meta.description,
        meta.readme ?? '',
        JSON.stringify(meta.tags),
        meta.publisher ?? null,
        meta.fileName,
      ]
    )
  }
  saveDb()
}

export function getResource(type: string, name: string): (ResourceMeta & { id: number }) | null {
  const row = queryOne<ResourceRow>(
    'SELECT * FROM resources WHERE type = ? AND name = ?',
    [type, name]
  )
  return row ? rowToMeta(row) : null
}

// --- Rating queries ---

export function upsertRating(resourceId: number, userId: string, score: number): void {
  run(
    `INSERT INTO ratings (resource_id, user_id, score)
     VALUES (?, ?, ?)
     ON CONFLICT(resource_id, user_id) DO UPDATE SET score = excluded.score`,
    [resourceId, userId, score]
  )
  // Update denormalized fields on resource
  const stats = queryOne<{ avg: number; cnt: number }>(
    'SELECT AVG(score) as avg, COUNT(*) as cnt FROM ratings WHERE resource_id = ?',
    [resourceId]
  )
  if (stats) {
    run(
      'UPDATE resources SET avg_rating = ?, rating_count = ?, updated_at = datetime(\'now\') WHERE id = ?',
      [stats.avg, stats.cnt, resourceId]
    )
  }
  saveDb()
}

export function getRating(resourceId: number, userId: string): Rating | null {
  const row = queryOne<{
    id: number; resource_id: number; user_id: string; score: number; created_at: string
  }>('SELECT * FROM ratings WHERE resource_id = ? AND user_id = ?', [resourceId, userId])
  if (!row) return null
  return { id: row.id, resourceId: row.resource_id, userId: row.user_id, score: row.score, createdAt: row.created_at }
}

export function getRatingDistribution(resourceId: number): Record<number, number> {
  const rows = queryAll<{ score: number; cnt: number }>(
    'SELECT score, COUNT(*) as cnt FROM ratings WHERE resource_id = ? GROUP BY score',
    [resourceId]
  )
  const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  for (const r of rows) dist[r.score] = r.cnt
  return dist
}

// --- Download count ---

export function incrementDownloadCount(type: string, name: string): void {
  run(
    `UPDATE resources SET download_count = download_count + 1, updated_at = datetime('now')
     WHERE type = ? AND name = ?`,
    [type, name]
  )
  saveDb()
}

// --- Publish log ---

export function insertPublishLog(entry: { fileName: string; fileSize: number; status: string; errorMsg?: string }): void {
  run(
    'INSERT INTO publish_log (file_name, file_size, status, error_msg) VALUES (?, ?, ?, ?)',
    [entry.fileName, entry.fileSize, entry.status, entry.errorMsg ?? null]
  )
  saveDb()
}

export function getPublishLog(limit = 50): PublishLogEntry[] {
  const rows = queryAll<{
    id: number; file_name: string; file_size: number; status: string; error_msg: string | null; published_at: string
  }>('SELECT * FROM publish_log ORDER BY id DESC LIMIT ?', [limit])
  return rows.map(r => ({
    id: r.id,
    fileName: r.file_name,
    fileSize: r.file_size,
    status: r.status,
    errorMsg: r.error_msg ?? undefined,
    publishedAt: r.published_at,
  }))
}

// --- Stats ---

export function getStats(): {
  totalResources: number
  totalDownloads: number
  totalRatings: number
  avgRating: number
  byType: Record<string, number>
  topDownloaded: Array<{ name: string; type: string; downloads: number }>
  topRated: Array<{ name: string; type: string; avgRating: number; ratingCount: number }>
} {
  const totalResources = queryOne<{ cnt: number }>('SELECT COUNT(*) as cnt FROM resources')?.cnt ?? 0
  const totalDownloads = queryOne<{ total: number }>('SELECT COALESCE(SUM(download_count), 0) as total FROM resources')?.total ?? 0
  const totalRatings = queryOne<{ cnt: number }>('SELECT COUNT(*) as cnt FROM ratings')?.cnt ?? 0
  const avgRating = queryOne<{ avg: number }>('SELECT COALESCE(AVG(score), 0) as avg FROM ratings')?.avg ?? 0

  const typeRows = queryAll<{ type: string; cnt: number }>('SELECT type, COUNT(*) as cnt FROM resources GROUP BY type')
  const byType: Record<string, number> = {}
  for (const r of typeRows) byType[r.type] = r.cnt

  const topDownloaded = queryAll<{ name: string; type: string; downloads: number }>(
    'SELECT name, type, download_count as downloads FROM resources ORDER BY download_count DESC LIMIT 10'
  )
  const topRated = queryAll<{ name: string; type: string; avgRating: number; ratingCount: number }>(
    'SELECT name, type, avg_rating as avgRating, rating_count as ratingCount FROM resources WHERE rating_count > 0 ORDER BY avg_rating DESC LIMIT 10'
  )

  return { totalResources, totalDownloads, totalRatings, avgRating, byType, topDownloaded, topRated }
}

// --- Legacy stubs (no longer needed but kept for compatibility) ---

export function setCatalog(_catalog: Catalog): void { /* no-op, use upsertResource */ }
export function loadCatalogFromDisk(): Catalog { return getCatalog() }
export function saveCatalogToDisk(_catalog?: Catalog): void { /* no-op, DB auto-persists */ }
