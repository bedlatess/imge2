import { AnimatePresence, motion } from "framer-motion";
import {
  Aperture,
  BookOpen,
  Check,
  CircleAlert,
  Download,
  History,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  LogOut,
  Maximize2,
  PanelRightOpen,
  PlugZap,
  Plus,
  RefreshCw,
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
const DEFAULT_BACKEND_URL =
  typeof window !== "undefined" && window.location.port !== "5173" ? window.location.origin : "http://127.0.0.1:8787";

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
  { label: "自动", value: "auto" },
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
    return Array.isArray(parsed)
      ? parsed.filter((item) => typeof item?.src === "string" && typeof item?.prompt === "string").slice(0, 80)
      : [];
  } catch {
    return [];
  }
}

function loadLocalUsageLogs(): UsageLog[] {
  try {
    const saved = localStorage.getItem(LOCAL_USAGE_STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item?.id === "string").slice(0, 200) : [];
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
      setNotice("浏览器本地存储空间不足，当前记录只会保留在本次页面会话中。");
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

  const activeRatio = useMemo(() => ratios.find((item) => item.value === params.ratio)?.label ?? "自动", [params.ratio]);
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
      setError("请先填写服务地址和访问凭证。凭证只会用于本次生成，不会保存到配置。");
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
      setGallery((current) => [...result.images, ...current].slice(0, 80));
      setNotice(result.warning);
      addLocalUsageLog({
        providerScope: config.providerSource,
        providerName: currentChannelLabel,
        prompt: prompt.trim(),
        model: config.model,
        mode: uploadFile ? "图生图" : "文生图",
        imageCount: result.images.length,
        status: "成功",
      });
    } catch (err) {
      if (err instanceof ImageApiError && err.diagnostic) {
        setError(err.message);
        setDiagnostic(err.diagnostic);
        addLocalUsageLog({
          providerScope: config.providerSource,
          providerName: currentChannelLabel,
          prompt: prompt.trim(),
          model: config.model,
          mode: uploadFile ? "图生图" : "文生图",
          imageCount: 0,
          status: "失败",
          error: err.diagnostic.title || err.message,
        });
      } else {
        const message = err instanceof Error ? err.message : "生成失败，请检查连接配置。";
        setError(message);
        setDiagnostic(null);
        addLocalUsageLog({
          providerScope: config.providerSource,
          providerName: currentChannelLabel,
          prompt: prompt.trim(),
          model: config.model,
          mode: uploadFile ? "图生图" : "文生图",
          imageCount: 0,
          status: "失败",
          error: message,
        });
      }
    } finally {
      setIsGenerating(false);
    }
  }

  function addLocalUsageLog(log: Omit<UsageLog, "id" | "createdAt">) {
    setUsageLogs((current) => [{ id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...log }, ...current].slice(0, 200));
  }

  function deleteUsageLog(id: string) {
    setUsageLogs((current) => current.filter((log) => log.id !== id));
  }

  function clearLocalRecordsAndImages() {
    setUsageLogs([]);
    setGallery([]);
    localStorage.removeItem(LOCAL_USAGE_STORAGE_KEY);
    localStorage.removeItem(GALLERY_STORAGE_KEY);
    setNotice("本地记录和图片画廊已清空。");
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
    apiFetch<{ providers: Provider[] }>(config.backendUrl, "/api/admin/platform-providers", {}, token).then((payload) =>
      setAdminProviders(payload.providers),
    );
    apiFetch<{ users: User[] }>(config.backendUrl, "/api/admin/users", {}, token).then((payload) => setAdminUsers(payload.users));
  }

  useEffect(() => {
    if (activeView === "admin") refreshAdmin();
  }, [activeView, token, user?.role]);

  async function logout() {
    if (token) await apiFetch(config.backendUrl, "/api/auth/logout", { method: "POST" }, token).catch(() => null);
    setToken("");
    setUser(null);
    setConfig((current) => ({ ...current, providerSource: "guest", providerId: "" }));
  }

  return (
    <main className="min-h-screen bg-ink text-slate-100">
      <div className="pointer-events-none fixed inset-0 circuit-bg opacity-80" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-[1680px] flex-col px-4 py-4 sm:px-6 lg:px-8">
        <Header
          activeView={activeView}
          backendStatus={backendStatus}
          user={user}
          onChangeView={setActiveView}
          onOpenAuth={() => setAuthOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onLogout={logout}
        />

        <div className="mt-5 flex-1">
          {activeView === "studio" && (
            <div className="grid min-h-[calc(100vh-116px)] gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
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
                onConfigChange={setConfig}
                onOpenChannels={() => setActiveView("channels")}
              />
              <OutputPanel
                gallery={gallery}
                isGenerating={isGenerating}
                requestedCount={params.count}
                activeRatio={activeRatio}
                backendStatus={backendStatus}
                currentChannelLabel={currentChannelLabel}
                onPreview={setLightbox}
                onDownload={downloadImage}
                onClearGallery={() => setGallery([])}
              />
            </div>
          )}

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
          {activeView === "usage" && (
            <UsageView logs={usageLogs} galleryCount={gallery.length} onDelete={deleteUsageLog} onClearAll={clearLocalRecordsAndImages} />
          )}
          {activeView === "admin" && (
            <AdminView user={user} token={token} backendUrl={config.backendUrl} users={adminUsers} providers={adminProviders} onRefresh={refreshAdmin} />
          )}
        </div>
      </div>

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
            className="fixed inset-0 z-50 grid place-items-center bg-black/[0.82] p-4 backdrop-blur-xl"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setLightbox(null)}
          >
            <motion.div
              className="relative max-h-[92vh] max-w-[92vw]"
              initial={{ scale: 0.96 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.96 }}
              onClick={(event) => event.stopPropagation()}
            >
              <img src={lightbox.src} alt={lightbox.prompt} className="max-h-[88vh] rounded-xl border border-white/12 object-contain shadow-2xl" />
              <IconButton label="关闭预览" onClick={() => setLightbox(null)} icon={<X className="h-4 w-4" />} className="absolute right-3 top-3" />
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
  const statusTone = backendStatus === "ready" ? "bg-emerald-400" : backendStatus === "checking" ? "bg-amber-300" : "bg-rose-400";
  return (
    <header className="panel flex flex-col gap-4 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-cyan-300/20 bg-cyan-300/[0.10] text-cyan-200">
          <Aperture className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-lg font-black tracking-wide">AstraForge</h1>
            <span className="hidden rounded-full border border-white/10 px-2 py-0.5 font-mono text-[10px] uppercase text-white/[0.45] sm:inline">Image Studio</span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-white/50">
            <span className={`h-2 w-2 rounded-full ${statusTone}`} />
            <span>{backendStatus === "ready" ? "后端已连接" : backendStatus === "checking" ? "正在检测后端" : "后端离线"}</span>
          </div>
        </div>
      </div>

      <nav className="flex gap-1 overflow-x-auto rounded-xl border border-white/[0.08] bg-black/20 p-1">
        <NavButton active={activeView === "studio"} onClick={() => onChangeView("studio")} icon={<Sparkles />} label="工作台" />
        <NavButton active={activeView === "prompts"} onClick={() => onChangeView("prompts")} icon={<BookOpen />} label="提示词" />
        <NavButton active={activeView === "channels"} onClick={() => onChangeView("channels")} icon={<PlugZap />} label="连接" />
        <NavButton active={activeView === "usage"} onClick={() => onChangeView("usage")} icon={<History />} label="记录" />
        {user?.role === "admin" && <NavButton active={activeView === "admin"} onClick={() => onChangeView("admin")} icon={<ShieldCheck />} label="管理" />}
      </nav>

      <div className="flex items-center gap-2">
        <IconButton label="后端设置" onClick={onOpenSettings} icon={<Settings className="h-4 w-4" />} />
        {user ? (
          <>
            <div className="hidden max-w-[220px] truncate rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white/[0.68] sm:block">
              {user.email}
            </div>
            <IconButton label="退出登录" onClick={onLogout} icon={<LogOut className="h-4 w-4" />} />
          </>
        ) : (
          <button onClick={onOpenAuth} className="btn-primary">
            <UserCircle className="h-4 w-4" />
            登录
          </button>
        )}
      </div>
    </header>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold transition ${
        active ? "bg-cyan-300 text-slate-950 shadow-[0_0_28px_rgba(103,232,249,.24)]" : "text-white/[0.52] hover:bg-white/[0.08] hover:text-white"
      }`}
    >
      <span className="[&>svg]:h-4 [&>svg]:w-4">{icon}</span>
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
  onParamsChange: (value: GenerationParams | ((current: GenerationParams) => GenerationParams)) => void;
  onDrop: (event: DragEvent<HTMLLabelElement>) => void;
  onDragOver: (event: DragEvent<HTMLLabelElement>) => void;
  onDragLeave: () => void;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemoveFile: () => void;
  onGenerate: () => void;
  onConfigChange: (config: AppConfig | ((current: AppConfig) => AppConfig)) => void;
  onOpenChannels: () => void;
}) {
  const {
    prompt,
    params,
    previewUrl,
    uploadFile,
    isDragging,
    isGenerating,
    error,
    diagnostic,
    notice,
    currentChannelLabel,
    config,
    userProviders,
    platformProviders,
    onPromptChange,
    onParamsChange,
    onDrop,
    onDragOver,
    onDragLeave,
    onFileChange,
    onRemoveFile,
    onGenerate,
    onConfigChange,
    onOpenChannels,
  } = props;

  function applySpeedPreset() {
    onParamsChange((current) => ({ ...current, count: 1, quality: "auto", format: "png" }));
  }

  function applyQualityPreset() {
    onParamsChange((current) => ({ ...current, count: 2, quality: "high", format: "png" }));
  }

  return (
    <section className="panel flex flex-col overflow-hidden">
      <div className="border-b border-white/[0.08] px-4 py-4">
        <p className="label">Create</p>
        <h2 className="mt-1 text-xl font-black">生成控制台</h2>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="field-label">提示词</label>
            <span className="font-mono text-xs text-white/[0.35]">{prompt.length}/2000</span>
          </div>
          <textarea
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            maxLength={2000}
            placeholder="描述你要生成的画面、风格、构图、材质和限制条件。"
            className="min-h-40 w-full resize-none rounded-xl border border-white/10 bg-black/[0.28] px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-white/25 focus:border-cyan-300/70 focus:ring-4 focus:ring-cyan-300/10"
          />
        </div>

        <label
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          className={`block cursor-pointer rounded-xl border border-dashed p-3 transition ${
            isDragging ? "border-cyan-300 bg-cyan-300/[0.10]" : "border-white/12 bg-white/[0.035] hover:border-cyan-300/50"
          }`}
        >
          <input className="hidden" type="file" accept="image/*" onChange={onFileChange} />
          {previewUrl ? (
            <div className="flex gap-3">
              <img src={previewUrl} alt="参考图" className="h-20 w-20 rounded-lg object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{uploadFile?.name || "参考图"}</p>
                <p className="mt-1 text-xs leading-5 text-white/[0.45]">已进入图生图模式。点击下方按钮可移除参考图。</p>
                <button
                  type="button"
                  onClick={(event) => {
                    event.preventDefault();
                    onRemoveFile();
                  }}
                  className="mt-2 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-white/[0.58] hover:border-rose-300/50 hover:text-rose-200"
                >
                  移除参考图
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-lg bg-white/[0.06] text-cyan-200">
                <UploadCloud className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-bold">拖入参考图或点击上传</p>
                <p className="mt-1 text-xs text-white/40">留空时使用文生图模式</p>
              </div>
            </div>
          )}
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <button onClick={applySpeedPreset} className="btn-secondary justify-center">
            <RefreshCw className="h-4 w-4" />
            快速预览
          </button>
          <button onClick={applyQualityPreset} className="btn-secondary justify-center">
            <Sparkles className="h-4 w-4" />
            质量优先
          </button>
        </div>

        <div className="grid gap-4">
          <Stepper
            label="生成数量"
            value={params.count}
            min={1}
            max={4}
            onChange={(value) => onParamsChange((current) => ({ ...current, count: value }))}
          />
          <PillGroup
            label="画幅"
            options={ratios}
            value={params.ratio}
            onChange={(value) => onParamsChange((current) => ({ ...current, ratio: value }))}
          />
          <PillGroup
            label="质量"
            options={[
              { label: "自动", value: "auto" },
              { label: "标准", value: "standard" },
              { label: "高清", value: "high" },
            ]}
            value={params.quality}
            onChange={(value) => onParamsChange((current) => ({ ...current, quality: value }))}
          />
          <PillGroup
            label="格式"
            options={[
              { label: "PNG", value: "png" },
              { label: "JPEG", value: "jpeg" },
              { label: "WEBP", value: "webp" },
            ]}
            value={params.format}
            onChange={(value) => onParamsChange((current) => ({ ...current, format: value }))}
          />
          <RangeField
            label="重绘强度"
            value={params.denoising}
            min={0}
            max={1}
            step={0.01}
            disabled={!config.sendDenoising}
            onChange={(value) => onParamsChange((current) => ({ ...current, denoising: value }))}
          />
        </div>

        <div className="rounded-xl border border-white/[0.08] bg-black/18 p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="field-label">当前连接</p>
              <p className="mt-1 truncate text-sm font-bold text-cyan-100">{currentChannelLabel}</p>
            </div>
            <button onClick={onOpenChannels} className="btn-ghost shrink-0">
              <PanelRightOpen className="h-4 w-4" />
              管理
            </button>
          </div>

          <Input
            value={config.model}
            list="model-presets"
            placeholder="模型名称，可选择预设或直接输入自定义模型"
            onChange={(value) => onConfigChange((current) => ({ ...current, model: value }))}
          />
          <datalist id="model-presets">
            {modelPresets.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </datalist>
          <p className="mb-3 mt-2 text-xs leading-5 text-white/[0.42]">高级用户可以直接输入服务商后台给出的模型名，例如自建模型、NewAPI 映射名或中转站模型名。</p>

          {config.providerSource === "guest" && (
            <div className="grid gap-2">
              <Input
                value={config.guestBaseUrl}
                placeholder="服务地址，例如 https://api.example.com/v1"
                onChange={(value) => onConfigChange((current) => ({ ...current, guestBaseUrl: value }))}
              />
              <Input
                value={config.guestApiKey}
                type="password"
                placeholder="访问凭证，仅用于本次生成"
                onChange={(value) => onConfigChange((current) => ({ ...current, guestApiKey: value }))}
              />
            </div>
          )}

          {config.providerSource !== "guest" && (
            <select
              value={config.providerId}
              onChange={(event) => onConfigChange((current) => ({ ...current, providerId: event.target.value }))}
              className="w-full rounded-lg border border-white/10 bg-black/[0.32] px-3 py-2 text-sm outline-none focus:border-cyan-300/70"
            >
              <option value="">选择连接</option>
              {config.providerSource === "user" &&
                userProviders.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              {config.providerSource === "platform" &&
                platformProviders.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
            </select>
          )}
        </div>

        <DiagnosticPanel error={error} diagnostic={diagnostic} notice={notice} />
      </div>

      <div className="border-t border-white/[0.08] p-4">
        <button onClick={onGenerate} disabled={isGenerating} className="btn-primary h-12 w-full justify-center text-base disabled:cursor-not-allowed disabled:opacity-60">
          {isGenerating ? <Loader2 className="h-5 w-5 animate-spin" /> : <Wand2 className="h-5 w-5" />}
          {isGenerating ? "正在生成" : "开始生成"}
        </button>
      </div>
    </section>
  );
}

function DiagnosticPanel({ error, diagnostic, notice }: { error: string; diagnostic: ApiDiagnostic | null; notice: string }) {
  if (!error && !notice) return null;
  if (error) {
    return (
      <div className="rounded-xl border border-rose-300/[0.18] bg-rose-400/[0.08] p-3 text-sm">
        <div className="flex gap-2 font-bold text-rose-100">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {diagnostic?.title || error}
        </div>
        {diagnostic?.suggestion && <p className="mt-2 leading-6 text-white/[0.62]">{diagnostic.suggestion}</p>}
        {diagnostic?.code && <p className="mt-2 font-mono text-xs text-white/[0.36]">{diagnostic.code}</p>}
      </div>
    );
  }
  return <div className="rounded-xl border border-cyan-300/[0.14] bg-cyan-300/[0.07] p-3 text-sm leading-6 text-cyan-50/80">{notice}</div>;
}

function OutputPanel({
  gallery,
  isGenerating,
  requestedCount,
  activeRatio,
  backendStatus,
  currentChannelLabel,
  onPreview,
  onDownload,
  onClearGallery,
}: {
  gallery: GalleryImage[];
  isGenerating: boolean;
  requestedCount: number;
  activeRatio: string;
  backendStatus: BackendStatus;
  currentChannelLabel: string;
  onPreview: (image: GalleryImage) => void;
  onDownload: (image: GalleryImage) => void;
  onClearGallery: () => void;
}) {
  const placeholders = Array.from({ length: Math.max(1, requestedCount) });
  return (
    <section className="panel flex min-h-[560px] flex-col overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-white/[0.08] px-4 py-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="label">Output</p>
          <h2 className="mt-1 text-xl font-black">生成结果</h2>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-white/50">
          <MetaPill label="连接" value={currentChannelLabel} />
          <MetaPill label="画幅" value={activeRatio} />
          <MetaPill label="后端" value={backendStatus === "ready" ? "在线" : backendStatus === "checking" ? "检测中" : "离线"} />
          <button onClick={onClearGallery} disabled={!gallery.length} className="btn-ghost disabled:cursor-not-allowed disabled:opacity-40">
            <Trash2 className="h-4 w-4" />
            清空图片
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 2xl:grid-cols-3">
          {isGenerating &&
            placeholders.map((_, index) => (
              <div key={`pending-${index}`} className="image-tile grid min-h-[280px] place-items-center">
                <div className="text-center">
                  <Loader2 className="mx-auto h-7 w-7 animate-spin text-cyan-200" />
                  <p className="mt-3 text-sm font-bold text-white/[0.72]">生成中 {index + 1}/{requestedCount}</p>
                  <p className="mt-1 text-xs text-white/[0.38]">等待上游返回图片</p>
                </div>
              </div>
            ))}

          {gallery.map((image) => (
            <article key={image.id} className="image-tile group overflow-hidden">
              <button onClick={() => onPreview(image)} className="block aspect-square w-full overflow-hidden bg-black/30">
                <img src={image.src} alt={image.prompt} className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]" />
              </button>
              <div className="border-t border-white/[0.08] p-3">
                <p className="line-clamp-2 min-h-10 text-sm leading-5 text-white/[0.72]">{image.prompt}</p>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-[11px] text-white/[0.36]">{new Date(image.createdAt).toLocaleString()}</span>
                  <div className="flex gap-2">
                    <IconButton label="预览" onClick={() => onPreview(image)} icon={<Maximize2 className="h-4 w-4" />} />
                    <IconButton label="下载" onClick={() => onDownload(image)} icon={<Download className="h-4 w-4" />} />
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>

        {!gallery.length && !isGenerating && (
          <EmptyState
            icon={<ImageIcon className="h-7 w-7" />}
            title="画廊为空"
            description="输入提示词并点击开始生成。生成结果会保存在当前浏览器本地。"
          />
        )}
      </div>
    </section>
  );
}

function PromptLibrary({ onUseTemplate }: { onUseTemplate: (template: PromptTemplate) => void }) {
  const [category, setCategory] = useState("全部");
  const [query, setQuery] = useState("");
  const filtered = promptTemplates.filter((template) => {
    const matchCategory = category === "全部" || template.category === category;
    const text = `${template.title} ${template.description} ${template.tags.join(" ")} ${template.prompt}`.toLowerCase();
    return matchCategory && text.includes(query.trim().toLowerCase());
  });

  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="panel overflow-hidden">
      <div className="flex flex-col gap-4 border-b border-white/[0.08] p-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="label">Prompt Library</p>
          <h2 className="mt-1 text-xl font-black">提示词库</h2>
          <p className="mt-2 text-sm text-white/[0.45]">挑选模板后可继续编辑，适合快速建立画面方向。</p>
        </div>
        <Input value={query} placeholder="搜索模板、标签或风格" onChange={setQuery} />
      </div>
      <div className="hide-scrollbar flex gap-2 overflow-x-auto border-b border-white/[0.08] p-4">
        {promptCategories.map((item) => (
          <button key={item} onClick={() => setCategory(item)} className={`chip ${category === item ? "chip-active" : ""}`}>
            {item}
          </button>
        ))}
      </div>
      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((template) => (
          <article key={template.id} className="rounded-xl border border-white/[0.08] bg-white/[0.035] p-4 transition hover:border-cyan-300/[0.35] hover:bg-cyan-300/[0.045]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-black">{template.title}</p>
                <p className="mt-2 text-sm leading-6 text-white/50">{template.description}</p>
              </div>
              <span className="rounded-full border border-white/10 px-2 py-1 text-xs text-white/[0.45]">{template.level}</span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {template.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-white/[0.06] px-2 py-1 text-xs text-white/[0.45]">
                  {tag}
                </span>
              ))}
            </div>
            <button onClick={() => onUseTemplate(template)} className="btn-primary mt-5 w-full justify-center">
              使用模板
            </button>
          </article>
        ))}
        {!filtered.length && <EmptyState icon={<BookOpen className="h-7 w-7" />} title="没有匹配模板" description="换一个关键词或分类试试。" />}
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
    if (!user) {
      onOpenAuth();
      return;
    }
    try {
      await apiFetch(config.backendUrl, "/api/user/providers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) }, token);
      setForm({ name: "", baseUrl: "https://api.openai.com/v1", apiKey: "", defaultModel: "gpt-image-2", type: "openai-compatible" });
      setMessage("个人连接已保存。");
      onRefresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "保存失败");
    }
  }

  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
      <div className="panel p-4">
        <p className="label">Connection</p>
        <h2 className="mt-1 text-xl font-black">保存个人连接</h2>
        <p className="mt-2 text-sm leading-6 text-white/[0.45]">登录后可保存常用的 OpenAI 兼容服务地址。访问凭证会加密存放在服务器。</p>
        <div className="mt-5 grid gap-3">
          <Input value={form.name} placeholder="连接名称，例如 我的图片服务" onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
          <Input value={form.baseUrl} placeholder="服务地址，例如 https://example.com/v1" onChange={(value) => setForm((current) => ({ ...current, baseUrl: value }))} />
          <Input value={form.apiKey} type="password" placeholder="访问凭证" onChange={(value) => setForm((current) => ({ ...current, apiKey: value }))} />
          <Input value={form.defaultModel} placeholder="默认模型，例如 gpt-image-2" onChange={(value) => setForm((current) => ({ ...current, defaultModel: value }))} />
          <button onClick={addProvider} className="btn-primary h-11 justify-center">
            <Plus className="h-4 w-4" />
            {user ? "保存连接" : "登录后保存"}
          </button>
          {message && <p className="text-sm text-white/[0.55]">{message}</p>}
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] p-4">
          <div>
            <p className="label">Routes</p>
            <h2 className="mt-1 text-xl font-black">可用连接</h2>
          </div>
          <button onClick={onRefresh} className="btn-ghost">
            <RefreshCw className="h-4 w-4" />
            刷新
          </button>
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-2">
          <ProviderCard
            title="快速连接"
            subtitle="无需登录，凭证只用于当前浏览器会话"
            active={config.providerSource === "guest"}
            onUse={() => onConfigChange((current) => ({ ...current, providerSource: "guest", providerId: "" }))}
          />
          {userProviders.map((provider) => (
            <ProviderCard
              key={provider.id}
              title={provider.name}
              subtitle={`个人连接 / ${provider.defaultModel}`}
              active={config.providerSource === "user" && config.providerId === provider.id}
              onUse={() => onConfigChange((current) => ({ ...current, providerSource: "user", providerId: provider.id, model: provider.defaultModel }))}
              onDelete={() => onDeleteUserProvider(provider.id)}
            />
          ))}
          {platformProviders.map((provider) => (
            <ProviderCard
              key={provider.id}
              title={provider.name}
              subtitle={`工作区授权 / ${provider.defaultModel}`}
              active={config.providerSource === "platform" && config.providerId === provider.id}
              onUse={() => onConfigChange((current) => ({ ...current, providerSource: "platform", providerId: provider.id, model: provider.defaultModel }))}
            />
          ))}
        </div>
      </div>
    </motion.section>
  );
}

function ProviderCard({ title, subtitle, active, onUse, onDelete }: { title: string; subtitle: string; active: boolean; onUse: () => void; onDelete?: () => void }) {
  return (
    <div className={`rounded-xl border p-4 ${active ? "border-cyan-300/60 bg-cyan-300/[0.08]" : "border-white/[0.08] bg-white/[0.035]"}`}>
      <p className="font-black">{title}</p>
      <p className="mt-2 text-sm text-white/[0.45]">{subtitle}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={onUse} className="btn-secondary">
          <Check className="h-4 w-4" />
          {active ? "当前使用" : "使用"}
        </button>
        {onDelete && (
          <button onClick={onDelete} className="btn-danger">
            <Trash2 className="h-4 w-4" />
            删除
          </button>
        )}
      </div>
    </div>
  );
}

function UsageView({
  logs,
  galleryCount,
  onDelete,
  onClearAll,
}: {
  logs: UsageLog[];
  galleryCount: number;
  onDelete: (id: string) => void;
  onClearAll: () => void;
}) {
  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="panel overflow-hidden">
      <div className="flex flex-col gap-4 border-b border-white/[0.08] p-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="label">Local History</p>
          <h2 className="mt-1 text-xl font-black">本地记录</h2>
          <p className="mt-2 text-sm text-white/[0.45]">记录和图片都保存在当前浏览器。清空后工作台画廊也会同步清空。</p>
        </div>
        <button onClick={onClearAll} disabled={!logs.length && !galleryCount} className="btn-danger h-10 disabled:cursor-not-allowed disabled:opacity-40">
          <Trash2 className="h-4 w-4" />
          清空记录与图片
        </button>
      </div>
      <div className="grid gap-3 border-b border-white/[0.08] p-4 sm:grid-cols-3">
        <Stat label="记录" value={String(logs.length)} />
        <Stat label="本地图片" value={String(galleryCount)} />
        <Stat label="保存位置" value="浏览器" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="bg-white/[0.04] text-xs uppercase tracking-wider text-white/40">
            <tr>
              <th className="p-3">时间</th>
              <th className="p-3">连接</th>
              <th className="p-3">模型</th>
              <th className="p-3">模式</th>
              <th className="p-3">数量</th>
              <th className="p-3">状态</th>
              <th className="p-3">内容</th>
              <th className="p-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-t border-white/[0.08]">
                <td className="p-3 text-white/[0.48]">{new Date(log.createdAt).toLocaleString()}</td>
                <td className="p-3">{log.providerName}</td>
                <td className="p-3 text-white/[0.58]">{log.model}</td>
                <td className="p-3">{log.mode}</td>
                <td className="p-3">{log.imageCount}</td>
                <td className={`p-3 font-bold ${log.status === "成功" ? "text-emerald-300" : "text-rose-300"}`}>{log.status}</td>
                <td className="max-w-md truncate p-3 text-white/[0.52]">{log.error || log.prompt}</td>
                <td className="p-3 text-right">
                  <button onClick={() => onDelete(log.id)} className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-white/[0.55] hover:border-rose-300/50 hover:text-rose-200">
                    删除
                  </button>
                </td>
              </tr>
            ))}
            {!logs.length && (
              <tr>
                <td className="p-8 text-center text-white/[0.45]" colSpan={8}>
                  暂无本地记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </motion.section>
  );
}

function AdminView({ user, token, backendUrl, users, providers, onRefresh }: { user: User | null; token: string; backendUrl: string; users: User[]; providers: Provider[]; onRefresh: () => void }) {
  const [form, setForm] = useState({
    name: "平台 gpt-image-2",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "",
    defaultModel: "gpt-image-2",
    accessMode: "admin-only",
    assignedUserIds: [] as string[],
    dailyLimit: 100,
  });
  const [message, setMessage] = useState("");

  if (user?.role !== "admin") {
    return <EmptyState icon={<ShieldCheck className="h-7 w-7" />} title="仅管理员可见" description="工作区连接和授权用户需要管理员权限。" />;
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
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="grid gap-4 xl:grid-cols-[430px_minmax(0,1fr)]">
      <div className="panel p-4">
        <p className="label">Admin</p>
        <h2 className="mt-1 text-xl font-black">工作区连接</h2>
        <div className="mt-5 grid gap-3">
          <Input value={form.name} placeholder="名称" onChange={(value) => setForm((current) => ({ ...current, name: value }))} />
          <Input value={form.baseUrl} placeholder="服务地址，例如 https://example.com/v1" onChange={(value) => setForm((current) => ({ ...current, baseUrl: value }))} />
          <Input type="password" value={form.apiKey} placeholder="工作区访问凭证" onChange={(value) => setForm((current) => ({ ...current, apiKey: value }))} />
          <Input value={form.defaultModel} placeholder="默认模型" onChange={(value) => setForm((current) => ({ ...current, defaultModel: value }))} />
          <select value={form.accessMode} onChange={(event) => setForm((current) => ({ ...current, accessMode: event.target.value }))} className="input-like">
            <option value="admin-only">仅管理员</option>
            <option value="assigned-users">指定用户</option>
          </select>
          {form.accessMode === "assigned-users" && (
            <div className="max-h-40 overflow-auto rounded-xl border border-white/10 bg-black/20 p-3">
              {users
                .filter((item) => item.role !== "admin")
                .map((item) => (
                  <label key={item.id} className="mb-2 flex items-center gap-2 text-sm text-white/70">
                    <input
                      type="checkbox"
                      checked={form.assignedUserIds.includes(item.id)}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          assignedUserIds: event.target.checked
                            ? [...current.assignedUserIds, item.id]
                            : current.assignedUserIds.filter((id) => id !== item.id),
                        }))
                      }
                    />
                    {item.email}
                  </label>
                ))}
            </div>
          )}
          <button onClick={addPlatformProvider} className="btn-primary h-11 justify-center">
            创建工作区连接
          </button>
          {message && <p className="text-sm text-white/[0.55]">{message}</p>}
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/[0.08] p-4">
          <div>
            <p className="label">Platform</p>
            <h2 className="mt-1 text-xl font-black">已配置连接</h2>
          </div>
          <button onClick={onRefresh} className="btn-ghost">
            <RefreshCw className="h-4 w-4" />
            刷新
          </button>
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-2">
          {providers.map((provider) => (
            <div key={provider.id} className="rounded-xl border border-white/[0.08] bg-white/[0.035] p-4">
              <p className="font-black">{provider.name}</p>
              <p className="mt-2 truncate text-sm text-white/[0.45]">{provider.baseUrl}</p>
              <p className="mt-2 text-sm text-white/[0.62]">{provider.defaultModel} / {provider.accessMode}</p>
            </div>
          ))}
          {!providers.length && <EmptyState icon={<KeyRound className="h-7 w-7" />} title="暂无连接" description="创建后会显示在这里。" />}
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
      const payload = await apiFetch<{ token: string; user: User }>(backendUrl, `/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      onAuthed(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "认证失败");
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center bg-black/[0.76] p-4 backdrop-blur-xl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div className="panel w-full max-w-md p-5" initial={{ scale: 0.96 }} animate={{ scale: 1 }} exit={{ scale: 0.96 }} onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div>
                <p className="label">Account</p>
                <h2 className="mt-1 text-xl font-black">{mode === "login" ? "登录" : "注册"}</h2>
              </div>
              <IconButton label="关闭" onClick={onClose} icon={<X className="h-4 w-4" />} />
            </div>
            <div className="mt-5 grid gap-3">
              <Input value={email} placeholder="邮箱" onChange={setEmail} />
              <Input type="password" value={password} placeholder="密码，至少 8 位" onChange={setPassword} />
              {error && <p className="text-sm text-rose-300">{error}</p>}
              <button onClick={submit} className="btn-primary h-11 justify-center">
                {mode === "login" ? "登录" : "注册"}
              </button>
              <button onClick={() => setMode(mode === "login" ? "register" : "login")} className="text-sm text-white/[0.52] hover:text-white">
                {mode === "login" ? "还没有账号？注册" : "已有账号？登录"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SettingsDrawer({
  open,
  config,
  backendStatus,
  onClose,
  onChange,
}: {
  open: boolean;
  config: AppConfig;
  backendStatus: BackendStatus;
  onClose: () => void;
  onChange: (config: AppConfig | ((current: AppConfig) => AppConfig)) => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-40 bg-black/[0.58] backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside
            initial={{ x: 420 }}
            animate={{ x: 0 }}
            exit={{ x: 420 }}
            transition={{ type: "spring", damping: 30, stiffness: 260 }}
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[420px] flex-col border-l border-white/10 bg-[#080b12]/94 p-5 shadow-2xl backdrop-blur-xl"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="label">Backend</p>
                <h2 className="mt-1 text-xl font-black">后端设置</h2>
              </div>
              <IconButton label="关闭" onClick={onClose} icon={<X className="h-4 w-4" />} />
            </div>
            <div className="mt-7 grid gap-4">
              <Input value={config.backendUrl} placeholder="http://127.0.0.1:8787" onChange={(value) => onChange((current) => ({ ...current, backendUrl: value }))} />
              <Input value={config.model} placeholder="默认模型，例如 gpt-image-2" onChange={(value) => onChange((current) => ({ ...current, model: value }))} />
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.035] p-4">
                <input
                  type="checkbox"
                  checked={config.sendDenoising}
                  onChange={(event) => onChange((current) => ({ ...current, sendDenoising: event.target.checked }))}
                  className="mt-1 h-4 w-4 accent-cyan-300"
                />
                <span>
                  <span className="block text-sm font-bold">发送 denoising_strength 参数</span>
                  <span className="mt-1 block text-xs leading-5 text-white/[0.46]">部分中转或自定义后端会读取该参数。</span>
                </span>
              </label>
            </div>
            <div className="mt-auto rounded-xl border border-cyan-300/[0.15] bg-cyan-300/[0.07] p-4 text-sm text-white/[0.62]">
              后端状态：<span className="font-bold text-cyan-100">{backendStatus}</span>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="field-label">{label}</span>
        <span className="font-mono text-xs text-cyan-100">{value}</span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {Array.from({ length: max - min + 1 }, (_, index) => min + index).map((item) => (
          <button key={item} onClick={() => onChange(item)} className={`chip justify-center ${value === item ? "chip-active" : ""}`}>
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <div className={disabled ? "opacity-45" : ""}>
      <div className="mb-2 flex items-center justify-between">
        <span className="field-label">{label}</span>
        <span className="font-mono text-xs text-white/[0.42]">{value.toFixed(2)}</span>
      </div>
      <input
        disabled={disabled}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="range-glow w-full"
      />
    </div>
  );
}

function PillGroup({ label, options, value, onChange }: { label: string; options: Array<{ label: string; value: string }>; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <p className="field-label mb-2">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button key={option.value} onClick={() => onChange(option.value)} className={`chip ${value === option.value ? "chip-active" : ""}`}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function MetaPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-lg border border-white/[0.08] bg-white/[0.035] px-3 py-2">
      <span className="text-white/[0.32]">{label}</span>
      <span className="ml-2 text-white/[0.72]">{value}</span>
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.035] p-4">
      <p className="text-xs uppercase tracking-wider text-white/[0.35]">{label}</p>
      <p className="mt-2 text-2xl font-black">{value}</p>
    </div>
  );
}

function EmptyState({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="grid min-h-[300px] place-items-center p-8 text-center">
      <div className="max-w-md">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-xl border border-cyan-300/[0.18] bg-cyan-300/[0.08] text-cyan-100">{icon}</div>
        <h2 className="text-xl font-black">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-white/[0.48]">{description}</p>
      </div>
    </div>
  );
}

function Input({
  value,
  placeholder,
  onChange,
  type = "text",
  list,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  type?: string;
  list?: string;
}) {
  return <input type={type} list={list} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className="input-like" />;
}

function IconButton({ label, icon, onClick, className = "" }: { label: string; icon: ReactNode; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-black/[0.32] text-white/[0.64] transition hover:border-cyan-300/60 hover:text-cyan-100 ${className}`}
    >
      {icon}
    </button>
  );
}
