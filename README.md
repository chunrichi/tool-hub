# ToolHub

Internal developer tool sync platform — browse, install, and publish extensions, skills, agents, and instructions.

A self-hosted alternative to VS Code Marketplace for enterprise teams.

## Features

- **Multi-type Resource Support** — VS Code extensions (.vsix), Copilot skills, custom agents, and instructions
- **One-Command Deploy** — Single Docker container for the entire platform
- **VS Code Extension** — Native sidebar integration with search, install, and update
- **Admin Dashboard** — Web-based management for resources, uploads, and analytics
- **Rating System** — User ratings with distribution charts
- **Download Tracking** — Monitor resource popularity
- **Automatic Discovery** — Scans `content/` directory and builds catalog automatically
- **Version Management** — Semantic versioning with update notifications

## Architecture

```
┌─────────────────────────┐         ┌─────────────────────────┐
│   VS Code Extension     │  HTTP   │    ToolHub Server       │
│   (Client UI)           │ ◄─────► │    (Node.js + Express)  │
│                         │         │                         │
│  • TreeView sidebar     │         │  • REST API              │
│  • Detail WebviewPanel  │         │  • SQLite database       │
│  • Install/Update logic │         │  • Content scanner       │
│  • Update notifications │         │  • File-based storage    │
└─────────────────────────┘         └────────────┬────────────┘
                                                 │
                                                 ▼
                                        ┌─────────────────┐
                                        │  content/        │
                                        │  ├── *.vsix      │
                                        │  └── {name}/     │
                                        │      ├── SKILL.md│
                                        │      └── ...     │
                                        └─────────────────┘
```

### Resource Types

| Type | Format | Storage | Install To |
|------|--------|---------|------------|
| `extension` | `.vsix` | File | `~/.vscode/extensions/` |
| `skill` | Directory | `SKILL.md` | `~/.agents/skills/{name}/` |
| `agent` | File | `.agent.md` | `~/.copilot/agents/` |
| `instruction` | File | `.instructions.md` | Project or `~/.copilot/` |

## Quick Start

### 1. Start Server

```bash
cd server
npm install
npm run dev
```

Server starts at `http://localhost:3000`

### 2. Install Extension

```bash
cd extension
npm install
npm run compile
# Press F5 in VS Code to launch Extension Development Host
```

### 3. Configure Registry

In VS Code Settings (`Cmd+,`), add:

```json
{
  "toolhub.registries": [
    {
      "name": "Local",
      "url": "http://localhost:3000"
    }
  ]
}
```

### 4. Browse & Install

Open ToolHub sidebar in Activity Bar → Browse resources → Click Install.

## Server Setup

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `CONTENT_DIR` | Resource directory | `./content` |
| `DATA_DIR` | Data directory (DB, uploads) | `./data` |
| `PUBLISH_TOKEN` | Auth token for publishing | - |

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/catalog` | Full catalog |
| `GET` | `/api/catalog/:type` | Filter by type |
| `GET` | `/api/resource/:type/:name` | Resource detail with ratings |
| `GET` | `/api/resource/:type/:name/readme` | README markdown |
| `GET` | `/api/download/:type/:id/:version` | Download resource |
| `POST` | `/api/publish` | Publish resource (auth required) |
| `POST` | `/api/rate` | Submit rating |
| `POST` | `/api/check-updates` | Batch version check |
| `GET` | `/api/stats` | Dashboard statistics |
| `GET` | `/api/publish-log` | Publish history |

### Content Directory Structure

```
content/
├── my-extension.vsix           # VS Code extension
└── clean-abap/                 # Skill/Agent/Instruction
    ├── SKILL.md                # Resource definition with frontmatter
    └── ...
```

**SKILL.md Frontmatter:**

```yaml
---
type: skill
name: clean-abap
version: 1.0.0
displayName: Clean ABAP
description: Clean ABAP coding standards and best practices
tags: [abap, sap, clean-code]
---

# Clean ABAP

Your skill content here...
```

## Extension Configuration

```jsonc
{
  // Registry servers
  "toolhub.registries": [
    { "name": "Company", "url": "https://toolhub.company.com" }
  ],

  // Update check interval (minutes)
  "toolhub.updateInterval": 360,

  // Auto-update installed resources
  "toolhub.autoUpdate": false
}
```

## Docker Deployment

```bash
cd server

# Create .env file
cat > .env << EOF
PORT=3000
PUBLISH_TOKEN=your-secret-token
CONTENT_DIR=./content
DATA_DIR=./data
EOF

# Start with Docker Compose
docker compose up -d
```

**docker-compose.yml:**

```yaml
services:
  toolhub:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./content:/app/content
      - ./data:/app/data
    environment:
      - PUBLISH_TOKEN=${PUBLISH_TOKEN}
```

## Publishing Resources

### Via Web UI

Navigate to `http://localhost:3000/upload` for the 3-step upload wizard:
1. Drop file (.vsix, .zip, .md)
2. Edit metadata
3. Confirm & publish

### Via Admin Dashboard

Navigate to `http://localhost:3000/admin` for full management:
- Dashboard with statistics
- Resource browser with search/filter
- Upload with metadata editor
- Publish history

### Via API

```bash
# Upload and parse file
curl -X POST http://localhost:3000/api/upload-temp \
  -F "file=@skill-bundle.zip"

# Parse metadata
curl -X POST http://localhost:3000/api/parse-temp \
  -H "Content-Type: application/json" \
  -d '{"tempId": "abc123.zip"}'

# Publish with metadata
curl -X POST http://localhost:3000/api/publish \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{
    "tempId": "abc123.zip",
    "fileName": "skill-bundle.zip",
    "type": "skill",
    "name": "my-skill",
    "version": "1.0.0",
    "displayName": "My Skill",
    "description": "A useful skill"
  }'
```

## Development

### Server

```bash
cd server
npm install
npm run dev          # Hot reload with tsx watch
npm run build        # Compile TypeScript
npm start            # Run compiled JS
```

### Extension

```bash
cd extension
npm install
npm run compile      # One-time build
npm run watch        # Watch mode
# F5 in VS Code to launch Extension Development Host
```

### Project Structure

```
toolhub/
├── extension/              # VS Code Extension
│   ├── src/
│   │   ├── extension.ts    # Entry point
│   │   ├── sidebarView.ts  # Webview sidebar
│   │   ├── detailView.ts   # Resource detail panel
│   │   ├── treeView.ts     # TreeView provider
│   │   ├── api.ts          # Server API client
│   │   ├── manager.ts      # Install/update logic
│   │   └── updater.ts      # Update checker
│   └── package.json
├── server/                 # Node.js Server
│   ├── src/
│   │   ├── index.ts        # Express app setup
│   │   ├── api.ts          # REST routes
│   │   ├── scanner.ts      # Content scanner
│   │   ├── storage.ts      # Database queries
│   │   ├── database.ts     # SQLite setup
│   │   └── config.ts       # Configuration
│   ├── public/
│   │   ├── admin.html      # Admin dashboard
│   │   └── upload.html     # Upload wizard
│   ├── content/            # Resource files
│   ├── data/               # SQLite DB, uploads
│   └── Dockerfile
├── docs/
│   ├── DESIGN.md           # Design documentation
│   └── images/             # Screenshots
└── README.md
```

## License

MIT
