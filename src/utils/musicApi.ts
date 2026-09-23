import {
  getSearchSuggestions as getPipedSuggestions,
  searchAlbums as searchPipedAlbums,
  searchArtists as searchPipedArtists,
  searchPlaylists as searchPipedPlaylists,
  searchTracks as searchPipedTracks,
  type PipedArtist,
  type PipedCollection,
  type PipedTrack,
} from "./piped";

type BackendTrack = {
  videoId?: string;
  title?: string;
  name?: string;
  artists?: Array<{ name?: string }>;
  artist?: string;
  thumbnails?: Array<{ url?: string }>;
  thumbnail?: { url?: string } | string;
  duration?: string | number;
  duration_seconds?: number;
  views?: number;
};

type BackendStream = {
  url?: string;
  title?: string;
  duration?: number;
};

export type PlayableSource = {
  src: string;
  duration?: number;
  mode: "stream" | "youtube";
};

const STATIC_BACKEND_CANDIDATES = ["http://127.0.0.1:8000", "http://localhost:8000"];
let activeBackendBase = "";

function getBackendCandidates() {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const candidates = [origin, ...STATIC_BACKEND_CANDIDATES].filter(Boolean);
  return Array.from(new Set(candidates));
}

function parseDuration(value?: string | number) {
  if (typeof value === "number") return Math.max(0, Math.floor(value));
  if (!value) return 0;

  const parts = value.split(":").map(Number).filter((part) => Number.isFinite(part));
  if (parts.length === 0) return 0;

  return parts.reduce((total, part) => total * 60 + part, 0);
}

function upscaleArtwork(url: string) {
  if (!url) return "";

  if (url.includes("i.ytimg.com/vi/")) {
    return url.replace(/\/hqdefault\.jpg.*$/i, "/maxresdefault.jpg").replace(/\/mqdefault\.jpg.*$/i, "/maxresdefault.jpg");
  }

  return url
    .replace(/=w\d+-h\d+/g, "=w1200-h1200")
    .replace(/=s\d+/g, "=s1200");
}

function pickArtwork(item: BackendTrack) {
  if (Array.isArray(item.thumbnails) && item.thumbnails.length > 0) {
    return upscaleArtwork(item.thumbnails[item.thumbnails.length - 1]?.url || "");
  }

  if (typeof item.thumbnail === "string") {
    return upscaleArtwork(item.thumbnail);
  }

  return upscaleArtwork(item.thumbnail?.url || "");
}

function isBlockedSearchTrack(title: string, artist: string) {
  const target = `${title} ${artist}`.toLowerCase();
  const blocked = [
    "bollywood dj non stop remix(remix by",
    "gym beats vol.4-nonstop-megamix",
    "the gym beats",
  ];

  return blocked.some((item) => target.includes(item));
}

function normalizeBackendTrack(item: BackendTrack, source: PipedTrack["source"]): PipedTrack | null {
  const videoId = item.videoId?.trim();
  if (!videoId) return null;

  const title = item.title?.trim() || item.name?.trim() || "Unknown Title";
  const artist =
    item.artists?.map((entry) => entry.name?.trim()).filter(Boolean).join(", ") || item.artist?.trim() || "Unknown Artist";
  const duration = item.duration_seconds || parseDuration(item.duration);

  return {
    id: videoId,
    title,
    artist,
    artwork: pickArtwork(item) || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    duration,
    youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
    videoId,
    plays: item.views,
    source,
  };
}

async function fetchJson<T>(url: string) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return (await response.json()) as T;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function requestBackend<T>(path: string) {
  const candidates = [activeBackendBase, ...getBackendCandidates()].filter(Boolean);
  const uniqueCandidates = Array.from(new Set(candidates));
  let lastError: unknown;

  for (const base of uniqueCandidates) {
    try {
      const data = await fetchJson<T>(`${base}${path}`);
      activeBackendBase = base;
      return data;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Backend musik tidak tersedia.");
}

export async function searchTracks(query: string) {
  try {
    const params = new URLSearchParams({ q: query.trim() });
    const results = await requestBackend<BackendTrack[]>(`/api/search?${params.toString()}`);
    const normalized = (Array.isArray(results) ? results : [])
      .map((item) => normalizeBackendTrack(item, "search"))
      .filter((item): item is PipedTrack => Boolean(item))
      .filter((item) => !isBlockedSearchTrack(item.title, item.artist));

    if (normalized.length > 0) return normalized;
  } catch {
    // fallback below
  }

  return (await searchPipedTracks(query)).filter((item) => !isBlockedSearchTrack(item.title, item.artist));
}

export async function getTrendingTracks(region = "ID") {
  try {
    const results = await requestBackend<BackendTrack[]>("/api/trending");
    const normalized = (Array.isArray(results) ? results : [])
      .map((item) => normalizeBackendTrack(item, "trending"))
      .filter((item): item is PipedTrack => Boolean(item));

    if (normalized.length > 0) return normalized;
  } catch {
    // fallback below
  }

  const safeFallback = await searchPipedTracks(region === "ID" ? "top hits indonesia official audio" : "top songs official audio");
  return safeFallback.slice(0, 20);
}

export async function getTrackPlaybackSource(videoId: string): Promise<PlayableSource> {
  try {
    const params = new URLSearchParams({ id: videoId });
    const result = await requestBackend<BackendStream>(`/api/stream?${params.toString()}`);

    if (result.url) {
      return {
        src: result.url,
        duration: result.duration,
        mode: "stream",
      };
    }
  } catch {
    // fallback below
  }

  return {
    src: `https://www.youtube.com/watch?v=${videoId}`,
    mode: "youtube",
  };
}

export async function getSearchSuggestions(query: string) {
  return getPipedSuggestions(query);
}

export async function searchAlbums(query: string): Promise<PipedCollection[]> {
  return searchPipedAlbums(query);
}

export async function searchPlaylists(query: string): Promise<PipedCollection[]> {
  return searchPipedPlaylists(query);
}

export async function searchArtists(query: string): Promise<PipedArtist[]> {
  return searchPipedArtists(query);
}
