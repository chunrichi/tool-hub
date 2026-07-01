import express from 'express'
import cors from 'cors'
import fs from 'node:fs'
import { config } from './config.js'
import { apiRouter, errorHandler } from './api.js'
import { scanContent } from './scanner.js'
import { loadCatalogFromDisk } from './storage.js'

async function main() {
  // Ensure directories exist
  fs.mkdirSync(config.contentDir, { recursive: true })
  fs.mkdirSync(config.dataDir, { recursive: true })

  // Scan content and load catalog
  await scanContent()
  console.log(`Catalog loaded: ${loadCatalogFromDisk().items.length} items`)

  const app = express()

  // Middleware
  app.use(cors())
  app.use(express.json())

  // Routes
  app.use('/api', apiRouter)

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  // Error handler
  app.use(errorHandler)

  app.listen(config.port, () => {
    console.log(`ToolHub server running on port ${config.port}`)
    console.log(`Content dir: ${config.contentDir}`)
  })
}

main().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
