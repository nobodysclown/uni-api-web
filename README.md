# uni-api-web

uni-api 网关的轻量管理面板：数据统计 + 提供商/模型配置管理，单服务单数据卷部署。

## 功能

- **数据统计**：总请求、成功率、Token 用量、按模型统计、最近请求日志（1小时 / 24小时 / 7天 / 30天）
- **提供商管理**：添加 / 删除提供商，增删 API 密钥，增删模型（含别名），复制提供商，保存后网关约 2 秒热加载生效

## 原理

- 配置读写直接调用网关自身的 `GET /v1/api_config` / `POST /v1/api_config/update` 接口（与 1.0 版本相同，浏览器直连，网关 CORS 已开放）
- 统计由内置的 Go 后端采集（DuckDB 存储），前端经同源 `/analytics/*` 反代访问

## 部署（InstaCloud）

```bash
npx -y insta@latest service add compute admin --port 80 --volume 1 --mount-path /data
npx -y insta@latest secrets set UNI_API_URL "https://your-uni-api-host"
npx -y insta@latest secrets set DATA_DIR "/data"
npx -y insta@latest secrets set ANALYTICS_DB_MEMORY_LIMIT_MB "128"
npx -y insta@latest deploy . --port 80 --group admin
```

## 本地运行

```bash
docker build -t uni-api-web .
docker run -p 8080:80 \
  -e UNI_API_URL="https://your-uni-api-host" \
  -e DATA_DIR="/data" \
  -v uni-api-data:/data \
  uni-api-web
```

## 目录结构

```
├── frontend/        # 管理页面（纯静态 HTML/CSS/JS）
│   ├── index.html
│   ├── style.css
│   └── app.js
├── analytics-api/   # 统计后端（Go + DuckDB）
├── nginx.conf       # 前端静态服务 + /analytics/* 反代
├── start.sh         # 容器启动脚本（同时起 nginx 和统计后端）
└── Dockerfile
```

## 登录

服务地址填你的 uni-api 网关地址，密钥填网关的管理密钥。
