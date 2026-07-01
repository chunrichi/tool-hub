import * as vscode from 'vscode'
import type { ResourceItem, ContentType, InstallStatus } from './types'

// ── Type icons ──────────────────────────────────────────────
const TYPE_ICONS: Record<ContentType, string> = {
  extension: 'extensions',
  skill: 'brain',
  agent: 'robot',
  instruction: 'note',
}

// ── Tree node types ─────────────────────────────────────────
export class CategoryTreeItem extends vscode.TreeItem {
  constructor(
    public readonly category: 'installed' | 'updatable' | 'available',
    count: number
  ) {
    const labels = {
      installed: 'INSTALLED',
      updatable: 'UPDATES AVAILABLE',
      available: 'AVAILABLE',
    }
    super(labels[category], vscode.TreeItemCollapsibleState.Expanded)
    this.description = `(${count})`
    this.contextValue = 'category'
    this.iconPath = new vscode.ThemeIcon('package')
  }
}

export class ResourceTreeItem extends vscode.TreeItem {
  constructor(public readonly resource: ResourceItem) {
    super(resource.meta.displayName, vscode.TreeItemCollapsibleState.None)

    const iconId = TYPE_ICONS[resource.meta.type]
    this.iconPath = new vscode.ThemeIcon(iconId)

    // Description: version + publisher
    const publisher = resource.meta.publisher || resource.registryName
    if (resource.status === 'updatable') {
      this.description = `${resource.installedVersion} → ${resource.meta.version} · ${publisher}`
    } else {
      this.description = `v${resource.meta.version} · ${publisher}`
    }

    // contextValue drives menu visibility
    this.contextValue = resource.status

    // Rich tooltip
    this.tooltip = buildTooltip(resource)

    // Click opens details
    this.command = {
      command: 'toolhub.viewDetails',
      title: 'View Details',
      arguments: [resource],
    }
  }
}

function buildTooltip(resource: ResourceItem): vscode.MarkdownString {
  const md = new vscode.MarkdownString()
  md.isTrusted = true
  md.supportThemeIcons = true

  md.appendMarkdown(`### ${resource.meta.displayName}\n\n`)
  md.appendMarkdown(`**Type:** ${resource.meta.type}  \n`)
  md.appendMarkdown(`**Name:** \`${resource.meta.name}\`  \n`)
  md.appendMarkdown(`**Version:** ${resource.meta.version}  \n`)

  if (resource.meta.publisher) {
    md.appendMarkdown(`**Publisher:** ${resource.meta.publisher}  \n`)
  }

  if (resource.meta.description) {
    md.appendMarkdown(`\n${resource.meta.description}\n`)
  }

  if (resource.meta.tags.length > 0) {
    md.appendMarkdown(`\n**Tags:** ${resource.meta.tags.join(', ')}\n`)
  }

  if (resource.status === 'updatable' && resource.installedVersion) {
    md.appendMarkdown(`\n---\n*Update available: ${resource.installedVersion} → ${resource.meta.version}*`)
  }

  return md
}

// ── Data Provider ───────────────────────────────────────────
export type TreeElement = CategoryTreeItem | ResourceTreeItem

export class ToolHubProvider implements vscode.TreeDataProvider<TreeElement> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeElement | undefined | null | void>()
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event

  private items: ResourceItem[] = []
  private filterText = ''

  refresh(): void {
    this._onDidChangeTreeData.fire()
  }

  setItems(items: ResourceItem[]): void {
    this.items = items
    this.refresh()
  }

  setFilter(text: string): void {
    this.filterText = text
    this.refresh()
  }

  getTreeItem(element: TreeElement): vscode.TreeItem {
    return element
  }

  getChildren(element?: TreeElement): TreeElement[] {
    if (element) {
      // Children of a category node → resource items
      if (element instanceof CategoryTreeItem) {
        return this.getResourcesForCategory(element.category)
      }
      return []
    }

    // Root → category nodes
    return this.getCategories()
  }

  private getFilteredItems(): ResourceItem[] {
    if (!this.filterText) return this.items

    const text = this.filterText.toLowerCase()

    return this.items.filter((item) => {
      // Syntax filters
      if (text === '@installed') return item.status === 'installed'
      if (text === '@available') return item.status === 'available'
      if (text === '@updatable') return item.status === 'updatable'
      if (text.startsWith('@ext:')) {
        const type = text.slice(5)
        return item.meta.type === type
      }

      // Text search
      const searchable = [
        item.meta.name,
        item.meta.displayName,
        item.meta.description,
        item.meta.publisher || '',
        ...item.meta.tags,
      ]
        .join(' ')
        .toLowerCase()

      return searchable.includes(text)
    })
  }

  private getCategories(): TreeElement[] {
    const filtered = this.getFilteredItems()
    const categories: TreeElement[] = []

    const installed = filtered.filter((i) => i.status === 'installed')
    const updatable = filtered.filter((i) => i.status === 'updatable')
    const available = filtered.filter((i) => i.status === 'available')

    if (installed.length > 0) {
      categories.push(new CategoryTreeItem('installed', installed.length))
    }
    if (updatable.length > 0) {
      categories.push(new CategoryTreeItem('updatable', updatable.length))
    }
    if (available.length > 0) {
      categories.push(new CategoryTreeItem('available', available.length))
    }

    return categories
  }

  private getResourcesForCategory(
    category: 'installed' | 'updatable' | 'available'
  ): ResourceTreeItem[] {
    const filtered = this.getFilteredItems()
    return filtered
      .filter((i) => i.status === category)
      .map((i) => new ResourceTreeItem(i))
  }
}
