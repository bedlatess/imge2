# AstraForge AI Image Studio

AstraForge 是一个可本地部署的 AI 图像生成工作台。它提供文生图、图生图、提示词库、账号系统、个人连接、管理员工作区连接，以及浏览器本地生成历史。

项目地址：[bedlatess/imge2](https://github.com/bedlatess/imge2)

## 功能概览

- 文生图与图生图
- 内置商业视觉提示词库
- 游客快速连接图像服务
- 登录用户保存个人连接
- 管理员配置工作区连接并授权用户使用
- 支持 OpenAI 兼容接口、NewAPI、SubAPI 和常见中转服务
- 上游错误诊断：服务地址、访问凭证、模型、额度、超时和响应格式
- 连接凭证加密保存
- 生成图片和使用记录默认保存在当前浏览器本地
- Docker / Docker Compose 部署

## 本地开发

```bash
git clone https://github.com/bedlatess/imge2.git
cd imge2
npm install
npm run dev
```

开发地址：

```text
前端：http://127.0.0.1:5173
后端：http://127.0.0.1:8787
```

第一次注册的账号会自动成为管理员。

## Docker Compose 部署

```bash
git clone https://github.com/bedlatess/imge2.git
cd imge2
cp .env.example .env
```

编辑 `.env`，至少修改：

```env
APP_ENCRYPTION_SECRET=replace-with-your-long-random-secret
```

启动：

```bash
docker compose up -d --build
```

默认访问地址：

```text
http://你的服务器IP:12001
```

查看状态：

```bash
docker compose ps
docker compose logs -f
```

停止：

```bash
docker compose down
```

## 数据持久化

Docker Compose 会挂载：

```yaml
./data:/app/data
```

账号、会话和加密后的连接凭证会保存在 `data/app.sqlite`。生成图片和本地使用记录默认保存在当前浏览器，不写入服务器。

备份：

```bash
tar -czf astraforge-data-backup.tar.gz data
```

恢复时把备份解压回项目根目录即可。

## 环境变量

```env
PORT=8787
CORS_ORIGIN=http://localhost:12001
OPENAI_IMAGE_BASE_URL=https://api.openai.com/v1
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_API_KEY=
MAX_UPLOAD_MB=20
SESSION_TTL_HOURS=168
UPSTREAM_TIMEOUT_SECONDS=90
APP_ENCRYPTION_SECRET=replace-with-your-long-random-secret
```

说明：

- `PORT` 是容器内部服务端口，默认 `8787`。
- `docker-compose.yml` 默认把宿主机 `12001` 映射到容器 `8787`。
- `APP_ENCRYPTION_SECRET` 用于加密连接凭证，生产环境必须固定且妥善保存。
- `OPENAI_API_KEY` 可以为空，管理员可以在网页后台配置工作区连接。
- `UPSTREAM_TIMEOUT_SECONDS` 是等待上游图像服务响应的最长时间。

## 连接服务地址怎么填

多数 OpenAI 兼容中转站应该填写接口根地址：

```text
https://api.example.com/v1
```

不要填写完整生成接口：

```text
https://api.example.com/v1/images/generations
```

系统会根据文生图或图生图自动追加：

```text
/images/generations
/images/edits
```

模型名请以服务商后台为准，例如：

```text
gpt-image-2
Qwen_Image
造相Z-Image-Turbo
runqing-Z-Image-Turbo-Tongyi-MAI-v1.0
```

## 常见错误代码

| 代码 | 含义 | 处理方式 |
| --- | --- | --- |
| `FULL_ENDPOINT_USED_AS_BASE_URL` | 服务地址填成了完整生成接口 | 改成以 `/v1` 结尾的接口根地址 |
| `INVALID_SERVICE_URL` | 服务地址格式不正确 | 确认以 `http://` 或 `https://` 开头 |
| `AUTH_FAILED` | 访问凭证无效或没有权限 | 检查凭证、余额、模型权限 |
| `ROUTE_NOT_FOUND` | 服务地址或路径不正确 | 尝试补上 `/v1`，不要填写完整接口路径 |
| `MODEL_NOT_AVAILABLE` | 模型名称不可用 | 到服务商后台复制准确模型名 |
| `IMAGE_TO_IMAGE_UNSUPPORTED` | 当前连接不支持图生图 | 移除参考图或更换支持图生图的模型 |
| `QUOTA_OR_RATE_LIMIT` | 额度不足或请求频率过高 | 检查余额、套餐或稍后重试 |
| `UPSTREAM_TIMEOUT` | 图像服务响应超时 | 降低生成数量或稍后重试 |
| `UNSUPPORTED_RESPONSE_FORMAT` | 返回格式暂未识别 | 换用 OpenAI 兼容接口或增加适配器 |

## 单 Docker 命令部署

```bash
docker build -t astraforge-ai-image-studio .
docker run -d \
  --name astraforge \
  -p 12001:8787 \
  -v ./data:/app/data \
  -e CORS_ORIGIN=http://localhost:12001 \
  -e APP_ENCRYPTION_SECRET=replace-with-your-long-random-secret \
  astraforge-ai-image-studio
```

## 更新项目

```bash
cd imge2
git pull
docker compose up -d --build
```

只要不删除 `data` 目录，用户和连接配置都会保留。
