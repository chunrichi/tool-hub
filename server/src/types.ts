export type ContentType = 'extension' | 'skill' | 'agent' | 'instruction'

export interface ResourceMeta {
  type: ContentType
  name: string
  version: string
  displayName: string
  description: string
  readme?: string
  tags: string[]
  publisher?: string
  fileName: string
  avgRating?: number
  ratingCount?: number
  downloadCount?: number
}

export interface Catalog {
  items: ResourceMeta[]
  lastScan: string
}

export interface UpdateCheckRequest {
  items: { id: string; type: ContentType; version: string }[]
}

export interface UpdateCheckResult {
  id: string
  type: ContentType
  currentVersion: string
  latestVersion: string
  hasUpdate: boolean
}

export interface Rating {
  id: number
  resourceId: number
  userId: string
  score: number
  createdAt: string
}

export interface PublishLogEntry {
  id: number
  fileName: string
  fileSize: number
  status: string
  errorMsg?: string
  publishedAt: string
}

export interface ApiResponse<T = unknown> {
  data?: T
  error?: string
  message?: string
}
