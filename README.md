# AstraForge AI Image Studio

一个面向商业化使用的 AI 图像生成站，支持文生图、图生图、提示词库、账号系统、个人连接、管理员工作区连接和使用记录。

项目地址：[bedlatess/imge2](https://github.com/bedlatess/imge2)

## 功能概览

- 文生图与图生图 Image-to-Image
- 内置提示词库
- 游客快速连接图像服务
- 注册用户保存个人连接
- 管理员配置工作区连接并授权用户使用
- 连接凭证加密保存
- 使用记录与生成历史
- Docker / Docker Compose 一键部署

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

服务器需要先安装 Docker 和 Docker Compose。

```bash
git clone https://github.com/bedlatess/imge2.git
cd imge2
cp .env.example .env
```

编辑 `.env`：

```bash
nano .env
```

至少修改 `APP_ENCRYPTION_SECRET`，请使用一串足够长的随机字符串：

```env
APP_ENCRYPTION_SECRET=replace-with-your-long-random-secret
```

启动服务：

```bash
docker compose up -d --build
```

默认访问端口是 `12001`：

```text
http://你的服务器IP:12001
```

查看运行状态：

```bash
docker compose ps
docker compose logs -f
```

停止服务：

```bash
docker compose down
```

## 数据持久化

Docker Compose 已挂载：

```yaml
./data:/app/data
```

账号、会话、加密后的连接凭证和使用记录会保存在服务器项目目录的 `data` 文件夹中。

备份：

```bash
tar -czf astraforge-data-backup.tar.gz data
```

恢复时把备份解压回项目根目录即可。

## 环境变量

常用配置：

```env
PORT=8787
CORS_ORIGIN=http://localhost:12001
OPENAI_IMAGE_BASE_URL=https://api.openai.com/v1
OPENAI_IMAGE_MODEL=gpt-image-2
OPENAI_API_KEY=
MAX_UPLOAD_MB=20
SESSION_TTL_HOURS=168
APP_ENCRYPTION_SECRET=replace-with-your-long-random-secret
```

说明：

- `PORT` 是容器内部服务端口，默认保持 `8787`。
- `docker-compose.yml` 默认把宿主机 `12001` 映射到容器 `8787`。
- `APP_ENCRYPTION_SECRET` 用于加密连接凭证，生产环境必须固定且妥善保存。
- `OPENAI_API_KEY` 可以为空，管理员后续可以在网页管理后台配置工作区连接。

## 单 Docker 命令部署

不使用 Compose 也可以：

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

访问：

```text
http://你的服务器IP:12001
```

## 绑定域名

如果使用 Nginx 反向代理，例如域名为 `image.example.com`：

```nginx
server {
    listen 80;
    server_name image.example.com;

    location / {
        proxy_pass http://127.0.0.1:12001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

申请 HTTPS：

```bash
sudo certbot --nginx -d image.example.com
```

如果绑定域名，建议把 `.env` 里的 `CORS_ORIGIN` 改成你的正式地址：

```env
CORS_ORIGIN=https://image.example.com
```

然后重启：

```bash
docker compose up -d
```

## 更新项目

```bash
cd imge2
git pull
docker compose up -d --build
```

只要不删除 `data` 目录，用户和连接配置都会保留。

## 首次使用

1. 打开 `http://你的服务器IP:12001`
2. 注册第一个账号
3. 第一个注册账号会自动成为管理员
4. 进入管理页面添加工作区连接
5. 普通用户也可以在连接中心保存自己的个人连接
