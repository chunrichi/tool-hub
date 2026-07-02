import * as vscode from 'vscode'
import type { ResourceItem, ContentType, InstallStatus } from './types'

// ── Type icons (standard VS Code ThemeIcon IDs) ─────────────
const TYPE_ICONS: Record<ContentType, string> = {
  extension: 'extensions',
  skill: 'lightbulb',
  agent: 'person',
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
    this.description = `${count}`
    this.contextValue = 'category'
    // VS Code Extensions view: plain text headers, no icon
  }
}

export class ResourceTreeItem extends vscode.TreeItem {
  constructor(public readonly resource: ResourceItem) {
    // Label: display name (bold, main line)
    super(resource.meta.displayName, vscode.TreeItemCollapsibleState.None)

    // Icon: every item must have an icon (ThemeIcon)
    const iconId = TYPE_ICONS[resource.meta.type]
    this.iconPath = new vscode.ThemeIcon(iconId)

    // Description: version (matches VS Code Extensions view style)
    // Shows version with update indicator if applicable
    if (resource.status === 'updatable' && resource.installedVersion) {
      this.description = `${resource.installedVersion} → ${resource.meta.version}`
    } else {
      this.description = `v${resource.meta.version}`
    }

    // contextValue drives menu visibility
    this.contextValue = resource.status

    // Rich tooltip with publisher, description, and full details
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

  // Title line: name + version
  md.appendMarkdown(`**${resource.meta.displayName}** v${resource.meta.version}\n\n`)

  // Publisher
  if (resource.meta.publisher) {
    md.appendMarkdown(`$(person) ${resource.meta.publisher}\n\n`)
  }

  // Description
  if (resource.meta.description) {
    md.appendMarkdown(`${resource.meta.description}\n\n`)
  }

  md.appendMarkdown(`---\n\n`)
  md.appendMarkdown(`| | |\n|---|---|\n`)
  md.appendMarkdown(`| **Type** | ${resource.meta.type} |\n`)
  md.appendMarkdown(`| **Id** | \`${resource.meta.name}\` |\n`)
  md.appendMarkdown(`| **Version** | ${resource.meta.version} |\n`)

  if (resource.meta.publisher) {
    md.appendMarkdown(`| **Publisher** | ${resource.meta.publisher} |\n`)
  }

  md.appendMarkdown(`| **Registry** | ${resource.registryName} |\n`)

  if (resource.meta.tags.length > 0) {
    md.appendMarkdown(`| **Tags** | ${resource.meta.tags.join(', ')} |\n`)
  }

  if (resource.status === 'updatable' && resource.installedVersion) {
    md.appendMarkdown(`\n---\n$(arrow-up) **Update available:** ${resource.installedVersion} → ${resource.meta.version}`)
  } else if (resource.status === 'installed') {
    md.appendMarkdown(`\n---\n$(check) **Installed**`)
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
