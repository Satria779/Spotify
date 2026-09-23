export type LyricLine = {
  time: number;
  text: string;
};

type LrcLibResponse = {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
};

function withTimeout(signalTimeout: number) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), signalTimeout);
  return {
    signal: controller.signal,
    clear: () => window.clearTimeout(timeoutId),
  };
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

export function parseLrc(lrc: string) {
  return lrc.split("\n").flatMap((line) => {
    const match = line.match(/^\[(\d{2}):(\d{2})(?:\.(\d{1,2}))?\]\s?(.*)$/);
    if (!match) return [];

    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    const hundredths = Number(match[3] || 0);
    const text = match[4]?.trim() || "";

    if (!text) return [];

    return [
      {
        time: minutes * 60 + seconds + hundredths / 100,
        text,
      } satisfies LyricLine,
    ];
  });
}

export function getActiveLyricIndex(lines: LyricLine[], time: number) {
  if (lines.length === 0) return -1;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (time >= lines[index].time) {
      return index;
    }
  }

  return 0;
}

export async function getLyrics(track: string, artist: string) {
  const params = new URLSearchParams({
    track_name: track,
    artist_name: artist,
  });

  try {
    const direct = await fetchJson<LrcLibResponse>(`https://lrclib.net/api/get?${params.toString()}`);
    return {
      plain: direct.plainLyrics || "",
      synced: direct.syncedLyrics || "",
    };
  } catch {
    const results = await fetchJson<LrcLibResponse[]>(`https://lrclib.net/api/search?${params.toString()}`);
    const match = Array.isArray(results) ? results[0] : null;

    return {
      plain: match?.plainLyrics || "",
      synced: match?.syncedLyrics || "",
    };
  }
}
