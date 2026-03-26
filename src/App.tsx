import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  getApiKey,
  setApiKey,
  clearApiKey,
  type AuditEvent,
  type AutonomyLevel,
  type AutonomyProfile,
  type ContentEngineStatus,
  type ImageEngineStatus,
  type LearningPatch,
  type MetaConnectionVerification,
  type MetaIntegrationStatus,
  type PageMemory,
  type PersonaSourceMode,
  type PolicyMode,
  type PublishJob,
  type ReviewQueueEntry,
  type StyleCard,
  type StylePack,
  type VideoEngineStatus
} from "./api";
import logoImage from "./assets/Logo.png";

const LEVEL_OPTIONS: AutonomyLevel[] = ["L0", "L1", "L2", "L3"];
const POLICY_OPTIONS: PolicyMode[] = ["STRICT", "STANDARD"];
const PERSONA_MODE_OPTIONS: PersonaSourceMode[] = ["FROM_REFERENCES", "FROM_SCRATCH"];

type UiMode = "GUIDED" | "ADVANCED";
type SmartRunStatus = "IDLE" | "RUNNING" | "DONE" | "REVIEW" | "FAILED";
type GuidedWorkspace = "CREATE" | "REVIEW" | "PUBLISH" | "SETTINGS";
type CreateTool = "POSTS" | "REELS";
type GuidedSection = "PAGES" | "WORKSPACE";
type PagesView = "GALLERY" | "EDITOR";
type PageSort = "UPDATED_DESC" | "UPDATED_ASC" | "NAME_ASC" | "NAME_DESC";
type AppRoute =
  | { kind: "PAGES" }
  | { kind: "WORKSPACE"; pageId?: string }
  | { kind: "ADVANCED" }
  | { kind: "ANALYTICS" };

const WORKSPACE_ICONS: Record<GuidedWorkspace, string> = {
  CREATE: "M12 5v14M5 12h14",
  REVIEW: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  PUBLISH: "M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13",
  SETTINGS: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
};
const WORKSPACE_LABELS: Record<GuidedWorkspace, string> = {
  CREATE: "Create",
  REVIEW: "Review",
  PUBLISH: "Publish",
  SETTINGS: "Settings"
};

function normalizePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

function parseRoute(pathname: string): AppRoute {
  const normalized = normalizePath(pathname);

  if (normalized === "/advanced") {
    return { kind: "ADVANCED" };
  }

  if (normalized === "/analytics") {
    return { kind: "ANALYTICS" };
  }

  if (normalized === "/" || normalized === "/pages") {
    return { kind: "PAGES" };
  }

  if (normalized === "/workspace") {
    return { kind: "WORKSPACE" };
  }

  if (normalized.startsWith("/workspace/")) {
    const pageId = decodeURIComponent(normalized.replace("/workspace/", ""));
    return { kind: "WORKSPACE", pageId };
  }

  return { kind: "PAGES" };
}

function routePath(route: AppRoute): string {
  if (route.kind === "ADVANCED") return "/advanced";
  if (route.kind === "ANALYTICS") return "/analytics";
  if (route.kind === "PAGES") return "/pages";
  if (route.pageId) return `/workspace/${encodeURIComponent(route.pageId)}`;
  return "/workspace";
}

function stringHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function pageAvatarLabel(pageId: string): string {
  const clean = pageId.replace(/[^a-z0-9]/gi, "");
  if (!clean) return "PG";

  const letters = clean.match(/[a-z]/gi) ?? [];
  const digits = clean.match(/\d/g) ?? [];

  if (letters.length >= 2) {
    return `${letters[0]}${letters[1]}`.toUpperCase();
  }

  if (letters.length === 1) {
    return `${letters[0]}${digits[0] ?? "0"}`.toUpperCase();
  }

  return `P${digits[0] ?? "0"}`;
}

function pageDisplayName(profile?: Pick<AutonomyProfile, "displayName" | "pageId"> | null): string {
  if (!profile) return "Page";
  const name = profile.displayName?.trim();
  return name || profile.pageId;
}

function pageAvatarStyle(pageId: string): React.CSSProperties {
  const baseHue = stringHash(pageId) % 360;
  return {
    background: `linear-gradient(135deg, hsl(${baseHue} 84% 56%), hsl(${(baseHue + 28) % 360} 88% 62%))`
  };
}

const AVATAR_MAX_DATA_URL_LENGTH = 1_500_000;

async function createAvatarDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Select a valid image file.");
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not read image."));
      img.src = objectUrl;
    });

    const maxEdge = 640;
    const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas context is not available.");
    }

    context.drawImage(image, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/webp", 0.86);

    if (dataUrl.length > AVATAR_MAX_DATA_URL_LENGTH) {
      throw new Error("Image is too large. Please choose a smaller file.");
    }

    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function badgeClass(value: string): string {
  if (value.includes("PUBLISHED") || value === "AUTO_PUBLISH" || value === "COMPLETED" || value === "SUCCEEDED") return "badge ok";
  if (value.includes("WAITING") || value.includes("REVIEW") || value.includes("RUNNING") || value.includes("READY") || value === "PENDING") return "badge warn";
  if (value.includes("FAILED") || value.includes("BLOCKED") || value.includes("ERROR") || value === "CANCELLED") return "badge bad";
  return "badge";
}

function formatDate(value?: string): string {
  if (!value) return "-";
  return new Date(value).toLocaleString();
}

function formatDateCompact(value?: string): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric"
  });
}

function shortText(value: string, max = 180): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}...`;
}

function parseLifestyleScenes(raw: string): string[] {
  const scenes = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (scenes.length === 0) {
    return [
      "morning patio coffee",
      "beach walk at sunset",
      "backyard barbecue",
      "neighborhood park stroll",
      "weekend road trip stop"
    ];
  }

  return Array.from(new Set(scenes)).slice(0, 8);
}

function extractPageIdFromUrl(input: string): string {
  const trimmed = input.trim();

  // Already a numeric ID
  if (/^\d{5,}$/.test(trimmed)) return trimmed;

  // profile.php?id=123456
  const profileMatch = trimmed.match(/profile\.php\?id=(\d+)/);
  if (profileMatch) return profileMatch[1];

  // facebook.com/pagename or facebook.com/pages/name/123456
  try {
    const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    const parts = url.pathname.split("/").filter(Boolean);

    // /pages/category/123456
    if (parts[0] === "pages" && parts.length >= 3) {
      const last = parts[parts.length - 1];
      if (/^\d+$/.test(last)) return last;
    }

    // /p/123456 or /123456
    for (const part of parts) {
      if (/^\d{5,}$/.test(part)) return part;
    }

    // /pagename — return the slug, backend will try it
    if (parts.length === 1 && parts[0] && parts[0] !== "pages") {
      return parts[0];
    }

    // /pagename/posts etc
    if (parts.length >= 1 && parts[0] !== "pages") {
      return parts[0];
    }
  } catch {
    // Not a URL, use as-is
  }

  return trimmed;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unexpected error";
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState(() => !!getApiKey());
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setError("");
    setLoading(true);
    setApiKey(key);
    try {
      await api.listProfiles();
      setAuthed(true);
    } catch {
      clearApiKey();
      setError("Invalid key or API unreachable");
    } finally {
      setLoading(false);
    }
  };

  if (authed) return <>{children}</>;

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh", background: "#080a0f" }}>
      <div style={{ background: "#111620", border: "1px solid rgba(100,160,240,0.08)", borderRadius: 20, padding: "40px 32px", width: 360, textAlign: "center" }}>
        <div style={{ width: 48, height: 48, margin: "0 auto 16px", borderRadius: 12, overflow: "hidden" }}>
          <img src={logoImage} alt="ZimFluencer" width={48} height={48} style={{ display: "block" }} />
        </div>
        <h2 style={{ fontFamily: "Outfit, sans-serif", fontWeight: 700, fontSize: 22, letterSpacing: "-0.03em", color: "#e8ecf4", margin: "0 0 4px" }}>ZimFluencer</h2>
        <p style={{ color: "#546380", fontSize: 13, margin: "0 0 24px" }}>Enter your access key to continue</p>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleLogin()}
          placeholder="Secret key"
          style={{ width: "100%", padding: "12px 16px", background: "#0f1420", border: "1px solid rgba(100,160,240,0.08)", borderRadius: 12, color: "#e8ecf4", fontSize: 14, marginBottom: 14, boxSizing: "border-box", outline: "none" }}
        />
        <button
          onClick={handleLogin}
          disabled={!key || loading}
          style={{
            width: "100%",
            padding: "12px 0",
            background: key && !loading ? "#38bdf8" : "#161c28",
            color: key && !loading ? "#080a0f" : "#546380",
            border: "none",
            borderRadius: 12,
            fontWeight: 700,
            fontSize: 14,
            cursor: key && !loading ? "pointer" : "not-allowed",
            transition: "all 180ms ease",
            boxShadow: key && !loading ? "0 0 40px rgba(56,189,248,0.12)" : "none"
          }}
        >
          {loading ? "Checking..." : "Unlock"}
        </button>
        {error && <p style={{ color: "#f87171", fontSize: 13, marginTop: 12 }}>{error}</p>}
      </div>
    </div>
  );
}

function AppInner() {
  const profileRefreshRequestRef = useRef(0);
  const cycleRefreshRequestRef = useRef(0);
  const metaRefreshRequestRef = useRef(0);
  const contentRefreshRequestRef = useRef(0);
  const pageContextRefreshRequestRef = useRef(0);

  const [route, setRoute] = useState<AppRoute>(() => parseRoute(window.location.pathname));
  const routeWorkspacePageId = route.kind === "WORKSPACE" ? route.pageId : undefined;
  const [profiles, setProfiles] = useState<AutonomyProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [latestCycle, setLatestCycle] = useState<any | null>(null);
  const [queue, setQueue] = useState<ReviewQueueEntry[]>([]);
  const [stylePacks, setStylePacks] = useState<StylePack[]>([]);
  const [styleCards, setStyleCards] = useState<StyleCard[]>([]);
  const [audits, setAudits] = useState<AuditEvent[]>([]);
  const [patches, setPatches] = useState<LearningPatch[]>([]);
  const [memory, setMemory] = useState<PageMemory | null>(null);
  const [publishJobs, setPublishJobs] = useState<PublishJob[]>([]);
  const [metaStatus, setMetaStatus] = useState<MetaIntegrationStatus | null>(null);
  const [metaVerify, setMetaVerify] = useState<MetaConnectionVerification | null>(null);
  const [contentStatus, setContentStatus] = useState<ContentEngineStatus | null>(null);
  const [imageStatus, setImageStatus] = useState<ImageEngineStatus | null>(null);
  const [videoStatus, setVideoStatus] = useState<VideoEngineStatus | null>(null);
  const [statusText, setStatusText] = useState<string>("Ready");
  const [isBusy, setIsBusy] = useState(false);
  const [isMetaChecking, setIsMetaChecking] = useState(false);
  const [smartRunStatus, setSmartRunStatus] = useState<SmartRunStatus>("IDLE");
  const [smartRunSummary, setSmartRunSummary] = useState<string>(
    "One click: AI researches topics, writes copy, generates images, and queues posts for your review."
  );
  const [reviewEditing, setReviewEditing] = useState(false);
  const [reviewEditTitle, setReviewEditTitle] = useState("");
  const [reviewEditBody, setReviewEditBody] = useState("");
  const [reviewEditMediaType, setReviewEditMediaType] = useState<"IMAGE" | "VIDEO">("IMAGE");
  const [reviewEditMediaPrompt, setReviewEditMediaPrompt] = useState("");
  const [reviewImagePrompt, setReviewImagePrompt] = useState("");

  const [newPageId, setNewPageId] = useState("");
  const [newPageName, setNewPageName] = useState("");
  const [newAvatarUrl, setNewAvatarUrl] = useState("");
  const [newPersonaMode, setNewPersonaMode] = useState<PersonaSourceMode>("FROM_SCRATCH");
  const [newPersonaName, setNewPersonaName] = useState("");
  const [newPersonaCoreDescription, setNewPersonaCoreDescription] = useState(
    "45+ American lifestyle creator, middle-income everyday look, natural candid expression, smartphone-native realism."
  );
  const [newPersonaLifestyle, setNewPersonaLifestyle] = useState(
    "morning patio coffee, beach walk at sunset, backyard barbecue, neighborhood park stroll, weekend road trip stop"
  );
  const [newPersonaReferenceImages, setNewPersonaReferenceImages] = useState<string[]>([]);
  const [newPersonaAutoImages, setNewPersonaAutoImages] = useState(true);
  const [newLevel, setNewLevel] = useState<AutonomyLevel>("L1");
  const [newPolicyMode, setNewPolicyMode] = useState<PolicyMode>("STRICT");
  const [newRiskThreshold, setNewRiskThreshold] = useState(35);
  const [newDailyPosts, setNewDailyPosts] = useState(2);
  const [newDailyReels, setNewDailyReels] = useState(0);
  const [newHourlyPublishes, setNewHourlyPublishes] = useState(2);
  const [newMetaToken, setNewMetaToken] = useState("");

  const [simulate, setSimulate] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [uiMode, setUiMode] = useState<UiMode>("GUIDED");
  const [showSetupAdvanced, setShowSetupAdvanced] = useState(false);
  const [showSystemDetails, setShowSystemDetails] = useState(false);
  const [showWorkspaceProfileEditor, setShowWorkspaceProfileEditor] = useState(false);
  const [showMetaConnect, setShowMetaConnect] = useState(false);
  const [connectStep, setConnectStep] = useState<1 | 2 | 3>(1);
  const [connectPageUrl, setConnectPageUrl] = useState("");
  const [connectToken, setConnectToken] = useState("");
  const [connectResult, setConnectResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [analytics, setAnalytics] = useState<Awaited<ReturnType<typeof api.getAnalytics>> | null>(null);
  const [guidedSection, setGuidedSection] = useState<GuidedSection>("PAGES");
  const [guidedWorkspace, setGuidedWorkspace] = useState<GuidedWorkspace>("CREATE");
  const [pagesView, setPagesView] = useState<PagesView>("GALLERY");
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [pageSearch, setPageSearch] = useState("");
  const [pageStatusFilter, setPageStatusFilter] = useState<"ALL" | "ENABLED" | "PAUSED">("ALL");
  const [pageSort, setPageSort] = useState<PageSort>("UPDATED_DESC");
  const [connectedPageIds, setConnectedPageIds] = useState<Set<string>>(new Set());
  const [quickConnectPageId, setQuickConnectPageId] = useState<string | null>(null);
  const [quickConnectToken, setQuickConnectToken] = useState("");
  const [quickConnectResult, setQuickConnectResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [quickConnectBusy, setQuickConnectBusy] = useState(false);
  const [createTool, setCreateTool] = useState<CreateTool>("POSTS");
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const [reelDrafts, setReelDrafts] = useState<import("./api").ReelDraft[]>([]);
  const [reelGeneratingId, setReelGeneratingId] = useState<string | null>(null);
  const [reelProgress, setReelProgress] = useState<{ text: string; percent: number }>({ text: "", percent: 0 });
  const [reelPreset, setReelPreset] = useState<"LIFESTYLE" | "BEFORE_AFTER">("LIFESTYLE");
  const [regenSceneIdx, setRegenSceneIdx] = useState<number | null>(null);
  const [musicTracks, setMusicTracks] = useState<import("./api").UserMusicTrack[]>([]);
  const [isMusicUploading, setIsMusicUploading] = useState(false);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId]
  );

  const editingProfile = useMemo(
    () => profiles.find((profile) => profile.id === editingProfileId) ?? null,
    [profiles, editingProfileId]
  );

  const filteredProfiles = useMemo(() => {
    const query = pageSearch.trim().toLowerCase();

    return profiles
      .filter((profile) => {
        if (pageStatusFilter === "ENABLED" && !profile.enabled) return false;
        if (pageStatusFilter === "PAUSED" && profile.enabled) return false;
        if (query) {
          const inId = profile.pageId.toLowerCase().includes(query);
          const inName = (profile.displayName ?? "").toLowerCase().includes(query);
          if (!inId && !inName) return false;
        }
        return true;
      });
  }, [profiles, pageSearch, pageStatusFilter]);

  const sortedProfiles = useMemo(() => {
    return [...filteredProfiles].sort((left, right) => {
      if (pageSort === "UPDATED_ASC") {
        return Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
      }

      if (pageSort === "UPDATED_DESC") {
        return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
      }

      const leftName = pageDisplayName(left).toLowerCase();
      const rightName = pageDisplayName(right).toLowerCase();

      if (pageSort === "NAME_DESC") {
        return rightName.localeCompare(leftName);
      }

      return leftName.localeCompare(rightName);
    });
  }, [filteredProfiles, pageSort]);

  const styleCardsByPack = useMemo(() => {
    const mapping = new Map<string, StyleCard[]>();
    for (const card of styleCards) {
      const current = mapping.get(card.stylePackId) ?? [];
      current.push(card);
      mapping.set(card.stylePackId, current);
    }
    return mapping;
  }, [styleCards]);

  const cycleStats = useMemo(() => {
    const items = latestCycle?.contentItems ?? [];
    return {
      generated: items.length,
      waitingReview: items.filter((item: any) => item.publishStatus === "WAITING_REVIEW").length,
      published: items.filter((item: any) => item.publishStatus === "PUBLISHED").length
    };
  }, [latestCycle]);

  const publishStats = useMemo(() => {
    const jobs = publishJobs;
    return {
      pending: jobs.filter((job) => job.status === "PENDING" || job.status === "PROCESSING").length,
      done: jobs.filter((job) => job.status === "SUCCEEDED").length,
      failed: jobs.filter((job) => job.status === "FAILED" || job.status === "CANCELLED").length
    };
  }, [publishJobs]);

  const nextActionText = useMemo(() => {
    if (!selectedProfile) return "Create your page profile";
    if (!latestCycle) return "Generate new drafts (preview is safe)";
    if (queue.length > 0) return `Review ${queue.length} draft(s)`;
    if (publishStats.pending > 0 || publishStats.done === 0) return "Publish approved posts";
    return "Cycle complete. You can start the next run.";
  }, [selectedProfile, latestCycle, queue, publishStats]);

  const suggestedWorkspace = useMemo<GuidedWorkspace>(() => {
    if (!selectedProfile) return "SETTINGS";
    if (queue.length > 0) return "REVIEW";
    if (publishStats.pending > 0) return "PUBLISH";
    return "CREATE";
  }, [selectedProfile, queue.length, publishStats.pending]);

  const quickStartSteps = useMemo(() => {
    const hasPage = Boolean(selectedProfile);
    const hasDrafts = cycleStats.generated > 0;
    const hasReviewItems = queue.length > 0;
    const hasPublished = publishStats.done > 0;

    return [
      { key: "page", label: "1. Select page", done: hasPage, active: !hasPage },
      { key: "generate", label: "2. Generate", done: hasDrafts, active: hasPage && !hasDrafts },
      { key: "review", label: "3. Review", done: hasDrafts && !hasReviewItems, active: hasReviewItems },
      { key: "publish", label: "4. Publish", done: hasPublished, active: !hasPublished && hasDrafts && !hasReviewItems }
    ];
  }, [selectedProfile, cycleStats.generated, queue.length, publishStats.done]);

  const activeReview = queue[0];
  const reviewPreviewTitle = reviewEditing ? reviewEditTitle : (activeReview?.item.title ?? "");
  const reviewPreviewBody = reviewEditing ? reviewEditBody : (activeReview?.item.body ?? "");
  const reviewPreviewMediaType = reviewEditing
    ? reviewEditMediaType
    : ((activeReview?.item.mediaType ?? (activeReview?.item.format === "REEL" ? "VIDEO" : "IMAGE")) as "IMAGE" | "VIDEO");
  const reviewPreviewMediaPrompt = reviewEditing ? reviewEditMediaPrompt : (activeReview?.item.mediaPrompt ?? "");
  const reviewPreviewAsset =
    activeReview?.item.mediaAssets?.find((asset) => asset.role === "POST_PREVIEW" || asset.role === "REEL_PREVIEW") ??
    activeReview?.item.mediaAssets?.find((asset) => asset.type === "IMAGE");
  const reviewPreviewImage = reviewPreviewAsset?.dataUrl ?? "";
  const reviewPreviewVideo =
    reviewPreviewMediaType === "VIDEO"
      ? activeReview?.item.mediaAssets?.find((asset) => asset.role === "REEL_VIDEO" || asset.type === "VIDEO")?.url ?? ""
      : "";

  function navigate(nextRoute: AppRoute, options?: { replace?: boolean }) {
    const nextPath = routePath(nextRoute);
    const currentPath = normalizePath(window.location.pathname);
    if (nextPath !== currentPath) {
      if (options?.replace) {
        window.history.replaceState(null, "", nextPath);
      } else {
        window.history.pushState(null, "", nextPath);
      }
    }
    setRoute(nextRoute);
  }

  async function refreshProfiles() {
    const requestId = ++profileRefreshRequestRef.current;
    const profileData = await api.listProfiles();
    if (requestId !== profileRefreshRequestRef.current) {
      return;
    }

    setProfiles(profileData);
    setSelectedProfileId((current) => {
      if (current && profileData.some((profile) => profile.id === current)) {
        return current;
      }

      if (route.kind === "WORKSPACE" && route.pageId) {
        const routeProfile = profileData.find((profile) => profile.pageId === route.pageId);
        if (routeProfile) {
          return routeProfile.id;
        }
      }

      return profileData[0]?.id ?? "";
    });
  }

  async function refreshConnectedPages() {
    try {
      const data = await api.getConnectedPages();
      setConnectedPageIds(new Set(data.pageIds));
    } catch {
      // Non-critical — don't block UI
    }
  }

  async function handleQuickConnect() {
    if (!quickConnectPageId || !quickConnectToken.trim()) {
      setQuickConnectResult({ ok: false, message: "Paste your Page Access Token first." });
      return;
    }
    setQuickConnectBusy(true);
    setQuickConnectResult(null);
    try {
      const result = await api.connectMeta(quickConnectPageId, quickConnectToken.trim());
      setQuickConnectToken("");
      await refreshConnectedPages();
      setQuickConnectPageId(null);
      setStatusText(result.pageName ? `Connected: ${result.pageName}` : "Meta connected!");
    } catch (error) {
      setQuickConnectResult({ ok: false, message: errorMessage(error) });
    } finally {
      setQuickConnectBusy(false);
    }
  }

  async function handleQuickDisconnect(pageId: string) {
    try {
      await api.disconnectMeta(pageId);
      await refreshConnectedPages();
      setStatusText("Token removed");
    } catch (error) {
      setStatusText(`Disconnect failed: ${errorMessage(error)}`);
    }
  }

  async function refreshStyles() {
    const packs = await api.listStylePacks();
    setStylePacks(packs);

    const cards = await Promise.all(packs.map((pack) => api.listStyleCards(pack.id)));
    setStyleCards(cards.flat());
  }

  async function refreshAudits() {
    setAudits(await api.listAuditEvents());
  }

  async function refreshCycles(pageId?: string) {
    const requestId = ++cycleRefreshRequestRef.current;
    const cycleData = await api.listCycles(pageId);
    if (requestId !== cycleRefreshRequestRef.current) {
      return;
    }

    setLatestCycle(cycleData[0] ?? null);
  }

  async function refreshMetaStatus(pageId?: string) {
    const requestId = ++metaRefreshRequestRef.current;
    try {
      const status = await api.getMetaStatus(pageId);
      if (requestId !== metaRefreshRequestRef.current) {
        return;
      }
      setMetaStatus(status);
    } catch {
      if (requestId !== metaRefreshRequestRef.current) {
        return;
      }
      setMetaStatus(null);
    }
  }

  async function refreshContentStatus() {
    const requestId = ++contentRefreshRequestRef.current;
    try {
      const [status, image, video] = await Promise.all([api.getContentStatus(), api.getImageStatus(), api.getVideoStatus()]);
      if (requestId !== contentRefreshRequestRef.current) {
        return;
      }
      setContentStatus(status);
      setImageStatus(image);
      setVideoStatus(video);
    } catch {
      if (requestId !== contentRefreshRequestRef.current) {
        return;
      }
      setContentStatus(null);
      setImageStatus(null);
      setVideoStatus(null);
    }
  }

  async function refreshPageContext(pageId: string) {
    const requestId = ++pageContextRefreshRequestRef.current;
    const [queueData, patchData, memoryData, jobsData, reelData] = await Promise.all([
      api.listReviewQueue(pageId),
      api.listLearningPatches(pageId),
      api.getMemory(pageId),
      api.listPublishJobs(undefined, pageId),
      api.listReelDrafts(pageId).catch(() => [] as import("./api").ReelDraft[])
    ]);
    if (requestId !== pageContextRefreshRequestRef.current) {
      return;
    }

    setQueue(queueData);
    setPatches(patchData);
    setMemory(memoryData);
    setPublishJobs(jobsData);
    setReelDrafts(reelData);
  }

  async function bootstrap() {
    setIsBusy(true);
    try {
      await Promise.all([refreshProfiles(), refreshStyles(), refreshAudits(), refreshCycles(), refreshMetaStatus(), refreshContentStatus(), refreshConnectedPages(), api.listMusicTracks().then(setMusicTracks).catch(() => {})]);
      setStatusText("System synced");
    } catch (error) {
      setStatusText(`Bootstrap failed: ${errorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  }

  useEffect(() => {
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onPopState = () => {
      setRoute(parseRoute(window.location.pathname));
    };

    window.addEventListener("popstate", onPopState);

    const parsed = parseRoute(window.location.pathname);
    setRoute(parsed);
    const expected = routePath(parsed);
    const current = normalizePath(window.location.pathname);
    if (expected !== current) {
      window.history.replaceState(null, "", expected);
    }

    return () => {
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  useEffect(() => {
    if (route.kind !== "PAGES" && pagesView === "EDITOR") {
      setPagesView("GALLERY");
    }

    if (route.kind === "PAGES") {
      if (!editingProfileId && pagesView !== "EDITOR") {
        setPagesView("GALLERY");
      }
      return;
    }

    if (route.kind === "WORKSPACE" && route.pageId) {
      const match = profiles.find((profile) => profile.pageId === route.pageId);
      if (match && match.id !== selectedProfileId) {
        setSelectedProfileId(match.id);
      }
      return;
    }

    if (!selectedProfileId && profiles.length > 0) {
      setSelectedProfileId(profiles[0].id);
    }
  }, [route, profiles, selectedProfileId, editingProfileId, pagesView]);

  useEffect(() => {
    if (route.kind !== "WORKSPACE") return;
    if (route.pageId) return;
    if (!selectedProfile) return;
    navigate({ kind: "WORKSPACE", pageId: selectedProfile.pageId }, { replace: true });
  }, [route.kind, routeWorkspacePageId, selectedProfile?.pageId]);

  useEffect(() => {
    if (!selectedProfile) return;
    void refreshPageContext(selectedProfile.pageId);
    void refreshCycles(selectedProfile.pageId);
    void refreshMetaStatus(selectedProfile.pageId);
    setMetaVerify(null);
    setShowSystemDetails(false);
    setShowWorkspaceProfileEditor(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProfileId]);

  useEffect(() => {
    if (route.kind !== "WORKSPACE") return;
    if (!selectedProfileId) return;
    setGuidedWorkspace(suggestedWorkspace);
    // Keep workspace stable while data refreshes to prevent tab "jumping".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.kind, selectedProfileId]);

  useEffect(() => {
    if (!activeReview) {
      setReviewEditing(false);
      setReviewEditTitle("");
      setReviewEditBody("");
      setReviewEditMediaType("IMAGE");
      setReviewEditMediaPrompt("");
      setReviewImagePrompt("");
      return;
    }

    const previewAsset =
      activeReview.item.mediaAssets?.find((asset) => asset.role === "POST_PREVIEW" || asset.role === "REEL_PREVIEW") ??
      activeReview.item.mediaAssets?.find((asset) => asset.type === "IMAGE");

    setReviewEditing(false);
    setReviewEditTitle(activeReview.item.title);
    setReviewEditBody(activeReview.item.body);
    setReviewEditMediaType((activeReview.item.mediaType ?? (activeReview.item.format === "REEL" ? "VIDEO" : "IMAGE")) as "IMAGE" | "VIDEO");
    setReviewEditMediaPrompt(activeReview.item.mediaPrompt ?? "");
    setReviewImagePrompt(previewAsset?.prompt ?? "");
  }, [activeReview?.item.id]);

  useEffect(() => {
    if (!selectedProfile || editingProfileId) return;
    setNewPageName(pageDisplayName(selectedProfile));
    setNewAvatarUrl(selectedProfile.avatarUrl ?? "");
    setNewPersonaMode(selectedProfile.persona?.mode ?? "FROM_SCRATCH");
    setNewPersonaName(selectedProfile.persona?.name ?? pageDisplayName(selectedProfile));
    setNewPersonaCoreDescription(
      selectedProfile.persona?.coreDescription ??
        "45+ American lifestyle creator, middle-income everyday look, natural candid expression, smartphone-native realism."
    );
    setNewPersonaLifestyle((selectedProfile.persona?.lifestyleScenes ?? ["morning patio coffee", "beach walk at sunset"]).join(", "));
    setNewPersonaReferenceImages((selectedProfile.persona?.referenceImages ?? []).map((entry) => entry.dataUrl));
    setNewPersonaAutoImages(selectedProfile.persona?.autoGeneratePostImages ?? true);
    setNewLevel(selectedProfile.level);
    setNewPolicyMode(selectedProfile.policyMode);
    setNewRiskThreshold(selectedProfile.riskThresholdAutoPublish);
    setNewDailyPosts(selectedProfile.limits.dailyPosts);
    setNewDailyReels(selectedProfile.limits.dailyReels);
    setNewHourlyPublishes(selectedProfile.limits.hourlyPublishes);
  }, [selectedProfile, editingProfileId]);

  function startEditingProfile(profile: AutonomyProfile) {
    navigate({ kind: "PAGES" });
    setPagesView("EDITOR");
    setSelectedProfileId(profile.id);
    setEditingProfileId(profile.id);
    setNewPageId(profile.pageId);
    setNewPageName(pageDisplayName(profile));
    setNewAvatarUrl(profile.avatarUrl ?? "");
    setNewPersonaMode(profile.persona?.mode ?? "FROM_SCRATCH");
    setNewPersonaName(profile.persona?.name ?? pageDisplayName(profile));
    setNewPersonaCoreDescription(
      profile.persona?.coreDescription ??
        "45+ American lifestyle creator, middle-income everyday look, natural candid expression, smartphone-native realism."
    );
    setNewPersonaLifestyle((profile.persona?.lifestyleScenes ?? ["morning patio coffee", "beach walk at sunset"]).join(", "));
    setNewPersonaReferenceImages((profile.persona?.referenceImages ?? []).map((entry) => entry.dataUrl));
    setNewPersonaAutoImages(profile.persona?.autoGeneratePostImages ?? true);
    setNewLevel(profile.level);
    setNewPolicyMode(profile.policyMode);
    setNewRiskThreshold(profile.riskThresholdAutoPublish);
    setNewDailyPosts(profile.limits.dailyPosts);
    setNewDailyReels(profile.limits.dailyReels);
    setNewHourlyPublishes(profile.limits.hourlyPublishes);
    setShowSetupAdvanced(true);
  }

  function resetProfileEditor() {
    setPagesView("GALLERY");
    setEditingProfileId(null);
    setNewPageId("");
    setNewPageName("");
    setNewAvatarUrl("");
    setNewMetaToken("");
    setNewPersonaMode("FROM_SCRATCH");
    setNewPersonaName("");
    setNewPersonaCoreDescription("45+ American lifestyle creator, middle-income everyday look, natural candid expression, smartphone-native realism.");
    setNewPersonaLifestyle("morning patio coffee, beach walk at sunset, backyard barbecue, neighborhood park stroll, weekend road trip stop");
    setNewPersonaReferenceImages([]);
    setNewPersonaAutoImages(true);
    applyRecommendedDefaults();
  }

  function startCreatingProfile() {
    setPagesView("EDITOR");
    setEditingProfileId(null);
    setNewPageId("");
    setNewPageName("");
    setNewAvatarUrl("");
    setNewMetaToken("");
    setNewPersonaMode("FROM_SCRATCH");
    setNewPersonaName("");
    setNewPersonaCoreDescription("45+ American lifestyle creator, middle-income everyday look, natural candid expression, smartphone-native realism.");
    setNewPersonaLifestyle("morning patio coffee, beach walk at sunset, backyard barbecue, neighborhood park stroll, weekend road trip stop");
    setNewPersonaReferenceImages([]);
    setNewPersonaAutoImages(true);
    setShowSetupAdvanced(false);
    applyRecommendedDefaults();
  }

  async function handleAvatarSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const avatarDataUrl = await createAvatarDataUrl(file);
      setNewAvatarUrl(avatarDataUrl);
      setStatusText("Avatar uploaded and optimized.");
    } catch (error) {
      setStatusText(`Avatar upload failed: ${errorMessage(error)}`);
    }
  }

  async function handlePersonaReferencesSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;

    try {
      const converted = await Promise.all(files.slice(0, 6).map((file) => createAvatarDataUrl(file)));
      setNewPersonaReferenceImages((current) => Array.from(new Set([...current, ...converted])).slice(0, 14));
      if (newPersonaMode !== "FROM_REFERENCES") {
        setNewPersonaMode("FROM_REFERENCES");
      }
      setStatusText("Persona reference images uploaded.");
    } catch (error) {
      setStatusText(`Persona images upload failed: ${errorMessage(error)}`);
    }
  }

  function handleRemovePersonaReference(index: number) {
    setNewPersonaReferenceImages((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function clearAvatar() {
    setNewAvatarUrl("");
  }

  function openWorkspaceForProfile(profile: AutonomyProfile) {
    setPagesView("GALLERY");
    setEditingProfileId(null);
    setSelectedProfileId(profile.id);
    navigate({ kind: "WORKSPACE", pageId: profile.pageId });
  }

  async function handleSaveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const displayNamePayload = newPageName.trim() || newPageId.trim();
    const referenceImagesPayload = newPersonaReferenceImages.map((dataUrl) => ({ dataUrl }));
    const anchorFromReferences = newPersonaReferenceImages[0]?.trim();

    // In FROM_SCRATCH mode, AI Brain auto-fills everything the user didn't provide
    const autoDescription = newPersonaMode === "FROM_SCRATCH"
      ? "35-year-old American, casual confident style, natural daylight look, relatable everyday person, smartphone-native candid realism."
      : "Page persona learned from uploaded reference photos.";
    const autoScenes = newPersonaMode === "FROM_SCRATCH"
      ? ["morning coffee routine", "gym cooldown", "evening neighborhood walk", "weekend market", "lunch break at a cafe", "Sunday porch planning"]
      : ["lifestyle scene from reference photos"];

    const lifestyleScenes = newPersonaLifestyle.trim()
      ? parseLifestyleScenes(newPersonaLifestyle)
      : autoScenes;

    const personaPayload = {
      mode: newPersonaMode,
      name: newPersonaName.trim() || displayNamePayload,
      coreDescription: newPersonaCoreDescription.trim() || autoDescription,
      lifestyleScenes,
      referenceImages: referenceImagesPayload,
      anchorImageUrl:
        anchorFromReferences ||
        (newPersonaMode === "FROM_REFERENCES" && newAvatarUrl.trim() ? newAvatarUrl.trim() : undefined),
      autoGeneratePostImages: newPersonaAutoImages
    };
    setIsBusy(true);
    try {
      if (editingProfileId) {
        const avatarPayload = newAvatarUrl.trim() ? newAvatarUrl.trim() : null;
        const profile = await api.patchProfile(editingProfileId, {
          displayName: displayNamePayload,
          avatarUrl: avatarPayload,
          persona: personaPayload,
          level: newLevel,
          policyMode: newPolicyMode,
          riskThresholdAutoPublish: Number(newRiskThreshold),
          limits: {
            dailyPosts: Number(newDailyPosts),
            dailyReels: Number(newDailyReels),
            hourlyPublishes: Number(newHourlyPublishes)
          }
        });
        // Save new token if provided during edit
        if (newMetaToken.trim()) {
          await api.saveMetaToken(profile.pageId, newMetaToken.trim());
          await refreshConnectedPages();
          setStatusText(`Page ${profile.pageId} updated & token refreshed`);
        } else {
          setStatusText(`Page ${profile.pageId} updated`);
        }
        await refreshProfiles();
        setSelectedProfileId(profile.id);
        setPagesView("GALLERY");
        setEditingProfileId(null);
      } else {
        const avatarPayload = newAvatarUrl.trim() ? newAvatarUrl.trim() : undefined;

        let resolvedPageId = newPageId.trim() ? extractPageIdFromUrl(newPageId) : "";
        const tokenToConnect = newMetaToken.trim();

        // If we have a token but no page ID, detect it
        if (tokenToConnect && !resolvedPageId) {
          try {
            const detected = await api.detectPage(tokenToConnect);
            resolvedPageId = detected.pageId;
          } catch {
            // Detection failed — generate a placeholder
          }
        }

        if (!resolvedPageId) resolvedPageId = `page-${Date.now()}`;

        const profile = await api.createProfile({
          pageId: resolvedPageId,
          displayName: displayNamePayload,
          avatarUrl: avatarPayload,
          persona: personaPayload,
          level: newLevel,
          policyMode: newPolicyMode,
          riskThresholdAutoPublish: Number(newRiskThreshold),
          limits: {
            dailyPosts: Number(newDailyPosts),
            dailyReels: Number(newDailyReels),
            hourlyPublishes: Number(newHourlyPublishes)
          }
        });
        // Save token for the real profile pageId
        if (tokenToConnect) {
          await api.saveMetaToken(profile.pageId, tokenToConnect);
          await refreshConnectedPages();
          setStatusText(`Page ${profile.pageId} created & token saved`);
        } else {
          setStatusText(`Page ${profile.pageId} created`);
        }
        await refreshProfiles();
        setSelectedProfileId(profile.id);
        navigate({ kind: "WORKSPACE", pageId: profile.pageId });
        resetProfileEditor();
      }
    } catch (error) {
      setStatusText(`${editingProfileId ? "Update" : "Create"} profile failed: ${errorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleUpdateSelectedPageConfig(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProfile) {
      setStatusText("Select a page first");
      return;
    }

    setIsBusy(true);
    try {
      const avatarPayload = newAvatarUrl.trim() ? newAvatarUrl.trim() : null;
      const displayNamePayload = newPageName.trim() || selectedProfile.pageId;
      const lifestyleScenes = parseLifestyleScenes(newPersonaLifestyle);
      const referenceImagesPayload = newPersonaReferenceImages.map((dataUrl) => ({ dataUrl }));
      const anchorFromReferences = newPersonaReferenceImages[0]?.trim();
      const profile = await api.patchProfile(selectedProfile.id, {
        displayName: displayNamePayload,
        avatarUrl: avatarPayload,
        persona: {
          mode: newPersonaMode,
          name: newPersonaName.trim() || displayNamePayload,
          coreDescription:
            newPersonaCoreDescription.trim() ||
            "45+ American lifestyle creator, middle-income everyday look, natural candid expression, smartphone-native realism.",
          lifestyleScenes,
          referenceImages: referenceImagesPayload,
          anchorImageUrl:
            anchorFromReferences ||
            (newPersonaMode === "FROM_REFERENCES" && avatarPayload ? avatarPayload : null),
          autoGeneratePostImages: newPersonaAutoImages
        },
        level: newLevel,
        policyMode: newPolicyMode,
        riskThresholdAutoPublish: Number(newRiskThreshold),
        limits: {
          dailyPosts: Number(newDailyPosts),
          dailyReels: Number(newDailyReels),
          hourlyPublishes: Number(newHourlyPublishes)
        }
      });
      await refreshProfiles();
      setSelectedProfileId(profile.id);
      setStatusText(`Page ${profile.pageId} setup updated`);
    } catch (error) {
      setStatusText(`Update setup failed: ${errorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleToggleEnabled(profile: AutonomyProfile) {
    setIsBusy(true);
    try {
      await api.patchProfile(profile.id, { enabled: !profile.enabled });
      await refreshProfiles();
      setStatusText(`Page ${profile.pageId} ${profile.enabled ? "paused" : "enabled"}`);
    } catch (error) {
      setStatusText(`Toggle failed: ${errorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDeleteProfile(profile: AutonomyProfile) {
    if (!confirm(`Delete page "${profile.displayName || profile.pageId}"? This cannot be undone.`)) return;
    setIsBusy(true);
    try {
      await api.deleteProfile(profile.id);
      await Promise.all([refreshProfiles(), refreshConnectedPages()]);
      if (selectedProfileId === profile.id) setSelectedProfileId("");
      setStatusText(`Page ${profile.pageId} deleted`);
    } catch (error) {
      setStatusText(`Delete failed: ${errorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRunCycle() {
    if (!selectedProfile) {
      setStatusText("Select a page first");
      return;
    }

    navigate({ kind: "WORKSPACE", pageId: selectedProfile.pageId }, { replace: true });
    setGuidedWorkspace("CREATE");
    setIsBusy(true);
    try {
      const cycle = await api.runCycle({
        pageId: selectedProfile.pageId,
        autonomyProfileId: selectedProfile.id,
        simulate
      });
      setLatestCycle(cycle);
      setSmartRunStatus("IDLE");
      setSmartRunSummary("One click: AI researches topics, writes copy, generates images, and queues posts for your review.");
      await Promise.all([refreshCycles(selectedProfile.pageId), refreshPageContext(selectedProfile.pageId), refreshAudits()]);
      setStatusText(`Cycle ${cycle.id.slice(0, 8)} completed`);
    } catch (error) {
      setStatusText(`Cycle run failed: ${errorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSmartRun() {
    if (!selectedProfile) {
      setStatusText("Select a page first");
      return;
    }

    if (!simulate && metaStatus?.mode === "real" && !metaStatus.ready) {
      setSmartRunStatus("FAILED");
      setSmartRunSummary("Meta token is missing or expired. Go to Settings and paste a fresh token from Graph API Explorer.");
      setStatusText("Smart run stopped: Meta config is incomplete");
      return;
    }

    setIsBusy(true);
    navigate({ kind: "WORKSPACE", pageId: selectedProfile.pageId }, { replace: true });
    setGuidedWorkspace("CREATE");
    setSmartRunStatus("RUNNING");
    setSmartRunSummary("Generating daily drafts...");
    try {
      const cycle = await api.runCycle({
        pageId: selectedProfile.pageId,
        autonomyProfileId: selectedProfile.id,
        simulate
      });
      setLatestCycle(cycle);

      await Promise.all([refreshCycles(selectedProfile.pageId), refreshPageContext(selectedProfile.pageId), refreshAudits()]);

      const queueData = await api.listReviewQueue(selectedProfile.pageId);
      setQueue(queueData);
      const queueSize = queueData.length;
      if (simulate) {
        setSmartRunStatus("DONE");
        setSmartRunSummary(`Preview ready: ${queueSize} item(s) waiting for review.`);
        setStatusText(`Smart run preview completed (${cycle.id.slice(0, 8)})`);
        if (queueSize > 0) setGuidedWorkspace("REVIEW");
        return;
      }

      if (queueSize > 0) {
        setSmartRunStatus("REVIEW");
        setSmartRunSummary(`Paused for safety: ${queueSize} item(s) need your review.`);
        setStatusText("Smart run paused at review gate");
        setGuidedWorkspace("REVIEW");
        return;
      }

      setSmartRunSummary("Publishing approved items...");
      const result = await api.runPublishWorkerOnce(30);
      await Promise.all([refreshPageContext(selectedProfile.pageId), refreshCycles(selectedProfile.pageId), refreshAudits()]);

      setSmartRunStatus("DONE");
      setSmartRunSummary(`Completed: published ${result.succeeded}, retried ${result.retried}.`);
      setStatusText("Smart run completed");
      setGuidedWorkspace("PUBLISH");
    } catch (error) {
      const message = errorMessage(error);
      setSmartRunStatus("FAILED");
      setSmartRunSummary(`Stopped: ${message}`);
      setStatusText(`Smart run failed: ${message}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleReview(cycleId: string, contentId: string, action: "APPROVE" | "REJECT", pageId?: string) {
    const targetPageId = pageId ?? selectedProfile?.pageId;
    setIsBusy(true);
    if (targetPageId) {
      navigate({ kind: "WORKSPACE", pageId: targetPageId }, { replace: true });
    }
    setGuidedWorkspace("REVIEW");
    try {
      const updated = await api.reviewItem(cycleId, contentId, {
        actorId: "dashboard-reviewer",
        action,
        note: action === "APPROVE" ? "Approved from dashboard" : "Rejected from dashboard"
      });

      // Keep item in queue if backend still routes it to review (e.g. limits/policy).
      setQueue((current) =>
        current.flatMap((entry) => {
          if (!(entry.cycleId === cycleId && entry.item.id === contentId)) {
            return [entry];
          }

          if (updated.publishStatus === "WAITING_REVIEW") {
            return [{ ...entry, item: updated }];
          }

          return [];
        })
      );

      if (targetPageId) {
        await Promise.all([refreshPageContext(targetPageId), refreshCycles(targetPageId), refreshAudits()]);
      } else {
        await Promise.all([refreshCycles(), refreshAudits()]);
      }
      if (action === "APPROVE" && updated.publishStatus === "APPROVED") {
        setStatusText("Approved in Preview mode. Turn Preview mode OFF for real publishing.");
      } else if (action === "APPROVE" && updated.publishStatus === "WAITING_REVIEW" && updated.publishError) {
        setStatusText(`Approve blocked: ${updated.publishError}`);
      } else if (action === "APPROVE" && updated.publishStatus === "PUBLISHED") {
        setStatusText("Approved and published.");
      } else {
        setStatusText(`Review action applied: ${action}`);
      }
    } catch (error) {
      setStatusText(`Review action failed: ${errorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSaveReviewEdits() {
    if (!selectedProfile || !activeReview) {
      return;
    }

    const nextTitle = reviewEditTitle.trim();
    const nextBody = reviewEditBody.trim();
    const nextMediaPrompt = reviewEditMediaPrompt.trim();

    if (!nextTitle || !nextBody) {
      setStatusText("Title and body are required.");
      return;
    }

    setIsBusy(true);
    try {
      await api.updateItem(activeReview.cycleId, activeReview.item.id, {
        actorId: "dashboard-reviewer",
        format: "POST",
        mediaType: reviewEditMediaType,
        title: nextTitle,
        body: nextBody,
        mediaPrompt: nextMediaPrompt ? nextMediaPrompt : null,
        note: "Edited before approval"
      });

      await Promise.all([refreshPageContext(selectedProfile.pageId), refreshCycles(selectedProfile.pageId), refreshAudits()]);
      setReviewEditing(false);
      setStatusText("Draft updated. Re-check and approve when ready.");
    } catch (error) {
      setStatusText(`Edit draft failed: ${errorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleQuickReviewFormatSwitch(mediaType: "IMAGE" | "VIDEO") {
    if (!activeReview) {
      return;
    }

    const currentType = (activeReview.item.mediaType ?? (activeReview.item.format === "REEL" ? "VIDEO" : "IMAGE")) as "IMAGE" | "VIDEO";
    if (activeReview.item.format === "POST" && currentType === mediaType) {
      setStatusText(mediaType === "VIDEO" ? "This draft is already in Video mode." : "This draft is already in Photo mode.");
      return;
    }

    setIsBusy(true);
    try {
      await api.updateItem(activeReview.cycleId, activeReview.item.id, {
        actorId: "dashboard-reviewer",
        format: "POST",
        mediaType,
        note: mediaType === "VIDEO" ? "Switched to video mode from quick controls" : "Switched to photo mode from quick controls"
      });

      await Promise.all([refreshPageContext(activeReview.pageId), refreshCycles(activeReview.pageId), refreshAudits()]);
      if (mediaType === "VIDEO") {
        setStatusText("Switched to Video mode. Generating 9:16 photo + Kling video preview.");
      } else {
        setStatusText("Switched to Photo mode.");
      }
    } catch (error) {
      setStatusText(`Switch media type failed: ${errorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRegenerateReviewImage() {
    if (!activeReview) {
      return;
    }

    const prompt = reviewImagePrompt.trim();
    if (prompt && prompt.length < 8) {
      setStatusText("Image prompt is too short. Add at least a few words.");
      return;
    }

    setIsBusy(true);
    try {
      await api.regenerateItemImage(activeReview.cycleId, activeReview.item.id, {
        actorId: "dashboard-reviewer",
        prompt: prompt || undefined
      });

      await Promise.all([refreshPageContext(activeReview.pageId), refreshCycles(activeReview.pageId), refreshAudits()]);
      setStatusText(prompt ? "Image regenerated with updated prompt." : "Image regenerated.");
    } catch (error) {
      setStatusText(`Image regenerate failed: ${errorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRunLearning() {
    if (!selectedProfile) {
      return;
    }

    setIsBusy(true);
    try {
      const generated = await api.runNightlyLearning({
        pageId: selectedProfile.pageId,
        maxPatches: 5
      });
      setPatches(generated);
      await refreshAudits();
      setStatusText(`Learning produced ${generated.length} patch(es)`);
    } catch (error) {
      setStatusText(`Nightly learning failed: ${errorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleRunWorker() {
    if (!selectedProfile) {
      return;
    }

    if (metaStatus?.mode === "real" && !metaStatus.ready) {
      setStatusText("Worker blocked: Meta integration is not ready for this page.");
      return;
    }

    navigate({ kind: "WORKSPACE", pageId: selectedProfile.pageId }, { replace: true });
    setGuidedWorkspace("PUBLISH");
    setIsBusy(true);
    try {
      const result = await api.runPublishWorkerOnce(30);
      await Promise.all([refreshPageContext(selectedProfile.pageId), refreshCycles(selectedProfile.pageId), refreshAudits()]);
      setStatusText(`Worker: processed ${result.processed}, done ${result.succeeded}, retried ${result.retried}`);
    } catch (error) {
      setStatusText(`Worker run failed: ${errorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSubmitFeedback(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProfile || !feedback.trim()) {
      return;
    }

    setIsBusy(true);
    try {
      const updated = await api.addReviewerFeedback({
        pageId: selectedProfile.pageId,
        feedback,
        actorId: "dashboard-reviewer"
      });
      setFeedback("");
      setMemory(updated);
      await refreshAudits();
      setStatusText("Feedback saved");
    } catch (error) {
      setStatusText(`Feedback failed: ${errorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function handleVerifyMetaConnection() {
    if (!selectedProfile) {
      setStatusText("Select a page first");
      return;
    }

    navigate({ kind: "WORKSPACE", pageId: selectedProfile.pageId }, { replace: true });
    setGuidedWorkspace("SETTINGS");
    setIsMetaChecking(true);
    try {
      const verification = await api.verifyMetaConnection(selectedProfile.pageId);
      setMetaVerify(verification);
      await refreshMetaStatus(selectedProfile.pageId);
      setStatusText(verification.ok ? "Meta page connection verified" : `Meta verify failed: ${verification.message}`);
    } catch (error) {
      setStatusText(`Meta verify failed: ${errorMessage(error)}`);
    } finally {
      setIsMetaChecking(false);
    }
  }

  async function handleConnectMeta() {
    if (!selectedProfile || !connectToken.trim()) {
      setConnectResult({ ok: false, message: "Paste your Page Access Token first." });
      return;
    }

    setIsBusy(true);
    setConnectResult(null);
    try {
      const result = await api.connectMeta(selectedProfile.pageId, connectToken.trim());
      setConnectResult({ ok: true, message: result.pageName ? `Connected: ${result.pageName}` : "Connected successfully." });
      setConnectToken("");
      await Promise.all([refreshMetaStatus(selectedProfile.pageId), refreshConnectedPages()]);
      setStatusText("Facebook page connected");
    } catch (error) {
      setConnectResult({ ok: false, message: errorMessage(error) });
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDisconnectMeta() {
    if (!selectedProfile) return;
    setIsBusy(true);
    try {
      await api.disconnectMeta(selectedProfile.pageId);
      setConnectResult(null);
      setConnectToken("");
      await Promise.all([refreshMetaStatus(selectedProfile.pageId), refreshConnectedPages()]);
      setStatusText("Facebook page disconnected");
    } catch (error) {
      setStatusText(`Disconnect failed: ${errorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  }

  function applyRecommendedDefaults() {
    setNewLevel("L1");
    setNewPolicyMode("STRICT");
    setNewDailyPosts(2);
    setNewDailyReels(0);
    setNewHourlyPublishes(2);
    setNewRiskThreshold(35);
  }

  function goToSuggestedAction() {
    if (!selectedProfile) {
      navigate({ kind: "PAGES" });
      return;
    }

    navigate({ kind: "WORKSPACE", pageId: selectedProfile.pageId });
    setGuidedWorkspace(suggestedWorkspace);
  }

  return (
    <div className="app-shell">
      <header className="topbar glass">
        <div className="brand-group">
          <div className="brand-logo-shell">
            <img src={logoImage} alt="ZimFluencer logo" className="brand-logo" width={68} height={68} decoding="async" />
          </div>
          <div className="brand-copy">
            <p className="brand-name">ZimFluencer</p>
          </div>
        </div>

        <div className="topbar-actions">
          <div className="mode-switch">
            <button
              className={`menu-pill ${route.kind === "PAGES" ? "active" : ""}`}
              onClick={() => navigate({ kind: "PAGES" })}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
              Pages
            </button>
            <button
              className={`menu-pill ${route.kind === "WORKSPACE" ? "active" : ""}`}
              onClick={() => navigate({ kind: "WORKSPACE", pageId: selectedProfile?.pageId })}
              disabled={!selectedProfile}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
              Workspace
            </button>
            <button
              className={`menu-pill ${route.kind === "ANALYTICS" ? "active" : ""}`}
              onClick={() => {
                navigate({ kind: "ANALYTICS" });
                if (selectedProfile) {
                  void api.getAnalytics(selectedProfile.pageId).then(setAnalytics).catch(() => {});
                }
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>
              Analytics
            </button>
          </div>
        </div>
        <span className={badgeClass(isBusy ? "RUNNING" : "COMPLETED")} style={{ marginLeft: "auto" }}>{isBusy ? "SYNCING" : "READY"}</span>
      </header>

      {route.kind === "PAGES" || route.kind === "WORKSPACE" ? (
        <section className="panel glass focus-shell">
          <div className={`tip-card ${smartRunStatus === "FAILED" ? "tip-danger" : smartRunStatus === "REVIEW" ? "tip-warning" : smartRunStatus === "DONE" ? "tip-success" : ""}`} style={{ margin: "0 16px" }}>
            <svg className="tip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
            <span>{statusText}</span>
          </div>

          {route.kind === "PAGES" ? (
            <div className="pages-shell">
              <section className="workspace-panel">
                <div className="row-between" style={{ marginBottom: 4 }}>
                  <div>
                    <h3 style={{ margin: 0 }}>Your Pages</h3>
                    <p className="muted" style={{ marginTop: 2 }}>Click a page to open workspace &middot; {sortedProfiles.length} of {profiles.length}</p>
                  </div>
                  <button className="primary inline-small" type="button" onClick={startCreatingProfile} style={{ flexShrink: 0 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      New Page
                    </span>
                  </button>
                </div>

                {profiles.length > 0 ? (
                  <div className="pages-filters pages-filters-wide">
                    <label>
                      Search
                      <input
                        value={pageSearch}
                        onChange={(event) => setPageSearch(event.target.value)}
                        placeholder="Find by page name or ID"
                      />
                    </label>
                    <label>
                      Status
                      <select value={pageStatusFilter} onChange={(event) => setPageStatusFilter(event.target.value as "ALL" | "ENABLED" | "PAUSED")}>
                        <option value="ALL">All</option>
                        <option value="ENABLED">Enabled</option>
                        <option value="PAUSED">Paused</option>
                      </select>
                    </label>
                    <label>
                      Sort
                      <select value={pageSort} onChange={(event) => setPageSort(event.target.value as PageSort)}>
                        <option value="UPDATED_DESC">Updated: newest</option>
                        <option value="UPDATED_ASC">Updated: oldest</option>
                        <option value="NAME_ASC">Name: A to Z</option>
                        <option value="NAME_DESC">Name: Z to A</option>
                      </select>
                    </label>
                  </div>
                ) : null}

                {sortedProfiles.length > 0 ? (
                  <div className="page-catalog-grid page-catalog-grid-rich">
                    {sortedProfiles.map((profile) => (
                      <article key={profile.id} className={`page-card ${selectedProfileId === profile.id ? "selected" : ""}`} onClick={() => openWorkspaceForProfile(profile)} style={{ cursor: "pointer", position: "relative" }}>
                        <button
                          type="button"
                          className="page-card-delete"
                          title="Delete page"
                          onClick={(e) => { e.stopPropagation(); handleDeleteProfile(profile); }}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                        <div className="page-card-head">
                          <div className={`page-avatar page-avatar-large ${profile.avatarUrl ? "has-image" : ""}`} style={profile.avatarUrl ? undefined : pageAvatarStyle(profile.pageId)}>
                            {profile.avatarUrl ? (
                              <img src={profile.avatarUrl} alt={`${pageDisplayName(profile)} avatar`} loading="lazy" decoding="async" />
                            ) : (
                              pageAvatarLabel(pageDisplayName(profile))
                            )}
                          </div>
                          <div>
                            <p className="page-card-title">{pageDisplayName(profile)}</p>
                            <p className="muted">Meta ID: {profile.pageId}</p>
                            <p className="muted">Updated {formatDateCompact(profile.updatedAt)}</p>
                          </div>
                        </div>

                        <div className="inline-meta">
                          <span className={badgeClass(profile.level)}>{profile.level}</span>
                          <span className={badgeClass(profile.enabled ? "COMPLETED" : "FAILED")}>
                            {profile.enabled ? "ENABLED" : "PAUSED"}
                          </span>
                          <span className={`badge ${connectedPageIds.has(profile.pageId) ? "badge-meta-connected" : "badge-meta-disconnected"}`}>
                            {connectedPageIds.has(profile.pageId) ? "Meta \u2713" : "Meta \u2717"}
                          </span>
                        </div>

                        <div className="page-card-meta-inline">
                          <span>{profile.limits.dailyPosts} posts/day</span>
                          <span>{profile.limits.dailyReels} reels/day</span>
                          <span>{profile.limits.hourlyPublishes} hourly cap</span>
                          <span>{profile.persona?.mode === "FROM_REFERENCES" ? "persona: photo-trained" : "persona: from-scratch"}</span>
                        </div>

                        <div className="button-row page-card-actions">
                          <button className="ghost inline-small" type="button" onClick={(e) => { e.stopPropagation(); startEditingProfile(profile); }}>
                            Edit
                          </button>
                          <button className="ghost inline-small" type="button" onClick={(e) => { e.stopPropagation(); handleToggleEnabled(profile); }} disabled={isBusy}>
                            {profile.enabled ? "Pause" : "Enable"}
                          </button>
                          {connectedPageIds.has(profile.pageId) ? (
                            <button className="ghost inline-small danger-text" type="button" onClick={(e) => { e.stopPropagation(); handleQuickDisconnect(profile.pageId); }}>
                              Disconnect
                            </button>
                          ) : (
                            <button className="primary inline-small" type="button" onClick={(e) => { e.stopPropagation(); setQuickConnectPageId(profile.pageId); setQuickConnectToken(""); setQuickConnectResult(null); }}>
                              Connect Meta
                            </button>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : profiles.length > 0 ? (
                  <div className="empty-state">
                    <p>No pages match filters.</p>
                    <span>Try another search or reset filters.</span>
                  </div>
                ) : (
                  <div className="empty-state" style={{ padding: "48px 24px" }}>
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" style={{ marginBottom: 12, opacity: 0.5 }}><rect x="3" y="3" width="18" height="18" rx="3"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                    <p style={{ fontSize: 15, fontWeight: 600 }}>No pages yet</p>
                    <span style={{ maxWidth: 280, textAlign: "center", lineHeight: 1.5 }}>Add your first Facebook page — paste a token and AI will learn the persona automatically.</span>
                    <button className="primary" type="button" onClick={startCreatingProfile} style={{ marginTop: 12 }}>
                      Create First Page
                    </button>
                  </div>
                )}
              </section>

              {quickConnectPageId !== null && (
                <div className="page-editor-overlay" role="dialog" aria-modal="true" aria-label="Connect Meta token" onClick={() => setQuickConnectPageId(null)}>
                  <section className="workspace-panel page-editor-surface" style={{ maxWidth: 480, margin: "10vh auto" }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <h3>Connect Meta Token</h3>
                      <button type="button" onClick={() => setQuickConnectPageId(null)} style={{ background: "transparent", border: "none", padding: 4, cursor: "pointer", opacity: 0.5 }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </button>
                    </div>
                    <p className="muted" style={{ margin: "8px 0 16px" }}>Page ID: <strong>{quickConnectPageId}</strong></p>
                    <p className="muted" style={{ marginBottom: 12 }}>
                      Get a token from{" "}
                      <a href="https://developers.facebook.com/tools/explorer/?permissions=pages_manage_posts,pages_read_engagement,pages_show_list" target="_blank" rel="noopener noreferrer" style={{ color: "#38bdf8" }}>
                        Graph API Explorer
                      </a>
                      {" "}&mdash; select your App, choose this page, generate token, and paste below.
                    </p>
                    <label style={{ display: "block", marginBottom: 12 }}>
                      Page Access Token
                      <input
                        type="password"
                        value={quickConnectToken}
                        onChange={(e) => setQuickConnectToken(e.target.value)}
                        placeholder="EAAMxyz..."
                        autoFocus
                        style={{ width: "100%", marginTop: 4 }}
                      />
                    </label>
                    {quickConnectResult && (
                      <p style={{ color: quickConnectResult.ok ? "#4ade80" : "#f87171", marginBottom: 12 }}>
                        {quickConnectResult.message}
                      </p>
                    )}
                    <div className="button-row">
                      <button className="primary" type="button" onClick={handleQuickConnect} disabled={quickConnectBusy || !quickConnectToken.trim()}>
                        {quickConnectBusy ? "Verifying..." : "Connect"}
                      </button>
                      <button className="ghost" type="button" onClick={() => setQuickConnectPageId(null)}>Cancel</button>
                    </div>
                  </section>
                </div>
              )}

              {pagesView === "EDITOR" ? (
                <div className="page-editor-overlay" role="dialog" aria-modal="true" aria-label="Page profile editor">
                  <section className="workspace-panel page-editor-surface page-editor-modal">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <h3>{editingProfile ? "Edit Page Profile" : "Create Page Profile"}</h3>
                      <button
                        type="button"
                        onClick={resetProfileEditor}
                        style={{ background: "transparent", border: "none", padding: 4, cursor: "pointer", display: "flex", opacity: 0.5, transition: "opacity 150ms" }}
                        onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.5"; }}
                        title="Close"
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--text-secondary)" strokeWidth="1.5" strokeLinecap="round"><path d="M12 4 4 12M4 4l8 8"/></svg>
                      </button>
                    </div>

                    <form className="stack-form" onSubmit={handleSaveProfile}>
                      <label>
                        Page name
                        <input
                          value={newPageName}
                          onChange={(event) => setNewPageName(event.target.value)}
                          placeholder="e.g. Finelo Trading, My Finance Page"
                          required
                        />
                        <span className="field-hint">Give your page a name — this is how you'll find it in the dashboard.</span>
                      </label>
                      {editingProfile ? (
                        <label>
                          Facebook Page ID
                          <input value={newPageId} disabled />
                        </label>
                      ) : null}

                      <label>
                        Meta Page Token {editingProfile && connectedPageIds.has(editingProfile.pageId) ? "(connected — paste new to refresh)" : ""}
                        <input
                          type="password"
                          value={newMetaToken}
                          onChange={(event) => setNewMetaToken(event.target.value)}
                          placeholder={editingProfile ? "Paste new token to update..." : "EAAMxyz... (paste from Graph API Explorer)"}
                        />
                        <span className="field-hint">
                          Get it from{" "}
                          <a href="https://developers.facebook.com/tools/explorer/?permissions=pages_manage_posts,pages_read_engagement,pages_show_list" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
                            Graph API Explorer
                          </a>
                          : select App &rarr; choose Page &rarr; Generate Access Token &rarr; copy.
                          {!editingProfile && " Page ID will be detected automatically from the token."}
                        </span>
                      </label>

                      {!editingProfile && newPageId.trim() && (
                        <div className="field-hint" style={{ padding: "8px 12px", background: "var(--bg-surface)", borderRadius: 8, border: "1px solid var(--border)" }}>
                          Page ID: <strong style={{ color: "var(--accent)" }}>{extractPageIdFromUrl(newPageId)}</strong>
                        </div>
                      )}

                      <div className="avatar-editor">
                        <label className="avatar-preview avatar-preview-clickable">
                          {newAvatarUrl ? (
                            <img src={newAvatarUrl} alt="Page avatar preview" loading="lazy" decoding="async" />
                          ) : (
                            <div className="page-avatar avatar-fallback" style={pageAvatarStyle(newPageId || newPageName || "new-page")}>
                              {pageAvatarLabel(newPageName || newPageId)}
                            </div>
                          )}
                          <input
                            className="avatar-upload-input"
                            type="file"
                            accept="image/*"
                            aria-label="Upload avatar image"
                            onChange={handleAvatarSelected}
                          />
                          <span className="avatar-upload-hint">{newAvatarUrl ? "Change avatar" : "Upload avatar"}</span>
                        </label>
                        <p className="muted avatar-helper">Click avatar to upload image</p>
                        {newAvatarUrl ? (
                          <button className="ghost inline-small" type="button" onClick={clearAvatar}>
                            Remove Avatar
                          </button>
                        ) : null}
                      </div>

                      <section className="persona-editor-block">
                        <h4 style={{ marginBottom: 8 }}>AI Persona</h4>

                        {/* Two path cards */}
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                          <button
                            type="button"
                            onClick={() => setNewPersonaMode("FROM_REFERENCES")}
                            style={{
                              padding: "14px 12px",
                              background: newPersonaMode === "FROM_REFERENCES" ? "var(--accent-dim)" : "var(--bg-input)",
                              border: `1.5px solid ${newPersonaMode === "FROM_REFERENCES" ? "var(--accent)" : "var(--border)"}`,
                              borderRadius: 12, cursor: "pointer", textAlign: "left",
                              display: "flex", flexDirection: "column", gap: 4, transition: "all 180ms ease"
                            }}
                          >
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={newPersonaMode === "FROM_REFERENCES" ? "var(--accent)" : "var(--text-secondary)"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                            <strong style={{ fontSize: 13, color: newPersonaMode === "FROM_REFERENCES" ? "var(--accent)" : "var(--text)" }}>I have a page</strong>
                            <span style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>Upload photos — AI studies the face, style, and learns to create content like your page</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setNewPersonaMode("FROM_SCRATCH");
                              if (!newPersonaCoreDescription.trim() || newPersonaCoreDescription === "45+ American lifestyle creator, middle-income everyday look, natural candid expression, smartphone-native realism.") {
                                setNewPersonaCoreDescription("35-year-old American, casual confident style, natural daylight look, relatable everyday vibe.");
                              }
                              if (!newPersonaLifestyle.trim() || newPersonaLifestyle === "morning patio coffee, beach walk at sunset, backyard barbecue, neighborhood park stroll, weekend road trip stop") {
                                setNewPersonaLifestyle("morning coffee routine, gym cooldown, evening walk, weekend market, lunch break");
                              }
                            }}
                            style={{
                              padding: "14px 12px",
                              background: newPersonaMode === "FROM_SCRATCH" ? "var(--accent-dim)" : "var(--bg-input)",
                              border: `1.5px solid ${newPersonaMode === "FROM_SCRATCH" ? "var(--accent)" : "var(--border)"}`,
                              borderRadius: 12, cursor: "pointer", textAlign: "left",
                              display: "flex", flexDirection: "column", gap: 4, transition: "all 180ms ease"
                            }}
                          >
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={newPersonaMode === "FROM_SCRATCH" ? "var(--accent)" : "var(--text-secondary)"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/><circle cx="12" cy="12" r="3"/></svg>
                            <strong style={{ fontSize: 13, color: newPersonaMode === "FROM_SCRATCH" ? "var(--accent)" : "var(--text)" }}>Create from scratch</strong>
                            <span style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>AI Brain generates everything — persona, face, content, style. Just give a name.</span>
                          </button>
                        </div>

                        {/* FROM_REFERENCES: existing page */}
                        {newPersonaMode === "FROM_REFERENCES" ? (
                          <div className="stack-form" style={{ marginTop: 12 }}>
                            {(newPageId.trim() || newMetaToken.trim()) ? (
                              <button
                                className="primary"
                                type="button"
                                disabled={isBusy}
                                style={{ width: "100%" }}
                                onClick={async () => {
                                  setIsBusy(true);
                                  setStatusText("Detecting page...");
                                  try {
                                    // Step 1: Resolve page ID
                                    let resolvedPageId = newPageId.trim() ? extractPageIdFromUrl(newPageId) : "";

                                    if (newMetaToken.trim()) {
                                      // Detect real page ID from token
                                      if (!resolvedPageId) {
                                        const detected = await api.detectPage(newMetaToken.trim());
                                        resolvedPageId = detected.pageId;
                                        setNewPageId(resolvedPageId);
                                        if (detected.pageName) setNewPageName(detected.pageName);
                                        if (detected.pictureUrl) setNewAvatarUrl(detected.pictureUrl);
                                      }
                                      // Step 2: Save token for this page ID
                                      await api.saveMetaToken(resolvedPageId, newMetaToken.trim());
                                    }

                                    if (!resolvedPageId) {
                                      setStatusText("Could not detect Page ID. Check your token.");
                                      return;
                                    }

                                    // Step 3: Study the page
                                    setStatusText("Studying your page...");
                                    const data = await api.studyPage(resolvedPageId);
                                    if (data.pageName) {
                                      setNewPersonaName(data.pageName);
                                      if (!newPageName.trim()) setNewPageName(data.pageName);
                                    }
                                    if (data.profilePicture) setNewAvatarUrl(data.profilePicture);
                                    const fetchedPhotos: string[] = [];
                                    if (data.profilePicture) fetchedPhotos.push(data.profilePicture);
                                    for (const url of data.photoUrls.slice(0, 8)) fetchedPhotos.push(url);
                                    for (const post of data.recentPosts) {
                                      if (post.imageUrl && fetchedPhotos.length < 12) fetchedPhotos.push(post.imageUrl);
                                    }
                                    if (fetchedPhotos.length > 0) {
                                      setNewPersonaReferenceImages((current) =>
                                        Array.from(new Set([...current, ...fetchedPhotos])).slice(0, 14)
                                      );
                                    }
                                    const toneStr = data.analysis.tone.join(", ");
                                    const topicsStr = data.analysis.topics.join(", ");
                                    setNewPersonaCoreDescription(
                                      `Persona from ${data.pageName}. Tone: ${toneStr}. Topics: ${topicsStr}. Engagement: ${data.analysis.avgEngagement}. Posting: ${data.analysis.postingFrequency}.`
                                    );
                                    setStatusText(`Studied ${data.pageName}: ${data.recentPosts.length} posts, ${fetchedPhotos.length} photos`);
                                  } catch (error) {
                                    setStatusText(errorMessage(error));
                                  } finally {
                                    setIsBusy(false);
                                  }
                                }}
                              >
                                {isBusy ? "Studying..." : "Study my page"}
                              </button>
                            ) : (
                              <p className="muted" style={{ fontSize: 11 }}>Paste a Meta Page Token above to auto-detect page and study it.</p>
                            )}

                            <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text-muted)", fontSize: 11 }}>
                              <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
                              <span>or upload photos manually</span>
                              <span style={{ flex: 1, height: 1, background: "var(--border)" }} />
                            </div>

                            <div className="persona-upload-row">
                              <label className="ghost inline-small persona-upload-trigger" style={{ cursor: "pointer" }}>
                                Upload photos
                                <input
                                  className="avatar-upload-input"
                                  type="file"
                                  accept="image/*"
                                  multiple
                                  onChange={handlePersonaReferencesSelected}
                                />
                              </label>
                              <span className="muted">{newPersonaReferenceImages.length}/14</span>
                            </div>
                            {newPersonaReferenceImages.length > 0 ? (
                              <div className="persona-reference-grid">
                                {newPersonaReferenceImages.map((image, index) => (
                                  <button
                                    key={`ref-${index}`}
                                    type="button"
                                    className="persona-reference-item"
                                    onClick={() => handleRemovePersonaReference(index)}
                                    title="Click to remove"
                                  >
                                    <img src={image} alt={`Reference ${index + 1}`} loading="lazy" decoding="async" />
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        {/* FROM_SCRATCH: AI Brain creates everything */}
                        {newPersonaMode === "FROM_SCRATCH" ? (
                          <div style={{ marginTop: 12, padding: "12px 14px", background: "var(--bg-input)", borderRadius: 10, border: "1px solid var(--border)" }}>
                            <p style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.7, margin: 0 }}>
                              <strong style={{ color: "var(--text)" }}>AI Brain mode:</strong> System will auto-generate persona appearance, lifestyle scenes, content style, and posting strategy. You only need a name — everything else is handled autonomously.
                            </p>
                          </div>
                        ) : null}
                      </section>

                      <button className="primary" type="submit" disabled={isBusy}>
                        {editingProfile ? "Update Profile" : "Create Profile"}
                      </button>
                    </form>
                    {editingProfile ? <p className="muted">Facebook Page ID is locked for existing profiles. You can still rename page.</p> : null}

                    <button className="ghost inline-small" type="button" onClick={() => setShowSetupAdvanced((state) => !state)}>
                      {showSetupAdvanced ? "Hide" : "Show"} profile settings
                    </button>

                    {showSetupAdvanced ? (
                      <div className="advanced-mini">
                        <button className="ghost inline-small" type="button" onClick={applyRecommendedDefaults}>
                          Reset to recommended
                        </button>
                        <label>
                          How much freedom does AI have?
                          <select value={newLevel} onChange={(event) => setNewLevel(event.target.value as AutonomyLevel)}>
                            <option value="L0">Full control — review everything before posting</option>
                            <option value="L1">Mostly manual — review most content</option>
                            <option value="L2">Semi-auto — low-risk posts go live, risky ones need review</option>
                            <option value="L3">Fully auto — AI publishes everything that passes safety</option>
                          </select>
                          <span className="field-hint">L0 = safest, L3 = most autonomous</span>
                        </label>
                        <label>
                          Content safety level
                          <select value={newPolicyMode} onChange={(event) => setNewPolicyMode(event.target.value as PolicyMode)}>
                            <option value="STRICT">Strict — extra careful with claims and language</option>
                            <option value="STANDARD">Standard — normal safety checks</option>
                          </select>
                        </label>
                        <div className="form-3col">
                          <label>
                            Posts/day
                            <input type="number" min={0} max={20} value={newDailyPosts} onChange={(event) => setNewDailyPosts(Number(event.target.value))} />
                          </label>
                          <label>
                            Reels/day
                            <input type="number" min={0} max={20} value={newDailyReels} onChange={(event) => setNewDailyReels(Number(event.target.value))} />
                          </label>
                          <label>
                            Max/hour
                            <input type="number" min={1} max={20} value={newHourlyPublishes} onChange={(event) => setNewHourlyPublishes(Number(event.target.value))} />
                          </label>
                        </div>
                      </div>
                    ) : null}

                  </section>
                </div>
              ) : null}
            </div>
          ) : route.kind === "WORKSPACE" ? (
            <div className="workspace-body">
              {!selectedProfile ? (
                <div className="empty-state">
                  <p>No active page selected.</p>
                  <span>Go to Pages, choose a profile, then open workspace.</span>
                </div>
              ) : (
                <>
                  <div className="page-quickbar">
                    <div className={`page-avatar page-avatar-mini ${selectedProfile.avatarUrl ? "has-image" : ""}`} style={selectedProfile.avatarUrl ? undefined : pageAvatarStyle(selectedProfile.pageId)}>
                      {selectedProfile.avatarUrl ? (
                        <img src={selectedProfile.avatarUrl} alt={`${pageDisplayName(selectedProfile)} avatar`} loading="lazy" decoding="async" />
                      ) : (
                        pageAvatarLabel(pageDisplayName(selectedProfile))
                      )}
                    </div>
                    <label className="page-picker-inline">
                      Active page
                      <select value={selectedProfileId} onChange={(event) => setSelectedProfileId(event.target.value)}>
                        {profiles.map((profile) => (
                          <option key={profile.id} value={profile.id}>
                            {pageDisplayName(profile)} · {profile.pageId}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className={badgeClass(selectedProfile.level)}>{selectedProfile.level}</span>
                    <span className={badgeClass(selectedProfile.enabled ? "COMPLETED" : "FAILED")}>
                      {selectedProfile.enabled ? "ENABLED" : "PAUSED"}
                    </span>
                    {queue.length > 0 ? (
                      <span className={badgeClass("WAITING_REVIEW")}>{queue.length} to review</span>
                    ) : null}
                  </div>

                  <div className="workspace-tabs">
                    {/* Create tab with dropdown */}
                    <div style={{ position: "relative" }}>
                      <button
                        className={`workspace-tab ${guidedWorkspace === "CREATE" ? "active" : ""}`}
                        type="button"
                        onClick={() => {
                          if (guidedWorkspace === "CREATE") {
                            setShowCreateMenu(prev => !prev);
                          } else {
                            setGuidedWorkspace("CREATE");
                            setShowCreateMenu(false);
                          }
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                        Create
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ opacity: 0.5 }}><polyline points="6 9 12 15 18 9"/></svg>
                      </button>
                      {showCreateMenu && (
                        <>
                          <div style={{ position: "fixed", inset: 0, zIndex: 199 }} onClick={() => setShowCreateMenu(false)} />
                          <div style={{
                            position: "absolute", top: "100%", left: 0, marginTop: 6, zIndex: 200,
                            background: "var(--bg-raised)", border: "1px solid var(--border)",
                            borderRadius: 10, padding: 4, minWidth: 180,
                            boxShadow: "0 8px 32px rgba(0,0,0,0.5)"
                          }}>
                            {([
                              { key: "POSTS" as CreateTool, label: "Posts", desc: "Photo & video posts", icon: "M4 4h16v16H4zM8 8h8M8 12h5" },
                              { key: "REELS" as CreateTool, label: "Reels", desc: "Multi-scene montage", icon: "M23 7l-7 5 7 5V7zM1 5h15v14H1z" },
                            ]).map(tool => (
                              <button
                                key={tool.key}
                                type="button"
                                onClick={() => { setCreateTool(tool.key); setGuidedWorkspace("CREATE"); setShowCreateMenu(false); }}
                                style={{
                                  display: "flex", alignItems: "center", gap: 10, width: "100%",
                                  padding: "10px 12px", border: "none", borderRadius: 8,
                                  background: createTool === tool.key ? "var(--accent-dim)" : "transparent",
                                  cursor: "pointer", textAlign: "left", transition: "background 100ms"
                                }}
                                onMouseEnter={e => { if (createTool !== tool.key) e.currentTarget.style.background = "var(--bg-hover)"; }}
                                onMouseLeave={e => { if (createTool !== tool.key) e.currentTarget.style.background = "transparent"; }}
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={createTool === tool.key ? "var(--accent)" : "var(--text-secondary)"} strokeWidth="1.8" strokeLinecap="round"><path d={tool.icon}/></svg>
                                <div>
                                  <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: createTool === tool.key ? "var(--accent)" : "var(--text)" }}>{tool.label}</p>
                                  <p style={{ margin: 0, fontSize: 10, color: "var(--text-muted)" }}>{tool.desc}</p>
                                </div>
                                {createTool === tool.key && (
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" style={{ marginLeft: "auto" }}><polyline points="20 6 9 17 4 12"/></svg>
                                )}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>

                    {/* Other tabs */}
                    {(["REVIEW", "PUBLISH", "SETTINGS"] as GuidedWorkspace[]).map((workspace) => (
                      <button
                        key={workspace}
                        className={`workspace-tab ${guidedWorkspace === workspace ? "active" : ""}`}
                        onClick={() => { setGuidedWorkspace(workspace); setShowCreateMenu(false); }}
                        type="button"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d={WORKSPACE_ICONS[workspace]}/></svg>
                        {WORKSPACE_LABELS[workspace]}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {selectedProfile ? (
                <>
              {guidedWorkspace === "CREATE" ? (
                <section className="workspace-panel">
                  {createTool === "POSTS" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <div className="row-between">
                    <h3>Posts</h3>
                    <p className="muted">Generate posts for {selectedProfile ? pageDisplayName(selectedProfile) : "this page"}.</p>
                  </div>
                  <div className="button-row">
                    <button className="primary" onClick={handleSmartRun} disabled={!selectedProfile || isBusy}>
                      Run Smart Cycle
                    </button>
                    <button className="ghost" onClick={handleRunCycle} disabled={!selectedProfile || isBusy}>
                      Generate Only
                    </button>
                  </div>
                  <div className={`tip-card ${smartRunStatus === "FAILED" ? "tip-danger" : smartRunStatus === "REVIEW" ? "tip-warning" : smartRunStatus === "DONE" ? "tip-success" : ""}`}>
                    <svg className="tip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><path d="m12 8v4M12 16h.01"/></svg>
                    <span>{smartRunSummary}</span>
                  </div>
                  <div className="metric-grid">
                    <div className="metric-card">
                      <span>Generated</span>
                      <strong>{cycleStats.generated}</strong>
                    </div>
                    <div className="metric-card">
                      <span>Waiting review</span>
                      <strong>{cycleStats.waitingReview}</strong>
                    </div>
                    <div className="metric-card">
                      <span>Published</span>
                      <strong>{cycleStats.published}</strong>
                    </div>
                  </div>
                  </div>
                  )}

                  {createTool === "REELS" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  <div className="row-between">
                    <h3>Reel Producer</h3>
                    <p className="muted">Create multi-scene reels for {selectedProfile ? pageDisplayName(selectedProfile) : "this page"}</p>
                  </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => setReelPreset("LIFESTYLE")}
                        style={{
                          padding: "12px", textAlign: "left", cursor: "pointer",
                          background: reelPreset === "LIFESTYLE" ? "var(--accent-dim)" : "var(--bg-input)",
                          border: `1.5px solid ${reelPreset === "LIFESTYLE" ? "var(--accent)" : "var(--border)"}`,
                          borderRadius: 10, transition: "all 150ms"
                        }}
                      >
                        <strong style={{ fontSize: 13, color: reelPreset === "LIFESTYLE" ? "var(--accent)" : "var(--text)", display: "block" }}>Lifestyle</strong>
                        <span style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>Lifestyle scenes, talking head, b-roll with music</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setReelPreset("BEFORE_AFTER")}
                        style={{
                          padding: "12px", textAlign: "left", cursor: "pointer",
                          background: reelPreset === "BEFORE_AFTER" ? "var(--accent-dim)" : "var(--bg-input)",
                          border: `1.5px solid ${reelPreset === "BEFORE_AFTER" ? "var(--accent)" : "var(--border)"}`,
                          borderRadius: 10, transition: "all 150ms"
                        }}
                      >
                        <strong style={{ fontSize: 13, color: reelPreset === "BEFORE_AFTER" ? "var(--accent)" : "var(--text)", display: "block" }}>Before / After</strong>
                        <span style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>2004 struggle vs 2026 freedom — dramatic transformation</span>
                      </button>
                    </div>

                    <div className="button-row">
                      <button
                        className="primary"
                        type="button"
                        disabled={!selectedProfile || isBusy}
                        onClick={async () => {
                          if (!selectedProfile) return;
                          setIsBusy(true);
                          setStatusText("Generating full reel...");
                          try {
                            const { id } = await api.generateReelFull(selectedProfile.pageId, selectedProfile.id, reelPreset);
                            setStatusText("Reel generating in background...");
                            // Poll
                            const poll = setInterval(async () => {
                              try {
                                const draft = await api.getReelDraft(id);
                                setStatusText(`Reel: ${draft.progress} (${draft.progressPercent}%)`);
                                if (draft.status !== "GENERATING") {
                                  clearInterval(poll);
                                  if (selectedProfile) await refreshPageContext(selectedProfile.pageId);
                                  setStatusText(draft.videoPath ? `Reel ready — check Review tab` : `Reel done (${draft.progress})`);
                                  setGuidedWorkspace("REVIEW");
                                  setIsBusy(false);
                                }
                              } catch { clearInterval(poll); setIsBusy(false); }
                            }, 3000);
                          } catch (error) {
                            setStatusText(`Generation failed: ${errorMessage(error)}`);
                            setIsBusy(false);
                          }
                        }}
                      >
                        {isBusy ? "Generating..." : "Smart Generate"}
                      </button>
                      <button
                        className="ghost"
                        type="button"
                        disabled={!selectedProfile || isBusy}
                        onClick={async () => {
                          if (!selectedProfile) return;
                          setIsBusy(true);
                          setStatusText("Writing reel script...");
                          try {
                            await api.generateReel(selectedProfile.pageId, selectedProfile.id, reelPreset);
                            await refreshPageContext(selectedProfile.pageId);
                            setStatusText("Script ready — review step by step");
                            setGuidedWorkspace("REVIEW");
                          } catch (error) {
                            setStatusText(`Script generation failed: ${errorMessage(error)}`);
                          } finally {
                            setIsBusy(false);
                          }
                        }}
                      >
                        Step by Step
                      </button>
                    </div>

                    {!isBusy && (
                      <div className="tip-card">
                        <svg className="tip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
                        <span>AI writes a scene-by-scene script, generates persona photos per scene, animates with Kling, assembles with text + music via FFmpeg.</span>
                      </div>
                    )}

                    {/* Music Library — inline in Reels tab */}
                    <div style={{ paddingTop: 16, borderTop: "1px solid var(--border)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                        <h4 style={{ margin: 0 }}>Music Library</h4>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                        {[
                          { key: "LIFESTYLE", label: "Lifestyle", desc: "Calm, upbeat tracks" },
                          { key: "BEFORE_AFTER", label: "Before / After", desc: "Dramatic, inspiring tracks" }
                        ].map(({ key: preset, label, desc }) => {
                          const tracks = musicTracks.filter(t => t.presets.includes(preset));
                          return (
                            <div key={preset} style={{ background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                <strong style={{ fontSize: 12 }}>{label}</strong>
                                <span style={{ fontSize: 10, color: "var(--text-muted)", background: "var(--bg-surface)", padding: "2px 8px", borderRadius: 99 }}>{tracks.length}</span>
                              </div>
                              <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>{desc}</p>

                              {tracks.map(track => (
                                <div key={track.id} style={{
                                  display: "flex", alignItems: "center", gap: 6, padding: "6px 8px",
                                  background: track.selected ? "var(--accent-dim)" : "var(--bg-surface)",
                                  borderRadius: 8,
                                  border: track.selected ? "1.5px solid var(--accent)" : "1px solid var(--border)",
                                  transition: "all 150ms"
                                }}>
                                  <button type="button" title={track.selected ? "Deselect — system will pick random" : "Select — always use this track"}
                                    style={{
                                      background: track.selected ? "var(--accent)" : "transparent",
                                      border: track.selected ? "none" : "1.5px solid var(--border)",
                                      borderRadius: "50%", width: 18, height: 18, cursor: "pointer", padding: 0,
                                      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0
                                    }}
                                    onClick={async () => {
                                      try {
                                        const updated = await api.selectMusicTrack(track.id, !track.selected, preset);
                                        setMusicTracks(prev => prev.map(t => {
                                          if (t.id === updated.id) return updated;
                                          // Deselect others in same preset when selecting
                                          if (!track.selected && t.presets.includes(preset) && t.id !== updated.id) return { ...t, selected: false };
                                          return t;
                                        }));
                                        setStatusText(updated.selected ? `"${updated.name}" selected` : "Deselected — random mode");
                                      } catch (err) { setStatusText(`Select failed: ${errorMessage(err)}`); }
                                    }}
                                  >
                                    {track.selected && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                                  </button>
                                  <p style={{ fontSize: 11, margin: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{track.name}</p>
                                  <audio src={api.getMusicTrackAudioUrl(track.id)} controls style={{ height: 26, width: 120, flexShrink: 0 }} />
                                  <button type="button" title="Remove" style={{ background: "transparent", border: "none", cursor: "pointer", padding: 2, opacity: 0.4, display: "flex" }}
                                    onMouseEnter={e => { e.currentTarget.style.opacity = "1"; }}
                                    onMouseLeave={e => { e.currentTarget.style.opacity = "0.4"; }}
                                    onClick={async () => { await api.deleteMusicTrack(track.id); setMusicTracks(prev => prev.filter(t => t.id !== track.id)); setStatusText("Track removed"); }}
                                  ><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                                </div>
                              ))}

                              <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 0", border: "1.5px dashed var(--border)", borderRadius: 8, cursor: "pointer", fontSize: 11, color: "var(--accent)" }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                                {isMusicUploading ? "Uploading..." : "Upload MP3"}
                                <input type="file" accept="audio/mpeg,audio/mp3" style={{ display: "none" }} disabled={isMusicUploading}
                                  onChange={async (e) => {
                                    const file = e.target.files?.[0]; if (!file) return;
                                    setIsMusicUploading(true);
                                    try {
                                      const reader = new FileReader();
                                      const dataBase64 = await new Promise<string>((resolve) => { reader.onload = () => resolve((reader.result as string).split(",")[1] ?? ""); reader.readAsDataURL(file); });
                                      const track = await api.uploadMusicTrack({ name: file.name.replace(/\.mp3$/i, ""), presets: [preset], category: preset === "BEFORE_AFTER" ? "inspiring" : "calm", dataBase64 });
                                      setMusicTracks(prev => [track, ...prev]);
                                      setStatusText(`"${track.name}" added`);
                                    } catch (err) { setStatusText(`Upload failed: ${errorMessage(err)}`); }
                                    finally { setIsMusicUploading(false); e.target.value = ""; }
                                  }}
                                />
                              </label>
                            </div>
                          );
                        })}
                      </div>
                      <p style={{ fontSize: 10, color: "var(--text-muted)", margin: "8px 0 0", lineHeight: 1.5 }}>
                        Click the circle to select a track. Selected track is always used. No selection = random track each time.
                      </p>
                    </div>
                  </div>
                  )}
                </section>
              ) : null}

              {guidedWorkspace === "REVIEW" ? (
                <>
                {/* Reel Drafts — Step-by-step Review */}
                {reelDrafts.filter(d => !["APPROVED", "REJECTED"].includes(d.status) && (!selectedProfile || d.pageId === selectedProfile.pageId)).length > 0 && (
                  <section className="workspace-panel" style={{ marginBottom: 16 }}>
                    <div className="row-between">
                      <h3>Reel Studio</h3>
                      <span className="muted">{reelDrafts.filter(d => !["APPROVED", "REJECTED"].includes(d.status) && (!selectedProfile || d.pageId === selectedProfile.pageId)).length} active</span>
                    </div>
                    {reelDrafts.filter(d => !["APPROVED", "REJECTED"].includes(d.status) && (!selectedProfile || d.pageId === selectedProfile.pageId)).map(draft => (
                      <div key={draft.id} style={{ padding: 16, background: "var(--bg-surface)", borderRadius: 12, border: "1px solid var(--border)", marginTop: 12 }}>

                        {/* Step indicator */}
                        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                          {["Script", "Photos", "Video"].map((step, i) => {
                            const stepStatuses = [["SCRIPT_READY"], ["SCENES_READY"], ["VIDEO_READY"]];
                            const currentIdx = draft.status === "GENERATING" ? (draft.progressPercent < 20 ? 0 : draft.progressPercent < 65 ? 1 : 2)
                              : stepStatuses.findIndex(ss => ss.includes(draft.status));
                            const done = i < currentIdx || draft.status === "VIDEO_READY";
                            const active = i === currentIdx;
                            return (
                              <span key={step} style={{
                                fontSize: 11, padding: "3px 10px", borderRadius: 99,
                                background: done ? "rgba(52,211,153,0.12)" : active ? "rgba(56,189,248,0.15)" : "var(--bg-input)",
                                color: done ? "var(--success)" : active ? "var(--accent)" : "var(--text-muted)",
                                border: `1px solid ${done ? "rgba(52,211,153,0.25)" : active ? "rgba(56,189,248,0.3)" : "var(--border)"}`,
                                fontWeight: active ? 600 : 400
                              }}>{done ? "\u2713 " : ""}{step}</span>
                            );
                          })}
                        </div>

                        <strong style={{ fontSize: 15 }}>{draft.title || "Generating script..."}</strong>
                        {draft.status === "GENERATING" && (
                          <div className="tip-card" style={{ marginTop: 8 }}>
                            <svg className="tip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ animation: "spin 1.5s linear infinite" }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                            <div style={{ flex: 1 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <span>{draft.progress}</span>
                                <button
                                  className="ghost inline-small danger-text"
                                  type="button"
                                  style={{ fontSize: 11, padding: "2px 8px" }}
                                  onClick={async () => {
                                    try {
                                      await api.reviewReelDraft(draft.id, "REJECT", "Cancelled by user");
                                      if (selectedProfile) await refreshPageContext(selectedProfile.pageId);
                                      setStatusText("Generation cancelled");
                                      setIsBusy(false);
                                    } catch { /* ignore */ }
                                  }}
                                >Cancel</button>
                              </div>
                              <div style={{ marginTop: 6, height: 3, borderRadius: 2, background: "var(--bg-input)", overflow: "hidden" }}>
                                <div style={{ height: "100%", width: `${draft.progressPercent}%`, background: "var(--accent)", transition: "width 0.5s" }} />
                              </div>
                            </div>
                          </div>
                        )}

                        {/* STEP 1: Script review */}
                        {draft.status === "SCRIPT_READY" && (
                          <div style={{ marginTop: 10 }}>
                            <p className="muted" style={{ margin: "6px 0" }}>{draft.scenes.length} scenes &middot; {draft.durationSeconds}s</p>
                            <div style={{ background: "var(--bg-input)", borderRadius: 8, padding: 12, maxHeight: 200, overflow: "auto", fontSize: 12, lineHeight: 1.7 }}>
                              {draft.scenes.map(s => (
                                <div key={s.index} style={{ marginBottom: 6 }}>
                                  <span style={{ color: "var(--accent)", fontWeight: 600, fontSize: 10 }}>{s.segmentLabel}</span>{" "}
                                  <span style={{ color: "var(--text-secondary)" }}>{s.onScreenText}</span>
                                </div>
                              ))}
                            </div>
                            <div className="button-row" style={{ marginTop: 10 }}>
                              <button className="primary" disabled={isBusy} onClick={async () => {
                                setIsBusy(true);
                                setStatusText("Script approved — generating photos...");
                                try {
                                  await api.advanceReelDraft(draft.id);
                                  const poll = setInterval(async () => {
                                    try {
                                      const d = await api.getReelDraft(draft.id);
                                      setStatusText(`${d.progress} (${d.progressPercent}%)`);
                                      if (d.status !== "GENERATING") {
                                        clearInterval(poll);
                                        if (selectedProfile) await refreshPageContext(selectedProfile.pageId);
                                        setStatusText(d.status === "SCENES_READY" ? "Photos ready — review them below" : d.progress);
                                        setIsBusy(false);
                                      }
                                    } catch { clearInterval(poll); setIsBusy(false); }
                                  }, 3000);
                                } catch (e) { setStatusText(`Failed: ${errorMessage(e)}`); setIsBusy(false); }
                              }}>{isBusy ? "Generating photos..." : "Approve Script \u2192 Generate Photos"}</button>
                              <button className="ghost" disabled={isBusy} onClick={async () => {
                                setIsBusy(true);
                                try { await api.reviewReelDraft(draft.id, "REJECT"); if (selectedProfile) await refreshPageContext(selectedProfile.pageId); setStatusText("Script rejected"); }
                                catch (e) { setStatusText(`Failed: ${errorMessage(e)}`); } finally { setIsBusy(false); }
                              }}>Reject</button>
                            </div>
                          </div>
                        )}

                        {/* STEP 2: Scene photos review */}
                        {draft.status === "SCENES_READY" && (
                          <div style={{ marginTop: 10 }}>
                            <p className="muted" style={{ margin: "6px 0" }}>{draft.sceneAssets.length} photos generated</p>
                            <div style={{ display: "flex", gap: 8, overflowX: "auto", padding: "4px 0" }}>
                              {draft.sceneAssets.filter(a => a.imageDataUrl && !a.imageDataUrl.endsWith("...")).map(asset => {
                                const isRegenerating = regenSceneIdx === asset.sceneIndex;
                                return (
                                <div key={asset.sceneIndex} style={{ flexShrink: 0, width: 88, position: "relative" }}>
                                  <img src={asset.imageDataUrl} style={{ width: 88, height: 156, objectFit: "cover", borderRadius: 8, opacity: isRegenerating ? 0.3 : 1, transition: "opacity 300ms" }} alt={`Scene ${asset.sceneIndex}`} />
                                  {isRegenerating && (
                                    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" style={{ animation: "spin 1s linear infinite" }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                                    </div>
                                  )}
                                  <button
                                    type="button"
                                    disabled={regenSceneIdx !== null}
                                    title="Regenerate this scene"
                                    style={{
                                      position: "absolute", top: 4, right: 4,
                                      width: 22, height: 22, borderRadius: "50%",
                                      background: "rgba(0,0,0,0.6)", border: "none",
                                      cursor: regenSceneIdx !== null ? "wait" : "pointer",
                                      display: isRegenerating ? "none" : "flex", alignItems: "center", justifyContent: "center",
                                      opacity: 0.7, transition: "opacity 150ms"
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.opacity = "1"; }}
                                    onMouseLeave={e => { e.currentTarget.style.opacity = "0.7"; }}
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      setRegenSceneIdx(asset.sceneIndex);
                                      setStatusText(`Regenerating scene ${asset.sceneIndex + 1}...`);
                                      try {
                                        await api.regenerateReelScene(draft.id, asset.sceneIndex);
                                        if (selectedProfile) await refreshPageContext(selectedProfile.pageId);
                                        setStatusText(`Scene ${asset.sceneIndex + 1} regenerated`);
                                      } catch (err) { setStatusText(`Regen failed: ${errorMessage(err)}`); }
                                      finally { setRegenSceneIdx(null); }
                                    }}
                                  >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                                  </button>
                                  <p style={{ fontSize: 9, color: "var(--text-muted)", textAlign: "center", margin: "3px 0 0" }}>{draft.scenes[asset.sceneIndex]?.segmentLabel}</p>
                                </div>
                                );
                              })}
                            </div>
                            <div className="button-row" style={{ marginTop: 10 }}>
                              <button className="primary" disabled={isBusy} onClick={async () => {
                                setIsBusy(true);
                                setStatusText("Photos approved — assembling video...");
                                try {
                                  await api.advanceReelDraft(draft.id);
                                  const poll = setInterval(async () => {
                                    try {
                                      const d = await api.getReelDraft(draft.id);
                                      setStatusText(`${d.progress} (${d.progressPercent}%)`);
                                      if (d.status !== "GENERATING") {
                                        clearInterval(poll);
                                        if (selectedProfile) await refreshPageContext(selectedProfile.pageId);
                                        setStatusText(d.status === "VIDEO_READY" ? "Video ready — final review below" : d.progress);
                                        setIsBusy(false);
                                      }
                                    } catch { clearInterval(poll); setIsBusy(false); }
                                  }, 3000);
                                } catch (e) { setStatusText(`Failed: ${errorMessage(e)}`); setIsBusy(false); }
                              }}>{isBusy ? "Assembling video..." : "Approve Photos \u2192 Assemble Video"}</button>
                              <button className="ghost" disabled={isBusy} onClick={async () => {
                                setIsBusy(true);
                                try { await api.reviewReelDraft(draft.id, "REJECT"); if (selectedProfile) await refreshPageContext(selectedProfile.pageId); setStatusText("Photos rejected"); }
                                catch (e) { setStatusText(`Failed: ${errorMessage(e)}`); } finally { setIsBusy(false); }
                              }}>Reject</button>
                            </div>
                          </div>
                        )}

                        {/* STEP 3: Final video review */}
                        {draft.status === "VIDEO_READY" && (
                          <div style={{ marginTop: 10 }}>
                            {draft.videoPath ? (
                              <video src={api.getReelVideoUrl(draft.id)} controls style={{ width: "100%", maxWidth: 360, borderRadius: 8, background: "#000" }} />
                            ) : (
                              <p className="muted">No video assembled — approve as photo slideshow</p>
                            )}
                            <div className="button-row" style={{ marginTop: 10 }}>
                              <button className="primary" disabled={isBusy} onClick={async () => {
                                setIsBusy(true);
                                try { await api.reviewReelDraft(draft.id, "APPROVE"); if (selectedProfile) await refreshPageContext(selectedProfile.pageId); setStatusText("Reel approved!"); }
                                catch (e) { setStatusText(`Failed: ${errorMessage(e)}`); } finally { setIsBusy(false); }
                              }}>Approve Reel</button>
                              <button className="ghost" disabled={isBusy} onClick={async () => {
                                setIsBusy(true);
                                try { await api.reviewReelDraft(draft.id, "REJECT"); if (selectedProfile) await refreshPageContext(selectedProfile.pageId); setStatusText("Reel rejected"); }
                                catch (e) { setStatusText(`Failed: ${errorMessage(e)}`); } finally { setIsBusy(false); }
                              }}>Reject</button>
                            </div>
                          </div>
                        )}

                        {draft.status === "FAILED" && (
                          <div className="tip-card tip-danger" style={{ marginTop: 8 }}>
                            <span>{draft.progress}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </section>
                )}

                {/* Post Review Queue */}
                <section className="workspace-panel">
                  <div className="row-between">
                    <h3>Post Review Queue</h3>
                    <span className={badgeClass(queue.length > 0 ? "WAITING_REVIEW" : "COMPLETED")}>
                      {queue.length} waiting
                    </span>
                  </div>
                  {latestCycle?.simulate ? (
                    <div className="tip-card tip-warning">
                      <svg className="tip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                      <span>Preview mode is on. Approving won't publish — turn Preview OFF and re-run to go live.</span>
                    </div>
                  ) : null}
                  {activeReview ? (
                    <div className="review-card">
                      <div className="row-between">
                        <strong>{activeReview.item.title}</strong>
                        <span className={badgeClass(activeReview.item.publishStatus)}>{activeReview.item.publishStatus}</span>
                      </div>
                      <p className="muted">{activeReview.item.vertical} · {reviewPreviewMediaType === "VIDEO" ? "VIDEO" : "PHOTO"}</p>
                      {reviewEditing ? (
                        <div className="review-edit-layout">
                          <div className="review-edit-form">
                            <label>
                              Title
                              <input
                                value={reviewEditTitle}
                                onChange={(event) => setReviewEditTitle(event.target.value)}
                              />
                            </label>
                            <label>
                              Media type
                              <select
                                value={reviewEditMediaType}
                                onChange={(event) => setReviewEditMediaType(event.target.value as "IMAGE" | "VIDEO")}
                              >
                                <option value="IMAGE">Photo post</option>
                                <option value="VIDEO">Video post (Kling)</option>
                              </select>
                            </label>
                            <label>
                              Body
                              <textarea
                                value={reviewEditBody}
                                onChange={(event) => setReviewEditBody(event.target.value)}
                              />
                            </label>
                            {reviewEditMediaType === "VIDEO" ? (
                              <label>
                                Media prompt
                                <textarea
                                  value={reviewEditMediaPrompt}
                                  onChange={(event) => setReviewEditMediaPrompt(event.target.value)}
                                />
                              </label>
                            ) : null}
                            <label>
                              Image prompt (optional)
                              <textarea
                                value={reviewImagePrompt}
                                onChange={(event) => setReviewImagePrompt(event.target.value)}
                                placeholder="Leave empty to use smart lifestyle prompt, or write your own."
                              />
                            </label>
                            <button className="ghost" type="button" onClick={handleRegenerateReviewImage} disabled={isBusy}>
                              Regenerate Image
                            </button>
                            <div className="button-row">
                              <button className="primary" type="button" onClick={handleSaveReviewEdits} disabled={isBusy}>
                                Save Edits
                              </button>
                              <button
                                className="ghost"
                                type="button"
                                onClick={() => {
                                  setReviewEditTitle(activeReview.item.title);
                                  setReviewEditBody(activeReview.item.body);
                                  setReviewEditMediaType(
                                    (activeReview.item.mediaType ?? (activeReview.item.format === "REEL" ? "VIDEO" : "IMAGE")) as
                                      | "IMAGE"
                                      | "VIDEO"
                                  );
                                  setReviewEditMediaPrompt(activeReview.item.mediaPrompt ?? "");
                                  setReviewEditing(false);
                                }}
                                disabled={isBusy}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>

                          <article className="fb-preview">
                            <header className="fb-preview-head">
                              <div className={`page-avatar page-avatar-mini ${selectedProfile?.avatarUrl ? "has-image" : ""}`} style={selectedProfile?.avatarUrl ? undefined : pageAvatarStyle(selectedProfile?.pageId ?? "preview-page")}>
                                {selectedProfile?.avatarUrl ? (
                                  <img src={selectedProfile.avatarUrl} alt={`${pageDisplayName(selectedProfile)} avatar`} loading="lazy" decoding="async" />
                                ) : (
                                  pageAvatarLabel(pageDisplayName(selectedProfile) || "preview-page")
                                )}
                              </div>
                              <div>
                                <p className="fb-preview-name">{pageDisplayName(selectedProfile)}</p>
                                <p className="fb-preview-meta">ID {selectedProfile?.pageId ?? "-"} · Preview · Not published</p>
                              </div>
                            </header>
                            <div className="fb-preview-body">
                              <p className="fb-preview-title">{reviewPreviewTitle || "Untitled draft"}</p>
                              <p className="fb-preview-text">{reviewPreviewBody || "Start typing to preview post text..."}</p>
                              {reviewPreviewImage ? (
                                <div className="fb-preview-image-wrap" style={{ position: "relative", overflow: "hidden" }}>
                                  <img src={reviewPreviewImage} alt="Draft generated preview" className="fb-preview-image" loading="lazy" decoding="async" style={{ opacity: isBusy ? 0.4 : 1, transition: "opacity 300ms ease" }} />
                                  {isBusy ? (
                                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: "var(--bg-surface)", overflow: "hidden" }}>
                                      <div style={{ width: "40%", height: "100%", background: "var(--accent)", borderRadius: 2, animation: "regen-slide 1.2s ease-in-out infinite" }} />
                                    </div>
                                  ) : null}
                                  <button
                                    type="button"
                                    onClick={handleRegenerateReviewImage}
                                    disabled={isBusy}
                                    title="Regenerate image"
                                    style={{ position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,0.5)", border: "none", borderRadius: 8, padding: 6, cursor: isBusy ? "wait" : "pointer", display: "flex", backdropFilter: "blur(8px)", opacity: isBusy ? 0.3 : 0.7, transition: "opacity 200ms" }}
                                    onMouseEnter={(e) => { if (!isBusy) e.currentTarget.style.opacity = "1"; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.opacity = isBusy ? "0.3" : "0.7"; }}
                                  >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/></svg>
                                  </button>
                                </div>
                              ) : null}
                              {reviewPreviewMediaType === "VIDEO" ? (
                                <div className="fb-preview-media">
                                  {reviewPreviewVideo ? (
                                    <video className="fb-preview-video" src={reviewPreviewVideo} controls playsInline preload="metadata" />
                                  ) : (
                                    <p className="muted">No video preview yet. Save edits to trigger 9:16 image + Kling video generation.</p>
                                  )}
                                  <span>Media prompt</span>
                                  <p>{reviewPreviewMediaPrompt || "No media prompt yet."}</p>
                                </div>
                              ) : null}
                            </div>
                          </article>
                        </div>
                      ) : (
                        <div className="review-edit-layout">
                          <div className="review-view-pane">
                            <p>{shortText(activeReview.item.body, 320)}</p>
                            <div className="review-format-switch">
                              <span className="review-format-label">Media type</span>
                              <div className="review-format-buttons">
                                <button
                                  className={`ghost ${((activeReview.item.mediaType ?? (activeReview.item.format === "REEL" ? "VIDEO" : "IMAGE")) === "IMAGE") ? "is-active" : ""}`}
                                  type="button"
                                  onClick={() => handleQuickReviewFormatSwitch("IMAGE")}
                                  disabled={isBusy}
                                >
                                  Photo
                                </button>
                                <button
                                  className={`ghost ${((activeReview.item.mediaType ?? (activeReview.item.format === "REEL" ? "VIDEO" : "IMAGE")) === "VIDEO") ? "is-active" : ""}`}
                                  type="button"
                                  onClick={() => handleQuickReviewFormatSwitch("VIDEO")}
                                  disabled={isBusy}
                                >
                                  Video (Kling)
                                </button>
                              </div>
                              <p className="muted review-format-hint">
                                Video mode auto-generates a 9:16 image and then a Kling video.
                              </p>
                            </div>
                            <label className="review-inline-field">
                              Image prompt (optional)
                              <textarea
                                value={reviewImagePrompt}
                                onChange={(event) => setReviewImagePrompt(event.target.value)}
                                placeholder="Refine visual scene, then regenerate."
                              />
                            </label>
                            <div className="button-row">
                              <button className="ghost" type="button" onClick={handleRegenerateReviewImage} disabled={isBusy}>
                                Regenerate Image
                              </button>
                              <button className="ghost" type="button" onClick={() => setReviewEditing(true)} disabled={isBusy}>
                                Edit
                              </button>
                              <button className="primary" onClick={() => handleReview(activeReview.cycleId, activeReview.item.id, "APPROVE", activeReview.pageId)} disabled={isBusy}>
                                Approve
                              </button>
                              <button className="ghost" onClick={() => handleReview(activeReview.cycleId, activeReview.item.id, "REJECT", activeReview.pageId)} disabled={isBusy}>
                                Reject
                              </button>
                            </div>
                          </div>

                          <article className="fb-preview">
                            <header className="fb-preview-head">
                              <div className={`page-avatar page-avatar-mini ${selectedProfile?.avatarUrl ? "has-image" : ""}`} style={selectedProfile?.avatarUrl ? undefined : pageAvatarStyle(selectedProfile?.pageId ?? "preview-page")}>
                                {selectedProfile?.avatarUrl ? (
                                  <img src={selectedProfile.avatarUrl} alt={`${pageDisplayName(selectedProfile)} avatar`} loading="lazy" decoding="async" />
                                ) : (
                                  pageAvatarLabel(pageDisplayName(selectedProfile) || "preview-page")
                                )}
                              </div>
                              <div>
                                <p className="fb-preview-name">{pageDisplayName(selectedProfile)}</p>
                                <p className="fb-preview-meta">ID {selectedProfile?.pageId ?? "-"} · Preview · Not published</p>
                              </div>
                            </header>
                            <div className="fb-preview-body">
                              <p className="fb-preview-title">{reviewPreviewTitle || "Untitled draft"}</p>
                              <p className="fb-preview-text">{reviewPreviewBody || "Start typing to preview post text..."}</p>
                              {reviewPreviewImage ? (
                                <div className="fb-preview-image-wrap" style={{ position: "relative", overflow: "hidden" }}>
                                  <img src={reviewPreviewImage} alt="Draft generated preview" className="fb-preview-image" loading="lazy" decoding="async" style={{ opacity: isBusy ? 0.4 : 1, transition: "opacity 300ms ease" }} />
                                  {isBusy ? (
                                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: "var(--bg-surface)", overflow: "hidden" }}>
                                      <div style={{ width: "40%", height: "100%", background: "var(--accent)", borderRadius: 2, animation: "regen-slide 1.2s ease-in-out infinite" }} />
                                    </div>
                                  ) : null}
                                  <button
                                    type="button"
                                    onClick={handleRegenerateReviewImage}
                                    disabled={isBusy}
                                    title="Regenerate image"
                                    style={{ position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,0.5)", border: "none", borderRadius: 8, padding: 6, cursor: isBusy ? "wait" : "pointer", display: "flex", backdropFilter: "blur(8px)", opacity: isBusy ? 0.3 : 0.7, transition: "opacity 200ms" }}
                                    onMouseEnter={(e) => { if (!isBusy) e.currentTarget.style.opacity = "1"; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.opacity = isBusy ? "0.3" : "0.7"; }}
                                  >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/></svg>
                                  </button>
                                </div>
                              ) : null}
                              {reviewPreviewMediaType === "VIDEO" ? (
                                <div className="fb-preview-media">
                                  {reviewPreviewVideo ? (
                                    <video className="fb-preview-video" src={reviewPreviewVideo} controls playsInline preload="metadata" />
                                  ) : (
                                    <p className="muted">No video preview yet. Switch to Edit and save as Video post to auto-generate with Kling.</p>
                                  )}
                                  <span>Media prompt</span>
                                  <p>{reviewPreviewMediaPrompt || "No media prompt yet."}</p>
                                </div>
                              ) : null}
                            </div>
                          </article>
                        </div>
                      )}
                      <p className="muted">{queue.length} item(s) in queue</p>
                    </div>
                  ) : (
                    <div className="empty-state">
                      <p>No drafts to review.</p>
                      <span>Run Today to generate new items.</span>
                    </div>
                  )}
                </section>
                </>
              ) : null}

              {guidedWorkspace === "PUBLISH" ? (
                <section className="workspace-panel">
                  <div className="row-between">
                    <h3>Publish Queue</h3>
                    <p className="muted">Push approved content to Facebook.</p>
                  </div>
                  <button className="primary" onClick={handleRunWorker} disabled={!selectedProfile || isBusy}>
                    Publish Approved Posts
                  </button>
                  {latestCycle?.simulate && publishStats.pending === 0 ? (
                    <div className="tip-card tip-warning">
                      <svg className="tip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                      <span>Latest cycle was preview-only — no publish jobs yet. Turn Preview OFF and run again to publish.</span>
                    </div>
                  ) : null}
                  <div className="metric-grid">
                    <div className="metric-card">
                      <span>Pending</span>
                      <strong>{publishStats.pending}</strong>
                    </div>
                    <div className="metric-card">
                      <span>Done</span>
                      <strong>{publishStats.done}</strong>
                    </div>
                    <div className="metric-card">
                      <span>Failed</span>
                      <strong>{publishStats.failed}</strong>
                    </div>
                  </div>
                  {publishJobs.length > 0 ? (
                    <div className="job-list">
                      {publishJobs.slice(0, 5).map((job) => (
                        <div key={job.id} className="patch-item">
                          <div className="row-between">
                            <strong>{job.status}</strong>
                            <span className="muted">{job.attempts}/{job.maxAttempts}</span>
                          </div>
                          <p className="muted">next: {formatDate(job.nextRunAt)}</p>
                          {job.lastError ? <p className="error-text">{job.lastError}</p> : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </section>
              ) : null}

              {false && (guidedWorkspace as string) === "ANALYTICS" ? (
                <section className="workspace-panel">
                  <div className="row-between">
                    <h3>Analytics</h3>
                    <button
                      className="ghost inline-small"
                      type="button"
                      disabled={isBusy}
                      onClick={async () => {
                        if (!selectedProfile) return;
                        setIsBusy(true);
                        try {
                          setAnalytics(await api.getAnalytics(selectedProfile.pageId));
                          setStatusText("Analytics loaded");
                        } catch (error) { setStatusText(`Analytics failed: ${errorMessage(error)}`); }
                        finally { setIsBusy(false); }
                      }}
                    >
                      Refresh
                    </button>
                  </div>

                  {!analytics ? (
                    <div className="empty-state">
                      <p>Loading analytics...</p>
                      <button className="primary inline-small" type="button" disabled={isBusy} onClick={async () => {
                        if (!selectedProfile) return;
                        setIsBusy(true);
                        try { setAnalytics(await api.getAnalytics(selectedProfile.pageId)); } catch {} finally { setIsBusy(false); }
                      }}>Load Analytics</button>
                    </div>
                  ) : (
                    <>
                      {/* Content Overview */}
                      <div className="metric-grid">
                        <div className="metric-card">
                          <span>Total content</span>
                          <strong>{analytics!.content.total}</strong>
                        </div>
                        <div className="metric-card">
                          <span>Published</span>
                          <strong style={{ color: "var(--success)" }}>{analytics!.content.published}</strong>
                        </div>
                        <div className="metric-card">
                          <span>Approval rate</span>
                          <strong style={{ color: analytics!.approvalRate >= 70 ? "var(--success)" : analytics!.approvalRate >= 40 ? "var(--warning)" : "var(--danger)" }}>{analytics!.approvalRate}%</strong>
                        </div>
                        <div className="metric-card">
                          <span>Cycles run</span>
                          <strong>{analytics!.cycles.total}</strong>
                        </div>
                      </div>

                      {/* Content Breakdown */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <div className="metric-card">
                          <span>Posts</span>
                          <strong>{analytics!.content.posts}</strong>
                        </div>
                        <div className="metric-card">
                          <span>Reels</span>
                          <strong>{analytics!.content.reels}</strong>
                        </div>
                      </div>

                      {/* Status Distribution */}
                      <div style={{ padding: 16, background: "var(--bg-raised)", borderRadius: 12, border: "1px solid var(--border)" }}>
                        <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 10 }}>Content pipeline</p>
                        <div style={{ display: "flex", gap: 4, height: 8, borderRadius: 4, overflow: "hidden", background: "var(--bg-surface)" }}>
                          {analytics!.content.published > 0 && <div style={{ flex: analytics!.content.published, background: "var(--success)", borderRadius: 4 }} title={`Published: ${analytics!.content.published}`} />}
                          {analytics!.content.approved > 0 && <div style={{ flex: analytics!.content.approved - analytics!.content.published, background: "var(--accent)", borderRadius: 4 }} title={`Approved: ${analytics!.content.approved - analytics!.content.published}`} />}
                          {analytics!.content.waiting > 0 && <div style={{ flex: analytics!.content.waiting, background: "var(--warning)", borderRadius: 4 }} title={`Waiting: ${analytics!.content.waiting}`} />}
                          {analytics!.content.rejected > 0 && <div style={{ flex: analytics!.content.rejected, background: "var(--danger)", borderRadius: 4 }} title={`Rejected: ${analytics!.content.rejected}`} />}
                        </div>
                        <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 11, color: "var(--text-muted)" }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--success)" }} />Published {analytics!.content.published}</span>
                          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--warning)" }} />Waiting {analytics!.content.waiting}</span>
                          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--danger)" }} />Rejected {analytics!.content.rejected}</span>
                        </div>
                      </div>

                      {/* Estimated Costs */}
                      <div style={{ padding: 16, background: "var(--bg-raised)", borderRadius: 12, border: "1px solid var(--border)" }}>
                        <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 10 }}>Estimated API costs</p>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                          <span style={{ fontSize: 28, fontWeight: 700, fontFamily: "var(--font-display)", color: "var(--text)", letterSpacing: "-0.03em" }}>${analytics!.estimatedCosts.total.toFixed(2)}</span>
                          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>total estimated</span>
                        </div>
                        <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 12, color: "var(--text-secondary)" }}>
                          <span>Text: ${analytics!.estimatedCosts.openai.toFixed(3)}</span>
                          <span>Images: ${analytics!.estimatedCosts.gemini.toFixed(3)}</span>
                          <span>Video: ${analytics!.estimatedCosts.fal.toFixed(3)}</span>
                        </div>
                      </div>

                      {/* Recent Cycles */}
                      {analytics!.cycles.recent.length > 0 ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Recent cycles</p>
                          {analytics!.cycles.recent.map((c) => (
                            <div key={c.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "var(--bg-raised)", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }}>
                              <span style={{ color: "var(--text-secondary)" }}>{formatDateCompact(c.date)}</span>
                              <span>{c.items} items</span>
                              <span style={{ color: "var(--success)" }}>{c.published} published</span>
                              <span className={badgeClass(c.status)}>{c.status}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {/* Publishing */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <div className="metric-card">
                          <span>Publish success</span>
                          <strong style={{ color: "var(--success)" }}>{analytics!.publishing.succeeded}</strong>
                        </div>
                        <div className="metric-card">
                          <span>Publish failed</span>
                          <strong style={{ color: analytics!.publishing.failed > 0 ? "var(--danger)" : "var(--text)" }}>{analytics!.publishing.failed}</strong>
                        </div>
                      </div>
                    </>
                  )}
                </section>
              ) : null}

              {false ? (
                <section className="workspace-panel">
                  <div className="row-between">
                    <h3>Reel Producer</h3>
                    <p className="muted">Create multi-scene montage reels for {selectedProfile ? pageDisplayName(selectedProfile) : "this page"}.</p>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                    <div className="metric-card">
                      <span>Scenes per Reel</span>
                      <strong>5–10</strong>
                    </div>
                    <div className="metric-card">
                      <span>Duration</span>
                      <strong>10–45s</strong>
                    </div>
                  </div>

                  <div style={{ padding: 16, background: "var(--bg-surface)", borderRadius: 12, border: "1px solid var(--border)", marginBottom: 16 }}>
                    <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7, margin: 0 }}>
                      <strong style={{ color: "var(--text)" }}>How it works:</strong> SmmBrain writes a scene-by-scene script from your content.
                      Each scene gets a photo (Gemini) matching your page persona, optionally animated (Kling).
                      FFmpeg assembles everything with text overlays, music, and optional AI voiceover.
                    </p>
                  </div>

                  <div className="button-row">
                    <button
                      className="primary"
                      type="button"
                      disabled={!selectedProfile || isBusy}
                      onClick={async () => {
                        if (!selectedProfile) return;
                        setIsBusy(true);
                        setStatusText("Generating reel...");
                        try {
                          const cycle = await api.runCycle({
                            pageId: selectedProfile.pageId,
                            autonomyProfileId: selectedProfile.id,
                            simulate
                          });
                          setLatestCycle(cycle);
                          await Promise.all([
                            refreshCycles(selectedProfile.pageId),
                            refreshPageContext(selectedProfile.pageId)
                          ]);
                          setStatusText(`Reel generated (cycle ${cycle.id.slice(0, 8)})`);
                          setGuidedWorkspace("REVIEW");
                        } catch (error) {
                          setStatusText(`Reel generation failed: ${errorMessage(error)}`);
                        } finally {
                          setIsBusy(false);
                        }
                      }}
                    >
                      {isBusy ? "Generating..." : "Generate Reel"}
                    </button>
                  </div>

                  <div style={{ marginTop: 20, padding: "12px 16px", background: "var(--bg-surface)", borderRadius: 8, border: "1px solid var(--border)" }}>
                    <p className="muted" style={{ fontSize: 11, margin: 0 }}>
                      Enable <code style={{ color: "var(--accent)" }}>REEL_PRODUCER_ENABLED=true</code> in .env for multi-scene montage with FFmpeg.
                      Without it, reels use the standard single-clip Kling path. Requires FFmpeg installed on the server.
                    </p>
                  </div>
                </section>
              ) : null}

              {guidedWorkspace === "SETTINGS" ? (
                <section className="workspace-panel">
                  <div className="row-between">
                    <div>
                      <h3>Page Settings</h3>
                      <p className="muted">Check system readiness first. Open full profile editor only when you need to change settings.</p>
                    </div>
                    <div className="button-row">
                      <button className="ghost inline-small" onClick={handleVerifyMetaConnection} disabled={isBusy || isMetaChecking}>
                        {isMetaChecking ? "Checking..." : "Check Meta"}
                      </button>
                      <button
                        className="ghost inline-small"
                        type="button"
                        onClick={() => {
                          void refreshContentStatus();
                        }}
                        disabled={isBusy}
                      >
                        Refresh AI
                      </button>
                    </div>
                  </div>

                  <div className="status-chip-grid">
                    <article className="status-chip">
                      <span>Meta</span>
                      <strong>{metaStatus?.mode ? metaStatus.mode.toUpperCase() : "UNKNOWN"}</strong>
                      <span className={badgeClass(metaStatus?.ready ? "COMPLETED" : "FAILED")}>
                        {metaStatus?.ready ? "READY" : "SETUP NEEDED"}
                      </span>
                    </article>
                    <article className="status-chip">
                      <span>Copy Engine</span>
                      <strong>{contentStatus?.mode ?? "UNKNOWN"}</strong>
                      <span className={badgeClass(contentStatus?.ready ? "COMPLETED" : "WAITING_REVIEW")}>
                        {contentStatus?.ready ? "READY" : "CHECK CONFIG"}
                      </span>
                    </article>
                    <article className="status-chip">
                      <span>Image Engine</span>
                      <strong>{imageStatus?.mode ?? "UNKNOWN"}</strong>
                      <span className={badgeClass(imageStatus?.ready ? "COMPLETED" : "WAITING_REVIEW")}>
                        {imageStatus?.ready ? "READY" : "CHECK CONFIG"}
                      </span>
                    </article>
                    <article className="status-chip">
                      <span>Kling Video</span>
                      <strong>{videoStatus?.mode ?? "UNKNOWN"}</strong>
                      <span className={badgeClass(videoStatus?.ready ? "COMPLETED" : "WAITING_REVIEW")}>
                        {videoStatus?.ready ? "READY" : "CHECK CONFIG"}
                      </span>
                    </article>
                  </div>

                  {metaVerify ? (
                    <p className={`smart-run-line ${metaVerify.ok ? "ok" : "bad"}`}>
                      {metaVerify.ok ? `Connected${metaVerify.pageName ? `: ${metaVerify.pageName}` : ""}` : metaVerify.message}
                    </p>
                  ) : null}

                  {/* ---- Connect Facebook Section ---- */}
                  <div className="advanced-mini">
                    <div className="row-between">
                      <h4>Connect Facebook Page</h4>
                      <button className="ghost inline-small" type="button" onClick={() => { setShowMetaConnect((s) => !s); setConnectStep(1); setConnectResult(null); }}>
                        {showMetaConnect ? "Close" : metaStatus?.ready ? "Reconnect" : "Connect"}
                      </button>
                    </div>

                    {!showMetaConnect && metaStatus?.ready ? (
                      <p style={{ fontSize: 13, color: "var(--success)" }}>
                        Page connected and ready to publish.
                      </p>
                    ) : !showMetaConnect ? (
                      <p className="muted">Not connected yet. Click Connect to set up publishing to Facebook.</p>
                    ) : null}

                    {showMetaConnect ? (
                      <div className="stack-form">
                        {/* Step 1: Paste page link */}
                        <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                          {[1, 2, 3].map((s) => (
                            <span
                              key={s}
                              style={{
                                width: 28, height: 28, borderRadius: "50%",
                                display: "flex", alignItems: "center", justifyContent: "center",
                                fontSize: 12, fontWeight: 700,
                                background: connectStep >= s ? "var(--accent)" : "var(--bg-surface)",
                                color: connectStep >= s ? "var(--text-inverse)" : "var(--text-muted)",
                                border: `1px solid ${connectStep >= s ? "var(--accent)" : "var(--border)"}`,
                                transition: "all 180ms ease"
                              }}
                            >{s}</span>
                          ))}
                        </div>

                        {connectStep === 1 ? (
                          <>
                            <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                              Paste a link to your Facebook page or just the Page ID:
                            </p>
                            <label>
                              Facebook Page link or ID
                              <input
                                value={connectPageUrl}
                                onChange={(e) => setConnectPageUrl(e.target.value)}
                                placeholder="e.g. https://facebook.com/YourPage or 123456789"
                              />
                              <span className="field-hint">
                                Works with any format: full URL, facebook.com/pagename, or numeric ID
                              </span>
                            </label>
                            {connectPageUrl.trim() ? (
                              <p className="muted" style={{ fontSize: 12 }}>
                                Detected Page ID: <strong style={{ color: "var(--accent)" }}>{extractPageIdFromUrl(connectPageUrl)}</strong>
                              </p>
                            ) : null}
                            <button
                              className="primary"
                              type="button"
                              onClick={() => {
                                if (!connectPageUrl.trim()) return;
                                const pageId = extractPageIdFromUrl(connectPageUrl);
                                if (selectedProfile && pageId !== selectedProfile.pageId) {
                                  void api.patchProfile(selectedProfile.id, { pageId } as any).catch(() => {});
                                }
                                setConnectStep(2);
                              }}
                              disabled={!connectPageUrl.trim()}
                            >
                              Next: Get Token
                            </button>
                          </>
                        ) : null}

                        {connectStep === 2 ? (
                          <>
                            <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7 }}>
                              Open the link below, select your page, and click <strong style={{ color: "var(--text)" }}>"Generate Access Token"</strong>:
                            </p>
                            <a
                              href="https://developers.facebook.com/tools/explorer/?permissions=pages_manage_posts,pages_read_engagement,pages_show_list"
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                                padding: "12px 20px", background: "var(--bg-surface)", border: "1px solid var(--border-accent)",
                                borderRadius: 12, fontWeight: 600, fontSize: 13, textDecoration: "none",
                                color: "var(--accent)", transition: "all 180ms ease"
                              }}
                            >
                              Open Graph API Explorer
                              <span style={{ fontSize: 16 }}>&#8599;</span>
                            </a>
                            <p className="muted" style={{ fontSize: 11, lineHeight: 1.6 }}>
                              1. Choose your Facebook App (or create one at developers.facebook.com)<br />
                              2. Select your page in the dropdown<br />
                              3. Permissions are already pre-selected — just click "Generate Access Token"<br />
                              4. Copy the token and go to the next step
                            </p>
                            <div className="button-row">
                              <button className="ghost" type="button" onClick={() => setConnectStep(1)}>Back</button>
                              <button className="primary" type="button" onClick={() => setConnectStep(3)}>
                                I have the token
                              </button>
                            </div>
                          </>
                        ) : null}

                        {connectStep === 3 ? (
                          <>
                            <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                              Paste the token and connect. We'll verify it immediately.
                            </p>
                            <label>
                              Page Access Token
                              <input
                                type="password"
                                value={connectToken}
                                onChange={(e) => setConnectToken(e.target.value)}
                                placeholder="Paste your token here"
                                autoFocus
                              />
                            </label>
                            <div className="button-row">
                              <button className="ghost" type="button" onClick={() => setConnectStep(2)}>Back</button>
                              <button className="primary" type="button" onClick={handleConnectMeta} disabled={isBusy || !connectToken.trim()}>
                                {isBusy ? "Connecting..." : "Connect Page"}
                              </button>
                            </div>
                            {connectResult ? (
                              <p className={`smart-run-line ${connectResult.ok ? "ok" : "bad"}`}>{connectResult.message}</p>
                            ) : null}
                          </>
                        ) : null}

                        {metaStatus?.ready && !connectResult ? (
                          <button className="ghost inline-small" type="button" onClick={handleDisconnectMeta} disabled={isBusy} style={{ alignSelf: "flex-start" }}>
                            Disconnect current page
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div className="button-row">
                    <button
                      className="ghost inline-small"
                      type="button"
                      onClick={() => setShowSystemDetails((state) => !state)}
                    >
                      {showSystemDetails ? "Hide system details" : "Show system details"}
                    </button>
                    <button
                      className="ghost inline-small"
                      type="button"
                      onClick={() => setShowWorkspaceProfileEditor((state) => !state)}
                    >
                      {showWorkspaceProfileEditor ? "Hide profile editor" : "Edit page profile"}
                    </button>
                  </div>

                  {showSystemDetails ? (
                    <div className="system-detail-grid">
                      <div className="integration-card">
                        <div className="row-between">
                          <strong>Meta Integration</strong>
                          <span className={badgeClass(metaStatus?.ready ? "COMPLETED" : "FAILED")}>
                            {metaStatus?.mode ? metaStatus.mode.toUpperCase() : "UNKNOWN"}
                          </span>
                        </div>
                        <p className="muted">
                          Token source: {metaStatus?.tokenSource ?? "NONE"} · Reel URL default: {metaStatus?.hasDefaultReelFileUrl ? "YES" : "NO"}
                        </p>
                        <p className="muted">Video posts in Video mode are sent to both Feed and Reels.</p>
                        {(metaStatus?.warnings ?? []).slice(0, 3).map((warning) => (
                          <p key={warning} className="warning-text">{warning}</p>
                        ))}
                      </div>

                      <div className="integration-card">
                        <div className="row-between">
                          <strong>AI Content Engine</strong>
                          <span className={badgeClass(contentStatus?.ready ? "COMPLETED" : "WAITING_REVIEW")}>
                            {contentStatus?.mode ?? "UNKNOWN"}
                          </span>
                        </div>
                        <p className="muted">
                          Model: {contentStatus?.model ?? "-"} · Language: {contentStatus?.language ?? "-"} · Research:{" "}
                          {contentStatus?.webResearchSource ?? "-"}
                        </p>
                        {(contentStatus?.warnings ?? []).slice(0, 3).map((warning) => (
                          <p key={warning} className="warning-text">{warning}</p>
                        ))}
                      </div>

                      <div className="integration-card">
                        <div className="row-between">
                          <strong>Persona Image Engine</strong>
                          <span className={badgeClass(imageStatus?.ready ? "COMPLETED" : "WAITING_REVIEW")}>
                            {imageStatus?.mode ?? "UNKNOWN"}
                          </span>
                        </div>
                        <p className="muted">
                          Model: {imageStatus?.model ?? "-"} · Output: native lifestyle image preview per draft.
                        </p>
                        {(imageStatus?.warnings ?? []).slice(0, 3).map((warning) => (
                          <p key={warning} className="warning-text">{warning}</p>
                        ))}
                      </div>

                      <div className="integration-card">
                        <div className="row-between">
                          <strong>Kling Video Engine</strong>
                          <span className={badgeClass(videoStatus?.ready ? "COMPLETED" : "WAITING_REVIEW")}>
                            {videoStatus?.mode ?? "UNKNOWN"}
                          </span>
                        </div>
                        <p className="muted">
                          Model: {videoStatus?.model ?? "-"} · Output: 9:16 motion video from generated lifestyle image.
                        </p>
                        {(videoStatus?.warnings ?? []).slice(0, 3).map((warning) => (
                          <p key={warning} className="warning-text">{warning}</p>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {showWorkspaceProfileEditor ? (
                  <form className="advanced-mini" onSubmit={handleUpdateSelectedPageConfig}>
                    <div className="avatar-editor">
                      <label className="avatar-preview avatar-preview-clickable">
                        {newAvatarUrl ? (
                          <img src={newAvatarUrl} alt="Page avatar preview" loading="lazy" decoding="async" />
                        ) : (
                          <div className="page-avatar avatar-fallback" style={pageAvatarStyle(selectedProfile.pageId)}>
                            {pageAvatarLabel(pageDisplayName(selectedProfile))}
                          </div>
                        )}
                        <input
                          className="avatar-upload-input"
                          type="file"
                          accept="image/*"
                          aria-label="Upload avatar image"
                          onChange={handleAvatarSelected}
                        />
                        <span className="avatar-upload-hint">{newAvatarUrl ? "Change avatar" : "Upload avatar"}</span>
                      </label>
                      <p className="muted avatar-helper">Click avatar to upload image</p>
                      {newAvatarUrl ? (
                        <button className="ghost inline-small" type="button" onClick={clearAvatar}>
                          Remove Avatar
                        </button>
                      ) : null}
                    </div>

                    <label>
                      Page name
                      <input
                        value={newPageName}
                        onChange={(event) => setNewPageName(event.target.value)}
                        placeholder="My Trading Page"
                      />
                    </label>

                    <section className="persona-editor-block">
                      <div className="row-between">
                        <h4>Persona Engine</h4>
                        <span className={badgeClass(newPersonaMode === "FROM_REFERENCES" ? "COMPLETED" : "WAITING_REVIEW")}>
                          {newPersonaMode === "FROM_REFERENCES" ? "Photo-learned" : "From scratch"}
                        </span>
                      </div>
                      <label>
                        Persona mode
                        <select
                          value={newPersonaMode}
                          onChange={(event) => setNewPersonaMode(event.target.value as PersonaSourceMode)}
                        >
                          {PERSONA_MODE_OPTIONS.map((mode) => (
                            <option key={mode} value={mode}>
                              {mode === "FROM_REFERENCES" ? "Learn from existing photos" : "Create from scratch"}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Persona name
                        <input
                          value={newPersonaName}
                          onChange={(event) => setNewPersonaName(event.target.value)}
                          placeholder="Alex Carter"
                        />
                      </label>
                      <label>
                        Core description
                        <textarea
                          value={newPersonaCoreDescription}
                          onChange={(event) => setNewPersonaCoreDescription(event.target.value)}
                          placeholder="Smart casual style, natural smile, consistent face proportions."
                        />
                      </label>
                      <label>
                        Lifestyle scenes (comma separated)
                        <input
                          value={newPersonaLifestyle}
                          onChange={(event) => setNewPersonaLifestyle(event.target.value)}
                          placeholder="morning patio coffee, neighborhood park stroll, weekend road trip stop"
                        />
                      </label>
                      <label className="inline-control">
                        <input
                          type="checkbox"
                          checked={newPersonaAutoImages}
                          onChange={(event) => setNewPersonaAutoImages(event.target.checked)}
                        />
                        Generate image previews for drafts
                      </label>

                      <div className="persona-upload-row">
                        <label className="ghost inline-small persona-upload-trigger">
                          Upload reference faces
                          <input
                            className="avatar-upload-input"
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={handlePersonaReferencesSelected}
                          />
                        </label>
                        <span className="muted">{newPersonaReferenceImages.length}/14 image(s)</span>
                      </div>
                      {newPersonaReferenceImages.length > 0 ? (
                        <div className="persona-reference-grid">
                          {newPersonaReferenceImages.map((image, index) => (
                            <button
                              key={`${image.slice(0, 24)}-${index}`}
                              type="button"
                              className="persona-reference-item"
                              onClick={() => handleRemovePersonaReference(index)}
                              title="Click to remove"
                            >
                              <img src={image} alt={`Persona reference ${index + 1}`} loading="lazy" decoding="async" />
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="muted">No reference photos yet. Add 3+ images for stronger face consistency.</p>
                      )}
                    </section>

                    <label>
                      Autonomy level
                      <select value={newLevel} onChange={(event) => setNewLevel(event.target.value as AutonomyLevel)}>
                        {LEVEL_OPTIONS.map((level) => (
                          <option key={level} value={level}>
                            {level}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Policy mode
                      <select value={newPolicyMode} onChange={(event) => setNewPolicyMode(event.target.value as PolicyMode)}>
                        {POLICY_OPTIONS.map((mode) => (
                          <option key={mode} value={mode}>
                            {mode}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="form-3col">
                      <label>
                        Posts/day
                        <input type="number" min={0} max={20} value={newDailyPosts} onChange={(event) => setNewDailyPosts(Number(event.target.value))} />
                      </label>
                      <label>
                        Reels/day
                        <input type="number" min={0} max={20} value={newDailyReels} onChange={(event) => setNewDailyReels(Number(event.target.value))} />
                      </label>
                      <label>
                        Hourly cap
                        <input type="number" min={1} max={20} value={newHourlyPublishes} onChange={(event) => setNewHourlyPublishes(Number(event.target.value))} />
                      </label>
                    </div>
                    <label>
                      Risk threshold
                      <input type="number" min={0} max={100} value={newRiskThreshold} onChange={(event) => setNewRiskThreshold(Number(event.target.value))} />
                    </label>
                    <div className="button-row">
                      <button className="primary" type="submit" disabled={isBusy}>
                        Save Page Setup
                      </button>
                      <button className="ghost" type="button" onClick={applyRecommendedDefaults}>
                        Use Recommended
                      </button>
                    </div>
                  </form>
                  ) : null}

                  {false && (<div>{[
                        { key: "LIFESTYLE", label: "x" },
                        { key: "BEFORE_AFTER", label: "x" }
                      ].map(({ key: preset, label }) => {
                        const tracks = musicTracks.filter(t => t.presets.includes(preset));
                        return (
                          <div key={preset} style={{
                            background: "var(--bg-input)",
                            border: "1px solid var(--border)",
                            borderRadius: 12,
                            padding: 16,
                            display: "flex", flexDirection: "column", gap: 10
                          }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <strong style={{ fontSize: 13 }}>{label}</strong>
                              <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-muted)", background: "var(--bg-surface)", padding: "2px 8px", borderRadius: 99 }}>
                                {tracks.length} {tracks.length === 1 ? "track" : "tracks"}
                              </span>
                            </div>

                            {tracks.length > 0 && (
                              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                {tracks.map(track => (
                                  <div key={track.id} style={{
                                    display: "flex", alignItems: "center", gap: 8,
                                    padding: "8px 10px",
                                    background: "var(--bg-surface)",
                                    borderRadius: 8,
                                    border: "1px solid var(--border)"
                                  }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <p style={{ fontSize: 12, margin: 0, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{track.name}</p>
                                      <p style={{ fontSize: 10, margin: "2px 0 0", color: "var(--text-muted)" }}>{(track.fileSizeBytes / 1024 / 1024).toFixed(1)} MB</p>
                                    </div>
                                    <audio src={api.getMusicTrackAudioUrl(track.id)} controls style={{ height: 28, width: 140, flexShrink: 0 }} />
                                    <button
                                      type="button"
                                      title="Remove track"
                                      style={{
                                        background: "transparent", border: "none", cursor: "pointer",
                                        padding: 4, display: "flex", opacity: 0.4, transition: "opacity 150ms"
                                      }}
                                      onMouseEnter={e => { e.currentTarget.style.opacity = "1"; }}
                                      onMouseLeave={e => { e.currentTarget.style.opacity = "0.4"; }}
                                      onClick={async () => {
                                        await api.deleteMusicTrack(track.id);
                                        setMusicTracks(prev => prev.filter(t => t.id !== track.id));
                                        setStatusText("Track removed");
                                      }}
                                    >
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}

                            <label style={{
                              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                              padding: "10px 0",
                              border: "1.5px dashed var(--border)",
                              borderRadius: 8,
                              cursor: isMusicUploading ? "wait" : "pointer",
                              fontSize: 12,
                              color: "var(--accent)",
                              transition: "all 150ms",
                              background: "transparent"
                            }}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                              {isMusicUploading ? "Uploading..." : "Drop or click to upload MP3"}
                              <input
                                type="file"
                                accept="audio/mpeg,audio/mp3"
                                style={{ display: "none" }}
                                disabled={isMusicUploading}
                                onChange={async (e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  setIsMusicUploading(true);
                                  try {
                                    const reader = new FileReader();
                                    const dataBase64 = await new Promise<string>((resolve) => {
                                      reader.onload = () => {
                                        const result = reader.result as string;
                                        resolve(result.split(",")[1] ?? "");
                                      };
                                      reader.readAsDataURL(file);
                                    });
                                    const track = await api.uploadMusicTrack({
                                      name: file.name.replace(/\.mp3$/i, ""),
                                      presets: [preset],
                                      category: preset === "BEFORE_AFTER" ? "inspiring" : "calm",
                                      dataBase64
                                    });
                                    setMusicTracks(prev => [track, ...prev]);
                                    setStatusText(`"${track.name}" added to ${label}`);
                                  } catch (err) { setStatusText(`Upload failed: ${errorMessage(err)}`); }
                                  finally { setIsMusicUploading(false); e.target.value = ""; }
                                }}
                              />
                            </label>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              ) : null}
            </>
          ) : null}
            </div>
          ) : null}
        </section>
      ) : route.kind === "ANALYTICS" ? (
        <section style={{ padding: "24px 32px", display: "flex", flexDirection: "column", gap: 20 }}>
          <div className="row-between">
            <div>
              <h2>Analytics</h2>
              <p className="muted">{selectedProfile ? `Page: ${pageDisplayName(selectedProfile)}` : "Select a page to view analytics"}</p>
            </div>
            {selectedProfile ? (
              <div className="button-row">
                <label className="page-picker-inline">
                  <select value={selectedProfileId} onChange={(event) => {
                    setSelectedProfileId(event.target.value);
                    const p = profiles.find(pr => pr.id === event.target.value);
                    if (p) void api.getAnalytics(p.pageId).then(setAnalytics).catch(() => {});
                  }}>
                    {profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>{pageDisplayName(profile)}</option>
                    ))}
                  </select>
                </label>
                <button className="ghost inline-small" type="button" disabled={isBusy} onClick={async () => {
                  if (!selectedProfile) return;
                  setIsBusy(true);
                  try { setAnalytics(await api.getAnalytics(selectedProfile.pageId)); setStatusText("Analytics refreshed"); }
                  catch (e) { setStatusText(`Failed: ${errorMessage(e)}`); }
                  finally { setIsBusy(false); }
                }}>Refresh</button>
              </div>
            ) : null}
          </div>

          {!analytics || !selectedProfile ? (
            <div className="empty-state"><p>Select a page to view analytics.</p></div>
          ) : (
            <>
              {/* Top metrics row */}
              <div className="metric-grid" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
                <div className="metric-card">
                  <span>Total content</span>
                  <strong>{analytics.content.total}</strong>
                </div>
                <div className="metric-card">
                  <span>Published</span>
                  <strong style={{ color: "var(--success)" }}>{analytics.content.published}</strong>
                </div>
                <div className="metric-card">
                  <span>Approval rate</span>
                  <strong style={{ color: analytics.approvalRate >= 70 ? "var(--success)" : analytics.approvalRate >= 40 ? "var(--warning)" : "var(--danger)" }}>{analytics.approvalRate}%</strong>
                </div>
                <div className="metric-card">
                  <span>Cycles</span>
                  <strong>{analytics.cycles.total}</strong>
                </div>
                <div className="metric-card">
                  <span>API cost</span>
                  <strong>${analytics.estimatedCosts.total.toFixed(2)}</strong>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {/* Content Pipeline Chart */}
                <div style={{ padding: 20, background: "var(--bg-raised)", borderRadius: 16, border: "1px solid var(--border)" }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 16 }}>Content Pipeline</p>
                  <div style={{ display: "flex", gap: 4, height: 12, borderRadius: 6, overflow: "hidden", background: "var(--bg-surface)" }}>
                    {analytics.content.published > 0 && <div style={{ flex: analytics.content.published, background: "var(--success)", borderRadius: 6 }} />}
                    {(analytics.content.approved - analytics.content.published) > 0 && <div style={{ flex: analytics.content.approved - analytics.content.published, background: "var(--accent)", borderRadius: 6 }} />}
                    {analytics.content.waiting > 0 && <div style={{ flex: analytics.content.waiting, background: "var(--warning)", borderRadius: 6 }} />}
                    {analytics.content.rejected > 0 && <div style={{ flex: analytics.content.rejected, background: "var(--danger)", borderRadius: 6 }} />}
                  </div>
                  <div style={{ display: "flex", gap: 16, marginTop: 12, fontSize: 11, color: "var(--text-muted)", flexWrap: "wrap" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--success)" }} />Published {analytics.content.published}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--warning)" }} />Waiting {analytics.content.waiting}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--danger)" }} />Rejected {analytics.content.rejected}</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 16 }}>
                    <div style={{ padding: "10px 12px", background: "var(--bg-surface)", borderRadius: 8 }}>
                      <span style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase" }}>Posts</span>
                      <p style={{ fontSize: 20, fontWeight: 700, fontFamily: "var(--font-display)" }}>{analytics.content.posts}</p>
                    </div>
                    <div style={{ padding: "10px 12px", background: "var(--bg-surface)", borderRadius: 8 }}>
                      <span style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase" }}>Reels</span>
                      <p style={{ fontSize: 20, fontWeight: 700, fontFamily: "var(--font-display)" }}>{analytics.content.reels}</p>
                    </div>
                  </div>
                </div>

                {/* Cost Breakdown */}
                <div style={{ padding: 20, background: "var(--bg-raised)", borderRadius: 16, border: "1px solid var(--border)" }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 16 }}>Cost Breakdown</p>
                  <p style={{ fontSize: 36, fontWeight: 700, fontFamily: "var(--font-display)", letterSpacing: "-0.03em", color: "var(--text)" }}>${analytics.estimatedCosts.total.toFixed(2)}</p>
                  <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 16 }}>estimated total API spend</p>
                  {/* Mini bar chart for costs */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {[
                      { label: "Text (OpenAI)", value: analytics.estimatedCosts.openai, color: "var(--accent)" },
                      { label: "Images (Gemini)", value: analytics.estimatedCosts.gemini, color: "var(--success)" },
                      { label: "Video (FAL)", value: analytics.estimatedCosts.fal, color: "var(--warning)" }
                    ].map((row) => {
                      const maxVal = Math.max(analytics.estimatedCosts.openai, analytics.estimatedCosts.gemini, analytics.estimatedCosts.fal, 0.001);
                      return (
                        <div key={row.label}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-muted)", marginBottom: 3 }}>
                            <span>{row.label}</span>
                            <span>${row.value.toFixed(3)}</span>
                          </div>
                          <div style={{ height: 6, borderRadius: 3, background: "var(--bg-surface)", overflow: "hidden" }}>
                            <div style={{ width: `${Math.max((row.value / maxVal) * 100, 2)}%`, height: "100%", background: row.color, borderRadius: 3, transition: "width 500ms ease" }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Cycle History Chart */}
              {analytics.cycles.recent.length > 0 ? (
                <div style={{ padding: 20, background: "var(--bg-raised)", borderRadius: 16, border: "1px solid var(--border)" }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 16 }}>Recent Cycles</p>
                  {/* SVG Bar Chart */}
                  <div style={{ overflowX: "auto" }}>
                    <svg width="100%" height="140" viewBox={`0 0 ${analytics.cycles.recent.length * 80} 140`} style={{ minWidth: 300 }}>
                      {analytics.cycles.recent.slice().reverse().map((c, i) => {
                        const maxItems = Math.max(...analytics.cycles.recent.map(r => r.items), 1);
                        const barH = (c.items / maxItems) * 90;
                        const pubH = (c.published / maxItems) * 90;
                        const x = i * 80 + 10;
                        return (
                          <g key={c.id}>
                            <rect x={x} y={120 - barH} width={30} height={barH} rx={4} fill="var(--bg-surface)" stroke="var(--border)" strokeWidth={1} />
                            <rect x={x} y={120 - pubH} width={30} height={pubH} rx={4} fill="var(--accent)" opacity={0.7} />
                            <text x={x + 15} y={135} textAnchor="middle" fill="var(--text-muted)" fontSize={9}>{formatDateCompact(c.date)}</text>
                            <text x={x + 15} y={115 - barH} textAnchor="middle" fill="var(--text-secondary)" fontSize={10}>{c.items}</text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                  <div style={{ display: "flex", gap: 16, fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--bg-surface)", border: "1px solid var(--border)" }} />Generated</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: "var(--accent)", opacity: 0.7 }} />Published</span>
                  </div>
                </div>
              ) : null}

              {/* Publishing Stats */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div style={{ padding: 20, background: "var(--bg-raised)", borderRadius: 16, border: "1px solid var(--border)", textAlign: "center" }}>
                  <p style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Publish Success</p>
                  <p style={{ fontSize: 36, fontWeight: 700, fontFamily: "var(--font-display)", color: "var(--success)", marginTop: 4 }}>{analytics.publishing.succeeded}</p>
                </div>
                <div style={{ padding: 20, background: "var(--bg-raised)", borderRadius: 16, border: "1px solid var(--border)", textAlign: "center" }}>
                  <p style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Publish Failed</p>
                  <p style={{ fontSize: 36, fontWeight: 700, fontFamily: "var(--font-display)", color: analytics.publishing.failed > 0 ? "var(--danger)" : "var(--text-muted)", marginTop: 4 }}>{analytics.publishing.failed}</p>
                </div>
              </div>
            </>
          )}
        </section>
      ) : (
        <div className="advanced-layout">
          <section className="panel glass">
            <h2>Latest Drafts</h2>
            {latestCycle?.contentItems?.length ? (
              <div className="draft-grid">
                {latestCycle.contentItems.map((item: any) => (
                  <article key={item.id} className="content-card">
                    <div className="row-between">
                      <strong>{item.title}</strong>
                      <span className={badgeClass(item.publishStatus)}>{item.publishStatus}</span>
                    </div>
                    <p className="muted">{item.vertical} · {item.format} · {item.route ?? "NO_ROUTE"}</p>
                    <p className="truncate-3">{item.body}</p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted">No drafts yet.</p>
            )}
          </section>

          <section className="panel glass">
            <h2>Review Queue</h2>
            {queue.length === 0 ? <p className="muted">Queue is empty.</p> : null}
            {queue.map((entry) => (
              <div key={entry.item.id} className="queue-item">
                <div className="row-between">
                  <strong>{entry.item.title}</strong>
                  <span className={badgeClass(entry.item.publishStatus)}>{entry.item.publishStatus}</span>
                </div>
                <p className="muted">{entry.item.vertical} · {entry.item.format}</p>
                <div className="button-row">
                  <button className="primary" onClick={() => handleReview(entry.cycleId, entry.item.id, "APPROVE", entry.pageId)} disabled={isBusy}>Approve</button>
                  <button className="ghost" onClick={() => handleReview(entry.cycleId, entry.item.id, "REJECT", entry.pageId)} disabled={isBusy}>Reject</button>
                </div>
              </div>
            ))}
          </section>

          <section className="panel glass">
            <h2>Publish Jobs</h2>
            <button className="primary" onClick={handleRunWorker} disabled={!selectedProfile || isBusy}>Run Worker</button>
            <div className="job-list">
              {publishJobs.slice(0, 10).map((job) => (
                <div key={job.id} className="patch-item">
                  <div className="row-between">
                    <strong>{job.status}</strong>
                    <span className="muted">{job.attempts}/{job.maxAttempts}</span>
                  </div>
                  <p className="muted">next: {formatDate(job.nextRunAt)}</p>
                  {job.lastError ? <p className="error-text">{job.lastError}</p> : null}
                </div>
              ))}
            </div>
          </section>

          <section className="panel glass">
            <h2>Learning + Memory</h2>
            {!memory ? <p className="muted">Select page to view memory.</p> : null}
            {memory ? (
              <>
                <p className="muted">Compliance signals: {memory.complianceSignals.length}</p>
                <p className="muted">Performance signals: {memory.performanceSignals.length}</p>
                <p className="muted">Reviewer feedback: {memory.reviewerFeedbackSignals.length}</p>
              </>
            ) : null}

            <form className="feedback-form" onSubmit={handleSubmitFeedback}>
              <textarea placeholder="Add feedback..." value={feedback} onChange={(event) => setFeedback(event.target.value)} />
              <button className="primary" disabled={!selectedProfile || !feedback.trim() || isBusy}>Save Feedback</button>
            </form>

            <button className="ghost" onClick={handleRunLearning} disabled={!selectedProfile || isBusy}>Run Learning</button>
            <div className="job-list">
              {patches.map((patch) => (
                <div key={patch.id} className="patch-item">
                  <div className="row-between">
                    <strong>{patch.patchType}</strong>
                    <span className={badgeClass(patch.safeToApply ? "COMPLETED" : "FAILED")}>{patch.safeToApply ? "SAFE" : "BLOCKED"}</span>
                  </div>
                  <p>{patch.summary}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="panel glass">
            <h2>Style Library</h2>
            {stylePacks.map((pack) => (
              <article key={pack.id} className="style-pack">
                <div className="row-between">
                  <strong>{pack.name}</strong>
                  <span className={badgeClass(pack.vertical)}>{pack.vertical}</span>
                </div>
                <p className="muted">Tone: {pack.rules.tone.join(", ")}</p>
                <ul className="refs">
                  {(styleCardsByPack.get(pack.id) ?? []).slice(0, 3).map((card) => (
                    <li key={card.id}>
                      <a href={card.url} target="_blank" rel="noreferrer">{card.platform}</a>
                      <span>{card.hookPatterns[0] ?? "reference"}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </section>

          <section className="panel glass">
            <h2>Audit Trail</h2>
            <div className="audit-list">
              {audits.slice(0, 20).map((event) => (
                <div key={event.id} className="audit-row">
                  <span>{event.entityType}</span>
                  <span>{event.action}</span>
                  <span>{event.actorType}</span>
                  <span>{formatDate(event.createdAt)}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthGate>
      <AppInner />
    </AuthGate>
  );
}
