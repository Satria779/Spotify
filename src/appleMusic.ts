export const FALLBACK_ARTWORK = "/images/satriamusic-cover.jpg";

export type MusicTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  artwork: string;
  previewUrl: string;
  trackUrl: string;
  fullDuration: number;
  genre: string;
  releaseDate: string;
  explicit: boolean;
};

type AppleSearchResponse = {
  resultCount: number;
  results: AppleSearchResult[];
};

type AppleSearchResult = {
  trackId?: number;
  kind?: string;
  artistName?: string;
  collectionName?: string;
  trackName?: string;
  previewUrl?: string;
  artworkUrl100?: string;
  trackViewUrl?: string;
  trackTimeMillis?: number;
  primaryGenreName?: string;
  releaseDate?: string;
  trackExplicitness?: string;
};

type RankedTrack = MusicTrack & {
  score: number;
};

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function upscaleArtwork(url?: string) {
  if (!url) return FALLBACK_ARTWORK;
  return url.replace(/\/\d+x\d+bb\./, "/900x900bb.");
}

function scoreResult(result: AppleSearchResult, title: string, artist: string) {
  const normalizedTitle = normalizeText(title);
  const normalizedArtist = normalizeText(artist);
  const resultTitle = normalizeText(result.trackName || "");
  const resultArtist = normalizeText(result.artistName || "");
  const resultAlbum = normalizeText(result.collectionName || "");

  let score = 0;

  if (normalizedTitle && resultTitle === normalizedTitle) score += 90;
  else if (normalizedTitle && resultTitle.startsWith(normalizedTitle)) score += 70;
  else if (normalizedTitle && resultTitle.includes(normalizedTitle)) score += 48;

  if (normalizedArtist && resultArtist === normalizedArtist) score += 80;
  else if (normalizedArtist && resultArtist.startsWith(normalizedArtist)) score += 62;
  else if (normalizedArtist && resultArtist.includes(normalizedArtist)) score += 42;

  if (normalizedTitle && resultAlbum.includes(normalizedTitle)) score += 10;
  if (result.previewUrl) score += 14;
  if (result.kind === "song") score += 20;

  return score;
}

function mapResult(result: AppleSearchResult, title: string, artist: string): RankedTrack | null {
  if (!result.trackId || !result.trackName || !result.artistName || !result.previewUrl || result.kind !== "song") {
    return null;
  }

  return {
    id: String(result.trackId),
    title: result.trackName,
    artist: result.artistName,
    album: result.collectionName || "Single",
    artwork: upscaleArtwork(result.artworkUrl100),
    previewUrl: result.previewUrl,
    trackUrl: result.trackViewUrl || "",
    fullDuration: Math.floor((result.trackTimeMillis || 30000) / 1000),
    genre: result.primaryGenreName || "Music",
    releaseDate: result.releaseDate || "",
    explicit: result.trackExplicitness === "explicit",
    score: scoreResult(result, title, artist),
  };
}

function jsonpRequest<T>(url: string) {
  return new Promise<T>((resolve, reject) => {
    const callbackName = `satriaMusicJsonp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const windowWithCallbacks = window as unknown as Window & Record<string, (data: T) => void>;

    const cleanup = () => {
      delete windowWithCallbacks[callbackName];
      script.remove();
      window.clearTimeout(timeoutId);
    };

    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("Permintaan ke katalog musik terlalu lama."));
    }, 12000);

    windowWithCallbacks[callbackName] = (data: T) => {
      cleanup();
      resolve(data);
    };

    script.src = `${url}${url.includes("?") ? "&" : "?"}callback=${callbackName}`;
    script.async = true;
    script.onerror = () => {
      cleanup();
      reject(new Error("Gagal memuat data dari katalog musik."));
    };

    document.body.appendChild(script);
  });
}

async function searchByCountry(term: string, title: string, artist: string, country: string) {
  const params = new URLSearchParams({
    term,
    country,
    media: "music",
    entity: "song",
    explicit: "No",
    lang: "en_us",
    limit: "12",
  });

  const response = await jsonpRequest<AppleSearchResponse>(`https://itunes.apple.com/search?${params.toString()}`);

  const ranked = response.results
    .map((result) => mapResult(result, title, artist))
    .filter((item): item is RankedTrack => Boolean(item))
    .sort((first, second) => second.score - first.score);

  const unique = new Map<string, RankedTrack>();

  ranked.forEach((item) => {
    if (!unique.has(item.id)) {
      unique.set(item.id, item);
    }
  });

  return Array.from(unique.values());
}

export async function searchAppleTracks(title: string, artist: string) {
  const cleanTitle = title.trim();
  const cleanArtist = artist.trim();
  const term = [cleanTitle, cleanArtist].filter(Boolean).join(" ");

  if (!term) return [];

  const indonesiaResults = await searchByCountry(term, cleanTitle, cleanArtist, "ID");

  if (indonesiaResults.length > 0) {
    return indonesiaResults.map(({ score, ...track }) => track);
  }

  const usResults = await searchByCountry(term, cleanTitle, cleanArtist, "US");
  return usResults.map(({ score, ...track }) => track);
}
