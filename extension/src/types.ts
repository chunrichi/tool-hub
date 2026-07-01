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
}
