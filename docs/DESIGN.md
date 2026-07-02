## ToolHub — 内部开发者工具同步平台

ToolHub = VS Code Extension（客户端）+ Node.js Backend（服务端），一个命令部署企业内部工具分发平台。

```
用户 VS Code (ToolHub Extension)
    │
    │  HTTP
    ▼
自建 Node.js 服务 (ToolHub Server)
    │
    ▼
content/ 目录 (扩展/技能/Agent/指令)
```

---

### 内容类型

| 类型 | vsix | 存储格式 | 安装到 |
|------|------|---------|--------|
| extension | VS Code 扩展 | `.vsix` | `~/.vscode/extensions/` |
| skill | Copilot 技能 | 目录 (SKILL.md) | `~/.agents/skills/{name}/` |
| agent | 自定义 Agent | `.agent.md` | `~/.copilot/agents/` |
| instruction | 自定义指令 | `.instructions.md` | 项目 或 `~/.copilot/` |

---

### 服务端设计

**技术栈：** Node.js + Express + TypeScript，纯文件存储，无数据库依赖。

**目录结构：**

```
server/
├── Dockerfile              # 应用容器
├── docker-compose.yml      # 单容器部署
├── package.json
├── tsconfig.json
├── .env.example
├── content/                # 所有资源（部署后填充）
│   ├── .gitkeep
│   ├── *.vsix              #   扩展文件
│   └── {name}/             #   技能/Agent/指令目录
│       ├── SKILL.md        #      技能定义
│       ├── *.agent.md      #      Agent 定义
│       ├── *.instructions.md #   指令定义
│       └── version.json    #      版本描述 (必需)
├── data/                   # 缓存（运行时生成）
│   ├── .gitkeep
│   └── catalog.json        #   所有资源的元数据
└── src/                    # 源码
    ├── index.ts            #   启动 + Express 中间件
    ├── config.ts           #   环境变量
    ├── api.ts              #   REST API 路由
    ├── scanner.ts           #   扫描 content/ 生成 catalog
    └── storage.ts           #   读写 catalog.json
```

**API 端点：**

| 方法 | 路径 | 用途 |
|------|------|------|
| GET | `/api/catalog` | 全量目录 |
| GET | `/api/catalog/{type}` | 按类型筛选 |
| GET | `/api/download/{type}/{id}/{version}` | 下载文件 |
| POST | `/api/publish` | 上传资源 |
| POST | `/api/check-updates` | 批量版本检查 |

**Scanner 逻辑：** 服务启动时扫描 `content/` 目录：
- `*.vsix` → 解压提取 `package.json` → type=extension
- 子目录 → 读取 `version.json` 获取 type/name/version → 按 type 归类

**version.json 格式：**

```json
{
  "type": "skill | agent | instruction",
  "name": "clean-abap",
  "version": "1.0.0",
  "displayName": "Clean ABAP",
  "description": "...",
  "tags": ["abap"]
}
```

**环境变量：**

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | `3000` |
| `CONTENT_DIR` | 资源目录 | `./content` |
| `PUBLISH_TOKEN` | 发布认证 token | - |
| `BASE_URL` | 外部可访问 URL | `http://localhost:3000` |

---

### 扩展端设计

**技术栈：** TypeScript + VS Code Extension API

**目录结构：**

```
extension/
├── package.json            # 扩展清单
├── tsconfig.json
├── .vscodeignore
├── .vscode/
│   ├── launch.json
│   └── tasks.json
├── resources/
│   └── icon.png
└── src/
    ├── extension.ts        #   入口: activate/deactivate
    ├── config.ts            #   仓库配置 & Settings
    ├── api.ts               #   服务端 API 封装
    ├── manager.ts           #   安装/卸载核心逻辑
    ├── updater.ts           #   定时更新检查
    └── treeView.ts          #   Activity Bar TreeView
```

**TreeView 设计：**

```
🔧 ToolHub
├── 📦 Extensions (3)                 [🔄 刷新]
│   ├── code-review     v1.2.0  ✓
│   ├── snippets        v0.3.1  ↗
│   └── linter          v2.0.0  ✗
├── 🧠 Skills (5)
│   ├── clean-abap      v1.0.0  ✓
│   └── ...
├── 🤖 Agents (2)
│   └── ...
└── 📋 Instructions (3)
    └── ...

状态指示:  ✓ 已安装最新  ↗ 有新版本  ✗ 未安装
```

**安装逻辑：** 根据类型分派

```
extension    → workbench.extensions.installExtension(Uri)
skill        → download ZIP → extract to ~/.agents/skills/{name}/
agent        → download file → save to ~/.copilot/agents/{name}.agent.md
instruction  → download file →
                 scope=workspace → .github/{name}.instructions.md
                 scope=global → ~/.copilot/{name}.instructions.md
```

**配置 (Settings)：**

```jsonc
{
  "toolhub.registries": [           // 默认空，不连任何服务器
    {
      "name": "My Company",
      "url": "https://toolhub.mycompany.com"
    }
  ],
  "toolhub.updateInterval": 360,    // 更新检查间隔 (分钟)
  "toolhub.autoUpdate": false       // 是否自动更新
}
```

**更新检查：** 定时收集已安装内容的 {id, version} 列表 → `POST /api/check-updates` → 比较返回值 → 状态栏 + TreeView 提示

---

### 部署 & 发布

**服务端部署：**

```bash
cd server
cp .env.example .env  # 编辑 PUBLISH_TOKEN
docker compose up -d
```

**发布资源：**

```bash
# 扩展
curl -X POST https://toolhub.example.com/api/publish \
  -H "Authorization: Bearer {token}" \
  -F "file=@my-extension-1.0.0.vsix"

# 技能/Agent/指令
curl -X POST https://toolhub.example.com/api/publish \
  -H "Authorization: Bearer {token}" \
  -F "file=@skill-bundle.zip"
```

**客户端安装：** 从 VS Marketplace 安装 ToolHub 扩展 → 在 Settings 添加仓库 URL → 自动列出可用资源

---

### 与外部的关系

| 方面 | 设计 |
|------|------|
| 官方 Market | 完全独立，互不影响 |
| `product.json` | 不修改 |
| 用户隐私 | 不收集任何数据，仅连接用户配置的 URL |
| 开源协议 | MIT |
| 市场审核 | 不 eval、不收集数据、不修改全局设置 |

---

### 代码量预估

| 模块 | 行数 |
|------|------|
| 服务端 (~5 文件) | ~300 行 |
| 扩展端 (~6 文件) | ~500 行 |
| 配置 + 部署文件 | ~100 行 |
| **总计** | **~900 行** |
