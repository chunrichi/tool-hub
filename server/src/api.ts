import { Router, type Request, type Response, type NextFunction } from 'express'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import { execSync } from 'node:child_process'
import archiver from 'archiver'
import semver from 'semver'
import { config } from './config.js'
import {
  getCatalog, upsertResource, getResource,
  upsertRating, getRating, getRatingDistribution,
  incrementDownloadCount, insertPublishLog, getPublishLog, getStats,
} from './storage.js'
import { scanContent, extractFrontmatter } from './scanner.js'
import type { ApiResponse, UpdateCheckRequest, UpdateCheckResult, ResourceMeta } from './types.js'

const upload = multer({ dest: path.join(config.dataDir, 'uploads') })

export const apiRouter = Router()

// POST /api/upload-temp — upload file to temp, return tempId
apiRouter.post(
  '/upload-temp',
  upload.single('file'),
  (req: Request, res: Response) => {
    const file = req.file
    if (!file) {
      res.status(400).json({ error: 'No file uploaded' } satisfies ApiResponse)
      return
    }

    // Rename to preserve original extension
    const ext = path.extname(file.originalname)
    const tempPath = file.path + ext
    fs.renameSync(file.path, tempPath)

    const response: ApiResponse<{ tempId: string; fileName: string }> = {
      data: {
        tempId: path.basename(tempPath),
        fileName: file.originalname,
      },
    }
    res.status(201).json(response)
  }
)

// POST /api/parse-temp — parse temp file metadata
apiRouter.post(
  '/parse-temp',
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tempId } = req.body as { tempId?: string }
      if (!tempId) {
        res.status(400).json({ error: 'tempId required' } satisfies ApiResponse)
        return
      }

      const tempPath = path.join(config.dataDir, 'uploads', tempId)
      if (!fs.existsSync(tempPath)) {
        res.status(404).json({ error: 'Temp file not found' } satisfies ApiResponse)
        return
      }

      const ext = path.extname(tempId).toLowerCase()
      const baseName = path.basename(tempId, ext).replace(/-[a-f0-9]+$/, '') // strip multer hash
      const result = parseFileMetadata(tempPath, ext, baseName)

      if (!result) {
        res.status(400).json({ error: 'Unable to parse file metadata' } satisfies ApiResponse)
        return
      }

      res.json({ data: result } satisfies ApiResponse<typeof result>)
    } catch (err) {
      next(err)
    }
  }
)

// POST /api/publish — finalize publish with metadata
apiRouter.post(
  '/publish',
  authenticateToken,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as {
        tempId?: string
        fileName?: string
        type?: string
        name?: string
        version?: string
        displayName?: string
        description?: string
        tags?: string[]
        readme?: string
      }

      if (!body.tempId || !body.fileName || !body.name || !body.type) {
        res.status(400).json({ error: 'Missing required fields' } satisfies ApiResponse)
        return
      }

      const tempPath = path.join(config.dataDir, 'uploads', body.tempId)
      if (!fs.existsSync(tempPath)) {
        res.status(404).json({ error: 'Temp file not found' } satisfies ApiResponse)
        return
      }

      const ext = path.extname(tempPath).toLowerCase()

      if (ext === '.md') {
        // Single markdown file → create directory with header file
        const dirName = body.name
        const dirPath = path.join(config.contentDir, dirName)
        fs.mkdirSync(dirPath, { recursive: true })

        // Build frontmatter + readme body
        const frontmatter = [
          '---',
          `type: ${body.type}`,
          `name: ${body.name}`,
          `version: ${body.version || '0.0.0'}`,
          `displayName: ${body.displayName || body.name}`,
          `description: ${body.description || ''}`,
          `tags: [${(body.tags || []).join(', ')}]`,
          '---',
          '',
          body.readme || '',
        ].join('\n')

        // Determine header filename
        const headerName =
          body.type === 'skill' ? 'SKILL.md' :
          body.type === 'agent' ? 'AGENT.md' :
          body.type === 'instruction' ? 'INSTRUCTIONS.md' :
          'SKILL.md'

        fs.writeFileSync(path.join(dirPath, headerName), frontmatter, 'utf-8')
      } else if (ext === '.zip' || ext === '.vsix') {
        // Archive → extract to content/
        const destDir = path.join(config.contentDir, body.name)
        fs.mkdirSync(destDir, { recursive: true })
        execSync(`unzip -o "${tempPath}" -d "${destDir}"`, { stdio: 'pipe' })

        // Update header file with user-provided metadata
        const headerCandidates = ['SKILL.md', 'AGENT.md', 'INSTRUCTIONS.md']
        let headerFile: string | null = null
        for (const name of headerCandidates) {
          const p = path.join(destDir, name)
          if (fs.existsSync(p)) { headerFile = p; break }
        }

        if (headerFile) {
          let content = fs.readFileSync(headerFile, 'utf-8')
          const hasFrontmatter = content.startsWith('---')
          if (hasFrontmatter) {
            // Replace existing frontmatter
            content = content.replace(
              /^---\s*\n[\s\S]*?\n---/,
              [
                '---',
                `type: ${body.type}`,
                `name: ${body.name}`,
                `version: ${body.version || '0.0.0'}`,
                `displayName: ${body.displayName || body.name}`,
                `description: ${body.description || ''}`,
                `tags: [${(body.tags || []).join(', ')}]`,
                '---',
              ].join('\n')
            )
          } else {
            // Prepend frontmatter
            content = [
              '---',
              `type: ${body.type}`,
              `name: ${body.name}`,
              `version: ${body.version || '0.0.0'}`,
              `displayName: ${body.displayName || body.name}`,
              `description: ${body.description || ''}`,
              `tags: [${(body.tags || []).join(', ')}]`,
              '---',
              '',
              content,
            ].join('\n')
          }
          fs.writeFileSync(headerFile, content, 'utf-8')
        }
      }

      // Clean up temp file
      fs.unlinkSync(tempPath)

      // Rescan content
      await scanContent()

      // Log publish
      insertPublishLog({
        fileName: body.name,
        fileSize: 0,
        status: 'success',
      })

      const response: ApiResponse = {
        message: `Published ${body.name}`,
        data: { fileName: body.name, type: body.type },
      }
      res.status(201).json(response)
    } catch (err) {
      insertPublishLog({
        fileName: (req.body as { name?: string }).name || 'unknown',
        fileSize: 0,
        status: 'error',
        errorMsg: err instanceof Error ? err.message : String(err),
      })
      next(err)
    }
  }
)
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

  // Track download
  incrementDownloadCount(type, id)

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
    archive.on('error', (_err) => {
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

// POST /api/rate — submit a rating
apiRouter.post('/rate', (req: Request, res: Response) => {
  const { type, name, score, userId } = req.body as {
    type?: string; name?: string; score?: number; userId?: string
  }

  if (!type || !name || !score || !userId) {
    res.status(400).json({ error: 'Missing required fields: type, name, score, userId' } satisfies ApiResponse)
    return
  }

  if (score < 1 || score > 5 || !Number.isInteger(score)) {
    res.status(400).json({ error: 'Score must be an integer between 1 and 5' } satisfies ApiResponse)
    return
  }

  const resource = getResource(type, name)
  if (!resource) {
    res.status(404).json({ error: 'Resource not found' } satisfies ApiResponse)
    return
  }

  upsertRating(resource.id, userId, score)
  const distribution = getRatingDistribution(resource.id)
  const updated = getResource(type, name)!

  res.json({
    data: {
      avgRating: updated.avgRating,
      ratingCount: updated.ratingCount,
      userScore: score,
      distribution,
    },
  } satisfies ApiResponse)
})

// GET /api/resource/:type/:name — resource detail with rating
apiRouter.get('/resource/:type/:name', (req: Request, res: Response) => {
  const { type, name } = req.params
  const resource = getResource(type, name)
  if (!resource) {
    res.status(404).json({ error: 'Resource not found' } satisfies ApiResponse)
    return
  }

  const { userId } = req.query as { userId?: string }
  const userRating = userId ? getRating(resource.id, userId) : null
  const distribution = getRatingDistribution(resource.id)

  res.json({
    data: {
      ...resource,
      userScore: userRating?.score ?? null,
      distribution,
    },
  } satisfies ApiResponse)
})

// GET /api/resource/:type/:name/readme — get readme markdown
apiRouter.get('/resource/:type/:name/readme', (req: Request, res: Response) => {
  const { type, name } = req.params
  const resource = getResource(type, name)
  if (!resource) {
    res.status(404).json({ error: 'Resource not found' } satisfies ApiResponse)
    return
  }

  // Try DB first, fallback to reading from file
  let readme = resource.readme || ''
  if (!readme) {
    const headerCandidates = ['SKILL.md', 'AGENT.md', 'INSTRUCTIONS.md']
    const dirPath = path.join(config.contentDir, resource.fileName)
    for (const candidate of headerCandidates) {
      const p = path.join(dirPath, candidate)
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf-8')
        readme = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '').trim()
        break
      }
    }
  }

  res.json({ data: { readme } } satisfies ApiResponse)
})

// GET /api/publish-log — upload history
apiRouter.get('/publish-log', (_req: Request, res: Response) => {
  const log = getPublishLog(50)
  res.json({ data: log } satisfies ApiResponse)
})

// GET /api/stats — dashboard statistics
apiRouter.get('/stats', (_req: Request, res: Response) => {
  const stats = getStats()
  res.json({ data: stats } satisfies ApiResponse)
})

function guessTypeFromFilename(fileName: string): string {
  const lower = fileName.toLowerCase()
  if (lower.includes('skill')) return 'skill'
  if (lower.includes('agent')) return 'agent'
  if (lower.includes('instruction')) return 'instruction'
  return 'skill'
}

interface ParsedMetadata {
  type: string
  name: string
  version: string
  displayName: string
  description: string
  tags: string[]
  readme: string
  publisher?: string
}

function parseFileMetadata(filePath: string, ext: string, baseName: string): ParsedMetadata | null {
  // .md files — parse frontmatter directly
  if (ext === '.md') {
    const content = fs.readFileSync(filePath, 'utf-8')
    const frontmatter = extractFrontmatter(content)
    if (frontmatter) {
      const body = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '').trim()
      return {
        type: (frontmatter.type as string) || guessTypeFromFilename(baseName),
        name: (frontmatter.name as string) || baseName,
        version: (frontmatter.version as string) || '0.0.0',
        displayName: (frontmatter.displayName as string) || (frontmatter.name as string) || baseName,
        description: (frontmatter.description as string) || '',
        tags: (frontmatter.tags as string[]) || [],
        readme: body,
      }
    }
    return null
  }

  // .zip / .vsix — extract to temp dir, look for header files
  if (ext === '.zip' || ext === '.vsix') {
    const tempDir = path.join(config.dataDir, 'parse-' + Date.now())
    fs.mkdirSync(tempDir, { recursive: true })
    try {
      execSync(`unzip -o "${filePath}" -d "${tempDir}"`, { stdio: 'pipe' })

      const headerCandidates = ['SKILL.md', 'AGENT.md', 'INSTRUCTIONS.md']
      let headerFile: string | null = null

      // Check root level
      for (const name of headerCandidates) {
        const p = path.join(tempDir, name)
        if (fs.existsSync(p)) { headerFile = p; break }
      }

      // Check first-level subdirectory
      if (!headerFile) {
        const entries = fs.readdirSync(tempDir, { withFileTypes: true })
        const subDir = entries.find(e => e.isDirectory())
        if (subDir) {
          for (const name of headerCandidates) {
            const p = path.join(tempDir, subDir.name, name)
            if (fs.existsSync(p)) { headerFile = p; break }
          }
        }
      }

      // Check for *.agent.md, *.instructions.md
      if (!headerFile) {
        const files = fs.readdirSync(tempDir)
        for (const f of files) {
          if (f.endsWith('.agent.md') || f.endsWith('.instructions.md')) {
            headerFile = path.join(tempDir, f)
            break
          }
        }
      }

      if (headerFile) {
        const content = fs.readFileSync(headerFile, 'utf-8')
        const frontmatter = extractFrontmatter(content)
        if (frontmatter) {
          const body = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '').trim()
          return {
            type: (frontmatter.type as string) || guessTypeFromFilename(headerFile),
            name: (frontmatter.name as string) || baseName,
            version: (frontmatter.version as string) || '0.0.0',
            displayName: (frontmatter.displayName as string) || (frontmatter.name as string) || baseName,
            description: (frontmatter.description as string) || '',
            tags: (frontmatter.tags as string[]) || [],
            readme: body,
          }
        }
      }

      // Fallback: parse filename for .vsix
      if (ext === '.vsix') {
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
          readme: '',
        }
      }

      return null
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  }

  return null
}

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
