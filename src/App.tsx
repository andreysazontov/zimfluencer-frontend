import { useEffect, useMemo, useRef, useState } from "react";
import {
  api,
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
  | { kind: "ADVANCED" };

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

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unexpected error";
}

export default function App() {
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
    if (route.kind === "ADVANCED") {
      setUiMode("ADVANCED");
      if (pagesView === "EDITOR") {
        setPagesView("GALLERY");
      }
      return;
    }

    setUiMode("GUIDED");

    if (route.kind !== "PAGES" && pagesView === "EDITOR") {
      setPagesView("GALLERY");
    }

    if (route.kind === "PAGES") {
      setGuidedSection("PAGES");
      if (!editingProfileId) {
        setPagesView("GALLERY");
      }
      return;
    }

    setGuidedSection("WORKSPACE");

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
    const lifestyleScenes = parseLifestyleScenes(newPersonaLifestyle);
    const referenceImagesPayload = newPersonaReferenceImages.map((dataUrl) => ({ dataUrl }));
    const anchorFromReferences = newPersonaReferenceImages[0]?.trim();
    const personaPayload = {
      mode: newPersonaMode,
      name: newPersonaName.trim() || displayNamePayload,
      coreDescription:
        newPersonaCoreDescription.trim() ||
        "45+ American lifestyle creator, middle-income everyday look, natural candid expression, smartphone-native realism.",
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
        const profile = await api.createProfile({
          pageId: newPageId.trim(),
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
            <p className="brand-subtitle">Autonomous content studio for Facebook pages</p>
          </div>
        </div>

        <div className="topbar-actions">
          <div className="mode-switch">
            <button
              className={`menu-pill ${uiMode === "GUIDED" ? "active" : ""}`}
              onClick={() => navigate({ kind: "PAGES" })}
            >
              Guided
            </button>
            <button
              className={`menu-pill ${uiMode === "ADVANCED" ? "active" : ""}`}
              onClick={() => navigate({ kind: "ADVANCED" })}
            >
              Advanced
            </button>
          </div>
          <span className={badgeClass(isBusy ? "RUNNING" : "COMPLETED")}>{isBusy ? "SYNCING" : "READY"}</span>
        </div>
      </header>

      <section className="hero glass">
        <div className="hero-top">
          <div>
            <h1>{guidedSection === "PAGES" ? "Pages Hub" : "Workspace Hub"}</h1>
            <p className="muted">
              {guidedSection === "PAGES"
                ? "Create pages and keep profile setup clean. Open one page workspace when ready."
                : selectedProfile
                  ? `Working page: ${pageDisplayName(selectedProfile)}`
                  : "Select or create a page to start daily workflow."}
            </p>
          </div>
          <div className="hero-actions">
            <button className="primary" type="button" onClick={goToSuggestedAction} disabled={isBusy}>
              {selectedProfile ? `Continue: ${WORKSPACE_LABELS[suggestedWorkspace]}` : "Create First Page"}
            </button>
            {selectedProfile ? (
              <span className="hero-page-chip">
                Page: {pageDisplayName(selectedProfile)}
                <small> · {selectedProfile.pageId}</small>
              </span>
            ) : null}
          </div>
        </div>
        <p className="hero-next-line">Next action: {nextActionText}</p>
        <div className="quick-start-strip" aria-label="Quick start progress">
          {quickStartSteps.map((step) => (
            <span
              key={step.key}
              className={`quick-start-chip ${step.done ? "done" : step.active ? "active" : ""}`}
            >
              {step.label}
            </span>
          ))}
        </div>
      </section>

      {uiMode === "GUIDED" ? (
        <section className="panel glass focus-shell">
          <header className="focus-header">
            <div>
              <h2>{guidedSection === "PAGES" ? "Pages" : "Workspace"}</h2>
              <p className="muted">
                {guidedSection === "PAGES"
                  ? "Create and manage page profiles. Keep this screen focused on page setup only."
                  : selectedProfile
                    ? `Active page: ${pageDisplayName(selectedProfile)}. Use tabs to run content workflow with less clutter.`
                    : "Select a page in Pages first."}
              </p>
            </div>
            <div className="section-tabs">
              <button
                type="button"
                className={`section-tab ${guidedSection === "PAGES" ? "active" : ""}`}
                onClick={() => navigate({ kind: "PAGES" })}
              >
                Pages
              </button>
              <button
                type="button"
                className={`section-tab ${guidedSection === "WORKSPACE" ? "active" : ""}`}
                onClick={() => navigate({ kind: "WORKSPACE", pageId: selectedProfile?.pageId })}
                disabled={!selectedProfile}
              >
                Workspace
              </button>
            </div>
          </header>

          <p className={`smart-run-line ${smartRunStatus === "FAILED" ? "bad" : smartRunStatus === "REVIEW" ? "warn" : smartRunStatus === "DONE" ? "ok" : ""}`}>
            {guidedSection === "WORKSPACE" && selectedProfile
              ? `${WORKSPACE_LABELS[guidedWorkspace]} · ${statusText}`
              : statusText}
          </p>

          {guidedSection === "PAGES" ? (
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
                    <div className="row-between">
                      <h3>{editingProfile ? "Edit Page Profile" : "Create Page Profile"}</h3>
                      <button className="ghost inline-small" type="button" onClick={resetProfileEditor}>
                        Close
                      </button>
                    </div>

                    <form className="stack-form" onSubmit={handleSaveProfile}>
                      <label>
                        Page name
                        <input
                          value={newPageName}
                          onChange={(event) => setNewPageName(event.target.value)}
                          placeholder="My Trading Page"
                        />
                      </label>
                      <label>
                        Facebook Page ID (required)
                        <input
                          value={newPageId}
                          onChange={(event) => setNewPageId(event.target.value)}
                          placeholder="1022560117608990"
                          required
                          disabled={Boolean(editingProfile)}
                        />
                        <span className="field-hint">Use the numeric Facebook Page ID from Meta.</span>
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
                        <div className="row-between">
                          <h4>AI Persona</h4>
                          <span className={badgeClass(newPersonaMode === "FROM_REFERENCES" ? "COMPLETED" : "WAITING_REVIEW")}>
                            {newPersonaMode === "FROM_REFERENCES" ? "Learn from photos" : "Create from scratch"}
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
                          Face and style description
                          <textarea
                            value={newPersonaCoreDescription}
                            onChange={(event) => setNewPersonaCoreDescription(event.target.value)}
                            placeholder="Athletic, 28 years old, confident smile, modern casual style, natural light."
                          />
                        </label>
                        <label>
                          Lifestyle scenes (comma separated)
                          <input
                            value={newPersonaLifestyle}
                            onChange={(event) => setNewPersonaLifestyle(event.target.value)}
                            placeholder="morning patio coffee, beach walk at sunset, backyard barbecue"
                          />
                        </label>
                        <label className="inline-control">
                          <input
                            type="checkbox"
                            checked={newPersonaAutoImages}
                            onChange={(event) => setNewPersonaAutoImages(event.target.checked)}
                          />
                          Auto-generate image preview for each draft
                        </label>

                        <div className="persona-upload-row">
                          <label className="ghost inline-small persona-upload-trigger">
                            Upload face references
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
                          <p className="muted">Tip: upload 3-8 photos with one face for stronger identity consistency.</p>
                        )}
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
                          Use recommended defaults
                        </button>
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
                      </div>
                    ) : null}
                  </section>
                </div>
              ) : null}
            </div>
          ) : (
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
                        onClick={() => setGuidedWorkspace(workspace)}
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
                  <div className="row-wrap">
                    <label className="inline-control">
                      <input type="checkbox" checked={simulate} onChange={(event) => setSimulate(event.target.checked)} />
                      Preview mode (safe)
                    </label>
                    <div className="button-row inline-actions">
                      <button className="primary" onClick={handleSmartRun} disabled={!selectedProfile || isBusy}>
                        Run Smart Cycle
                      </button>
                      <button className="ghost" onClick={handleRunCycle} disabled={!selectedProfile || isBusy}>
                        Generate Drafts Only
                      </button>
                    </div>
                  </div>
                  {simulate ? <p className="preview-warning">Preview mode is ON. Drafts are generated, but nothing is posted to Facebook.</p> : null}
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
                                <div className="fb-preview-image-wrap">
                                  <img src={reviewPreviewImage} alt="Draft generated preview" className="fb-preview-image" loading="lazy" decoding="async" />
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
                                <div className="fb-preview-image-wrap">
                                  <img src={reviewPreviewImage} alt="Draft generated preview" className="fb-preview-image" loading="lazy" decoding="async" />
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
