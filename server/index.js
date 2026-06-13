import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import multer from "multer";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const dataDir = path.join(appRoot, "data");
const distDir = path.join(appRoot, "dist");
fs.mkdirSync(dataDir, { recursive: true });

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(process.env.MAX_UPLOAD_MB || 20) * 1024 * 1024,
    files: 1,
  },
});

const PORT = Number(process.env.PORT || 8787);
const DEFAULT_BASE_URL = (process.env.OPENAI_IMAGE_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const ENV_API_KEY = process.env.OPENAI_API_KEY || "";
const DEFAULT_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || "http://127.0.0.1:5173";
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_HOURS || 168) * 60 * 60 * 1000;
const ENCRYPTION_SECRET = process.env.APP_ENCRYPTION_SECRET || "dev-only-change-me";
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_SECONDS || 90) * 1000;

app.use(cors({ origin: ALLOWED_ORIGIN, credentials: false }));
app.use(express.json({ limit: "2mb" }));

const db = new DatabaseSync(path.join(dataDir, "app.sqlite"));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS user_providers (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'openai-compatible',
    base_url TEXT NOT NULL,
    encrypted_api_key TEXT NOT NULL,
    default_model TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS platform_providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'openai-compatible',
    base_url TEXT NOT NULL,
    encrypted_api_key TEXT NOT NULL,
    default_model TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    access_mode TEXT NOT NULL DEFAULT 'admin-only',
    assigned_user_ids TEXT NOT NULL DEFAULT '[]',
    daily_limit INTEGER NOT NULL DEFAULT 100,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS usage_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    provider_id TEXT,
    provider_scope TEXT NOT NULL,
    provider_name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    model TEXT NOT NULL,
    mode TEXT NOT NULL,
    image_count INTEGER NOT NULL,
    status TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL
  );
`);

const countUsers = db.prepare("SELECT COUNT(*) AS count FROM users");
const getUserByEmail = db.prepare("SELECT * FROM users WHERE lower(email) = lower(?)");
const getUserById = db.prepare("SELECT id, email, role, created_at FROM users WHERE id = ?");
const createUserStmt = db.prepare("INSERT INTO users (id, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)");
const createSessionStmt = db.prepare("INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)");
const getSessionStmt = db.prepare(`
  SELECT s.token, s.expires_at, u.id, u.email, u.role, u.created_at
  FROM sessions s
  JOIN users u ON u.id = s.user_id
  WHERE s.token = ?
`);
const deleteSessionStmt = db.prepare("DELETE FROM sessions WHERE token = ?");

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const next = hashPassword(password, salt).split(":")[1];
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(next, "hex"));
}

function encryptionKey() {
  return crypto.createHash("sha256").update(ENCRYPTION_SECRET).digest();
}

function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${encrypted.toString("base64")}`;
}

function decryptSecret(value) {
  const [ivB64, tagB64, encryptedB64] = String(value || "").split(".");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedB64, "base64")), decipher.final()]).toString("utf8");
}

function safeProvider(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    baseUrl: row.base_url,
    defaultModel: row.default_model,
    enabled: Boolean(row.enabled),
    accessMode: row.access_mode,
    assignedUserIds: JSON.parse(row.assigned_user_ids || "[]"),
    dailyLimit: row.daily_limit,
    createdAt: row.created_at,
    keyPreview: "••••••••",
  };
}

function safeUserProvider(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    baseUrl: row.base_url,
    defaultModel: row.default_model,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    keyPreview: "••••••••",
  };
}

function getAuth(req) {
  const auth = req.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const row = getSessionStmt.get(token);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    deleteSessionStmt.run(token);
    return null;
  }
  return {
    token,
    user: {
      id: row.id,
      email: row.email,
      role: row.role,
      createdAt: row.created_at,
    },
  };
}

function requireUser(req, res, next) {
  const auth = getAuth(req);
  if (!auth) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  req.auth = auth;
  next();
}

function requireAdmin(req, res, next) {
  const auth = getAuth(req);
  if (!auth) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  if (auth.user.role !== "admin") {
    res.status(403).json({ error: "Admin permission required." });
    return;
  }
  req.auth = auth;
  next();
}

function normalizeImageSource(value, fallbackFormat = "png") {
  if (!value || typeof value !== "string") return "";
  if (value.startsWith("data:image/")) return value;
  if (/^https?:\/\//i.test(value)) return value;
  return `data:image/${fallbackFormat};base64,${value}`;
}

function createDiagnostic({ code, title, suggestion, detail, status = 500, upstreamStatus = null, upstreamUrl = "" }) {
  return {
    code,
    title,
    suggestion,
    detail: String(detail || "").slice(0, 1200),
    status,
    upstreamStatus,
    upstreamUrl,
  };
}

function sendDiagnostic(res, diagnostic) {
  res.status(diagnostic.status || 500).json({
    error: diagnostic.title,
    diagnostic,
  });
}

function looksLikeFullImageEndpoint(baseUrl) {
  return /\/images\/(generations|edits)$/i.test(baseUrl.replace(/\/+$/, ""));
}

function looksLikeMissingV1(baseUrl) {
  try {
    const url = new URL(baseUrl);
    return !/\/v\d+(\/)?$/i.test(url.pathname) && !/\/openai\/v\d+(\/)?$/i.test(url.pathname) && !/\/api\/v\d+(\/)?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function buildUpstreamUrl(provider, isEdit) {
  const cleanBase = provider.baseUrl.replace(/\/+$/, "");
  return `${cleanBase}/${isEdit ? "images/edits" : "images/generations"}`;
}

function validateProviderUrl(provider, isEdit) {
  if (!/^https?:\/\//i.test(provider.baseUrl)) {
    return createDiagnostic({
      code: "INVALID_SERVICE_URL",
      title: "服务地址格式不正确。",
      suggestion: "请填写完整地址，例如 https://api.example.com/v1。",
      detail: `当前服务地址：${provider.baseUrl}`,
      status: 400,
    });
  }
  if (looksLikeFullImageEndpoint(provider.baseUrl)) {
    return createDiagnostic({
      code: "FULL_ENDPOINT_USED_AS_BASE_URL",
      title: "服务地址填成了完整生成接口。",
      suggestion: "这里应填写接口根地址，例如 https://api.gjx88.com/v1，而不是 /images/generations。系统会自动追加生成路径。",
      detail: `当前会被拼接为：${buildUpstreamUrl(provider, isEdit)}`,
      status: 400,
      upstreamUrl: buildUpstreamUrl(provider, isEdit),
    });
  }
  return null;
}

function extractImages(payload, outputFormat) {
  const data = Array.isArray(payload?.data) ? payload.data : [];
  const images = data
    .map((item) => normalizeImageSource(item?.b64_json || item?.url, outputFormat))
    .filter(Boolean);
  if (images.length) return images;

  const output = Array.isArray(payload?.output) ? payload.output : [];
  return output
    .map((item) => {
      const result = item?.result;
      if (typeof result === "string") return normalizeImageSource(result, outputFormat);
      if (result && typeof result === "object") {
        return normalizeImageSource(result.b64_json || result.base64 || result.image || result.data, outputFormat);
      }
      return "";
    })
    .filter(Boolean);
}

function summarizePayload(payload) {
  try {
    return JSON.stringify(payload).slice(0, 1200);
  } catch {
    return String(payload || "").slice(0, 1200);
  }
}

async function readUpstreamJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    const error = new Error(text || "Upstream returned a non-JSON response.");
    error.status = response.status;
    throw error;
  }
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function diagnoseUpstreamFailure({ status, payload, provider, upstreamUrl, isEdit, model }) {
  const rawMessage = payload?.error?.message || payload?.error || payload?.message || payload?.detail || payload?.msg || "";
  const message = typeof rawMessage === "string" ? rawMessage : summarizePayload(rawMessage);
  const lower = message.toLowerCase();

  if (status === 401 || status === 403 || /invalid api key|incorrect api key|unauthorized|forbidden|无效.*key|鉴权|认证|权限/.test(lower)) {
    return createDiagnostic({
      code: "AUTH_FAILED",
      title: "访问凭证无效或没有权限。",
      suggestion: "请检查访问凭证是否复制完整、是否过期、余额是否充足，以及该凭证是否允许调用图像模型。",
      detail: message || `上游返回 HTTP ${status}`,
      status: 502,
      upstreamStatus: status,
      upstreamUrl,
    });
  }

  if (status === 404 || /not found|no route|route not|resource not found|不存在|路径/.test(lower)) {
    return createDiagnostic({
      code: "ROUTE_NOT_FOUND",
      title: "服务地址或接口路径不正确。",
      suggestion: looksLikeMissingV1(provider.baseUrl)
        ? "这个服务可能需要以 /v1 结尾。请尝试把服务地址改成类似 https://api.example.com/v1。"
        : "请确认服务地址是接口根地址，不要填写完整的 /images/generations 或 /images/edits。",
      detail: `请求地址：${upstreamUrl}\n上游信息：${message || "Not Found"}`,
      status: 502,
      upstreamStatus: status,
      upstreamUrl,
    });
  }

  if (status === 400 && /model|模型/.test(lower)) {
    return createDiagnostic({
      code: "MODEL_NOT_AVAILABLE",
      title: "当前模型不可用或名称不正确。",
      suggestion: `请检查模型名称是否和服务商后台完全一致。当前模型：${model}`,
      detail: message || `上游返回 HTTP ${status}`,
      status: 502,
      upstreamStatus: status,
      upstreamUrl,
    });
  }

  if (status === 400 && isEdit && /image|multipart|file|unsupported|不支持|图片/.test(lower)) {
    return createDiagnostic({
      code: "IMAGE_TO_IMAGE_UNSUPPORTED",
      title: "当前连接可能不支持图生图。",
      suggestion: "请换一个支持图片编辑的模型，或先移除垫图改用文生图。",
      detail: message || `上游返回 HTTP ${status}`,
      status: 502,
      upstreamStatus: status,
      upstreamUrl,
    });
  }

  if (status === 429 || /rate limit|quota|余额|额度|insufficient|too many/.test(lower)) {
    return createDiagnostic({
      code: "QUOTA_OR_RATE_LIMIT",
      title: "额度不足或请求过于频繁。",
      suggestion: "请检查服务商余额、套餐额度或稍后重试。",
      detail: message || `上游返回 HTTP ${status}`,
      status: 502,
      upstreamStatus: status,
      upstreamUrl,
    });
  }

  return createDiagnostic({
    code: "UPSTREAM_ERROR",
    title: "图像服务返回错误。",
    suggestion: "请根据下方技术细节检查服务商后台、模型名称和参数是否匹配。",
    detail: message || summarizePayload(payload) || `上游返回 HTTP ${status}`,
    status: 502,
    upstreamStatus: status,
    upstreamUrl,
  });
}

function diagnoseResponseShape(payload, upstreamUrl) {
  return createDiagnostic({
    code: "UNSUPPORTED_RESPONSE_FORMAT",
    title: "图像服务返回格式暂未识别。",
    suggestion: "该服务可能不是 OpenAI 图像兼容格式。请换用 OpenAI 兼容连接，或后续在工作区连接里选择对应服务商适配器。",
    detail: summarizePayload(payload),
    status: 502,
    upstreamStatus: 200,
    upstreamUrl,
  });
}

function diagnoseThrownError(error, upstreamUrl) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (error?.name === "AbortError") {
    return createDiagnostic({
      code: "UPSTREAM_TIMEOUT",
      title: "图像服务响应超时。",
      suggestion: "图片生成可能排队较久，请降低生成数量，或稍后重试。",
      detail: `超过 ${UPSTREAM_TIMEOUT_MS / 1000} 秒未收到响应。`,
      status: 504,
      upstreamUrl,
    });
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|certificate|TLS|network/i.test(message)) {
    return createDiagnostic({
      code: "NETWORK_ERROR",
      title: "无法连接到图像服务。",
      suggestion: "请检查服务地址是否能从服务器访问，域名解析和 HTTPS 证书是否正常。",
      detail: message,
      status: 502,
      upstreamUrl,
    });
  }
  return createDiagnostic({
    code: "SERVER_PROXY_ERROR",
    title: "生成代理出现异常。",
    suggestion: "请稍后重试；如果持续出现，请联系管理员查看后端日志。",
    detail: message,
    status: error?.status || 500,
    upstreamUrl,
  });
}

function appendSharedFormFields(form, body, provider) {
  form.append("model", body.model || provider.defaultModel || DEFAULT_MODEL);
  form.append("prompt", body.prompt);
  form.append("size", body.size || "1024x1024");
  form.append("n", String(body.n || 1));
  form.append("quality", body.quality || "auto");
  form.append("output_format", body.output_format || "png");
  if (body.output_format && body.output_format !== "png" && body.output_compression) {
    form.append("output_compression", String(body.output_compression));
  }
  if (body.denoising_strength) {
    form.append("denoising_strength", String(body.denoising_strength));
  }
}

function parseProviderFromBody(body) {
  const source = body.providerSource || body.channelSource || "user";
  return {
    source,
    id: body.providerId || "",
    baseUrl: body.guestBaseUrl || body.baseUrl || "",
    apiKey: body.guestApiKey || body.apiKey || "",
    model: body.model || DEFAULT_MODEL,
  };
}

function canUsePlatformProvider(user, provider) {
  if (!provider.enabled) return false;
  if (!user) return false;
  if (user.role === "admin") return true;
  if (provider.access_mode === "assigned-users") {
    const assigned = JSON.parse(provider.assigned_user_ids || "[]");
    return assigned.includes(user.id);
  }
  return false;
}

function resolveProvider(req, auth) {
  const requested = parseProviderFromBody(req.body);
  const user = auth?.user || null;

  if (requested.source === "guest") {
    if (!requested.baseUrl.trim() || !requested.apiKey.trim()) {
      return { error: "请填写服务地址和访问凭证。" };
    }
    return {
      provider: {
        id: null,
        scope: "guest",
        name: "快速连接",
        baseUrl: requested.baseUrl.trim().replace(/\/+$/, ""),
        apiKey: requested.apiKey.trim(),
        defaultModel: requested.model || DEFAULT_MODEL,
      },
    };
  }

  if (requested.source === "platform") {
    if (!user) return { error: "请登录后使用工作区连接。" };
    const row = db.prepare("SELECT * FROM platform_providers WHERE id = ?").get(requested.id);
    if (!row || !canUsePlatformProvider(user, row)) return { error: "你没有权限使用该工作区连接。" };
    return {
      provider: {
        id: row.id,
        scope: "platform",
        name: row.name,
        baseUrl: row.base_url.replace(/\/+$/, ""),
        apiKey: decryptSecret(row.encrypted_api_key),
        defaultModel: requested.model || row.default_model || DEFAULT_MODEL,
      },
    };
  }

  if (!user) {
    return { error: "请登录后使用已保存连接，或选择快速连接。" };
  }

  const row = db.prepare("SELECT * FROM user_providers WHERE id = ? AND user_id = ?").get(requested.id, user.id);
  if (!row || !row.enabled) return { error: "请选择一个可用的个人连接。" };
  return {
    provider: {
      id: row.id,
      scope: "user",
      name: row.name,
      baseUrl: row.base_url.replace(/\/+$/, ""),
      apiKey: decryptSecret(row.encrypted_api_key),
      defaultModel: requested.model || row.default_model || DEFAULT_MODEL,
    },
  };
}

function logUsage({ userId, provider, prompt, model, mode, imageCount, status, error }) {
  db.prepare(`
    INSERT INTO usage_logs (id, user_id, provider_id, provider_scope, provider_name, prompt, model, mode, image_count, status, error, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomId("log"),
    userId || null,
    provider.id || null,
    provider.scope,
    provider.name,
    prompt.slice(0, 2000),
    model,
    mode,
    imageCount,
    status,
    error || null,
    nowIso(),
  );
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    upstreamConfigured: Boolean(ENV_API_KEY),
    model: DEFAULT_MODEL,
  });
});

app.post("/api/auth/register", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "请输入有效邮箱。" });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "密码至少 8 位。" });
    return;
  }
  if (getUserByEmail.get(email)) {
    res.status(409).json({ error: "该邮箱已注册。" });
    return;
  }

  const role = Number(countUsers.get().count || 0) === 0 ? "admin" : "user";
  const userId = randomId("usr");
  createUserStmt.run(userId, email, hashPassword(password), role, nowIso());
  const token = randomId("sess");
  createSessionStmt.run(token, userId, new Date(Date.now() + SESSION_TTL_MS).toISOString(), nowIso());
  const user = getUserById.get(userId);
  res.json({ token, user: { id: user.id, email: user.email, role: user.role, createdAt: user.created_at } });
});

app.post("/api/auth/login", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = getUserByEmail.get(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    res.status(401).json({ error: "邮箱或密码不正确。" });
    return;
  }
  const token = randomId("sess");
  createSessionStmt.run(token, user.id, new Date(Date.now() + SESSION_TTL_MS).toISOString(), nowIso());
  res.json({
    token,
    user: { id: user.id, email: user.email, role: user.role, createdAt: user.created_at },
  });
});

app.post("/api/auth/logout", requireUser, (req, res) => {
  deleteSessionStmt.run(req.auth.token);
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  const auth = getAuth(req);
  if (!auth) {
    res.json({ user: null });
    return;
  }
  res.json({ user: auth.user });
});

app.get("/api/providers", (req, res) => {
  const auth = getAuth(req);
  const userProviders = auth
    ? db.prepare("SELECT * FROM user_providers WHERE user_id = ? ORDER BY created_at DESC").all(auth.user.id).map(safeUserProvider)
    : [];
  const allPlatform = db.prepare("SELECT * FROM platform_providers WHERE enabled = 1 ORDER BY created_at DESC").all();
  const platformProviders = allPlatform
    .filter((row) => canUsePlatformProvider(auth?.user || null, row))
    .map(safeProvider);
  res.json({ userProviders, platformProviders });
});

app.post("/api/user/providers", requireUser, (req, res) => {
  const name = String(req.body.name || "个人连接").trim();
  const baseUrl = String(req.body.baseUrl || "").trim().replace(/\/+$/, "");
  const apiKey = String(req.body.apiKey || "").trim();
  const defaultModel = String(req.body.defaultModel || DEFAULT_MODEL).trim();
  const type = String(req.body.type || "openai-compatible").trim();
  if (!baseUrl || !apiKey) {
    res.status(400).json({ error: "服务地址和访问凭证必填。" });
    return;
  }
  const id = randomId("up");
  db.prepare(`
    INSERT INTO user_providers (id, user_id, name, type, base_url, encrypted_api_key, default_model, enabled, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(id, req.auth.user.id, name, type, baseUrl, encryptSecret(apiKey), defaultModel, nowIso());
  const row = db.prepare("SELECT * FROM user_providers WHERE id = ?").get(id);
  res.json({ provider: safeUserProvider(row) });
});

app.delete("/api/user/providers/:id", requireUser, (req, res) => {
  db.prepare("DELETE FROM user_providers WHERE id = ? AND user_id = ?").run(req.params.id, req.auth.user.id);
  res.json({ ok: true });
});

app.get("/api/admin/users", requireAdmin, (_req, res) => {
  const users = db.prepare("SELECT id, email, role, created_at FROM users ORDER BY created_at DESC").all();
  res.json({ users: users.map((u) => ({ id: u.id, email: u.email, role: u.role, createdAt: u.created_at })) });
});

app.get("/api/admin/platform-providers", requireAdmin, (_req, res) => {
  const providers = db.prepare("SELECT * FROM platform_providers ORDER BY created_at DESC").all().map(safeProvider);
  res.json({ providers });
});

app.post("/api/admin/platform-providers", requireAdmin, (req, res) => {
  const name = String(req.body.name || "工作区连接").trim();
  const baseUrl = String(req.body.baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  const apiKey = String(req.body.apiKey || "").trim();
  const defaultModel = String(req.body.defaultModel || DEFAULT_MODEL).trim();
  const type = String(req.body.type || "openai-compatible").trim();
  const accessMode = String(req.body.accessMode || "admin-only");
  const assignedUserIds = Array.isArray(req.body.assignedUserIds) ? req.body.assignedUserIds : [];
  const dailyLimit = Number(req.body.dailyLimit || 100);
  if (!baseUrl || !apiKey) {
    res.status(400).json({ error: "服务地址和访问凭证必填。" });
    return;
  }
  const id = randomId("pp");
  db.prepare(`
    INSERT INTO platform_providers (id, name, type, base_url, encrypted_api_key, default_model, enabled, access_mode, assigned_user_ids, daily_limit, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
  `).run(id, name, type, baseUrl, encryptSecret(apiKey), defaultModel, accessMode, JSON.stringify(assignedUserIds), dailyLimit, nowIso());
  const row = db.prepare("SELECT * FROM platform_providers WHERE id = ?").get(id);
  res.json({ provider: safeProvider(row) });
});

app.patch("/api/admin/platform-providers/:id", requireAdmin, (req, res) => {
  const existing = db.prepare("SELECT * FROM platform_providers WHERE id = ?").get(req.params.id);
  if (!existing) {
    res.status(404).json({ error: "Provider not found." });
    return;
  }
  const encryptedApiKey = req.body.apiKey ? encryptSecret(String(req.body.apiKey).trim()) : existing.encrypted_api_key;
  db.prepare(`
    UPDATE platform_providers
    SET name = ?, type = ?, base_url = ?, encrypted_api_key = ?, default_model = ?, enabled = ?, access_mode = ?, assigned_user_ids = ?, daily_limit = ?
    WHERE id = ?
  `).run(
    String(req.body.name || existing.name).trim(),
    String(req.body.type || existing.type).trim(),
    String(req.body.baseUrl || existing.base_url).trim().replace(/\/+$/, ""),
    encryptedApiKey,
    String(req.body.defaultModel || existing.default_model).trim(),
    req.body.enabled === false ? 0 : 1,
    String(req.body.accessMode || existing.access_mode),
    JSON.stringify(Array.isArray(req.body.assignedUserIds) ? req.body.assignedUserIds : JSON.parse(existing.assigned_user_ids || "[]")),
    Number(req.body.dailyLimit || existing.daily_limit),
    req.params.id,
  );
  const row = db.prepare("SELECT * FROM platform_providers WHERE id = ?").get(req.params.id);
  res.json({ provider: safeProvider(row) });
});

app.delete("/api/admin/platform-providers/:id", requireAdmin, (req, res) => {
  db.prepare("DELETE FROM platform_providers WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

app.get("/api/usage", (req, res) => {
  const auth = getAuth(req);
  const logs = auth
    ? db.prepare("SELECT * FROM usage_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 100").all(auth.user.id)
    : [];
  res.json({
    logs: logs.map((log) => ({
      id: log.id,
      providerScope: log.provider_scope,
      providerName: log.provider_name,
      prompt: log.prompt,
      model: log.model,
      mode: log.mode,
      imageCount: log.image_count,
      status: log.status,
      error: log.error,
      createdAt: log.created_at,
    })),
  });
});

app.post("/api/images/generate", upload.single("image"), async (req, res) => {
  const auth = getAuth(req);
  const prompt = String(req.body.prompt || "").trim();
  if (!prompt) {
    res.status(400).json({ error: "Prompt is required." });
    return;
  }

  const resolved = resolveProvider(req, auth);
  if (resolved.error) {
    res.status(403).json({ error: resolved.error });
    return;
  }
  const provider = resolved.provider;
  const outputFormat = String(req.body.output_format || "png");
  const isEdit = Boolean(req.file);
  const upstreamUrl = buildUpstreamUrl(provider, isEdit);
  const model = String(req.body.model || provider.defaultModel || DEFAULT_MODEL);
  const requestedCount = Math.max(1, Number(req.body.n || 1) || 1);
  const urlDiagnostic = validateProviderUrl(provider, isEdit);
  if (urlDiagnostic) {
    logUsage({ userId: auth?.user?.id, provider, prompt, model, mode: isEdit ? "edit" : "generate", imageCount: 0, status: "failed", error: urlDiagnostic.title });
    sendDiagnostic(res, urlDiagnostic);
    return;
  }

  try {
    let response;

    if (isEdit) {
      const form = new FormData();
      appendSharedFormFields(form, { ...req.body, model }, provider);
      const blob = new Blob([req.file.buffer], { type: req.file.mimetype || "application/octet-stream" });
      form.append("image", blob, req.file.originalname || "reference.png");
      response = await fetchWithTimeout(upstreamUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${provider.apiKey}` },
        body: form,
      });
    } else {
      const payload = {
        model,
        prompt,
        size: req.body.size || "1024x1024",
        n: requestedCount,
        quality: req.body.quality || "auto",
        output_format: outputFormat,
      };
      if (outputFormat !== "png" && req.body.output_compression) {
        payload.output_compression = Number(req.body.output_compression);
      }

      response = await fetchWithTimeout(upstreamUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${provider.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    }

    const payload = await readUpstreamJson(response);
    if (!response.ok) {
      const diagnostic = diagnoseUpstreamFailure({ status: response.status, payload, provider, upstreamUrl, isEdit, model });
      logUsage({ userId: auth?.user?.id, provider, prompt, model, mode: isEdit ? "edit" : "generate", imageCount: 0, status: "failed", error: diagnostic.title });
      sendDiagnostic(res, diagnostic);
      return;
    }

    const images = extractImages(payload, outputFormat);
    if (!images.length) {
      const diagnostic = diagnoseResponseShape(payload, upstreamUrl);
      logUsage({ userId: auth?.user?.id, provider, prompt, model, mode: isEdit ? "edit" : "generate", imageCount: 0, status: "failed", error: diagnostic.title });
      sendDiagnostic(res, diagnostic);
      return;
    }

    logUsage({ userId: auth?.user?.id, provider, prompt, model, mode: isEdit ? "edit" : "generate", imageCount: images.length, status: "success" });
    res.json({
      images,
      model,
      mode: isEdit ? "edit" : "generate",
      provider: { name: provider.name, scope: provider.scope },
      requestedCount,
      returnedCount: images.length,
      warning: images.length < requestedCount ? `服务商实际返回 ${images.length}/${requestedCount} 张图片。部分模型或中转接口会忽略生成数量参数。` : "",
      createdAt: nowIso(),
    });
  } catch (error) {
    const diagnostic = diagnoseThrownError(error, upstreamUrl);
    logUsage({ userId: auth?.user?.id, provider, prompt, model, mode: isEdit ? "edit" : "generate", imageCount: 0, status: "failed", error: diagnostic.title });
    sendDiagnostic(res, diagnostic);
  }
});

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api\/|\/health).*/, (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`AstraForge server listening on http://127.0.0.1:${PORT}`);
});
