import { Router, type Request, type Response, type NextFunction } from 'express'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import archiver from 'archiver'
import semver from 'semver'
import { config } from './config.js'
import { getCatalog, upsertResource } from './storage.js'
import { scanContent } from './scanner.js'
import type { ApiResponse, UpdateCheckRequest, UpdateCheckResult, ResourceMeta } from './types.js'

const upload = multer({ dest: path.join(config.dataDir, 'uploads') })

export const apiRouter = Router()

// GET /api/catalog — full catalog
apiRouter.get('/catalog', (_req: Request, res: Response) => {
  const catalog = getCatalog()
  const response: ApiResponse<ResourceMeta[]> = { data: catalog.items }
  res.json(response)
})

// GET /api/catalog/:type — filter by type
apiRouter.get('/catalog/:type', (req: Request, res: Response) => {
  const { type } = req.params
  const catalog = getCatalog()
  const filtered = catalog.items.filter((i) => i.type === type)
  const response: ApiResponse<ResourceMeta[]> = { data: filtered }
  res.json(response)
})

// GET /api/download/:type/:id/:version — download resource
apiRouter.get('/download/:type/:id/:version', (req: Request, res: Response) => {
  const { type, id, version } = req.params
  const catalog = getCatalog()
  const item = catalog.items.find(
    (i) => i.type === type && i.name === id && i.version === version
  )

  if (!item) {
    const response: ApiResponse = { error: 'Resource not found' }
    res.status(404).json(response)
    return
  }

  const filePath = path.join(config.contentDir, item.fileName)
  if (!fs.existsSync(filePath)) {
    const response: ApiResponse = { error: 'File not found on disk' }
    res.status(404).json(response)
    return
  }

  const stat = fs.statSync(filePath)

  // If it's a file (e.g. .vsix), send directly
  if (stat.isFile()) {
    res.download(filePath, item.fileName)
    return
  }

  // If it's a directory (skill/agent/instruction), create zip on the fly
  if (stat.isDirectory()) {
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${item.fileName}.zip"`)

    const archive = archiver('zip', { zlib: { level: 9 } })
    archive.on('error', (err) => {
      res.status(500).json({ error: 'Archive failed' })
    })
    archive.pipe(res)
    archive.directory(filePath, item.fileName)
    archive.finalize()
    return
  }

  const response: ApiResponse = { error: 'Unsupported file type' }
  res.status(400).json(response)
})

// POST /api/publish — upload resource (requires auth)
apiRouter.post(
  '/publish',
  authenticateToken,
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const file = req.file
      if (!file) {
        const response: ApiResponse = { error: 'No file uploaded' }
        res.status(400).json(response)
        return
      }

      const destPath = path.join(config.contentDir, file.originalname)
      fs.renameSync(file.path, destPath)

      await scanContent()

      const response: ApiResponse = {
        message: `Published ${file.originalname}`,
        data: { fileName: file.originalname },
      }
      res.status(201).json(response)
    } catch (err) {
      next(err)
    }
  }
)

// POST /api/check-updates — batch version check
apiRouter.post('/check-updates', (req: Request, res: Response) => {
  const body = req.body as UpdateCheckRequest
  if (!body.items || !Array.isArray(body.items)) {
    const response: ApiResponse = { error: 'Invalid request body' }
    res.status(400).json(response)
    return
  }

  const catalog = getCatalog()
  const results: UpdateCheckResult[] = body.items.map((item) => {
    const latest = catalog.items.find(
      (i) => i.type === item.type && i.name === item.id
    )
    const latestVersion = latest?.version || item.version
    return {
      id: item.id,
      type: item.type,
      currentVersion: item.version,
      latestVersion,
      hasUpdate: semver.gt(latestVersion, item.version),
    }
  })

  const response: ApiResponse<UpdateCheckResult[]> = { data: results }
  res.json(response)
})

// Auth middleware
function authenticateToken(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : ''

  if (!config.publishToken) {
    next()
    return
  }

  if (token !== config.publishToken) {
    const response: ApiResponse = { error: 'Unauthorized: invalid token' }
    res.status(401).json(response)
    return
  }

  next()
}

// Error handler middleware
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  console.error(`[${new Date().toISOString()}] Error: ${err.message}`)
  const response: ApiResponse = { error: 'Internal server error' }
  res.status(500).json(response)
}
