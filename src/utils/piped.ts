export type PipedTrack = {
  id: string;
  title: string;
  artist: string;
  artwork: string;
  duration: number;
  youtubeUrl: string;
  videoId: string;
  plays?: number;
  source: "search" | "playlist" | "trending";
};

export type PipedCollection = {
  id: string;
  title: string;
  artwork: string;
  creator: string;
  type: "album" | "playlist";
  count: number;
};

export type PipedArtist = {
  id: string;
  name: string;
  artwork: string;
  subscribersText: string;
};

type InstanceInfo = {
  api_url?: string;
  uptime_24h?: number;
  uptime_7d?: number;
  last_checked?: number;
};

type SearchResponse<T> = {
  items?: T[];
};

type SearchTrackItem = {
  url?: string;
  type?: string;
  title?: string;
  thumbnail?: string;
  uploaderName?: string;
  duration?: number;
  views?: number;
};

type SearchCollectionItem = {
  url?: string;
  type?: string;
  name?: string;
  thumbnail?: string;
  uploaderName?: string;
  videos?: number;
};

type SearchArtistItem = {
  url?: string;
  type?: string;
  name?: string;
  thumbnail?: string;
  subscribers?: number;
};

type PlaylistDetail = {
  name?: string;
  thumbnailUrl?: string;
  videos?: number;
  relatedStreams?: SearchTrackItem[];
};

const INSTANCE_LIST_URL = "https://piped-instances.kavin.rocks/";
const FALLBACK_INSTANCES = [
  "https://api.piped.private.coffee",
  "https://pipedapi.kavin.rocks",
];

let activeInstance = "";
let cachedInstances: string[] | null = null;

function withTimeout(signalTimeout: number) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), signalTimeout);
  return {
    signal: controller.signal,
    clear: () => window.clearTimeout(timeoutId),
  };
}

function extractIdFromUrl(url: string | undefined, param: "v" | "list") {
  if (!url) return "";

  try {
    const absolute = url.startsWith("http") ? new URL(url) : new URL(`https://youtube.com${url}`);
    return absolute.searchParams.get(param) || "";
  } catch {
    return "";
  }
}

function formatCompactNumber(value?: number) {
  if (!value || value < 0) return "—";
  return new Intl.NumberFormat("id-ID", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

async function fetchJson<T>(url: string) {
  const { signal, clear } = withTimeout(12000);

  try {
    const response = await fetch(url, {
      signal,
      headers: {
        accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return (await response.json()) as T;
  } finally {
    clear();
  }
}

async function getCandidateInstances() {
  if (cachedInstances) return cachedInstances;

  try {
    const instances = await fetchJson<InstanceInfo[]>(INSTANCE_LIST_URL);

    cachedInstances = instances
      .filter((instance) => instance.api_url)
      .sort((first, second) => {
        const firstScore = (first.uptime_24h || 0) + (first.uptime_7d || 0) / 100;
        const secondScore = (second.uptime_24h || 0) + (second.uptime_7d || 0) / 100;
        return secondScore - firstScore;
      })
      .map((instance) => instance.api_url as string)
      .slice(0, 6);
  } catch {
    cachedInstances = [...FALLBACK_INSTANCES];
  }

  return cachedInstances;
}

async function requestPiped<T>(path: string) {
  const instances = await getCandidateInstances();
  const candidates = [activeInstance, ...instances, ...FALLBACK_INSTANCES].filter(Boolean);
  const uniqueCandidates = Array.from(new Set(candidates));

  let lastError: unknown;

  for (const baseUrl of uniqueCandidates) {
    try {
      const data = await fetchJson<T>(`${baseUrl}${path}`);
      activeInstance = baseUrl;
      return data;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Tidak ada instance YouTube Music API publik yang berhasil merespons.");
}

function upscaleArtwork(url?: string, videoId?: string) {
  const fallback = videoId ? `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg` : "";
  if (!url) return fallback;

  if (url.includes("i.ytimg.com/vi/")) {
    return url.replace(/\/hqdefault\.jpg.*$/i, "/maxresdefault.jpg").replace(/\/mqdefault\.jpg.*$/i, "/maxresdefault.jpg");
  }

  return url.replace(/=w\d+-h\d+/g, "=w1200-h1200").replace(/=s\d+/g, "=s1200");
}

function mapTrack(item: SearchTrackItem, source: PipedTrack["source"]): PipedTrack | null {
  const videoId = extractIdFromUrl(item.url, "v");
  const duration = Math.max(0, Math.floor(item.duration || 0));
  const title = item.title?.trim() || "";

  if (!videoId || !title || duration <= 0) return null;
  if (/\blive\b/i.test(title)) return null;

  return {
    id: videoId,
    title,
    artist: item.uploaderName || "Unknown Artist",
    artwork: upscaleArtwork(item.thumbnail, videoId),
    duration,
    youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
    videoId,
    plays: item.views,
    source,
  };
}

function mapCollection(item: SearchCollectionItem, type: PipedCollection["type"]): PipedCollection | null {
  const id = extractIdFromUrl(item.url, "list");

  if (!id || !item.name) return null;

  return {
    id,
    title: item.name,
    artwork: item.thumbnail || "",
    creator: item.uploaderName || "Unknown Creator",
    type,
    count: Math.max(0, item.videos || 0),
  };
}

export async function getSearchSuggestions(query: string) {
  if (!query.trim()) return [];

  const params = new URLSearchParams({ query: query.trim() });
  const data = await requestPiped<string[]>(`/suggestions?${params.toString()}`);
  return Array.isArray(data) ? data.slice(0, 8) : [];
}

export async function searchTracks(query: string) {
  const params = new URLSearchParams({ q: query.trim(), filter: "music_songs" });
  const data = await requestPiped<SearchResponse<SearchTrackItem>>(`/search?${params.toString()}`);

  return (data.items || [])
    .map((item) => mapTrack(item, "search"))
    .filter((item): item is PipedTrack => Boolean(item));
}

export async function searchAlbums(query: string) {
  const params = new URLSearchParams({ q: query.trim(), filter: "music_albums" });
  const data = await requestPiped<SearchResponse<SearchCollectionItem>>(`/search?${params.toString()}`);

  return (data.items || [])
    .map((item) => mapCollection(item, "album"))
    .filter((item): item is PipedCollection => Boolean(item));
}

export async function searchPlaylists(query: string) {
  const params = new URLSearchParams({ q: query.trim(), filter: "playlists" });
  const data = await requestPiped<SearchResponse<SearchCollectionItem>>(`/search?${params.toString()}`);

  return (data.items || [])
    .map((item) => mapCollection(item, "playlist"))
    .filter((item): item is PipedCollection => Boolean(item));
}

export async function searchArtists(query: string) {
  const params = new URLSearchParams({ q: query.trim(), filter: "music_artists" });
  const data = await requestPiped<SearchResponse<SearchArtistItem>>(`/search?${params.toString()}`);

  return (data.items || [])
    .map((item) => {
      const id = item.url?.split("/").pop() || "";
      if (!id || !item.name) return null;

      return {
        id,
        name: item.name,
        artwork: item.thumbnail || "",
        subscribersText: formatCompactNumber(item.subscribers),
      } satisfies PipedArtist;
    })
    .filter((item): item is PipedArtist => Boolean(item));
}

export async function getTrendingTracks(region = "ID") {
  const params = new URLSearchParams({ region });
  const data = await requestPiped<SearchTrackItem[]>(`/trending?${params.toString()}`);

  return (Array.isArray(data) ? data : [])
    .map((item) => mapTrack(item, "trending"))
    .filter((item): item is PipedTrack => Boolean(item));
}

export async function getPlaylistTracks(id: string) {
  const data = await requestPiped<PlaylistDetail>(`/playlists/${id}`);

  return {
    title: data.name || "Playlist",
    artwork: data.thumbnailUrl || "",
    count: data.videos || 0,
    tracks: (data.relatedStreams || [])
      .map((item) => mapTrack(item, "playlist"))
      .filter((item): item is PipedTrack => Boolean(item)),
  };
}
