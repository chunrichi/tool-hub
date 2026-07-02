import express from 'express'
import cors from 'cors'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './config.js'
import { apiRouter, errorHandler } from './api.js'
import { scanContent } from './scanner.js'
import { getCatalog } from './storage.js'
import { initDatabase, migrateFromCatalogJson } from './database.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function main() {
  // Ensure directories exist
  fs.mkdirSync(config.contentDir, { recursive: true })
  fs.mkdirSync(config.dataDir, { recursive: true })

  // Initialize SQLite database
  await initDatabase()
  console.log('Database initialized')

  // Migrate from catalog.json if present
  migrateFromCatalogJson()

  // Scan content directory and upsert into DB
  await scanContent()
  console.log(`Catalog loaded: ${getCatalog().items.length} items`)

  const app = express()

  // Middleware
  app.use(cors())
  app.use(express.json())

  // Static files
  const publicDir = path.resolve(__dirname, '..', 'public')
  app.use(express.static(publicDir))

  // Routes
  app.use('/api', apiRouter)

  // Upload page
  app.get('/upload', (_req, res) => {
    res.sendFile(path.join(publicDir, 'upload.html'))
  })

  // Admin page
  app.get('/admin', (_req, res) => {
    res.sendFile(path.join(publicDir, 'admin.html'))
  })

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  // Error handler
  app.use(errorHandler)

  app.listen(config.port, () => {
    console.log(`ToolHub server running on port ${config.port}`)
    console.log(`Content dir: ${config.contentDir}`)
    console.log(`Upload page: http://localhost:${config.port}/upload`)
  })
}

main().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
