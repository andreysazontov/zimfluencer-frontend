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
type GuidedWorkspace = "PAGE" | "GENERATE" | "REVIEW" | "PUBLISH";
type GuidedSection = "PAGES" | "WORKSPACE";
type PagesView = "GALLERY" | "EDITOR";
type PageSort = "UPDATED_DESC" | "UPDATED_ASC" | "NAME_ASC" | "NAME_DESC";
type AppRoute =
  | { kind: "PAGES" }
  | { kind: "WORKSPACE"; pageId?: string }
  | { kind: "ADVANCED" }
  | { kind: "ANALYTICS" };

const WORKSPACE_LABELS: Record<GuidedWorkspace, string> = {
  PAGE: "Settings",
  GENERATE: "Today",
  REVIEW: "Queue",
  PUBLISH: "Publish"
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
    "Tip: Smart Run handles research + copy + image generation. Video drafts in Video mode are generated autonomously via Kling."
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
  const [guidedWorkspace, setGuidedWorkspace] = useState<GuidedWorkspace>("PAGE");
  const [pagesView, setPagesView] = useState<PagesView>("GALLERY");
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [pageSearch, setPageSearch] = useState("");
  const [pageStatusFilter, setPageStatusFilter] = useState<"ALL" | "ENABLED" | "PAUSED">("ALL");
  const [pageSort, setPageSort] = useState<PageSort>("UPDATED_DESC");

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
    if (!selectedProfile) return "PAGE";
    if (queue.length > 0) return "REVIEW";
    if (publishStats.pending > 0) return "PUBLISH";
    return "GENERATE";
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
    const [queueData, patchData, memoryData, jobsData] = await Promise.all([
      api.listReviewQueue(pageId),
      api.listLearningPatches(pageId),
      api.getMemory(pageId),
      api.listPublishJobs(undefined, pageId)
    ]);
    if (requestId !== pageContextRefreshRequestRef.current) {
      return;
    }

    setQueue(queueData);
    setPatches(patchData);
    setMemory(memoryData);
    setPublishJobs(jobsData);
  }

  async function bootstrap() {
    setIsBusy(true);
    try {
      await Promise.all([refreshProfiles(), refreshStyles(), refreshAudits(), refreshCycles(), refreshMetaStatus(), refreshContentStatus()]);
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

    if (route.pageId) {
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
        await refreshProfiles();
        setSelectedProfileId(profile.id);
        setStatusText(`Page ${profile.pageId} updated`);
        setPagesView("GALLERY");
        setEditingProfileId(null);
      } else {
        const avatarPayload = newAvatarUrl.trim() ? newAvatarUrl.trim() : undefined;
        const resolvedPageId = newPageId.trim() ? extractPageIdFromUrl(newPageId) : `page-${Date.now()}`;
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
        await refreshProfiles();
        setSelectedProfileId(profile.id);
        setStatusText(`Page ${profile.pageId} created`);
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

  async function handleRunCycle() {
    if (!selectedProfile) {
      setStatusText("Select a page first");
      return;
    }

    navigate({ kind: "WORKSPACE", pageId: selectedProfile.pageId }, { replace: true });
    setGuidedWorkspace("GENERATE");
    setIsBusy(true);
    try {
      const cycle = await api.runCycle({
        pageId: selectedProfile.pageId,
        autonomyProfileId: selectedProfile.id,
        simulate
      });
      setLatestCycle(cycle);
      setSmartRunStatus("IDLE");
      setSmartRunSummary("Tip: Smart Run handles research + copy + image generation. Video drafts in Video mode are generated autonomously via Kling.");
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
      setSmartRunSummary("Meta integration is not ready. Check page token configuration first.");
      setStatusText("Smart run stopped: Meta config is incomplete");
      return;
    }

    setIsBusy(true);
    navigate({ kind: "WORKSPACE", pageId: selectedProfile.pageId }, { replace: true });
    setGuidedWorkspace("GENERATE");
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
    setGuidedWorkspace("PAGE");
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
      await refreshMetaStatus(selectedProfile.pageId);
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
      await refreshMetaStatus(selectedProfile.pageId);
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
              Pages
            </button>
            <button
              className={`menu-pill ${route.kind === "WORKSPACE" ? "active" : ""}`}
              onClick={() => navigate({ kind: "WORKSPACE", pageId: selectedProfile?.pageId })}
              disabled={!selectedProfile}
            >
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
              Analytics
            </button>
          </div>
          <span className={badgeClass(isBusy ? "RUNNING" : "COMPLETED")}>{isBusy ? "SYNCING" : "READY"}</span>
        </div>
      </header>

      {route.kind === "PAGES" || route.kind === "WORKSPACE" ? (
        <section className="panel glass focus-shell">
          <p className={`smart-run-line ${smartRunStatus === "FAILED" ? "bad" : smartRunStatus === "REVIEW" ? "warn" : smartRunStatus === "DONE" ? "ok" : ""}`} style={{ margin: "0 32px" }}>
            {statusText}
          </p>

          {route.kind === "PAGES" ? (
            <div className="pages-shell">
              <section className="workspace-panel pages-toolbar-panel">
                <div>
                  <h3>Pages Gallery</h3>
                  <p className="muted">Choose a page and open workspace. New Page and Edit open in a separate editor window.</p>
                </div>
                <div className="pages-toolbar-actions">
                  <button className="primary inline-small" type="button" onClick={startCreatingProfile}>
                    New Page
                  </button>
                </div>
              </section>

              <section className="workspace-panel">
                <div className="row-between">
                  <h3>Your Pages</h3>
                  <p className="muted">{sortedProfiles.length} of {profiles.length}</p>
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
                      <article key={profile.id} className={`page-card ${selectedProfileId === profile.id ? "selected" : ""}`}>
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
                        </div>

                        <div className="page-card-meta-inline">
                          <span>{profile.limits.dailyPosts} posts/day</span>
                          <span>{profile.limits.dailyReels} reels/day</span>
                          <span>{profile.limits.hourlyPublishes} hourly cap</span>
                          <span>{profile.persona?.mode === "FROM_REFERENCES" ? "persona: photo-trained" : "persona: from-scratch"}</span>
                        </div>

                        <div className="button-row page-card-actions">
                          <button className="primary" type="button" onClick={() => openWorkspaceForProfile(profile)}>
                            Open Workspace
                          </button>
                          <button className="ghost" type="button" onClick={() => startEditingProfile(profile)}>
                            Edit
                          </button>
                          <button className="ghost" type="button" onClick={() => handleToggleEnabled(profile)} disabled={isBusy}>
                            {profile.enabled ? "Pause" : "Enable"}
                          </button>
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
                  <div className="empty-state">
                    <p>No pages created yet.</p>
                    <span>Create your first page profile to continue.</span>
                    <button className="primary inline-small" type="button" onClick={startCreatingProfile}>
                      Create First Page
                    </button>
                  </div>
                )}
              </section>

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
                      <label>
                        Facebook page link or ID
                        <input
                          value={newPageId}
                          onChange={(event) => setNewPageId(event.target.value)}
                          placeholder="e.g. https://facebook.com/YourPage or leave empty"
                          disabled={Boolean(editingProfile)}
                        />
                        {newPageId.trim() && !/^\d+$/.test(newPageId.trim()) ? (
                          <span className="field-hint">Detected: <strong style={{ color: "var(--accent)" }}>{extractPageIdFromUrl(newPageId)}</strong></span>
                        ) : (
                          <span className="field-hint">Paste a link to your Facebook page, a Page ID, or leave empty to add later.</span>
                        )}
                      </label>

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
                            {newPageId.trim() ? (
                              <button
                                className="primary"
                                type="button"
                                disabled={isBusy}
                                style={{ width: "100%" }}
                                onClick={async () => {
                                  const pageId = extractPageIdFromUrl(newPageId);
                                  setIsBusy(true);
                                  setStatusText("Studying your page...");
                                  try {
                                    const data = await api.studyPage(pageId);
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
                              <p className="muted" style={{ fontSize: 11 }}>Paste your Facebook page link above to auto-study.</p>
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
                    <button className="ghost inline-small" type="button" onClick={() => handleToggleEnabled(selectedProfile)} disabled={isBusy}>
                      {selectedProfile.enabled ? "Pause Page" : "Enable Page"}
                    </button>
                    <button className="ghost inline-small" type="button" onClick={() => navigate({ kind: "PAGES" })}>
                      Back to Pages
                    </button>
                  </div>

                  <section className="workspace-panel workspace-overview">
                    <div className="row-between">
                      <div>
                        <h3>Today At A Glance</h3>
                        <p className="muted">One page, one flow: generate, review, publish.</p>
                      </div>
                      <span className={badgeClass(queue.length > 0 ? "WAITING_REVIEW" : "COMPLETED")}>
                        {queue.length > 0 ? `${queue.length} in review` : "Queue clear"}
                      </span>
                    </div>
                    <div className="metric-grid">
                      <div className="metric-card">
                        <span>Drafts generated</span>
                        <strong>{cycleStats.generated}</strong>
                      </div>
                      <div className="metric-card">
                        <span>Queued to review</span>
                        <strong>{cycleStats.waitingReview}</strong>
                      </div>
                      <div className="metric-card">
                        <span>Published jobs</span>
                        <strong>{publishStats.done}</strong>
                      </div>
                    </div>
                    <div className="button-row">
                      <button className="primary" type="button" onClick={handleSmartRun} disabled={!selectedProfile || isBusy}>
                        Run Smart Cycle
                      </button>
                      <button className="ghost" type="button" onClick={() => setGuidedWorkspace("REVIEW")} disabled={!selectedProfile || queue.length === 0}>
                        Open Queue
                      </button>
                      <button className="ghost" type="button" onClick={() => setGuidedWorkspace("PUBLISH")} disabled={!selectedProfile}>
                        Open Publish
                      </button>
                    </div>
                  </section>

                  <div className="workspace-tabs">
                    {(Object.keys(WORKSPACE_LABELS) as GuidedWorkspace[]).map((workspace) => (
                      <button
                        key={workspace}
                        className={`workspace-tab ${guidedWorkspace === workspace ? "active" : ""}`}
                        onClick={() => {
                          setGuidedWorkspace(workspace);
                          if (workspace === "ANALYTICS" && selectedProfile) {
                            void api.getAnalytics(selectedProfile.pageId).then(setAnalytics).catch(() => {});
                          }
                        }}
                        type="button"
                      >
                        {WORKSPACE_LABELS[workspace]}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {selectedProfile ? (
                <>
              {guidedWorkspace === "GENERATE" ? (
                <section className="workspace-panel">
                  <div className="row-between">
                    <h3>Today</h3>
                    <p className="muted">Generate fresh drafts for this page.</p>
                  </div>
                  <div className="button-row">
                    <button className="primary" onClick={handleSmartRun} disabled={!selectedProfile || isBusy}>
                      Run Smart Cycle
                    </button>
                    <button className="ghost" onClick={handleRunCycle} disabled={!selectedProfile || isBusy}>
                      Generate Only
                    </button>
                  </div>
                  <p className={`smart-run-line ${smartRunStatus === "FAILED" ? "bad" : smartRunStatus === "REVIEW" ? "warn" : smartRunStatus === "DONE" ? "ok" : ""}`}>
                    {smartRunSummary}
                  </p>
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
                </section>
              ) : null}

              {guidedWorkspace === "REVIEW" ? (
                <section className="workspace-panel">
                  <div className="row-between">
                    <h3>Review Queue</h3>
                    <span className={badgeClass(queue.length > 0 ? "WAITING_REVIEW" : "COMPLETED")}>
                      {queue.length} waiting
                    </span>
                  </div>
                  {latestCycle?.simulate ? (
                    <p className="preview-warning">
                      This queue came from Preview mode. Approve will not publish until you run with Preview mode OFF.
                    </p>
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
                    <p className="preview-warning">Latest cycle was preview-only, so there are no publish jobs yet.</p>
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

              {false && guidedWorkspace === "ANALYTICS" ? (
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
                          <span>Cycles run</span>
                          <strong>{analytics.cycles.total}</strong>
                        </div>
                      </div>

                      {/* Content Breakdown */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <div className="metric-card">
                          <span>Posts</span>
                          <strong>{analytics.content.posts}</strong>
                        </div>
                        <div className="metric-card">
                          <span>Reels</span>
                          <strong>{analytics.content.reels}</strong>
                        </div>
                      </div>

                      {/* Status Distribution */}
                      <div style={{ padding: 16, background: "var(--bg-raised)", borderRadius: 12, border: "1px solid var(--border)" }}>
                        <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 10 }}>Content pipeline</p>
                        <div style={{ display: "flex", gap: 4, height: 8, borderRadius: 4, overflow: "hidden", background: "var(--bg-surface)" }}>
                          {analytics.content.published > 0 && <div style={{ flex: analytics.content.published, background: "var(--success)", borderRadius: 4 }} title={`Published: ${analytics.content.published}`} />}
                          {analytics.content.approved > 0 && <div style={{ flex: analytics.content.approved - analytics.content.published, background: "var(--accent)", borderRadius: 4 }} title={`Approved: ${analytics.content.approved - analytics.content.published}`} />}
                          {analytics.content.waiting > 0 && <div style={{ flex: analytics.content.waiting, background: "var(--warning)", borderRadius: 4 }} title={`Waiting: ${analytics.content.waiting}`} />}
                          {analytics.content.rejected > 0 && <div style={{ flex: analytics.content.rejected, background: "var(--danger)", borderRadius: 4 }} title={`Rejected: ${analytics.content.rejected}`} />}
                        </div>
                        <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 11, color: "var(--text-muted)" }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--success)" }} />Published {analytics.content.published}</span>
                          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--warning)" }} />Waiting {analytics.content.waiting}</span>
                          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--danger)" }} />Rejected {analytics.content.rejected}</span>
                        </div>
                      </div>

                      {/* Estimated Costs */}
                      <div style={{ padding: 16, background: "var(--bg-raised)", borderRadius: 12, border: "1px solid var(--border)" }}>
                        <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 10 }}>Estimated API costs</p>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                          <span style={{ fontSize: 28, fontWeight: 700, fontFamily: "var(--font-display)", color: "var(--text)", letterSpacing: "-0.03em" }}>${analytics.estimatedCosts.total.toFixed(2)}</span>
                          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>total estimated</span>
                        </div>
                        <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 12, color: "var(--text-secondary)" }}>
                          <span>Text: ${analytics.estimatedCosts.openai.toFixed(3)}</span>
                          <span>Images: ${analytics.estimatedCosts.gemini.toFixed(3)}</span>
                          <span>Video: ${analytics.estimatedCosts.fal.toFixed(3)}</span>
                        </div>
                      </div>

                      {/* Recent Cycles */}
                      {analytics.cycles.recent.length > 0 ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Recent cycles</p>
                          {analytics.cycles.recent.map((c) => (
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
                          <strong style={{ color: "var(--success)" }}>{analytics.publishing.succeeded}</strong>
                        </div>
                        <div className="metric-card">
                          <span>Publish failed</span>
                          <strong style={{ color: analytics.publishing.failed > 0 ? "var(--danger)" : "var(--text)" }}>{analytics.publishing.failed}</strong>
                        </div>
                      </div>
                    </>
                  )}
                </section>
              ) : null}

              {guidedWorkspace === "PAGE" ? (
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
