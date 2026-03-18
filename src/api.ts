const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

export const getApiKey = (): string | null => sessionStorage.getItem("zim_api_key");
export const setApiKey = (key: string): void => sessionStorage.setItem("zim_api_key", key);
export const clearApiKey = (): void => sessionStorage.removeItem("zim_api_key");

export type AutonomyLevel = "L0" | "L1" | "L2" | "L3";
export type PolicyMode = "STRICT" | "STANDARD";
export type PersonaSourceMode = "FROM_REFERENCES" | "FROM_SCRATCH";

export interface PersonaReferenceImage {
  id: string;
  dataUrl: string;
  createdAt: string;
}

export interface PersonaProfile {
  mode: PersonaSourceMode;
  name: string;
  coreDescription: string;
  lifestyleScenes: string[];
  referenceImages: PersonaReferenceImage[];
  anchorImageUrl?: string;
  autoGeneratePostImages: boolean;
  lastTrainedAt?: string;
}

export interface AutonomyProfile {
  id: string;
  pageId: string;
  displayName?: string;
  avatarUrl?: string;
  persona: PersonaProfile;
  level: AutonomyLevel;
  policyMode: PolicyMode;
  riskThresholdAutoPublish: number;
  limits: {
    dailyPosts: number;
    dailyReels: number;
    hourlyPublishes: number;
  };
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentContentItem {
  id: string;
  vertical: "FINANCE" | "AI";
  format: "POST" | "REEL";
  mediaType?: "IMAGE" | "VIDEO";
  title: string;
  body: string;
  mediaAssets?: Array<{
    id: string;
    type: "IMAGE" | "VIDEO";
    role: "POST_PREVIEW" | "REEL_PREVIEW" | "REEL_VIDEO" | "PERSONA_ANCHOR";
    provider: "GEMINI" | "IMAGEN" | "FAL" | "MOCK";
    mimeType: string;
    dataUrl?: string;
    url?: string;
    prompt: string;
    createdAt: string;
  }>;
  route?: "AUTO_PUBLISH" | "HUMAN_REVIEW" | "BLOCKED";
  publishStatus: "DRAFT" | "READY" | "WAITING_REVIEW" | "APPROVED" | "PUBLISHED" | "BLOCKED";
  publishError?: string;
  mediaPrompt?: string;
}

export interface AgentCycle {
  id: string;
  pageId: string;
  autonomyProfileId: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "OVERRIDDEN";
  simulate: boolean;
  steps: Array<{
    id: string;
    role: string;
    status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
    outputSummary?: string;
  }>;
  contentItems: AgentContentItem[];
  analyticsSummary?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewQueueEntry {
  cycleId: string;
  pageId: string;
  item: AgentContentItem;
}

export interface StylePack {
  id: string;
  name: string;
  vertical: "FINANCE" | "AI";
  rules: {
    tone: string[];
    formatConstraints: string[];
    doRules: string[];
    dontRules: string[];
  };
}

export interface StyleCard {
  id: string;
  stylePackId: string;
  platform: "INSTAGRAM" | "TIKTOK" | "OTHER";
  url: string;
  toneTags: string[];
  hookPatterns: string[];
  avoidPatterns: string[];
}

export interface LearningPatch {
  id: string;
  pageId: string;
  patchType: "PROMPT_STRATEGY" | "TIMING_STRATEGY" | "VERTICAL_MIX";
  summary: string;
  safeToApply: boolean;
  applied: boolean;
  createdAt: string;
}

export interface PageMemory {
  id: string;
  pageId: string;
  complianceSignals: string[];
  performanceSignals: string[];
  reviewerFeedbackSignals: string[];
}

export interface AuditEvent {
  id: string;
  entityType: string;
  action: string;
  actorType: "SYSTEM" | "HUMAN";
  actorId: string;
  createdAt: string;
}

export interface PublishJob {
  id: string;
  pageId: string;
  cycleId: string;
  contentItemId: string;
  status: "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  attempts: number;
  maxAttempts: number;
  nextRunAt: string;
  lastError?: string;
}

export interface MetaIntegrationStatus {
  mode: "mock" | "real";
  pageId?: string;
  ready: boolean;
  tokenSource: "PAGE" | "GLOBAL" | "NONE";
  hasDefaultReelFileUrl: boolean;
  warnings: string[];
}

export interface MetaConnectionVerification {
  ok: boolean;
  mode: "mock" | "real";
  pageId: string;
  pageName?: string;
  message: string;
  errorCode?: string;
  retryable?: boolean;
}

export interface ContentEngineStatus {
  mode: "OPENAI" | "FALLBACK";
  ready: boolean;
  model?: string;
  language: "EN" | "RU";
  webResearchSource: "SERPER" | "OPEN_WEB" | "MOCK";
  warnings: string[];
}

export interface ImageEngineStatus {
  mode: "GEMINI" | "MOCK";
  ready: boolean;
  model?: string;
  warnings: string[];
}

export interface VideoEngineStatus {
  mode: "FAL" | "MOCK";
  ready: boolean;
  model?: string;
  warnings: string[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const apiKey = getApiKey();
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "x-api-key": apiKey } : {}),
      ...(init?.headers ?? {})
    },
    ...init
  });

  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    let rawMessage = `${response.status}`;

    if (contentType.includes("application/json")) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
      rawMessage = payload.error ?? payload.message ?? rawMessage;
    } else {
      const text = await response.text();
      rawMessage = text || rawMessage;
    }

    throw new Error(toFriendlyError(rawMessage));
  }

  return (await response.json()) as T;
}

function toFriendlyError(raw: string): string {
  const normalized = raw.replace(/^Error:\s*/i, "").trim();
  const lower = normalized.toLowerCase();

  if (lower.includes("token")) {
    return "Meta token issue: token is missing or expired. Update token and reconnect page permissions.";
  }

  if (lower.includes("permission")) {
    return "Meta permissions issue: page access is missing required publish scopes.";
  }

  if (lower.includes("rate limit") || lower.includes("too many requests")) {
    return "Rate limit reached. Wait a bit and retry.";
  }

  if (lower.includes("profile") && lower.includes("not found")) {
    return "Selected page profile was not found. Refresh the page and select profile again.";
  }

  if (lower.includes("config") && lower.includes("token")) {
    return "Meta config issue: page token is missing. Add META_ACCESS_TOKEN or META_PAGE_ACCESS_TOKENS.";
  }

  if (lower.includes("zod")) {
    return "Some fields are invalid. Check form values and try again.";
  }

  return normalized;
}

export const api = {
  listProfiles: () => request<AutonomyProfile[]>("/autonomy/profiles"),
  createProfile: (payload: {
    pageId: string;
    displayName?: string;
    avatarUrl?: string;
    persona?: {
      mode?: PersonaSourceMode;
      name?: string;
      coreDescription?: string;
      lifestyleScenes?: string[];
      referenceImages?: Array<{ id?: string; dataUrl: string }>;
      anchorImageUrl?: string;
      autoGeneratePostImages?: boolean;
      lastTrainedAt?: string;
    };
    level: AutonomyLevel;
    policyMode: PolicyMode;
    riskThresholdAutoPublish: number;
    limits: { dailyPosts: number; dailyReels: number; hourlyPublishes: number };
  }) =>
    request<AutonomyProfile>("/autonomy/profiles", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  patchProfile: (
    id: string,
    payload: Omit<Partial<AutonomyProfile>, "avatarUrl" | "displayName" | "persona"> & {
      avatarUrl?: string | null;
      displayName?: string | null;
      persona?: {
        mode?: PersonaSourceMode;
        name?: string;
        coreDescription?: string;
        lifestyleScenes?: string[];
        referenceImages?: Array<{ id?: string; dataUrl: string }>;
        anchorImageUrl?: string | null;
        autoGeneratePostImages?: boolean;
        lastTrainedAt?: string;
      };
    }
  ) =>
    request<AutonomyProfile>(`/autonomy/profiles/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  runCycle: (payload: {
    pageId: string;
    autonomyProfileId: string;
    simulate: boolean;
  }) =>
    request<AgentCycle>("/agents/cycles/run", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  listCycles: (pageId?: string) => request<AgentCycle[]>(pageId ? `/agents/cycles?pageId=${pageId}` : "/agents/cycles"),
  listReviewQueue: (pageId?: string) => request<ReviewQueueEntry[]>(pageId ? `/review/queue?pageId=${pageId}` : "/review/queue"),
  reviewItem: (cycleId: string, contentId: string, payload: { actorId: string; action: "APPROVE" | "REJECT"; note?: string }) =>
    request<AgentContentItem>(`/agents/cycles/${cycleId}/content/${contentId}/review`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  updateItem: (
    cycleId: string,
    contentId: string,
    payload: {
      actorId: string;
      format?: "POST" | "REEL";
      mediaType?: "IMAGE" | "VIDEO";
      title?: string;
      body?: string;
      mediaPrompt?: string | null;
      note?: string;
    }
  ) =>
    request<AgentContentItem>(`/agents/cycles/${cycleId}/content/${contentId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  regenerateItemImage: (
    cycleId: string,
    contentId: string,
    payload: { actorId: string; prompt?: string }
  ) =>
    request<AgentContentItem>(`/agents/cycles/${cycleId}/content/${contentId}/media/regenerate`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  listStylePacks: () => request<StylePack[]>("/style-packs"),
  listStyleCards: (packId: string) => request<StyleCard[]>(`/style-packs/${packId}/cards`),
  runNightlyLearning: (payload: { pageId: string; maxPatches: number }) =>
    request<LearningPatch[]>("/learning/nightly-run", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  listLearningPatches: (pageId: string) => request<LearningPatch[]>(`/learning/patches/${pageId}`),
  getMemory: (pageId: string) => request<PageMemory>(`/memory/${pageId}`),
  addReviewerFeedback: (payload: { pageId: string; feedback: string; actorId: string }) =>
    request<PageMemory>("/memory/reviewer-feedback", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  listAuditEvents: () => request<AuditEvent[]>("/audit/events"),
  listPublishJobs: (status?: PublishJob["status"], pageId?: string) => {
    const query = new URLSearchParams();
    if (status) {
      query.set("status", status);
    }
    if (pageId) {
      query.set("pageId", pageId);
    }
    const suffix = query.toString();
    return request<PublishJob[]>(suffix ? `/publish/jobs?${suffix}` : "/publish/jobs");
  },
  runPublishWorkerOnce: (maxJobs = 20) =>
    request<{ processed: number; succeeded: number; failed: number; retried: number }>("/workers/publish/run-once", {
      method: "POST",
      body: JSON.stringify({ maxJobs })
    }),
  getMetaStatus: (pageId?: string) =>
    request<MetaIntegrationStatus>(pageId ? `/integrations/meta/status?pageId=${encodeURIComponent(pageId)}` : "/integrations/meta/status"),
  getContentStatus: () => request<ContentEngineStatus>("/integrations/content/status"),
  getImageStatus: () => request<ImageEngineStatus>("/integrations/image/status"),
  getVideoStatus: () => request<VideoEngineStatus>("/integrations/video/status"),
  verifyMetaConnection: (pageId: string) =>
    request<MetaConnectionVerification>("/integrations/meta/verify", {
      method: "POST",
      body: JSON.stringify({ pageId })
    })
};
