import initSqlJs, { type Database } from 'sql.js'
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'

let db: Database

const DB_PATH = () => path.join(config.dataDir, 'toolhub.db')

export async function initDatabase(): Promise<Database> {
  const SQL = await initSqlJs()
  const dbPath = DB_PATH()

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  db.run('PRAGMA journal_mode=WAL')
  db.run('PRAGMA foreign_keys=ON')

  // --- resources ---
  db.run(`
    CREATE TABLE IF NOT EXISTS resources (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      type          TEXT NOT NULL CHECK(type IN ('extension','skill','agent','instruction')),
      name          TEXT NOT NULL,
      version       TEXT NOT NULL,
      display_name  TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      readme        TEXT NOT NULL DEFAULT '',
      tags          TEXT NOT NULL DEFAULT '[]',
      publisher     TEXT,
      file_name     TEXT NOT NULL,
      avg_rating    REAL NOT NULL DEFAULT 0,
      rating_count  INTEGER NOT NULL DEFAULT 0,
      download_count INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(type, name)
    )
  `)

  // --- ratings ---
  db.run(`
    CREATE TABLE IF NOT EXISTS ratings (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      resource_id   INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      user_id       TEXT NOT NULL,
      score         INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5),
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(resource_id, user_id)
    )
  `)

  // --- publish_log ---
  db.run(`
    CREATE TABLE IF NOT EXISTS publish_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      file_name     TEXT NOT NULL,
      file_size     INTEGER NOT NULL DEFAULT 0,
      status        TEXT NOT NULL DEFAULT 'success',
      error_msg     TEXT,
      published_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  saveDb()
  return db
}

export function getDb(): Database {
  return db
}

export function saveDb(): void {
  if (!db) return
  const data = db.export()
  const buffer = Buffer.from(data)
  const dbPath = DB_PATH()
  const tmpPath = dbPath + '.tmp'
  fs.writeFileSync(tmpPath, buffer)
  fs.renameSync(tmpPath, dbPath)
}

// --- Query helpers ---

export function queryAll<T>(sql: string, params?: unknown[]): T[] {
  const stmt = db.prepare(sql)
  try {
    if (params) stmt.bind(params as initSqlJs.BindParams)
    const rows: T[] = []
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as T)
    }
    return rows
  } finally {
    stmt.free()
  }
}

export function queryOne<T>(sql: string, params?: unknown[]): T | null {
  const rows = queryAll<T>(sql, params)
  return rows[0] ?? null
}

export function run(sql: string, params?: unknown[]): void {
  db.run(sql, params as initSqlJs.BindParams)
}

export function runAndGetId(sql: string, params?: unknown[]): number {
  db.run(sql, params as initSqlJs.BindParams)
  const row = queryOne<{ id: number }>('SELECT last_insert_rowid() as id')
  return row?.id ?? 0
}

// --- Migration from catalog.json ---

export function migrateFromCatalogJson(): void {
  const catalogPath = path.join(config.dataDir, 'catalog.json')
  if (!fs.existsSync(catalogPath)) return

  try {
    const raw = fs.readFileSync(catalogPath, 'utf-8')
    const catalog = JSON.parse(raw) as { items: Array<Record<string, unknown>> }
    if (!catalog.items?.length) return

    const existing = queryOne<{ cnt: number }>('SELECT COUNT(*) as cnt FROM resources')
    if (existing && existing.cnt > 0) return

    for (const item of catalog.items) {
      run(
        `INSERT OR IGNORE INTO resources (type, name, version, display_name, description, tags, publisher, file_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.type,
          item.name,
          item.version,
          item.displayName || item.name,
          item.description || '',
          JSON.stringify(item.tags || []),
          item.publisher || null,
          item.fileName,
        ]
      )
    }
    saveDb()
    console.log(`Migrated ${catalog.items.length} items from catalog.json`)
  } catch (err) {
    console.error('Failed to migrate catalog.json:', err)
  }
}
