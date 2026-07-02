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

export interface ResourceDetail extends ResourceMeta {
  userScore: number | null
  distribution: Record<number, number>
}

export interface Registry {
  name: string
  url: string
}

export interface ApiResponse<T = unknown> {
  data?: T
  error?: string
  message?: string
}

export interface UpdateCheckResult {
  id: string
  type: ContentType
  currentVersion: string
  latestVersion: string
  hasUpdate: boolean
}

export type InstallStatus = 'installed' | 'updatable' | 'available'

export interface ResourceItem {
  meta: ResourceMeta
  status: InstallStatus
  installedVersion?: string
  registryName: string
  registryUrl: string
}
