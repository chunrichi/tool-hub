export type ContentType = 'extension' | 'skill' | 'agent' | 'instruction'

export interface ResourceMeta {
  type: ContentType
  name: string
  version: string
  displayName: string
  description: string
  tags: string[]
  publisher?: string
  fileName: string
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

export interface ApiResponse<T = unknown> {
  data?: T
  error?: string
  message?: string
}
