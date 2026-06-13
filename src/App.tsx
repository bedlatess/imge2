import { AnimatePresence, motion } from "framer-motion";
import {
  Aperture,
  BookOpen,
  CheckCircle2,
  Crown,
  Download,
  History,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  LogOut,
  Maximize2,
  Palette,
  PlugZap,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  UserCircle,
  Wand2,
  X,
} from "lucide-react";
import { ChangeEvent, DragEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { promptCategories, promptTemplates, type PromptTemplate } from "./promptLibrary";

type BackendStatus = "checking" | "ready" | "offline";
type View = "studio" | "prompts" | "channels" | "usage" | "admin";
type ChannelSource = "guest" | "user" | "platform";

type User = { id: string; email: string; role: "admin" | "user"; createdAt: string };
type Provider = {
  id: string;
  name: string;
  type: string;
  baseUrl: string;
  defaultModel: string;
  enabled: boolean;
  accessMode?: string;
  assignedUserIds?: string[];
  dailyLimit?: number;
  createdAt: string;
};
type UsageLog = {
  id: string;
  providerScope: string;
  providerName: string;
  prompt: string;
  model: string;
  mode: string;
  imageCount: number;
  status: string;
  error?: string;
  createdAt: string;
};

type AppConfig = {
  backendUrl: string;
  model: string;
  providerSource: ChannelSource;
  providerId: string;
  guestBaseUrl: string;
  guestApiKey: string;
  sendDenoising: boolean;
};

type GenerationParams = {
  count: number;
  denoising: number;
  ratio: string;
  quality: string;
  format: string;
};

type GalleryImage = {
  id: string;
  src: string;
  prompt: string;
  ratio: string;
  createdAt: string;
  source: "api";
  providerName?: string;
};

type ImageApiResult = {
  images: GalleryImage[];
  warning: string;
};

type ApiDiagnostic = {
  code: string;
  title: string;
  suggestion: string;
  detail?: string;
  status?: number;
  upstreamStatus?: number | null;
  upstreamUrl?: string;
};

class ImageApiError extends Error {
  diagnostic?: ApiDiagnostic;

  constructor(message: string, diagnostic?: ApiDiagnostic) {
    super(message);
    this.name = "ImageApiError";
    this.diagnostic = diagnostic;
  }
}

const STORAGE_KEY = "astraforge.app.config";
const TOKEN_KEY = "astraforge.session.token";
const GALLERY_STORAGE_KEY = "astraforge.local.gallery";
const LOCAL_USAGE_STORAGE_KEY = "astraforge.local.usage";
const DEFAULT_BACKEND_URL = typeof window !== "undefined" && window.location.port !== "5173"
  ? window.location.origin
  : "http://127.0.0.1:8787";
const DEFAULT_CONFIG: AppConfig = {
  backendUrl: DEFAULT_BACKEND_URL,
  model: "gpt-image-2",
  providerSource: "guest",
  providerId: "",
  guestBaseUrl: "https://api.openai.com/v1",
  guestApiKey: "",
  sendDenoising: false,
};

const ratios = [
  { label: "1:1", value: "1024x1024" },
  { label: "3:4", value: "1024x1536" },
  { label: "4:3", value: "1536x1024" },
  { label: "16:9", value: "1792x1024" },
  { label: "9:16", value: "1024x1792" },
  { label: "Auto", value: "auto" },
];

const modelPresets = [
  { label: "GPT Image 2", value: "gpt-image-2" },
  { label: "GPT Image 1.5", value: "gpt-image-1.5" },
  { label: "GPT Image 1", value: "gpt-image-1" },
  { label: "Qwen Image", value: "Qwen_Image" },
  { label: "造相 Z Turbo", value: "造相Z-Image-Turbo" },
  { label: "Z-Image Turbo", value: "runqing-Z-Image-Turbo-Tongyi-MAI-v1.0" },
];

function loadConfig(): AppConfig {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? { ...DEFAULT_CONFIG, ...JSON.parse(saved), guestApiKey: "" } : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

function loadLocalGallery(): GalleryImage[] {
  try {
    const saved = localStorage.getItem(GALLERY_STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item?.src === "string" && typeof item?.prompt === "string").slice(0, 80) : [];
  } catch {
    return [];
  }
}

function loadLocalUsageLogs(): UsageLog[] {
  try {
    const saved = localStorage.getItem(LOCAL_USAGE_STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed)
      ? parsed
          .filter((item) => typeof item?.id === "string" && typeof item?.createdAt === "string")
          .slice(0, 200)
      : [];
  } catch {
    return [];
  }
}

function cleanBackendUrl(url: string) {
  return url.trim().replace(/\/+$/, "");
}

function withAuthHeaders(headers: HeadersInit | undefined, token: string) {
  const nextHeaders = new Headers(headers);
  if (token) nextHeaders.set("Authorization", `Bearer ${token}`);
  return nextHeaders;
}

async function apiFetch<T>(backendUrl: string, path: string, options: RequestInit = {}, token = ""): Promise<T> {
  const response = await fetch(`${cleanBackendUrl(backendUrl)}${path}`, {
    ...options,
    headers: withAuthHeaders(options.headers, token),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload as T;
}

async function callBackendImageApi(
  config: AppConfig,
  params: GenerationParams,
  prompt: string,
  uploadFile: File | null,
  token: string,
): Promise<ImageApiResult> {
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("model", config.model);
  form.append("size", params.ratio);
  form.append("n", String(params.count));
  form.append("quality", params.quality);
  form.append("output_format", params.format);
  form.append("providerSource", config.providerSource);
  form.append("providerId", config.providerId);
  if (config.providerSource === "guest") {
    form.append("guestBaseUrl", config.guestBaseUrl);
    form.append("guestApiKey", config.guestApiKey);
  }
  if (uploadFile) form.append("image", uploadFile, uploadFile.name || "reference.png");
  if (config.sendDenoising) form.append("denoising_strength", String(params.denoising));

  const response = await fetch(`${cleanBackendUrl(config.backendUrl)}/api/images/generate`, {
    method: "POST",
    headers: withAuthHeaders(undefined, token),
    body: form,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new ImageApiError(payload.error || `后端请求失败：HTTP ${response.status}`, payload.diagnostic);
  const images = Array.isArray(payload.images) ? payload.images.filter((item: unknown) => typeof item === "string") : [];
  if (!images.length) throw new Error("后端响应中没有可用图片。");

  return {
    warning: typeof payload.warning === "string" ? payload.warning : "",
    images: images.map((src: string, index: number) => ({
      id: crypto.randomUUID(),
      src,
      prompt,
      ratio: params.ratio,
      createdAt: payload.createdAt || new Date(Date.now() + index).toISOString(),
      source: "api",
      providerName: payload.provider?.name,
    })),
  };
}

function downloadImage(image: GalleryImage) {
  const link = document.createElement("a");
  link.href = image.src;
  link.download = `astraforge-${image.id}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export default function App() {
  const [config, setConfig] = useState<AppConfig>(loadConfig);
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const [user, setUser] = useState<User | null>(null);
  const [backendStatus, setBackendStatus] = useState<BackendStatus>("checking");
  const [activeView, setActiveView] = useState<View>("studio");
  const [authOpen, setAuthOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [params, setParams] = useState<GenerationParams>({
    count: 1,
    denoising: 0.42,
    ratio: "1024x1024",
    quality: "auto",
    format: "png",
  });
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [gallery, setGallery] = useState<GalleryImage[]>(loadLocalGallery);
  const [lightbox, setLightbox] = useState<GalleryImage | null>(null);
  const [error, setError] = useState("");
  const [diagnostic, setDiagnostic] = useState<ApiDiagnostic | null>(null);
  const [notice, setNotice] = useState("");
  const [userProviders, setUserProviders] = useState<Provider[]>([]);
  const [platformProviders, setPlatformProviders] = useState<Provider[]>([]);
  const [usageLogs, setUsageLogs] = useState<UsageLog[]>(loadLocalUsageLogs);
  const [adminProviders, setAdminProviders] = useState<Provider[]>([]);
  const [adminUsers, setAdminUsers] = useState<User[]>([]);

  useEffect(() => {
    const { guestApiKey: _guestApiKey, ...safeConfig } = config;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safeConfig));
  }, [config]);

  useEffect(() => {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  }, [token]);

  useEffect(() => {
    try {
      localStorage.setItem(GALLERY_STORAGE_KEY, JSON.stringify(gallery.slice(0, 80)));
    } catch {
      setNotice("浏览器本地存储空间不足，当前图片只会保留在本次页面会话中。");
    }
  }, [gallery]);

  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_USAGE_STORAGE_KEY, JSON.stringify(usageLogs.slice(0, 200)));
    } catch {
      setNotice("浏览器本地存储空间不足，使用记录只会保留在本次页面会话中。");
    }
  }, [usageLogs]);

  useEffect(() => {
    let active = true;
    setBackendStatus("checking");
    fetch(`${cleanBackendUrl(config.backendUrl)}/health`)
      .then((response) => response.json())
      .then(() => active && setBackendStatus("ready"))
      .catch(() => active && setBackendStatus("offline"));
    return () => {
      active = false;
    };
  }, [config.backendUrl]);

  useEffect(() => {
    let active = true;
    apiFetch<{ user: User | null }>(config.backendUrl, "/api/me", {}, token)
      .then((payload) => active && setUser(payload.user))
      .catch(() => {
        if (active) {
          setUser(null);
          setToken("");
        }
      });
    return () => {
      active = false;
    };
  }, [config.backendUrl, token]);

  const refreshProviders = () => {
    apiFetch<{ userProviders: Provider[]; platformProviders: Provider[] }>(config.backendUrl, "/api/providers", {}, token)
      .then((payload) => {
        setUserProviders(payload.userProviders);
        setPlatformProviders(payload.platformProviders);
        if (config.providerSource === "user" && !payload.userProviders.some((item) => item.id === config.providerId)) {
          setConfig((current) => ({ ...current, providerSource: "guest", providerId: "" }));
        }
        if (config.providerSource === "platform" && !payload.platformProviders.some((item) => item.id === config.providerId)) {
          setConfig((current) => ({ ...current, providerSource: "guest", providerId: "" }));
        }
      })
      .catch(() => {
        setUserProviders([]);
        setPlatformProviders([]);
      });
  };

  useEffect(refreshProviders, [config.backendUrl, token]);

  useEffect(() => {
    if (!uploadFile) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(uploadFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [uploadFile]);

  const activeRatio = useMemo(() => ratios.find((item) => item.value === params.ratio)?.label ?? "Auto", [params.ratio]);
  const currentChannelLabel = useMemo(() => {
    if (config.providerSource === "guest") return "快速连接";
    if (config.providerSource === "user") return userProviders.find((item) => item.id === config.providerId)?.name || "个人连接";
    return platformProviders.find((item) => item.id === config.providerId)?.name || "工作区连接";
  }, [config.providerSource, config.providerId, userProviders, platformProviders]);

  function acceptFile(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("请上传 PNG、JPG、WEBP 等图片文件。");
      setDiagnostic(null);
      return;
    }
    setError("");
    setDiagnostic(null);
    setUploadFile(file);
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragging(false);
    acceptFile(event.dataTransfer.files?.[0]);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    acceptFile(event.target.files?.[0]);
    event.currentTarget.value = "";
  }

  function useTemplate(template: PromptTemplate) {
    setPrompt(template.prompt);
    setParams((current) => ({ ...current, ratio: template.ratio }));
    setActiveView("studio");
    setError("");
    setDiagnostic(null);
  }

  async function generate() {
    if (!prompt.trim()) {
      setError("请先输入提示词，或从提示词库选择一个模板。");
      setDiagnostic(null);
      setNotice("");
      return;
    }
    if (backendStatus !== "ready") {
      setError("后端离线，请先启动 npm run dev。");
      setDiagnostic(null);
      setNotice("");
      return;
    }
    if (config.providerSource === "guest" && (!config.guestBaseUrl.trim() || !config.guestApiKey.trim())) {
      setError("请先填写服务地址和访问凭证，系统只会在本次生成时使用。");
      setDiagnostic(null);
      setNotice("");
      return;
    }
    if (config.providerSource !== "guest" && !config.providerId) {
      setError("请选择一个可用连接。");
      setDiagnostic(null);
      setNotice("");
      return;
    }

    setError("");
    setDiagnostic(null);
    setNotice("");
    setIsGenerating(true);
    try {
      const result = await callBackendImageApi(config, params, prompt.trim(), uploadFile, token);
      setGallery((current) => [...result.images, ...current]);
      setNotice(result.warning);
      addLocalUsageLog({
        providerScope: config.providerSource,
        providerName: currentChannelLabel,
        prompt: prompt.trim(),
        model: config.model,
        mode: uploadFile ? "edit" : "generate",
        imageCount: result.images.length,
        status: "success",
      });
    } catch (err) {
      if (err instanceof ImageApiError && err.diagnostic) {
        setError(err.message);
        setDiagnostic(err.diagnostic);
        setNotice("");
        addLocalUsageLog({
          providerScope: config.providerSource,
          providerName: currentChannelLabel,
          prompt: prompt.trim(),
          model: config.model,
          mode: uploadFile ? "edit" : "generate",
          imageCount: 0,
          status: "failed",
          error: err.diagnostic.title || err.message,
        });
      } else {
        const message = err instanceof Error ? err.message : "生成失败，请检查连接配置。";
        setError(message);
        setDiagnostic(null);
        setNotice("");
        addLocalUsageLog({
          providerScope: config.providerSource,
          providerName: currentChannelLabel,
          prompt: prompt.trim(),
          model: config.model,
          mode: uploadFile ? "edit" : "generate",
          imageCount: 0,
          status: "failed",
          error: message,
        });
      }
    } finally {
      setIsGenerating(false);
    }
  }

  function addLocalUsageLog(log: Omit<UsageLog, "id" | "createdAt">) {
    setUsageLogs((current) => [
      {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        ...log,
      },
      ...current,
    ].slice(0, 200));
  }

  function refreshUsage() {
    setUsageLogs(loadLocalUsageLogs());
  }

  function deleteUsageLog(id: string) {
    setUsageLogs((current) => current.filter((log) => log.id !== id));
  }

  function clearUsageLogs() {
    setUsageLogs([]);
  }

  async function deleteUserProvider(id: string) {
    await apiFetch(config.backendUrl, `/api/user/providers/${id}`, { method: "DELETE" }, token);
    if (config.providerSource === "user" && config.providerId === id) {
      setConfig((current) => ({ ...current, providerSource: "guest", providerId: "" }));
    }
    refreshProviders();
  }

  function refreshAdmin() {
    if (user?.role !== "admin") return;
    apiFetch<{ providers: Provider[] }>(config.backendUrl, "/api/admin/platform-providers", {}, token).then((payload) => setAdminProviders(payload.providers));
    apiFetch<{ users: User[] }>(config.backendUrl, "/api/admin/users", {}, token).then((payload) => setAdminUsers(payload.users));
  }

  useEffect(() => {
    if (activeView === "usage") refreshUsage();
    if (activeView === "admin") refreshAdmin();
  }, [activeView, token, user?.role]);

  async function logout() {
    if (token) await apiFetch(config.backendUrl, "/api/auth/logout", { method: "POST" }, token).catch(() => null);
    setToken("");
    setUser(null);
    setConfig((current) => ({ ...current, providerSource: "guest", providerId: "" }));
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-ink text-white">
      <div className="fine-grid pointer-events-none absolute inset-0 opacity-60" />
      <div className="pointer-events-none absolute inset-0 bg-mesh" />
      <div className="pointer-events-none absolute -left-28 top-24 h-72 w-72 rounded-full bg-volt/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-10 h-80 w-80 rounded-full bg-plasma/20 blur-3xl" />

      <section className="relative mx-auto flex w-full max-w-[1520px] flex-col gap-6 px-4 py-5 sm:px-6 lg:min-h-screen lg:px-8">
        <Header
          activeView={activeView}
          backendStatus={backendStatus}
          user={user}
          onChangeView={setActiveView}
          onOpenAuth={() => setAuthOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onLogout={logout}
        />

        {activeView === "prompts" && <PromptLibrary onUseTemplate={useTemplate} />}
        {activeView === "channels" && (
          <ChannelsView
            config={config}
            token={token}
            user={user}
            userProviders={userProviders}
            platformProviders={platformProviders}
            onConfigChange={setConfig}
            onOpenAuth={() => setAuthOpen(true)}
            onRefresh={refreshProviders}
            onDeleteUserProvider={deleteUserProvider}
          />
        )}
        {activeView === "usage" && <UsageView logs={usageLogs} onRefresh={refreshUsage} onDelete={deleteUsageLog} onClear={clearUsageLogs} />}
        {activeView === "admin" && (
          <AdminView
            user={user}
            token={token}
            backendUrl={config.backendUrl}
            users={adminUsers}
            providers={adminProviders}
            onRefresh={refreshAdmin}
          />
        )}
        {activeView === "studio" && (
          <div className="grid flex-1 gap-6 lg:grid-cols-[430px_minmax(0,1fr)]">
            <StudioPanel
              prompt={prompt}
              params={params}
              previewUrl={previewUrl}
              uploadFile={uploadFile}
              isDragging={isDragging}
              isGenerating={isGenerating}
              error={error}
              diagnostic={diagnostic}
              notice={notice}
              currentChannelLabel={currentChannelLabel}
              config={config}
              userProviders={userProviders}
              platformProviders={platformProviders}
              onPromptChange={setPrompt}
              onParamsChange={setParams}
              onDrop={onDrop}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onFileChange={onFileChange}
              onRemoveFile={() => setUploadFile(null)}
              onGenerate={generate}
              onShowPrompts={() => setActiveView("prompts")}
              onShowChannels={() => setActiveView("channels")}
              onConfigChange={setConfig}
            />
            <OutputPanel
              gallery={gallery}
              isGenerating={isGenerating}
              activeRatio={activeRatio}
              backendStatus={backendStatus}
              currentChannelLabel={currentChannelLabel}
              onPreview={setLightbox}
              onDownload={downloadImage}
            />
          </div>
        )}
      </section>

      <AuthModal
        open={authOpen}
        backendUrl={config.backendUrl}
        onClose={() => setAuthOpen(false)}
        onAuthed={(payload) => {
          setToken(payload.token);
          setUser(payload.user);
          setAuthOpen(false);
        }}
      />
      <SettingsDrawer open={settingsOpen} config={config} backendStatus={backendStatus} onClose={() => setSettingsOpen(false)} onChange={setConfig} />

      <AnimatePresence>
        {lightbox && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/82 p-4 backdrop-blur-xl"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setLightbox(null)}
          >
            <motion.div
              initial={{ scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0 }}
              className="relative max-h-[92vh] w-full max-w-6xl overflow-hidden rounded-[28px] border border-white/14 bg-white/8 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <img src={lightbox.src} alt={lightbox.prompt} className="max-h-[78vh] w-full object-contain bg-black/40" />
              <div className="flex flex-col gap-3 border-t border-white/10 p-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-white/72">{lightbox.prompt}</p>
                <div className="flex gap-2">
                  <IconButton label="下载" onClick={() => downloadImage(lightbox)} icon={<Download className="h-4 w-4" />} />
                  <IconButton label="关闭" onClick={() => setLightbox(null)} icon={<X className="h-4 w-4" />} />
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

function Header({
  activeView,
  backendStatus,
  user,
  onChangeView,
  onOpenAuth,
  onOpenSettings,
  onLogout,
}: {
  activeView: View;
  backendStatus: BackendStatus;
  user: User | null;
  onChangeView: (view: View) => void;
  onOpenAuth: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
}) {
  const status = backendStatus === "ready" ? "后端已就绪" : backendStatus === "checking" ? "检测后端" : "后端离线";
  return (
    <motion.header initial={{ opacity: 0, y: -14 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-[28px] px-5 py-4">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-4">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/10 shadow-glow">
            <Palette className="h-6 w-6 text-volt" />
          </div>
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.36em] text-white/44">AstraForge</p>
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl">AI Image Studio</h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="hide-scrollbar flex max-w-full gap-1 overflow-x-auto rounded-full border border-white/12 bg-black/18 p-1">
            <NavButton active={activeView === "studio"} onClick={() => onChangeView("studio")} icon={<Wand2 className="h-4 w-4" />} label="创作台" />
            <NavButton active={activeView === "prompts"} onClick={() => onChangeView("prompts")} icon={<BookOpen className="h-4 w-4" />} label="提示词库" />
            <NavButton active={activeView === "channels"} onClick={() => onChangeView("channels")} icon={<KeyRound className="h-4 w-4" />} label="连接中心" />
            <NavButton active={activeView === "usage"} onClick={() => onChangeView("usage")} icon={<History className="h-4 w-4" />} label="使用记录" />
            {user?.role === "admin" && <NavButton active={activeView === "admin"} onClick={() => onChangeView("admin")} icon={<ShieldCheck className="h-4 w-4" />} label="管理" />}
          </div>
          <div className="rounded-full border border-white/12 bg-white/8 px-4 py-2 text-xs text-white/62">{status}</div>
          {user ? (
            <div className="flex items-center gap-2 rounded-full border border-white/12 bg-white/8 px-3 py-2 text-xs text-white/70">
              <UserCircle className="h-4 w-4 text-volt" />
              <span className="max-w-32 truncate">{user.email}</span>
              {user.role === "admin" && <Crown className="h-4 w-4 text-ember" />}
              <button onClick={onLogout} aria-label="退出登录" className="text-white/44 transition hover:text-plasma">
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <button onClick={onOpenAuth} className="flex items-center gap-2 rounded-full border border-white/12 bg-white/10 px-4 py-2 text-sm font-bold transition hover:border-volt/60 hover:bg-volt/10">
              <UserCircle className="h-4 w-4" />
              登录 / 注册
            </button>
          )}
          <IconButton label="后端配置" onClick={onOpenSettings} icon={<Settings className="h-4 w-4" />} />
        </div>
      </div>
    </motion.header>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button type="button" onClick={onClick} className={`flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-sm font-bold transition ${active ? "bg-white text-ink" : "text-white/60 hover:text-white"}`}>
      {icon}
      {label}
    </button>
  );
}

function StudioPanel(props: {
  prompt: string;
  params: GenerationParams;
  previewUrl: string;
  uploadFile: File | null;
  isDragging: boolean;
  isGenerating: boolean;
  error: string;
  diagnostic: ApiDiagnostic | null;
  notice: string;
  currentChannelLabel: string;
  config: AppConfig;
  userProviders: Provider[];
  platformProviders: Provider[];
  onPromptChange: (value: string) => void;
  onParamsChange: (params: GenerationParams | ((current: GenerationParams) => GenerationParams)) => void;
  onDrop: (event: DragEvent<HTMLLabelElement>) => void;
  onDragOver: (event: DragEvent<HTMLLabelElement>) => void;
  onDragLeave: () => void;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemoveFile: () => void;
  onGenerate: () => void;
  onShowPrompts: () => void;
  onShowChannels: () => void;
  onConfigChange: (config: AppConfig | ((current: AppConfig) => AppConfig)) => void;
}) {
  function applySpeedPreset() {
    props.onParamsChange((current) => ({ ...current, count: 1, quality: "auto", ratio: current.ratio === "auto" ? "1024x1024" : current.ratio }));
  }

  function applyQualityPreset() {
    props.onParamsChange((current) => ({ ...current, count: Math.max(current.count, 1), quality: "high" }));
  }

  return (
    <motion.aside initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="glass h-fit rounded-[28px] p-4 sm:p-5 lg:sticky lg:top-5">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.34em] text-volt/80">Input Matrix</p>
          <h2 className="mt-2 text-2xl font-extrabold tracking-tight">创作控制台</h2>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/10 p-3 shadow-glow">
          <Aperture className="h-5 w-5 text-volt" />
        </div>
      </div>

      <div className="mb-4 rounded-3xl border border-white/10 bg-white/[0.045] p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-white/40">当前连接</p>
            <p className="mt-1 text-sm font-extrabold text-white">{props.currentChannelLabel}</p>
          </div>
          <button onClick={props.onShowChannels} className="rounded-full border border-volt/30 bg-volt/10 px-3 py-2 text-xs font-bold text-volt transition hover:bg-volt hover:text-ink">
            切换
          </button>
        </div>
        <select
          value={`${props.config.providerSource}:${props.config.providerId}`}
          onChange={(event) => {
            const [source, id] = event.target.value.split(":") as [ChannelSource, string];
            props.onConfigChange((current) => ({ ...current, providerSource: source, providerId: id || "" }));
          }}
          className="w-full rounded-2xl border border-white/10 bg-black/28 px-3 py-3 text-sm text-white outline-none"
        >
          <option value="guest:">快速连接</option>
          {props.userProviders.map((provider) => (
            <option key={provider.id} value={`user:${provider.id}`}>个人连接 - {provider.name}</option>
          ))}
          {props.platformProviders.map((provider) => (
            <option key={provider.id} value={`platform:${provider.id}`}>工作区连接 - {provider.name}</option>
          ))}
        </select>
        {props.config.providerSource === "guest" && (
          <div className="mt-3 grid gap-2">
            <input
              value={props.config.guestBaseUrl}
              onChange={(event) => props.onConfigChange((current) => ({ ...current, guestBaseUrl: event.target.value }))}
              className="rounded-2xl border border-white/10 bg-black/24 px-3 py-2 text-sm text-white outline-none"
              placeholder="服务地址，例如 https://api.openai.com/v1"
            />
            <input
              value={props.config.guestApiKey}
              type="password"
              onChange={(event) => props.onConfigChange((current) => ({ ...current, guestApiKey: event.target.value }))}
              className="rounded-2xl border border-white/10 bg-black/24 px-3 py-2 text-sm text-white outline-none"
              placeholder="访问凭证，仅用于本次生成"
            />
          </div>
        )}
        <div className="mt-3 rounded-2xl border border-white/8 bg-black/18 p-3">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/36">模型预设</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {modelPresets.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => props.onConfigChange((current) => ({ ...current, model: preset.value }))}
                className={`rounded-full border px-2.5 py-1.5 text-[11px] font-bold transition ${props.config.model === preset.value ? "border-volt bg-volt/16 text-volt" : "border-white/10 bg-white/6 text-white/56 hover:text-white"}`}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <input
            value={props.config.model}
            onChange={(event) => props.onConfigChange((current) => ({ ...current, model: event.target.value }))}
            className="mt-2 w-full rounded-2xl border border-white/10 bg-black/24 px-3 py-2 text-sm text-white outline-none"
            placeholder="模型名称，例如 gpt-image-2 / Qwen_Image"
          />
        </div>
      </div>

      <label
        onDragOver={props.onDragOver}
        onDragLeave={props.onDragLeave}
        onDrop={props.onDrop}
        className={`group relative mb-4 flex min-h-44 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-3xl border border-dashed p-4 text-center transition ${
          props.isDragging ? "border-volt bg-volt/10 shadow-glow" : "border-white/18 bg-black/18 hover:border-volt/70 hover:bg-white/8"
        }`}
      >
        <input type="file" accept="image/*" className="hidden" onChange={props.onFileChange} />
        {props.previewUrl ? (
          <>
            <img src={props.previewUrl} alt="参考图预览" className="absolute inset-0 h-full w-full object-cover opacity-90" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
            <button type="button" onClick={(event) => { event.preventDefault(); props.onRemoveFile(); }} className="absolute right-3 top-3 rounded-full border border-white/15 bg-black/60 p-2 text-white backdrop-blur transition hover:border-plasma hover:text-plasma" aria-label="删除参考图">
              <Trash2 className="h-4 w-4" />
            </button>
            <div className="relative mt-auto w-full text-left">
              <p className="truncate text-sm font-bold">{props.uploadFile?.name}</p>
              <p className="mt-1 text-xs text-white/62">Image-to-Image 已启用，参考图仅内存转发</p>
            </div>
          </>
        ) : (
          <>
            <div className="mb-4 rounded-2xl border border-white/12 bg-white/8 p-4 text-volt transition group-hover:scale-105">
              <UploadCloud className="h-7 w-7" />
            </div>
            <p className="text-sm font-bold">拖拽上传垫图</p>
            <p className="mt-2 max-w-64 text-xs leading-5 text-white/52">支持 PNG / JPG / WEBP。参考图只在生成时内存转发，不会保存到服务器。</p>
          </>
        )}
      </label>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold uppercase tracking-[0.22em] text-white/44">Prompt</label>
          <button type="button" onClick={props.onShowPrompts} className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/8 px-3 py-1.5 text-xs font-bold text-volt transition hover:border-volt/60">
            <BookOpen className="h-3.5 w-3.5" />
            提示词库
          </button>
        </div>
        <textarea
          value={props.prompt}
          onChange={(event) => props.onPromptChange(event.target.value)}
          className="min-h-40 w-full resize-none rounded-3xl border border-white/12 bg-black/24 p-4 text-sm leading-6 text-white outline-none transition placeholder:text-white/30 focus:border-volt/80 focus:ring-4 focus:ring-volt/15"
          placeholder="描述主体、构图、风格、材质、镜头、光线、文字内容和输出比例；也可以从提示词库一键带入模板。"
        />
      </div>

      <div className="mt-5 grid gap-4">
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={applySpeedPreset} className="rounded-2xl border border-volt/30 bg-volt/10 px-3 py-2 text-xs font-extrabold text-volt transition hover:bg-volt hover:text-ink">
            速度优先
          </button>
          <button type="button" onClick={applyQualityPreset} className="rounded-2xl border border-white/12 bg-white/8 px-3 py-2 text-xs font-extrabold text-white/70 transition hover:border-plasma/50 hover:text-plasma">
            质量优先
          </button>
        </div>
        <SliderField label="生成数量" value={props.params.count} min={1} max={4} step={1} suffix="张" onChange={(value) => props.onParamsChange((current) => ({ ...current, count: value }))} />
        <SliderField label="重绘幅度" value={props.params.denoising} min={0.05} max={0.95} step={0.01} suffix="" onChange={(value) => props.onParamsChange((current) => ({ ...current, denoising: value }))} />
      </div>

      <div className="mt-5 space-y-3">
        <PillGroup label="图片比例" options={ratios} value={props.params.ratio} onChange={(value) => props.onParamsChange((current) => ({ ...current, ratio: value }))} />
        <PillGroup label="质量" options={[{ label: "Auto", value: "auto" }, { label: "High", value: "high" }, { label: "Medium", value: "medium" }, { label: "Low", value: "low" }]} value={props.params.quality} onChange={(value) => props.onParamsChange((current) => ({ ...current, quality: value }))} />
        <PillGroup label="格式" options={[{ label: "PNG", value: "png" }, { label: "WEBP", value: "webp" }, { label: "JPEG", value: "jpeg" }]} value={props.params.format} onChange={(value) => props.onParamsChange((current) => ({ ...current, format: value }))} />
      </div>

      {props.notice && !props.error && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="mt-4 rounded-2xl border border-ember/35 bg-ember/10 px-4 py-3 text-sm leading-6 text-ember">
          {props.notice}
        </motion.div>
      )}
      {props.error && <DiagnosticPanel error={props.error} diagnostic={props.diagnostic} />}

      <button onClick={props.onGenerate} disabled={props.isGenerating} className="mt-5 flex w-full items-center justify-center gap-3 rounded-3xl bg-gradient-to-r from-volt via-aurora to-plasma px-5 py-4 text-sm font-extrabold text-white shadow-magenta transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-70">
        {props.isGenerating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
        {props.isGenerating ? "正在生成..." : props.previewUrl ? "开始图生图" : "生成图像"}
      </button>
    </motion.aside>
  );
}

function DiagnosticPanel({ error, diagnostic }: { error: string; diagnostic: ApiDiagnostic | null }) {
  if (!diagnostic) {
    return (
      <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="mt-4 rounded-2xl border border-plasma/30 bg-plasma/10 px-4 py-3 text-sm text-plasma">
        {error}
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="mt-4 overflow-hidden rounded-3xl border border-plasma/30 bg-plasma/10 text-sm">
      <div className="border-b border-white/10 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-plasma/35 bg-plasma/15 px-2.5 py-1 font-mono text-[11px] font-bold text-plasma">{diagnostic.code}</span>
          {diagnostic.upstreamStatus && <span className="rounded-full border border-white/10 bg-white/8 px-2.5 py-1 font-mono text-[11px] text-white/62">HTTP {diagnostic.upstreamStatus}</span>}
        </div>
        <p className="mt-3 font-bold text-plasma">{diagnostic.title || error}</p>
      </div>
      <div className="space-y-3 px-4 py-3 text-white/70">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/38">建议</p>
          <p className="mt-1 leading-6">{diagnostic.suggestion}</p>
        </div>
        {diagnostic.upstreamUrl && (
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/38">请求地址</p>
            <p className="mt-1 break-all font-mono text-xs text-white/55">{diagnostic.upstreamUrl}</p>
          </div>
        )}
        {diagnostic.detail && (
          <details className="rounded-2xl border border-white/10 bg-black/20 p-3">
            <summary className="cursor-pointer text-xs font-bold text-white/58">技术细节</summary>
            <pre className="mt-3 max-h-36 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-white/50">{diagnostic.detail}</pre>
          </details>
        )}
      </div>
    </motion.div>
  );
}

function SliderField({ label, value, min, max, step, suffix, onChange }: { label: string; value: number; min: number; max: number; step: number; suffix: string; onChange: (value: number) => void }) {
  const display = step === 1 ? value.toFixed(0) : value.toFixed(2);
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.045] p-4">
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="font-bold text-white/78">{label}</span>
        <span className="font-mono text-volt">{display}{suffix}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} className="range-glow h-2 w-full cursor-pointer" />
    </div>
  );
}

function PillGroup({ label, options, value, onChange }: { label: string; options: Array<{ label: string; value: string }>; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <p className="mb-2 text-xs font-bold uppercase tracking-[0.22em] text-white/40">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button key={option.value} onClick={() => onChange(option.value)} className={`rounded-full border px-3 py-2 text-xs font-extrabold transition ${value === option.value ? "border-volt bg-volt/18 text-volt shadow-glow" : "border-white/10 bg-white/6 text-white/62 hover:border-white/28 hover:text-white"}`}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function OutputPanel({ gallery, isGenerating, activeRatio, backendStatus, currentChannelLabel, onPreview, onDownload }: { gallery: GalleryImage[]; isGenerating: boolean; activeRatio: string; backendStatus: BackendStatus; currentChannelLabel: string; onPreview: (image: GalleryImage) => void; onDownload: (image: GalleryImage) => void }) {
  return (
    <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="glass min-h-[680px] rounded-[28px] p-4 sm:p-5">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.34em] text-plasma/80">Output Gallery</p>
          <h2 className="mt-2 text-2xl font-extrabold tracking-tight">生成画廊</h2>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-white/10 bg-white/8 px-3 py-2 text-white/58">{activeRatio}</span>
          <span className="rounded-full border border-white/10 bg-white/8 px-3 py-2 text-white/58">{backendStatus === "ready" ? currentChannelLabel : "Backend Pending"}</span>
        </div>
      </div>

      {gallery.length === 0 && !isGenerating ? (
        <div className="grid min-h-[520px] place-items-center rounded-[24px] border border-white/10 bg-black/18 text-center">
          <div className="max-w-md px-6">
            <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-3xl border border-white/12 bg-white/8 text-volt shadow-glow">
              <ImageIcon className="h-8 w-8" />
            </div>
            <h3 className="text-xl font-extrabold">等待第一张生成结果</h3>
            <p className="mt-3 text-sm leading-6 text-white/52">连接一个图像服务，或登录后使用已保存的个人连接与工作区连接。</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence>
            {isGenerating && Array.from({ length: 3 }).map((_, index) => (
              <motion.div key={`skeleton-${index}`} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }} className="relative aspect-[4/5] overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.045]">
                <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-white/12 via-volt/8 to-plasma/10" />
                <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full border border-white/12 bg-black/32 px-3 py-2 text-xs text-white/68 backdrop-blur">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-volt" />
                  正在生成...
                </div>
              </motion.div>
            ))}
            {gallery.map((image) => (
              <motion.article key={image.id} layout initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="group relative overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.04]">
                <img src={image.src} alt={image.prompt} className="aspect-[4/5] w-full object-cover transition duration-500 group-hover:scale-105" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/78 via-black/8 to-transparent opacity-80" />
                <div className="absolute left-4 top-4 rounded-full border border-white/12 bg-black/34 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-white/70 backdrop-blur">{image.providerName || "API"}</div>
                <div className="absolute right-4 top-4 flex translate-y-2 gap-2 opacity-0 transition group-hover:translate-y-0 group-hover:opacity-100">
                  <IconButton label="放大查看" onClick={() => onPreview(image)} icon={<Maximize2 className="h-4 w-4" />} />
                  <IconButton label="下载" onClick={() => onDownload(image)} icon={<Download className="h-4 w-4" />} />
                </div>
                <div className="absolute inset-x-0 bottom-0 p-4">
                  <p className="max-h-11 overflow-hidden text-sm font-semibold leading-5 text-white">{image.prompt}</p>
                  <p className="mt-2 font-mono text-[11px] text-white/44">{new Date(image.createdAt).toLocaleString()}</p>
                </div>
              </motion.article>
            ))}
          </AnimatePresence>
        </div>
      )}
    </motion.section>
  );
}

function PromptLibrary({ onUseTemplate }: { onUseTemplate: (template: PromptTemplate) => void }) {
  const [category, setCategory] = useState("全部");
  const [query, setQuery] = useState("");
  const templates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return promptTemplates.filter((template) => {
      const inCategory = category === "全部" || template.category === category;
      const inQuery = !q || [template.title, template.description, template.category, template.level, template.prompt, ...template.tags].join(" ").toLowerCase().includes(q);
      return inCategory && inQuery;
    });
  }, [category, query]);

  return (
    <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-[28px] p-4 sm:p-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.34em] text-volt/80">Prompt Library</p>
          <h2 className="mt-2 text-3xl font-black tracking-tight">AstraForge 灵感库</h2>
          <p className="mt-3 text-sm leading-6 text-white/56">内置为图像创作重新编写的中文商业模板。选择一个模板后可直接带回创作台继续微调。</p>
        </div>
        <label className="flex min-w-0 items-center gap-3 rounded-2xl border border-white/12 bg-black/24 px-4 py-3 lg:w-96">
          <Search className="h-4 w-4 text-white/44" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索：海报 / 角色 / 手账 / UI..." className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/34" />
        </label>
      </div>
      <div className="hide-scrollbar mt-6 flex gap-2 overflow-x-auto pb-2">
        {promptCategories.map((item) => (
          <button key={item} onClick={() => setCategory(item)} className={`shrink-0 rounded-full border px-4 py-2 text-sm font-bold transition ${category === item ? "border-volt bg-volt/18 text-volt shadow-glow" : "border-white/10 bg-white/6 text-white/62 hover:text-white"}`}>
            {item}
          </button>
        ))}
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {templates.map((template) => (
          <motion.article key={template.id} layout className="group flex min-h-[310px] flex-col rounded-[24px] border border-white/10 bg-black/22 p-4 transition hover:border-volt/40 hover:bg-white/[0.07]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="mb-3 flex flex-wrap gap-2">
                  <span className="rounded-full border border-plasma/25 bg-plasma/10 px-2.5 py-1 text-[11px] font-bold text-plasma">{template.category}</span>
                  <span className="rounded-full border border-white/10 bg-white/8 px-2.5 py-1 text-[11px] font-bold text-white/58">{template.level}</span>
                </div>
                <h3 className="text-lg font-extrabold tracking-tight">{template.title}</h3>
              </div>
              <span className="rounded-full border border-white/10 bg-white/8 px-2.5 py-1 font-mono text-[11px] text-volt">{template.ratio}</span>
            </div>
            <p className="mt-3 text-sm leading-6 text-white/56">{template.description}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {template.tags.map((tag) => <span key={tag} className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/48">{tag}</span>)}
            </div>
            <p className="mt-4 max-h-28 overflow-hidden rounded-2xl border border-white/8 bg-white/[0.035] p-3 text-xs leading-5 text-white/52">{template.prompt}</p>
            <button onClick={() => onUseTemplate(template)} className="mt-auto flex items-center justify-center gap-2 rounded-2xl border border-volt/40 bg-volt/12 px-4 py-3 text-sm font-extrabold text-volt transition hover:bg-volt hover:text-ink">
              <CheckCircle2 className="h-4 w-4" />
              使用模板
            </button>
          </motion.article>
        ))}
      </div>
    </motion.section>
  );
}

function ChannelsView({
  config,
  token,
  user,
  userProviders,
  platformProviders,
  onConfigChange,
  onOpenAuth,
  onRefresh,
  onDeleteUserProvider,
}: {
  config: AppConfig;
  token: string;
  user: User | null;
  userProviders: Provider[];
  platformProviders: Provider[];
  onConfigChange: (config: AppConfig | ((current: AppConfig) => AppConfig)) => void;
  onOpenAuth: () => void;
  onRefresh: () => void;
  onDeleteUserProvider: (id: string) => void;
}) {
  const [form, setForm] = useState({ name: "", baseUrl: "https://api.openai.com/v1", apiKey: "", defaultModel: "gpt-image-2", type: "openai-compatible" });
  const [message, setMessage] = useState("");
  async function addProvider() {
    if (!user) { onOpenAuth(); return; }
    try {
      await apiFetch(config.backendUrl, "/api/user/providers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }, token);
      setForm({ name: "", baseUrl: "https://api.openai.com/v1", apiKey: "", defaultModel: "gpt-image-2", type: "openai-compatible" });
      setMessage("连接已保存。");
      onRefresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存失败");
    }
  }
  return (
    <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="grid gap-6 lg:grid-cols-[420px_minmax(0,1fr)]">
      <div className="glass rounded-[28px] p-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.34em] text-volt/80">Connection Center</p>
        <h2 className="mt-2 text-2xl font-black">个人连接</h2>
        <p className="mt-3 text-sm leading-6 text-white/54">登录后可以保存常用的图像服务地址。OpenAI 兼容、新版中转站、NewAPI、SubAPI 通常填写到 /v1，凭证会加密存放。</p>
        <div className="mt-5 grid gap-3">
          <Input value={form.name} placeholder="连接名称，例如 我的图像服务" onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
          <Input value={form.baseUrl} placeholder="服务地址，例如 https://example.com/v1，不要填 /images/generations" onChange={(value) => setForm((current) => ({ ...current, baseUrl: value }))} />
          <Input value={form.apiKey} type="password" placeholder="访问凭证，会加密保存" onChange={(value) => setForm((current) => ({ ...current, apiKey: value }))} />
          <Input value={form.defaultModel} placeholder="默认模型，例如 gpt-image-2" onChange={(value) => setForm((current) => ({ ...current, defaultModel: value }))} />
          <button onClick={addProvider} className="flex items-center justify-center gap-2 rounded-2xl bg-volt px-4 py-3 text-sm font-extrabold text-ink">
            <Plus className="h-4 w-4" />
            {user ? "保存个人连接" : "登录后保存"}
          </button>
          {message && <p className="text-sm text-white/58">{message}</p>}
        </div>
      </div>
      <div className="glass rounded-[28px] p-5">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.34em] text-plasma/80">Available Connections</p>
            <h2 className="mt-2 text-2xl font-black">可用连接</h2>
          </div>
          <button onClick={onRefresh} className="rounded-full border border-white/12 bg-white/8 px-4 py-2 text-sm font-bold">刷新</button>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <ProviderCard title="快速连接" subtitle="无需登录，凭证只用于本次生成" active={config.providerSource === "guest"} onUse={() => onConfigChange((current) => ({ ...current, providerSource: "guest", providerId: "" }))} />
          {userProviders.map((provider) => (
            <ProviderCard key={provider.id} title={provider.name} subtitle={`个人连接 · ${provider.defaultModel}`} active={config.providerSource === "user" && config.providerId === provider.id} onUse={() => onConfigChange((current) => ({ ...current, providerSource: "user", providerId: provider.id, model: provider.defaultModel }))} onDelete={() => onDeleteUserProvider(provider.id)} />
          ))}
          {platformProviders.map((provider) => (
            <ProviderCard key={provider.id} title={provider.name} subtitle={`工作区授权 · ${provider.defaultModel}`} active={config.providerSource === "platform" && config.providerId === provider.id} onUse={() => onConfigChange((current) => ({ ...current, providerSource: "platform", providerId: provider.id, model: provider.defaultModel }))} />
          ))}
        </div>
      </div>
    </motion.section>
  );
}

function ProviderCard({ title, subtitle, active, onUse, onDelete }: { title: string; subtitle: string; active: boolean; onUse: () => void; onDelete?: () => void }) {
  return (
    <div className={`rounded-3xl border p-4 ${active ? "border-volt bg-volt/10 shadow-glow" : "border-white/10 bg-white/[0.045]"}`}>
      <p className="font-bold">{title}</p>
      <p className="mt-2 text-sm text-white/50">{subtitle}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={onUse} className="rounded-full border border-white/12 bg-white/8 px-4 py-2 text-sm font-bold text-volt">{active ? "当前使用" : "使用此连接"}</button>
        {onDelete && (
          <button onClick={onDelete} className="rounded-full border border-plasma/25 bg-plasma/10 px-3 py-2 text-sm font-bold text-plasma transition hover:bg-plasma hover:text-white">
            删除
          </button>
        )}
      </div>
    </div>
  );
}

function UsageView({
  logs,
  onRefresh,
  onDelete,
  onClear,
}: {
  logs: UsageLog[];
  onRefresh: () => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}) {
  return (
    <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-[28px] p-5">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.34em] text-volt/80">Usage</p>
          <h2 className="mt-2 text-2xl font-black">本地使用记录</h2>
          <p className="mt-2 text-sm text-white/48">记录只保存在当前浏览器，不会写入服务器。</p>
        </div>
          <div className="flex gap-2">
            <button onClick={onRefresh} className="rounded-full border border-white/12 bg-white/8 px-4 py-2 text-sm font-bold">刷新</button>
            <button onClick={onClear} disabled={!logs.length} className="rounded-full border border-plasma/30 bg-plasma/10 px-4 py-2 text-sm font-bold text-plasma disabled:cursor-not-allowed disabled:opacity-40">清空记录</button>
          </div>
        </div>
        <div className="overflow-hidden rounded-3xl border border-white/10">
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead className="bg-white/[0.06] text-white/48">
            <tr><th className="p-3">时间</th><th className="p-3">连接</th><th className="p-3">模型</th><th className="p-3">模式</th><th className="p-3">数量</th><th className="p-3">状态</th><th className="p-3">提示词</th><th className="p-3 text-right">操作</th></tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-t border-white/8">
                <td className="p-3 text-white/52">{new Date(log.createdAt).toLocaleString()}</td>
                <td className="p-3">{log.providerName}</td>
                <td className="p-3 text-white/62">{log.model}</td>
                <td className="p-3">{log.mode}</td>
                <td className="p-3">{log.imageCount}</td>
                <td className={`p-3 ${log.status === "success" ? "text-volt" : "text-plasma"}`}>{log.status}</td>
                <td className="max-w-sm truncate p-3 text-white/52">{log.error || log.prompt}</td>
                <td className="p-3 text-right">
                  <button onClick={() => onDelete(log.id)} className="rounded-full border border-white/10 bg-white/6 px-3 py-1.5 text-xs font-bold text-white/58 transition hover:border-plasma/50 hover:text-plasma">删除</button>
                </td>
              </tr>
            ))}
            {!logs.length && <tr><td className="p-6 text-center text-white/50" colSpan={8}>暂无使用记录</td></tr>}
          </tbody>
          </table>
        </div>
        <p className="mt-4 text-xs leading-5 text-white/42">本地记录保存文本元数据，生成图片保留在当前浏览器本地画廊中。清空浏览器数据会同时移除这些内容。</p>
      </motion.section>
  );
}

function AdminView({ user, token, backendUrl, users, providers, onRefresh }: { user: User | null; token: string; backendUrl: string; users: User[]; providers: Provider[]; onRefresh: () => void }) {
  const [form, setForm] = useState({ name: "平台 gpt-image-2", baseUrl: "https://api.openai.com/v1", apiKey: "", defaultModel: "gpt-image-2", accessMode: "admin-only", assignedUserIds: [] as string[], dailyLimit: 100 });
  const [message, setMessage] = useState("");
  if (user?.role !== "admin") {
    return <EmptyState title="仅管理员可见" description="工作区连接、授权用户和全局额度需要管理员权限。" />;
  }
  async function addPlatformProvider() {
    try {
      await apiFetch(backendUrl, "/api/admin/platform-providers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }, token);
      setMessage("工作区连接已创建。");
      setForm((current) => ({ ...current, apiKey: "" }));
      onRefresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "创建失败");
    }
  }
  return (
    <motion.section initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} className="grid gap-6 lg:grid-cols-[430px_minmax(0,1fr)]">
      <div className="glass rounded-[28px] p-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.34em] text-volt/80">Admin Provider</p>
        <h2 className="mt-2 text-2xl font-black">工作区连接</h2>
        <div className="mt-5 grid gap-3">
          <Input value={form.name} placeholder="名称" onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
          <Input value={form.baseUrl} placeholder="服务地址，例如 https://example.com/v1" onChange={(value) => setForm((current) => ({ ...current, baseUrl: value }))} />
          <Input type="password" value={form.apiKey} placeholder="工作区访问凭证" onChange={(value) => setForm((current) => ({ ...current, apiKey: value }))} />
          <Input value={form.defaultModel} placeholder="默认模型" onChange={(value) => setForm((current) => ({ ...current, defaultModel: value }))} />
          <select value={form.accessMode} onChange={(event) => setForm((current) => ({ ...current, accessMode: event.target.value }))} className="rounded-2xl border border-white/10 bg-black/24 px-3 py-3 text-sm text-white outline-none">
            <option value="admin-only">仅管理员</option>
            <option value="assigned-users">指定用户</option>
          </select>
          {form.accessMode === "assigned-users" && (
            <div className="max-h-36 overflow-auto rounded-2xl border border-white/10 bg-black/18 p-3">
              {users.filter((item) => item.role !== "admin").map((item) => (
                <label key={item.id} className="mb-2 flex items-center gap-2 text-sm text-white/70">
                  <input type="checkbox" checked={form.assignedUserIds.includes(item.id)} onChange={(event) => setForm((current) => ({ ...current, assignedUserIds: event.target.checked ? [...current.assignedUserIds, item.id] : current.assignedUserIds.filter((id) => id !== item.id) }))} />
                  {item.email}
                </label>
              ))}
            </div>
          )}
          <button onClick={addPlatformProvider} className="rounded-2xl bg-volt px-4 py-3 text-sm font-extrabold text-ink">创建工作区连接</button>
          {message && <p className="text-sm text-white/58">{message}</p>}
        </div>
      </div>
      <div className="glass rounded-[28px] p-5">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.34em] text-plasma/80">Platform Routes</p>
            <h2 className="mt-2 text-2xl font-black">已配置连接</h2>
          </div>
          <button onClick={onRefresh} className="rounded-full border border-white/12 bg-white/8 px-4 py-2 text-sm font-bold">刷新</button>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {providers.map((provider) => (
            <div key={provider.id} className="rounded-3xl border border-white/10 bg-white/[0.045] p-4">
              <p className="font-bold">{provider.name}</p>
              <p className="mt-2 text-sm text-white/48">{provider.baseUrl}</p>
              <p className="mt-2 text-sm text-white/62">{provider.defaultModel} · {provider.accessMode}</p>
            </div>
          ))}
          {!providers.length && <p className="text-white/50">暂无工作区连接</p>}
        </div>
      </div>
    </motion.section>
  );
}

function AuthModal({ open, backendUrl, onClose, onAuthed }: { open: boolean; backendUrl: string; onClose: () => void; onAuthed: (payload: { token: string; user: User }) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  async function submit() {
    setError("");
    try {
      const payload = await apiFetch<{ token: string; user: User }>(backendUrl, `/api/auth/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      onAuthed(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "认证失败");
    }
  }
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-xl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div className="w-full max-w-md rounded-[28px] border border-white/12 bg-[#070a15]/92 p-5 shadow-2xl" initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.34em] text-volt/80">Account</p>
                <h2 className="mt-2 text-2xl font-black">{mode === "login" ? "登录" : "注册"}</h2>
              </div>
              <IconButton label="关闭" onClick={onClose} icon={<X className="h-4 w-4" />} />
            </div>
            <div className="mt-5 grid gap-3">
              <Input value={email} placeholder="邮箱" onChange={setEmail} />
              <Input type="password" value={password} placeholder="密码，至少 8 位" onChange={setPassword} />
              {error && <p className="text-sm text-plasma">{error}</p>}
              <button onClick={submit} className="rounded-2xl bg-volt px-4 py-3 text-sm font-extrabold text-ink">{mode === "login" ? "登录" : "注册"}</button>
              <button onClick={() => setMode(mode === "login" ? "register" : "login")} className="text-sm text-white/58 hover:text-white">
                {mode === "login" ? "还没有账号？注册" : "已有账号？登录"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SettingsDrawer({ open, config, backendStatus, onClose, onChange }: { open: boolean; config: AppConfig; backendStatus: BackendStatus; onClose: () => void; onChange: (config: AppConfig | ((current: AppConfig) => AppConfig)) => void }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-40 bg-black/58 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside initial={{ x: 420 }} animate={{ x: 0 }} exit={{ x: 420 }} transition={{ type: "spring", damping: 30, stiffness: 260 }} className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[420px] flex-col border-l border-white/12 bg-[#070a15]/88 p-5 shadow-2xl backdrop-blur-2xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.34em] text-volt/80">Backend Config</p>
                <h2 className="mt-2 text-2xl font-extrabold">后端配置</h2>
              </div>
              <IconButton label="关闭" onClick={onClose} icon={<X className="h-4 w-4" />} />
            </div>
            <div className="mt-7 space-y-5">
              <Input value={config.backendUrl} placeholder="http://127.0.0.1:8787" onChange={(value) => onChange((current) => ({ ...current, backendUrl: value }))} />
              <Input value={config.model} placeholder="默认模型，例如 gpt-image-2 / Qwen_Image" onChange={(value) => onChange((current) => ({ ...current, model: value }))} />
              <label className="flex cursor-pointer items-start gap-3 rounded-3xl border border-white/10 bg-white/[0.045] p-4">
                <input type="checkbox" checked={config.sendDenoising} onChange={(event) => onChange((current) => ({ ...current, sendDenoising: event.target.checked }))} className="mt-1 h-4 w-4 accent-plasma" />
                <span>
                  <span className="block text-sm font-bold">发送 denoising_strength 兼容参数</span>
                  <span className="mt-1 block text-xs leading-5 text-white/46">部分中转或自定义后端会读取它。</span>
                </span>
              </label>
            </div>
            <div className="mt-auto rounded-3xl border border-volt/18 bg-volt/8 p-4 text-xs leading-5 text-white/58">后端状态：<span className="font-bold text-volt">{backendStatus}</span></div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function EmptyState({ title, description, action, onAction }: { title: string; description: string; action?: string; onAction?: () => void }) {
  return (
    <div className="glass grid min-h-[520px] place-items-center rounded-[28px] p-8 text-center">
      <div className="max-w-md">
        <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-3xl border border-white/12 bg-white/8 text-volt shadow-glow">
          <UserCircle className="h-8 w-8" />
        </div>
        <h2 className="text-2xl font-black">{title}</h2>
        <p className="mt-3 text-sm leading-6 text-white/52">{description}</p>
        {action && <button onClick={onAction} className="mt-5 rounded-2xl bg-volt px-5 py-3 text-sm font-extrabold text-ink">{action}</button>}
      </div>
    </div>
  );
}

function Input({ value, placeholder, onChange, type = "text" }: { value: string; placeholder: string; onChange: (value: string) => void; type?: string }) {
  return <input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className="w-full rounded-2xl border border-white/12 bg-black/24 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/26 focus:border-volt/80 focus:ring-4 focus:ring-volt/15" />;
}

function IconButton({ label, icon, onClick }: { label: string; icon: ReactNode; onClick: () => void }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className="grid h-10 w-10 place-items-center rounded-full border border-white/12 bg-black/42 text-white backdrop-blur transition hover:border-volt hover:text-volt">
      {icon}
    </button>
  );
}
