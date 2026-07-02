import type { ResourceMeta, ApiResponse, UpdateCheckResult, ResourceDetail } from './types'

async function request<T>(baseUrl: string, path: string, options?: RequestInit): Promise<T> {
  const url = `${baseUrl.replace(/\/+$/, '')}${path}`
  const res = await fetch(url, options)
  const json = (await res.json()) as ApiResponse<T>

  if (!res.ok || json.error) {
    throw new Error(json.error || `HTTP ${res.status}`)
  }

  return json.data as T
}

export async function fetchCatalog(baseUrl: string): Promise<ResourceMeta[]> {
  return request<ResourceMeta[]>(baseUrl, '/api/catalog')
}

export async function fetchCatalogByType(baseUrl: string, type: string): Promise<ResourceMeta[]> {
  return request<ResourceMeta[]>(baseUrl, `/api/catalog/${type}`)
}

export async function checkUpdates(
  baseUrl: string,
  items: { id: string; type: string; version: string }[]
): Promise<UpdateCheckResult[]> {
  return request<UpdateCheckResult[]>(baseUrl, '/api/check-updates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  })
}

export async function publishResource(
  baseUrl: string,
  token: string,
  file: File | Blob,
  fileName: string
): Promise<{ fileName: string }> {
  const formData = new FormData()
  formData.append('file', file, fileName)

  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/publish`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  })

  const json = (await res.json()) as ApiResponse<{ fileName: string }>

  if (!res.ok || json.error) {
    throw new Error(json.error || `HTTP ${res.status}`)
  }

  return json.data as { fileName: string }
}

export function getDownloadUrl(baseUrl: string, type: string, id: string, version: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/download/${type}/${id}/${version}`
}

export async function fetchResourceDetail(
  baseUrl: string,
  type: string,
  name: string,
  userId?: string
): Promise<ResourceDetail> {
  const params = userId ? `?userId=${encodeURIComponent(userId)}` : ''
  return request<ResourceDetail>(baseUrl, `/api/resource/${type}/${name}${params}`)
}

export async function submitRating(
  baseUrl: string,
  type: string,
  name: string,
  score: number,
  userId: string
): Promise<{ avgRating: number; ratingCount: number; userScore: number; distribution: Record<number, number> }> {
  return request(baseUrl, '/api/rate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, name, score, userId }),
  })
}

export async function fetchReadme(
  baseUrl: string,
  type: string,
  name: string
): Promise<string> {
  const result = await request<{ readme: string }>(baseUrl, `/api/resource/${type}/${name}/readme`)
  return result.readme
}
