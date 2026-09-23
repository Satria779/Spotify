import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import ReactPlayer from "react-player";
import { getActiveLyricIndex, getLyrics, parseLrc, type LyricLine } from "./utils/lyrics";
import {
  getSearchSuggestions,
  getTrackPlaybackSource,
  getTrendingTracks,
  searchAlbums,
  searchArtists,
  searchPlaylists,
  searchTracks,
  type PlayableSource,
} from "./utils/musicApi";
import { getPlaylistTracks, type PipedArtist, type PipedCollection, type PipedTrack } from "./utils/piped";

type MainView = "home" | "search" | "library";
type ActiveView = MainView | "artist";
type RepeatMode = "off" | "all" | "one";
type FeedSection = { id: string; title: string; tracks: PipedTrack[] };
type SearchBundle = { tracks: PipedTrack[]; albums: PipedCollection[]; playlists: PipedCollection[]; artists: PipedArtist[] };
type ArtistDetail = { artist: PipedArtist; tracks: PipedTrack[]; albums: PipedCollection[]; playlists: PipedCollection[] };
type CustomPlaylist = { id: string; name: string; tracks: PipedTrack[] };
type StatsTrack = { title: string; artist: string; plays: number; seconds: number };
type MusicStats = { totalPlays: number; totalSeconds: number; tracks: Record<string, StatsTrack> };

const QUICK_SEARCHES = ["Hindia", "Membasuh", "Kunto Aji", "Feast", "Pamungkas", "Nadin Amizah"];
const STORAGE_LIKES = "music-liked";
const STORAGE_RECENT = "music-recent-v2";
const STORAGE_QUEUE = "music-queue-v2";
const STORAGE_PLAYLISTS = "music-playlists-v2";
const STORAGE_SEARCH_HISTORY = "music-search-history-v2";
const STORAGE_STATS = "music-stats-v2";
const STORAGE_CURRENT = "music-current-v2";
const STORAGE_REPEAT = "music-repeat-v2";
const STORAGE_SHUFFLE = "music-shuffle-v2";
const STORAGE_AUTOPLAY = "music-autoplay-v1";
const STORAGE_RATE = "music-rate-v1";
const FALLBACK_ARTWORK = "/images/satriamusic-cover.jpg";

const searchCategories = [
  { title: "Pop Indonesia", color: "#e13300", image: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=400&q=80" },
  { title: "Galau", color: "#5038a0", image: "https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=400&q=80" },
  { title: "TikTok Viral", color: "#15883e", image: "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=400&q=80" },
  { title: "Focus Mode", color: "#1e3264", image: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=400&q=80" },
  { title: "Acoustic", color: "#ba5d07", image: "https://images.unsplash.com/photo-1485579149621-3123dd979885?auto=format&fit=crop&w=400&q=80" },
  { title: "Late Night", color: "#0d5c63", image: "https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=400&q=80" },
];

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}
function formatLongTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  return h ? `${h} jam ${m} menit` : `${m} menit`;
}
function tryParse<T>(value: string | null, fallback: T) {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}
function dedupeTracks(tracks: PipedTrack[]) {
  const map = new Map<string, PipedTrack>();
  tracks.forEach((track) => { if (!map.has(track.id)) map.set(track.id, track); });
  return [...map.values()];
}
function cleanForLyrics(value: string) {
  return value.replace(/\([^)]*\)/g, "").replace(/\[[^\]]*\]/g, "").replace(/official|audio|video|lyric/gi, "").replace(/\s{2,}/g, " ").trim();
}
function primaryArtistName(value: string) { return value.split(",")[0]?.trim() || value.trim(); }
function normalizeName(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, " ").trim();
}
function artistFromTrack(track: PipedTrack): PipedArtist {
  return { id: primaryArtistName(track.artist).toLowerCase().replace(/\s+/g, "-"), name: primaryArtistName(track.artist), artwork: track.artwork, subscribersText: "Artis" };
}
function filterHomeTracks(tracks: PipedTrack[]) {
  const blocked = /\b(yoga|meditation|mantra|bhajan|chant|nursery|kids|children|rhymes|podcast|live|dj set|mix nonstop|remix nonstop|hindi|bollywood|megamix|nonstop|psynth|gym beats)\b/i;
  return tracks.filter((track) => !blocked.test(`${track.title} ${track.artist}`.toLowerCase()));
}
function chooseBestArtistMatch(target: string, artists: PipedArtist[]) {
  const n = normalizeName(target);
  return artists.find((a) => normalizeName(a.name) === n) || artists.find((a) => normalizeName(a.name).startsWith(n)) || artists[0] || null;
}
function isTrackFromArtist(track: PipedTrack, artist: string) {
  const a = normalizeName(primaryArtistName(track.artist)); const b = normalizeName(artist);
  return a === b || a.includes(b) || b.includes(a);
}
function isCollectionFromArtist(item: PipedCollection, artist: string) {
  const a = normalizeName(artist);
  return normalizeName(item.creator).includes(a) || normalizeName(item.title).includes(a);
}

function Svg({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">{children}</svg>;
}
function HomeIcon() { return <Svg><path d="M4.5 10.4 12 4.7l7.5 5.7V20h-5.2v-5.2h-4.6V20H4.5v-9.6Z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round"/></Svg>; }
function SearchIcon() { return <Svg><circle cx="11" cy="11" r="6.6" stroke="currentColor" strokeWidth="1.9"/><path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/></Svg>; }
function MusicIcon() { return <Svg><path d="M9 17.5V6.7L19 4v10.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><circle cx="7" cy="18" r="2.8" stroke="currentColor" strokeWidth="1.8"/><circle cx="17" cy="18" r="2.8" stroke="currentColor" strokeWidth="1.8"/><path d="M9 10.4 19 7.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></Svg>; }
function LibraryIcon() { return <Svg><path d="M5.2 4.8h2.5v14.4H5.2zm5.5-1.1h2.5v16.6h-2.5zm5.5 2.2h2.6v12.2h-2.6z" fill="currentColor"/></Svg>; }
function HeartIcon({ filled }: { filled?: boolean }) { return <Svg><path d="M12 20.8 4.9 14c-1.5-1.4-2.4-3.1-2.4-5.3C2.5 5.5 5 3 8.1 3c1.7 0 3.3.8 4.4 2.1C13.6 3.8 15.2 3 16.9 3 20 3 22.5 5.5 22.5 8.7c0 2.2-.9 3.9-2.4 5.3L12 20.8Z" stroke="currentColor" strokeWidth="1.7" fill={filled ? "currentColor" : "none"}/></Svg>; }
function PlayIcon() { return <Svg><path d="M7.2 4.8 19.8 12 7.2 19.2V4.8Z" fill="currentColor"/></Svg>; }
function PauseIcon() { return <Svg><path d="M6.5 4.8h4.2v14.4H6.5zm6.8 0h4.2v14.4h-4.2z" fill="currentColor"/></Svg>; }
function PrevIcon() { return <Svg><path d="M11 12 21 18.8V5.2L11 12ZM3 5.2v13.6h2.2V5.2H3Zm4.2 6.8 10 6.8V5.2L7.2 12Z" fill="currentColor"/></Svg>; }
function NextIcon() { return <Svg><path d="M13 5.2v13.6L23 12 13 5.2ZM18.8 5.2v13.6H21V5.2h-2.2ZM6.8 5.2v13.6L16.8 12 6.8 5.2Z" fill="currentColor"/></Svg>; }
function CloseIcon() { return <Svg><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></Svg>; }
function BackIcon() { return <Svg><path d="m15 5-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></Svg>; }
function QueueIcon() { return <Svg><path d="M4 6h11M4 12h11M4 18h7M18 13v7m0 0 3-3m-3 3-3-3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></Svg>; }
function ShuffleIcon({ active }: { active?: boolean }) { return <Svg><path d="M4 7h3c3.7 0 4.3 10 8 10h5M16 4l3 3-3 3M16 14l3 3-3 3" stroke={active ? "currentColor" : "currentColor"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></Svg>; }
function RepeatIcon({ mode }: { mode: RepeatMode }) { return <Svg><path d="M6 7h11l-2.4-2.4M18 17H7l2.4 2.4M17 7c2 0 3 1.2 3 3v1M7 17c-2 0-3-1.2-3-3v-1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>{mode === "one" ? <path d="M12 9v6m-1.5-4.5L12 9.3l1.5 1.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/> : null}</Svg>; }
function MoreIcon() { return <Svg><circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/></Svg>; }
function TimerIcon() { return <Svg><circle cx="12" cy="13" r="7.5" stroke="currentColor" strokeWidth="1.8"/><path d="M9 3h6M12 8v5l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></Svg>; }
function LyricsIcon() { return <Svg><path d="M6 5h12M6 9h12M6 13h8M6 17h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></Svg>; }
function StatsIcon() { return <Svg><path d="M5 19V9m7 10V5m7 14v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></Svg>; }
function SettingsIcon() { return <Svg><path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z" stroke="currentColor" strokeWidth="1.7"/><path d="m19.1 13.3 1.2 1-.9 1.6-1.5-.4a7.5 7.5 0 0 1-1.6 1l-.2 1.6h-1.9l-.5-1.5a7.4 7.4 0 0 1-1.9 0l-.5 1.5h-1.9l-.2-1.6a7.5 7.5 0 0 1-1.6-1l-1.5.4-.9-1.6 1.2-1a7.4 7.4 0 0 1 0-1.9l-1.2-1 .9-1.6 1.5.4a7.5 7.5 0 0 1 1.6-1l.2-1.6h1.9l.5 1.5a7.4 7.4 0 0 1 1.9 0l.5-1.5h1.9l.2 1.6a7.5 7.5 0 0 1 1.6 1l1.5-.4.9 1.6-1.2 1a7.4 7.4 0 0 1 0 1.9Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></Svg>; }
function PlusIcon() { return <Svg><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/></Svg>; }
function TrashIcon() { return <Svg><path d="M5 7h14M9 7V4h6v3m-8 0 1 13h8l1-13M10 11v5m4-5v5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></Svg>; }
function ChevronDownIcon() { return <Svg><path d="M6 9.5 12 15l6-5.5" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"/></Svg>; }
function SpeakerLowIcon() { return <Svg><path d="M11 5 6.6 8.3H4v7.4h2.6L11 19V5Z" fill="currentColor"/></Svg>; }
function SpeakerHighIcon() { return <Svg><path d="M10.8 5 6.5 8.3H4v7.4h2.5l4.3 3.3V5Z" fill="currentColor"/><path d="M15.2 9.1a4.2 4.2 0 0 1 0 5.8M18 7a8 8 0 0 1 0 10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></Svg>; }
function Equalizer({ active }: { active: boolean }) { return <div className="eq-wrap compact">{[0,140,280,420].map((delay,index)=><span key={delay} className={`eq-bar ${active?"animate":""}`} style={{height:`${10+index*4}px`,animationDelay:`${delay}ms`}}/>)}</div>; }
function formatRepeat(mode: RepeatMode) { return mode === "all" ? "Ulangi semua" : mode === "one" ? "Ulangi satu" : "Ulangi mati"; }

function SkeletonRecentList() {
  return <div className="vertical-list">{Array.from({length:4}).map((_,i)=><div key={i} className="skeleton-row"><div className="skeleton skeleton-cover"/><div className="skeleton-copy"><div className="skeleton skeleton-line long"/><div className="skeleton skeleton-line short"/></div><div className="skeleton skeleton-dot"/></div>)}</div>;
}
function SkeletonHorizontalRow() {
  return <div className="horizontal-scroll">{Array.from({length:4}).map((_,i)=><div key={i} className="h-card skeleton-card"><div className="skeleton skeleton-art"/><div className="skeleton skeleton-line long"/><div className="skeleton skeleton-line short"/></div>)}</div>;
}
function SkeletonArtistProfile() {
  return <><div className="artist-hero"><div className="back-btn skeleton-circle"/><div className="artist-hero-meta"><div className="artist-hero-img skeleton-circle big"/><div className="artist-hero-copy"><div className="skeleton skeleton-line short"/><div className="skeleton skeleton-line medium"/><div className="skeleton skeleton-line short"/></div></div></div><div className="section-container"><h2 className="section-title">Populer</h2><SkeletonRecentList/></div></>;
}

function TrackRow({ track, active, onClick, onArtistClick, onMenu }: { track:PipedTrack; active?:boolean; onClick:()=>void; onArtistClick?:()=>void; onMenu?:()=>void }) {
  return <div className={`v-item ${active?"active":""}`}>
    <button type="button" className="track-cover-btn" onClick={onClick}><img className="v-img" src={track.artwork} alt={track.title}/></button>
    <div className="v-info text-left"><button type="button" className="track-title-btn" onClick={onClick}><div className="v-title">{track.title}</div></button><button type="button" className="artist-link-btn" onClick={onArtistClick}><div className="v-sub">{track.artist}</div></button></div>
    <button type="button" className="dots-icon track-right-btn" onClick={onMenu || onClick} aria-label="Aksi lagu"><MoreIcon/></button>
  </div>;
}
function HorizontalTrackCard({track,onClick,onArtistClick}:{track:PipedTrack;onClick:()=>void;onArtistClick?:()=>void}) {
  return <div className="h-card text-left"><button type="button" className="h-card-main" onClick={onClick}><img className="h-img" src={track.artwork} alt={track.title}/><div className="h-title">{track.title}</div></button><button type="button" className="artist-link-btn horizontal" onClick={onArtistClick}><div className="h-sub">{track.artist}</div></button></div>;
}
function HorizontalCollectionCard({item,onClick}:{item:PipedCollection;onClick:()=>void}) {
  return <button type="button" className="h-card text-left" onClick={onClick}><img className="h-img" src={item.artwork} alt={item.title}/><div className="h-title">{item.title}</div><div className="h-sub">{item.creator}</div></button>;
}
function HorizontalArtistCard({artist,onClick}:{artist:PipedArtist;onClick:()=>void}) {
  return <button type="button" className="h-card text-left" onClick={onClick}><img className="h-img artist-img" src={artist.artwork} alt={artist.name}/><div className="h-title">{artist.name}</div><div className="h-sub">{artist.subscribersText} subscriber</div></button>;
}

function PlayerCard(props:{
  track:PipedTrack|null; playing:boolean; liked?:boolean; progress:number; currentTime:number; duration:number; volume:number; loadingStream:boolean;
  onClose:()=>void; onTogglePlay:()=>void; onPrev:()=>void; onNext:()=>void; onLike:()=>void; onArtistClick?:()=>void; onSeek:(v:number)=>void; onVolume:(v:number)=>void;
  onQueue:()=>void; onLyrics:()=>void; onTimer:()=>void; shuffle:boolean; repeat:RepeatMode; onShuffle:()=>void; onRepeat:()=>void;
}) {
  const {track,playing,liked,progress,currentTime,duration,volume,loadingStream,onClose,onTogglePlay,onPrev,onNext,onLike,onArtistClick,onSeek,onVolume,onQueue,onLyrics,onTimer,shuffle,repeat,onShuffle,onRepeat}=props;
  return <div className="player-phone-shell">
    <div className="player-grab-bar"/>
    <div className="player-modal-header">
      <button type="button" className="player-top-btn" onClick={onClose}><ChevronDownIcon/></button>
      <div className="player-header-text leftish"><span>Memainkan Lagu</span><strong>{track?.title||"Music"}</strong></div>
      <button type="button" className="player-top-btn" onClick={onQueue}><QueueIcon/></button>
    </div>
    <div className="player-card-box"><div className="player-card-surface">
      <div className="player-art-container-ref"><img src={track?.artwork||FALLBACK_ARTWORK} alt={track?.title||"Album Art"}/></div>
      <div className="player-track-info-ref left-align"><div className="player-track-copy left-align"><div className="player-title-ref">{track?.title||"Judul Lagu"}</div><button type="button" className="player-artist-button" onClick={onArtistClick}><div className="player-artist-ref">{track?.artist||"Artis"}</div></button></div><button type="button" className="player-like-inline" onClick={onLike} aria-label="Suka"><HeartIcon filled={liked}/></button></div>
      <div className="progress-container-ref"><input type="range" className="progress-bar-ref music-range" value={Math.min(currentTime,duration||track?.duration||0)} min={0} max={duration||track?.duration||0} step={0.1} onChange={e=>onSeek(Number(e.target.value))} style={{["--range-progress" as string]:`${progress}%`}}/><div className="time-info-ref"><span>{formatTime(currentTime)}</span><span>{loadingStream?"Memuat...":formatTime(Math.max((duration||track?.duration||0)-currentTime,0))}</span></div></div>
      <div className="playback-tools"><button type="button" className={`player-tool ${shuffle?"active":""}`} onClick={onShuffle} aria-label="Acak"><ShuffleIcon active={shuffle}/></button><button type="button" className={`player-tool ${repeat!=="off"?"active":""}`} onClick={onRepeat} aria-label="Ulangi"><RepeatIcon mode={repeat}/></button><button type="button" className="player-tool" onClick={onLyrics} aria-label="Lyrics"><LyricsIcon/></button><button type="button" className="player-tool" onClick={onTimer} aria-label="Sleep timer"><TimerIcon/></button></div>
      <div className="playback-controls-ref"><button type="button" className="ghost-player-btn" onClick={onPrev}><PrevIcon/></button><button type="button" className="play-pause-btn-ref" onClick={onTogglePlay}>{playing?<PauseIcon/>:<PlayIcon/>}</button><button type="button" className="ghost-player-btn" onClick={onNext}><NextIcon/></button></div>
      <div className="volume-row-ref"><SpeakerLowIcon/><input type="range" className="music-range" value={volume} min={0} max={100} onChange={e=>onVolume(Number(e.target.value))} style={{["--range-progress" as string]:`${volume}%`}}/><SpeakerHighIcon/></div>
      <div className="player-status-line"><span>{shuffle?"Acak aktif":"Urutan normal"}</span><span>{formatRepeat(repeat)}</span></div>
    </div></div>
  </div>;
}

export default function App() {
  const playerRef = useRef<any>(null);
  const lyricsListRef = useRef<HTMLDivElement|null>(null);
  const lyricRefs = useRef<Array<HTMLParagraphElement|null>>([]);

  const [activeView,setActiveView]=useState<ActiveView>("home");
  const [returnView,setReturnView]=useState<MainView>("home");
  const [playerOpen,setPlayerOpen]=useState(false);
  const [playerPanel,setPlayerPanel]=useState<"player"|"lyrics"|"queue">("player");
  const [queueOpen,setQueueOpen]=useState(false);
  const [sleepOpen,setSleepOpen]=useState(false);
  const [playlistOpen,setPlaylistOpen]=useState(false);
  const [playlistTarget,setPlaylistTarget]=useState<PipedTrack|null>(null);
  const [toast,setToast]=useState("");
  const [actionTrack,setActionTrack]=useState<PipedTrack|null>(null);
  const [isStatsOpen,setIsStatsOpen]=useState(false);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [autoplay,setAutoplay]=useState(true);
  const [playbackRate,setPlaybackRate]=useState(1);

  const [homeSections,setHomeSections]=useState<FeedSection[]>([]);
  const [albumRows,setAlbumRows]=useState<PipedCollection[]>([]);
  const [playlistRows,setPlaylistRows]=useState<PipedCollection[]>([]);
  const [artistRows,setArtistRows]=useState<PipedArtist[]>([]);
  const [searchInput,setSearchInput]=useState("");
  const [searchSuggestions,setSearchSuggestions]=useState<string[]>([]);
  const [searchHistory,setSearchHistory]=useState<string[]>([]);
  const [searchResults,setSearchResults]=useState<SearchBundle>({tracks:[],albums:[],playlists:[],artists:[]});
  const [artistDetail,setArtistDetail]=useState<ArtistDetail|null>(null);
  const [artistLoading,setArtistLoading]=useState(false);
  const [isHomeLoading,setIsHomeLoading]=useState(true);
  const [isSearchLoading,setIsSearchLoading]=useState(false);
  const [homeError,setHomeError]=useState("");
  const [searchMessage,setSearchMessage]=useState("");

  const [currentTrack,setCurrentTrack]=useState<PipedTrack|null>(null);
  const [playQueue,setPlayQueue]=useState<PipedTrack[]>([]);
  const [queueTitle,setQueueTitle]=useState("Music");
  const [queueIndex,setQueueIndex]=useState(0);
  const [likedTracks,setLikedTracks]=useState<Record<string,boolean>>({});
  const [recentPlayed,setRecentPlayed]=useState<PipedTrack[]>([]);
  const [playlists,setPlaylists]=useState<CustomPlaylist[]>([]);
  const [shuffle,setShuffle]=useState(false);
  const [repeat,setRepeat]=useState<RepeatMode>("off");
  const [playbackSource,setPlaybackSource]=useState<PlayableSource|null>(null);
  const [loadingStream,setLoadingStream]=useState(false);
  const [isPlaying,setIsPlaying]=useState(false);
  const [currentTime,setCurrentTime]=useState(0);
  const [duration,setDuration]=useState(0);
  const [volume,setVolume]=useState(78);
  const [sleepSeconds,setSleepSeconds]=useState(0);
  const [lyricsLoading,setLyricsLoading]=useState(false);
  const [plainLyrics,setPlainLyrics]=useState("");
  const [syncedLyrics,setSyncedLyrics]=useState("");
  const [stats,setStats]=useState<MusicStats>({totalPlays:0,totalSeconds:0,tracks:{}});

  const playerBackground=currentTrack?.artwork||recentPlayed[0]?.artwork||FALLBACK_ARTWORK;
  const visibleLyrics=useMemo<LyricLine[]>(()=>{
    const synced=parseLrc(syncedLyrics); if(synced.length) return synced;
    return plainLyrics.split("\n").map(v=>v.trim()).filter(Boolean).map((text,index)=>({time:index*4,text}));
  },[plainLyrics,syncedLyrics]);
  const activeLyricIndex=useMemo(()=>getActiveLyricIndex(visibleLyrics,currentTime),[visibleLyrics,currentTime]);
  const progress=duration>0?(currentTime/duration)*100:0;
  const masterQueue=useMemo(()=>dedupeTracks([...recentPlayed,...homeSections.flatMap(s=>s.tracks),...searchResults.tracks]),[recentPlayed,homeSections,searchResults.tracks]);
  const likedList=useMemo(()=>dedupeTracks([...Object.keys(likedTracks).filter(id=>likedTracks[id]).map(id=>[...masterQueue,...recentPlayed].find(t=>t.id===id)).filter(Boolean) as PipedTrack[]]),[likedTracks,masterQueue,recentPlayed]);
  const recentList=recentPlayed.length?recentPlayed.slice(0,6):homeSections[0]?.tracks.slice(0,6)||[];
  const smartMix=useMemo(()=>{
    const playedIds=new Set(recentPlayed.map(t=>t.id));
    const scored=new Map<string,number>();
    Object.values(stats.tracks).forEach(t=>scored.set(normalizeName(t.artist),(scored.get(normalizeName(t.artist))||0)+t.plays));
    return dedupeTracks(masterQueue).filter(t=>!playedIds.has(t.id)).sort((a,b)=>(scored.get(normalizeName(b.artist))||0)-(scored.get(normalizeName(a.artist))||0)).slice(0,12);
  },[masterQueue,recentPlayed,stats.tracks]);

  const notify=(message:string)=>{
    setToast(message);
    window.setTimeout(()=>setToast(current=>current===message?"":current),2600);
  };

  useEffect(()=>{
    setLikedTracks(tryParse(localStorage.getItem(STORAGE_LIKES),{}));
    setRecentPlayed(tryParse(localStorage.getItem(STORAGE_RECENT),[]));
    setPlayQueue(tryParse(localStorage.getItem(STORAGE_QUEUE),[]));
    setPlaylists(tryParse(localStorage.getItem(STORAGE_PLAYLISTS),[]));
    setSearchHistory(tryParse(localStorage.getItem(STORAGE_SEARCH_HISTORY),[]));
    setStats(tryParse(localStorage.getItem(STORAGE_STATS),{totalPlays:0,totalSeconds:0,tracks:{}}));
    setRepeat(tryParse<RepeatMode>(localStorage.getItem(STORAGE_REPEAT),"off"));
    setShuffle(tryParse(localStorage.getItem(STORAGE_SHUFFLE),false));
    setAutoplay(tryParse(localStorage.getItem(STORAGE_AUTOPLAY),true));
    setPlaybackRate(tryParse(localStorage.getItem(STORAGE_RATE),1));
    const saved=tryParse<{track:PipedTrack|null;index:number;time:number}>(localStorage.getItem(STORAGE_CURRENT),{track:null,index:0,time:0});
    if(saved.track){setCurrentTrack(saved.track);setQueueIndex(saved.index);setCurrentTime(saved.time||0);setDuration(saved.track.duration||0);}
  },[]);
  useEffect(()=>localStorage.setItem(STORAGE_LIKES,JSON.stringify(likedTracks)),[likedTracks]);
  useEffect(()=>localStorage.setItem(STORAGE_RECENT,JSON.stringify(recentPlayed.slice(0,50))),[recentPlayed]);
  useEffect(()=>localStorage.setItem(STORAGE_QUEUE,JSON.stringify(playQueue.slice(0,200))),[playQueue]);
  useEffect(()=>localStorage.setItem(STORAGE_PLAYLISTS,JSON.stringify(playlists)),[playlists]);
  useEffect(()=>localStorage.setItem(STORAGE_SEARCH_HISTORY,JSON.stringify(searchHistory.slice(0,12))),[searchHistory]);
  useEffect(()=>localStorage.setItem(STORAGE_STATS,JSON.stringify(stats)),[stats]);
  useEffect(()=>localStorage.setItem(STORAGE_REPEAT,JSON.stringify(repeat)),[repeat]);
  useEffect(()=>localStorage.setItem(STORAGE_SHUFFLE,JSON.stringify(shuffle)),[shuffle]);
  useEffect(()=>localStorage.setItem(STORAGE_AUTOPLAY,JSON.stringify(autoplay)),[autoplay]);
  useEffect(()=>localStorage.setItem(STORAGE_RATE,JSON.stringify(playbackRate)),[playbackRate]);
  useEffect(()=>{ if(currentTrack) localStorage.setItem(STORAGE_CURRENT,JSON.stringify({track:currentTrack,index:queueIndex,time:currentTime})); },[currentTrack,queueIndex,currentTime]);

  useEffect(()=>{
    let cancelled=false;
    const loadHome=async()=>{
      setIsHomeLoading(true);setHomeError("");
      try{
        const [anyar,gembira,charts,galau,tiktok,hits,globalPop,albums,playlistsRemote,artistsMain,artistsIndo,artistsGlobal]=await Promise.all([
          searchTracks("baru rilis indonesia official audio"),searchTracks("lagu semangat indonesia official audio"),getTrendingTracks("ID"),
          searchTracks("lagu galau indonesia official audio"),searchTracks("viral tiktok indonesia official audio"),searchTracks("top hits indonesia official audio"),
          searchTracks("Justin Bieber Billie Eilish Bruno Mars Taylor Swift Multo official songs"),searchAlbums("Hindia"),searchPlaylists("This is Hindia"),
          searchArtists("Hindia Justin Bieber Billie Eilish Multo"),searchArtists("Hindia Tulus Sheila On 7 Pamungkas Nadin Amizah Kunto Aji"),
          searchArtists("Justin Bieber Billie Eilish Bruno Mars Taylor Swift Olivia Rodrigo The Weeknd")
        ]);
        if(cancelled)return;
        const sections=[
          ["anyar","Rilis Anyar (Baru Rilis)",anyar],["gembira","Gembira & Semangat",gembira],["charts","Tangga Lagu Populer",charts],["global","Global Pop Pilihan",globalPop],
          ["galau","Galau Terpopuler",galau],["tiktok","Viral TikTok",tiktok],["hits","Hit terpopuler hari ini",hits]
        ].map(([id,title,tracks])=>({id:id as string,title:title as string,tracks:filterHomeTracks(tracks as PipedTrack[]).slice(0,12)})).filter(s=>s.tracks.length);
        setHomeSections(sections);
        const merged=new Map<string,PipedArtist>(); [...artistsIndo,...artistsGlobal,...artistsMain].forEach(a=>{if(!merged.has(a.name.toLowerCase()))merged.set(a.name.toLowerCase(),a);});
        setAlbumRows(albums.slice(0,10));setPlaylistRows(playlistsRemote.slice(0,10));setArtistRows([...merged.values()].slice(0,14));
        const fallback=sections[2]?.tracks[0]||sections[0]?.tracks[0]||null;
        if(fallback){setCurrentTrack(prev=>prev||fallback);setPlayQueue(prev=>prev.length?prev:sections[2]?.tracks||[]);setDuration(prev=>prev||fallback.duration||0);}
      }catch(error){if(!cancelled)setHomeError(error instanceof Error?error.message:"Gagal memuat home.");}
      finally{if(!cancelled)setIsHomeLoading(false);}
    };
    void loadHome();return()=>{cancelled=true};
  },[]);

  useEffect(()=>{
    if(!searchInput.trim()){setSearchSuggestions([]);return;}
    const id=window.setTimeout(()=>void getSearchSuggestions(searchInput).then(setSearchSuggestions).catch(()=>setSearchSuggestions([])),300);
    return()=>window.clearTimeout(id);
  },[searchInput]);

  useEffect(()=>{
    if(!currentTrack){setPlaybackSource(null);return;}
    let cancelled=false;setLoadingStream(true);setPlaybackSource({src:currentTrack.youtubeUrl,mode:"youtube"});setDuration(currentTrack.duration||0);
    void getTrackPlaybackSource(currentTrack.videoId).then(source=>{if(cancelled)return;setPlaybackSource(source);if(source.duration)setDuration(source.duration);}).catch(()=>{}).finally(()=>{if(!cancelled)setLoadingStream(false)});
    return()=>{cancelled=true};
  },[currentTrack?.id]);

  useEffect(()=>{
    let cancelled=false;
    if(!currentTrack){setPlainLyrics("");setSyncedLyrics("");return;}
    setLyricsLoading(true);
    void getLyrics(cleanForLyrics(currentTrack.title),cleanForLyrics(currentTrack.artist)).then(result=>{if(cancelled)return;setPlainLyrics(result.plain);setSyncedLyrics(result.synced)}).catch(()=>{if(!cancelled){setPlainLyrics("");setSyncedLyrics("")}}).finally(()=>{if(!cancelled)setLyricsLoading(false)});
    return()=>{cancelled=true};
  },[currentTrack?.id]);

  useEffect(()=>{
    const container=lyricsListRef.current, line=lyricRefs.current[activeLyricIndex];
    if(!container||!line||activeLyricIndex<0)return;
    const top=line.offsetTop,bottom=top+line.clientHeight;
    if(top<container.scrollTop+24||bottom>container.scrollTop+container.clientHeight-24) container.scrollTo({top:Math.max(top-container.clientHeight/2+line.clientHeight,0),behavior:"smooth"});
  },[activeLyricIndex]);

  useEffect(()=>{
    if(!sleepSeconds||!isPlaying)return;
    const id=window.setInterval(()=>setSleepSeconds(v=>Math.max(0,v-1)),1000);
    return()=>window.clearInterval(id);
  },[sleepSeconds,isPlaying]);
  useEffect(()=>{
    if(sleepSeconds===0&&isPlaying){ /* timer expiry is handled by transition guard below */ }
  },[sleepSeconds,isPlaying]);
  useEffect(()=>{
    if(sleepSeconds===0)return;
    if(sleepSeconds<=1){setIsPlaying(false);setSleepSeconds(0);notify("Sleep timer selesai.");}
  },[sleepSeconds]);

  useEffect(()=>{
    if(!isPlaying||!currentTrack)return;
    const id=window.setInterval(()=>setStats(prev=>({...prev,totalSeconds:prev.totalSeconds+1,tracks:{...prev.tracks,[currentTrack.id]:{title:currentTrack.title,artist:currentTrack.artist,plays:prev.tracks[currentTrack.id]?.plays||0,seconds:(prev.tracks[currentTrack.id]?.seconds||0)+1}}})),1000);
    return()=>window.clearInterval(id);
  },[isPlaying,currentTrack?.id]);

  useEffect(()=>{
    if(!("mediaSession" in navigator)||!duration||!Number.isFinite(currentTime)||!Number.isFinite(duration))return;
    try{
      if(typeof navigator.mediaSession.setPositionState==="function")
        navigator.mediaSession.setPositionState({duration:Math.max(duration,0.001),playbackRate:playbackRate,position:Math.min(Math.max(currentTime,0),duration)});
    }catch{}
  },[currentTime,duration,playbackRate]);

  useEffect(()=>{
    if(!("mediaSession" in navigator)||!currentTrack)return;
    try{
      navigator.mediaSession.metadata=new MediaMetadata({title:currentTrack.title,artist:currentTrack.artist,album:"Satria Music",artwork:[{src:currentTrack.artwork,sizes:"512x512",type:"image/jpeg"}]});
      navigator.mediaSession.setActionHandler("play",()=>setIsPlaying(true));
      navigator.mediaSession.setActionHandler("pause",()=>setIsPlaying(false));
      navigator.mediaSession.setActionHandler("previoustrack",()=>handlePrevious());
      navigator.mediaSession.setActionHandler("nexttrack",()=>handleNext());
      navigator.mediaSession.setActionHandler("seekbackward",()=>handleSeek(Math.max(0,currentTime-10)));
      navigator.mediaSession.setActionHandler("seekforward",()=>handleSeek(Math.min(duration,currentTime+10)));
    }catch{}
    return()=>{try{navigator.mediaSession.setActionHandler("play",null);navigator.mediaSession.setActionHandler("pause",null);navigator.mediaSession.setActionHandler("previoustrack",null);navigator.mediaSession.setActionHandler("nexttrack",null)}catch{}};
  });

  const getNativeMedia=(): HTMLMediaElement|null=>{
    const ref=playerRef.current;
    try{
      const internal=ref?.getInternalPlayer?.();
      if(internal && typeof internal.playbackRate === "number") return internal as HTMLMediaElement;
    }catch{}
    const media=document.querySelector<HTMLMediaElement>(".hidden-player-host audio, .hidden-player-host video");
    return media;
  };

  const applyPlaybackRate=()=>{
    const media=getNativeMedia();
    if(!media)return false;
    try{
      const rate=Math.min(2,Math.max(0.25,Number(playbackRate)||1));
      media.defaultPlaybackRate=rate;
      media.playbackRate=rate;
      return Math.abs(media.playbackRate-rate)<0.01;
    }catch{return false;}
  };

  useEffect(()=>{
    let cancelled=false;
    let attempts=0;
    const apply=()=>{
      if(cancelled)return;
      if(applyPlaybackRate()||attempts>=30)return;
      attempts+=1;
      window.setTimeout(apply,100);
    };
    apply();
    return()=>{cancelled=true};
  },[playbackRate,currentTrack?.id,playbackSource?.src]);

  // Some streaming backends recreate/reset the native media element's rate
  // after buffering. Keep the selected rate enforced while the track is active.
  useEffect(()=>{
    if(!currentTrack)return;
    let cancelled=false;
    let timer=0;
    const enforce=()=>{
      if(cancelled)return;
      const media=getNativeMedia();
      if(media && Math.abs(media.playbackRate-playbackRate)>0.01) applyPlaybackRate();
      timer=window.setTimeout(enforce,250);
    };
    enforce();
    return()=>{cancelled=true;window.clearTimeout(timer)};
  },[currentTrack?.id,playbackRate,playbackSource?.src,isPlaying]);

  useEffect(()=>{
    const onVisibility=()=>{
      // Do not pause or reset playback when Chrome moves the page to the background.
      // The native media element can continue playing while the document is hidden.
      if(!document.hidden) applyPlaybackRate();
    };
    document.addEventListener("visibilitychange",onVisibility);
    return()=>document.removeEventListener("visibilitychange",onVisibility);
  },[playbackRate]);

  useEffect(()=>{
    if(!currentTrack)return;
    const img=new Image();img.crossOrigin="anonymous";img.src=currentTrack.artwork;
    img.onload=()=>{
      try{
        const canvas=document.createElement("canvas"),ctx=canvas.getContext("2d");if(!ctx)return;
        canvas.width=32;canvas.height=32;ctx.drawImage(img,0,0,32,32);const data=ctx.getImageData(0,0,32,32).data;
        let r=0,g=0,b=0,count=0;
        for(let i=0;i<data.length;i+=4){if(data[i+3]<150)continue;r+=data[i];g+=data[i+1];b+=data[i+2];count++;}
        if(count){r=Math.round(r/count);g=Math.round(g/count);b=Math.round(b/count);document.documentElement.style.setProperty("--dynamic-accent",`rgb(${r} ${g} ${b})`);document.documentElement.style.setProperty("--dynamic-accent-soft",`rgba(${r},${g},${b},.25)`);}
      }catch{}
    };
  },[currentTrack?.artwork]);

  const recordPlay=(track:PipedTrack)=>{
    setStats(prev=>({...prev,totalPlays:prev.totalPlays+1,tracks:{...prev.tracks,[track.id]:{title:track.title,artist:track.artist,plays:(prev.tracks[track.id]?.plays||0)+1,seconds:prev.tracks[track.id]?.seconds||0}}}));
  };
  const openTrack=(track:PipedTrack, source:PipedTrack[], title:string, shouldOpen=true)=>{
    const queue=dedupeTracks(source.length?source:[track]);const index=Math.max(0,queue.findIndex(t=>t.id===track.id));
    setCurrentTrack(track);setPlayQueue(queue);setQueueIndex(index);setQueueTitle(title);setCurrentTime(0);setDuration(track.duration||0);setIsPlaying(true);if(shouldOpen)setPlayerOpen(true);
    setRecentPlayed(prev=>dedupeTracks([track,...prev]).slice(0,50));recordPlay(track);
  };
  function handleNext(){
    if(!playQueue.length)return;
    if(!autoplay){setIsPlaying(false);return;}
    if(repeat==="one"){setCurrentTime(0);setIsPlaying(true);return;}
    let nextIndex=queueIndex+1;
    if(shuffle&&playQueue.length>1){const candidates=playQueue.map((_,i)=>i).filter(i=>i!==queueIndex);nextIndex=candidates[Math.floor(Math.random()*candidates.length)];}
    if(nextIndex>=playQueue.length){if(repeat==="all")nextIndex=0;else{setIsPlaying(false);return;}}
    const next=playQueue[nextIndex];setQueueIndex(nextIndex);setCurrentTrack(next);setCurrentTime(0);setDuration(next.duration||0);setIsPlaying(true);setRecentPlayed(prev=>dedupeTracks([next,...prev]).slice(0,50));recordPlay(next);
  }
  function handlePrevious(){
    if(currentTime>5){handleSeek(0);return;}
    if(!playQueue.length)return;
    const prevIndex=queueIndex<=0?(repeat==="all"?playQueue.length-1:0):queueIndex-1;
    const track=playQueue[prevIndex];setQueueIndex(prevIndex);setCurrentTrack(track);setCurrentTime(0);setDuration(track.duration||0);setIsPlaying(true);recordPlay(track);
  }
  function handleTogglePlay(){
    if(!currentTrack){const fallback=recentList[0]||homeSections[0]?.tracks[0];if(fallback)openTrack(fallback,recentList.length?recentList:homeSections[0].tracks,"Sering kamu dengarkan");return;}
    setIsPlaying(v=>!v);
  }
  function handleSeek(value:number){if(playerRef.current)playerRef.current.currentTime=value;setCurrentTime(value);}
  function handleToggleLike(track:PipedTrack){
    setLikedTracks(prev=>{
      const nextLiked=!prev[track.id];
      notify(nextLiked?"Ditambahkan ke lagu yang disukai":"Dihapus dari lagu yang disukai");
      return {...prev,[track.id]:nextLiked};
    });
  }
  function addToQueue(track:PipedTrack,afterCurrent=false){
    setPlayQueue(prev=>{
      const without=prev.filter(t=>t.id!==track.id);
      const index=afterCurrent?Math.max(0,without.findIndex(t=>t.id===currentTrack?.id)+1):without.length;
      const result=[...without];result.splice(index<0?result.length:index,0,track);return result;
    });notify(afterCurrent?"Ditambahkan sebagai lagu berikutnya":"Ditambahkan ke antrean");
  }
  function removeFromQueue(index:number){
    if(index===queueIndex){notify("Lagu yang sedang diputar tidak dapat dihapus dari antrean aktif.");return;}
    setPlayQueue(prev=>prev.filter((_,i)=>i!==index));
    setQueueIndex(i=>index<i?i-1:i);
  }
  function moveQueue(from:number,to:number){
    if(to<0||to>=playQueue.length)return;
    setPlayQueue(prev=>{const next=[...prev];const [item]=next.splice(from,1);next.splice(to,0,item);return next;});
    setQueueIndex(i=>{if(i===from)return to;if(from<i&&to>=i)return i-1;if(from>i&&to<=i)return i+1;return i;});
  }
  function playQueueItem(index:number){
    const track=playQueue[index];if(!track)return;
    setQueueIndex(index);setCurrentTrack(track);setCurrentTime(0);setDuration(track.duration||0);setIsPlaying(true);setRecentPlayed(prev=>dedupeTracks([track,...prev]).slice(0,50));recordPlay(track);
  }
  function cycleRepeat(){setRepeat(prev=>prev==="off"?"all":prev==="all"?"one":"off");}
  function clearHistory(){setRecentPlayed([]);notify("Riwayat diputar dihapus.");}
  function createPlaylist(){
    const name=window.prompt("Nama playlist baru");if(!name?.trim())return;
    const playlist={id:`pl-${Date.now()}`,name:name.trim(),tracks:[]};setPlaylists(prev=>[...prev,playlist]);notify("Playlist dibuat.");
  }
  function renamePlaylist(id:string){
    const playlist=playlists.find(p=>p.id===id);if(!playlist)return;const name=window.prompt("Nama playlist",playlist.name);if(!name?.trim())return;
    setPlaylists(prev=>prev.map(p=>p.id===id?{...p,name:name.trim()}:p));notify("Playlist diubah.");
  }
  function deletePlaylist(id:string){setPlaylists(prev=>prev.filter(p=>p.id!==id));notify("Playlist dihapus.");}
  function addTrackToPlaylist(id:string,track:PipedTrack){setPlaylists(prev=>prev.map(p=>p.id===id&& !p.tracks.some(t=>t.id===track.id)?{...p,tracks:[...p.tracks,track]}:p));notify("Ditambahkan ke playlist.");}
  function removeTrackFromPlaylist(id:string,trackId:string){setPlaylists(prev=>prev.map(p=>p.id===id?{...p,tracks:p.tracks.filter(t=>t.id!==trackId)}:p));}
  function saveQueueAsPlaylist(){
    const tracks=dedupeTracks(playQueue);
    if(!tracks.length){notify("Antrean masih kosong.");return;}
    const name=window.prompt("Nama playlist", "Antrean saya");
    if(!name?.trim())return;
    setPlaylists(prev=>[...prev,{id:`pl-${Date.now()}`,name:name.trim(),tracks}]);
    notify("Antrean disimpan sebagai playlist.");
  }
  function clearQueue(){
    setPlayQueue(currentTrack?[currentTrack]:[]);
    setQueueIndex(0);
    notify("Antrean dibersihkan.");
  }
  function handleSearch(query=searchInput){
    const trimmed=query.trim();if(!trimmed)return;
    setActiveView("search");setIsSearchLoading(true);setSearchMessage("Mencari lagu, album, playlist, dan artis...");
    setSearchHistory(prev=>[trimmed,...prev.filter(v=>normalizeName(v)!==normalizeName(trimmed))].slice(0,12));
    void Promise.all([searchTracks(trimmed),searchAlbums(trimmed),searchPlaylists(trimmed),searchArtists(trimmed)]).then(([tracks,albums,playlistsRemote,artists])=>{setSearchResults({tracks,albums,playlists:playlistsRemote,artists});setSearchMessage(`Hasil untuk "${trimmed}".`)}).catch(e=>setSearchMessage(e instanceof Error?e.message:"Pencarian gagal.")).finally(()=>{setIsSearchLoading(false);setSearchSuggestions([])});
  }
  function handleSubmit(e:FormEvent<HTMLFormElement>){e.preventDefault();void handleSearch();}
  async function openCollection(item:PipedCollection){
    try{const detail=await getPlaylistTracks(item.id);setActiveView("search");setSearchResults(prev=>({...prev,tracks:detail.tracks}));setSearchMessage(`Membuka ${item.type} "${detail.title}".`)}catch(e){setSearchMessage(e instanceof Error?e.message:"Gagal membuka koleksi.")}
  }
  async function openArtist(artist:PipedArtist){
    setReturnView(activeView==="artist"?"home":activeView as MainView);setActiveView("artist");setArtistLoading(true);setArtistDetail({artist,tracks:[],albums:[],playlists:[]});
    try{const [matches,tracks,albums,playlistsRemote]=await Promise.all([searchArtists(artist.name),searchTracks(`${artist.name} official songs`),searchAlbums(artist.name),searchPlaylists(artist.name)]);const resolved=chooseBestArtistMatch(artist.name,matches)||artist;setArtistDetail({artist:resolved,tracks:(tracks.filter(t=>isTrackFromArtist(t,resolved.name)).length?tracks.filter(t=>isTrackFromArtist(t,resolved.name)):tracks).slice(0,12),albums:(albums.filter(a=>isCollectionFromArtist(a,resolved.name)).length?albums.filter(a=>isCollectionFromArtist(a,resolved.name)):albums).slice(0,10),playlists:(playlistsRemote.filter(a=>isCollectionFromArtist(a,resolved.name)).length?playlistsRemote.filter(a=>isCollectionFromArtist(a,resolved.name)):playlistsRemote).slice(0,10)})}finally{setArtistLoading(false)}
  }

  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{
      const target=e.target as HTMLElement|null;
      if(target && ["INPUT","TEXTAREA","BUTTON"].includes(target.tagName))return;
      if(e.code==="Space"){e.preventDefault();handleTogglePlay();}
      else if(e.key==="ArrowRight")handleSeek(Math.min(duration,currentTime+5));
      else if(e.key==="ArrowLeft")handleSeek(Math.max(0,currentTime-5));
      else if(e.key==="ArrowUp"){e.preventDefault();setVolume(v=>Math.min(100,v+5));}
      else if(e.key==="ArrowDown"){e.preventDefault();setVolume(v=>Math.max(0,v-5));}
    };
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[currentTime,duration,currentTrack?.id,isPlaying]);

  const topTracks=Object.values(stats.tracks).sort((a,b)=>b.plays-a.plays).slice(0,5);
  const topArtists=Object.values(stats.tracks).reduce<Record<string,{artist:string;plays:number}>>((acc,item)=>{const key=item.artist;acc[key]??={artist:key,plays:0};acc[key].plays+=item.plays;return acc}, {});
  const topArtistList=Object.values(topArtists).sort((a,b)=>b.plays-a.plays).slice(0,5);

  return <>
    <div className="app-bg" style={{backgroundImage:`url(${playerBackground})`}}/>
    <main className="app-shell">
      <section className={`view-section ${activeView==="home"?"active":""}`}>
        <div className="home-header no-avatar-header"><div className="pill active">Semua</div><div className="pill">Musik</div><div className="pill">Podcast</div></div>
        <div className="section-container"><h2 className="section-title">Sering kamu dengarkan</h2>{recentList.length?<div className="vertical-list">{recentList.map(t=><TrackRow key={t.id} track={t} active={currentTrack?.id===t.id} onClick={()=>openTrack(t,recentList,t.title)} onArtistClick={()=>void openArtist(artistFromTrack(t))} onMenu={()=>setActionTrack(t)}/>)}</div>:isHomeLoading?<SkeletonRecentList/>:<div className="vertical-list"><div className="empty-copy">Belum ada lagu di daftar ini.</div></div>}</div>
        {homeError?<div className="section-container"><div className="empty-copy error-copy">{homeError}</div></div>:null}
        {isHomeLoading&&!homeSections.length?<>{Array.from({length:4}).map((_,i)=><div key={i} className="section-container"><h2 className="section-title">Memuat katalog...</h2><SkeletonHorizontalRow/></div>)}</>:<>
          {homeSections.map(section=><div className="section-container" key={section.id}><h2 className="section-title">{section.title}</h2><div className="horizontal-scroll">{section.tracks.map(t=><HorizontalTrackCard key={t.id} track={t} onClick={()=>openTrack(t,section.tracks,t.title)} onArtistClick={()=>void openArtist(artistFromTrack(t))}/>)}</div></div>)}
          {smartMix.length?<div className="section-container"><div className="section-title-row"><h2 className="section-title">Dibuat untuk kamu</h2><span className="mini-heading">Berdasarkan riwayat lokal</span></div><div className="horizontal-scroll">{smartMix.map(t=><HorizontalTrackCard key={`mix-${t.id}`} track={t} onClick={()=>openTrack(t,smartMix,"Dibuat untuk kamu")} onArtistClick={()=>void openArtist(artistFromTrack(t))}/>)}</div></div>:null}
          <div className="section-container"><h2 className="section-title">Album dan single populer</h2><div className="horizontal-scroll">{albumRows.map(i=><HorizontalCollectionCard key={i.id} item={i} onClick={()=>void openCollection(i)}/>)}</div></div>
          <div className="section-container"><h2 className="section-title">Artis Terpopuler Saat Ini</h2><div className="horizontal-scroll">{artistRows.map(a=><HorizontalArtistCard key={a.id} artist={a} onClick={()=>void openArtist(a)}/>)}</div></div>
          <div className="section-container"><h2 className="section-title">Playlist populer</h2><div className="horizontal-scroll">{playlistRows.map(i=><HorizontalCollectionCard key={i.id} item={i} onClick={()=>void openCollection(i)}/>)}</div></div>
        </>}
        {recentPlayed.length?<div className="section-container"><div className="section-title-row"><h2 className="section-title">Recently Played</h2><button type="button" className="text-btn" onClick={clearHistory}>Hapus riwayat</button></div><div className="horizontal-scroll">{recentPlayed.slice(0,10).map(t=><HorizontalTrackCard key={`r-${t.id}`} track={t} onClick={()=>openTrack(t,recentPlayed,"Recently Played")} onArtistClick={()=>void openArtist(artistFromTrack(t))}/>)}</div></div>:null}
      </section>

      <section className={`view-section ${activeView==="search"?"active":""}`}>
        <div className="search-header-container no-avatar-header"><h1>Cari</h1></div>
        <form onSubmit={handleSubmit} className="search-box-wrapper"><div className="search-icon-input"><SearchIcon/></div><input className="search-box" placeholder="Apa yang ingin kamu dengarkan?" value={searchInput} onChange={e=>setSearchInput(e.target.value)} onFocus={()=>{}}/></form>
        {searchHistory.length?<div className="search-history"><div className="section-title-row"><span className="mini-heading">Pencarian terakhir</span><button className="text-btn" type="button" onClick={()=>setSearchHistory([])}>Hapus</button></div><div className="search-history-list">{searchHistory.map(q=><button key={q} type="button" className="history-chip" onClick={()=>{setSearchInput(q);void handleSearch(q)}}><SearchIcon/>{q}</button>)}</div></div>:null}
        <div className="quick-search-row">{QUICK_SEARCHES.map(item=><button key={item} type="button" className="pill" onClick={()=>{setSearchInput(item);void handleSearch(item)}}>{item}</button>)}</div>
        {searchSuggestions.length?<div className="section-container"><div className="vertical-list">{searchSuggestions.map(item=><button key={item} className="search-suggestion" type="button" onClick={()=>{setSearchInput(item);void handleSearch(item)}}><SearchIcon/><span>{item}</span></button>)}</div></div>:null}
        {searchResults.tracks.length===0&&searchResults.artists.length===0&&!isSearchLoading?<div id="searchCategoriesUI"><h2 className="section-title">Jelajahi semua</h2><div className="category-grid">{searchCategories.map(c=><button key={c.title} type="button" className="category-card" style={{backgroundColor:c.color}} onClick={()=>{setSearchInput(c.title);void handleSearch(c.title)}}><div className="category-title">{c.title}</div><img className="category-img" src={c.image} alt={c.title}/></button>)}</div></div>:<div id="searchResultsUI"><h2 className="section-title">{isSearchLoading?"Memuat hasil...":searchMessage||"Hasil pencarian"}</h2>{isSearchLoading?<SkeletonRecentList/>:<><div className="vertical-list">{searchResults.tracks.map(t=><TrackRow key={t.id} track={t} active={currentTrack?.id===t.id} onClick={()=>openTrack(t,searchResults.tracks,t.title)} onArtistClick={()=>void openArtist(artistFromTrack(t))} onMenu={()=>setActionTrack(t)}/>)}</div>{searchResults.artists.length?<div className="section-container"><h2 className="section-title">Artist</h2><div className="horizontal-scroll">{searchResults.artists.map(a=><HorizontalArtistCard key={a.id} artist={a} onClick={()=>void openArtist(a)}/>)}</div></div>:null}</>}</div>}
      </section>

      <section className={`view-section ${activeView==="library"?"active":""}`}>
        <div className="lib-header no-avatar-header"><div className="lib-header-left"><h1 className="lib-title">Koleksi Kamu</h1></div><div className="header-actions"><button type="button" className="icon-btn" onClick={()=>setIsStatsOpen(true)} aria-label="Statistik"><StatsIcon/></button><button type="button" className="icon-btn" onClick={()=>setSettingsOpen(true)} aria-label="Pengaturan"><SettingsIcon/></button></div></div>
        <div className="lib-filters"><div className="pill active">Disukai</div><div className="pill">Playlist</div><div className="pill">Terakhir</div></div>
        <div className="section-container"><div className="section-title-row"><h2 className="section-title">Disukai</h2>{likedList.length?<button className="text-btn" type="button" onClick={()=>openTrack(likedList[0],likedList,"Lagu Disukai")}>Putar semua</button>:null}</div><div className="lib-list">{likedList.map(t=><div key={t.id} className="lib-item-row"><button type="button" className="lib-item" onClick={()=>openTrack(t,likedList,"Lagu Disukai")}><img className="lib-item-img" src={t.artwork} alt={t.title}/><div className="lib-item-info"><div className="lib-item-title">{t.title}</div><div className="lib-item-sub">{t.artist}</div></div></button><button type="button" className="icon-btn small" onClick={()=>handleToggleLike(t)}><HeartIcon filled/></button></div>)}{!likedList.length?<div className="empty-copy">Belum ada lagu favorit di koleksi kamu.</div>:null}</div></div>
        <div className="section-container"><div className="section-title-row"><h2 className="section-title">Playlist Kamu</h2><button type="button" className="icon-btn" onClick={createPlaylist} aria-label="Buat playlist"><PlusIcon/></button></div>{playlists.map(p=><div key={p.id} className="custom-playlist"><div className="playlist-header"><button type="button" className="playlist-main" onClick={()=>p.tracks.length&&openTrack(p.tracks[0],p.tracks,p.name)}><div className="playlist-art">{p.tracks[0]?<img src={p.tracks[0].artwork} alt=""/>:<MusicIcon/>}</div><div><strong>{p.name}</strong><span>{p.tracks.length} lagu</span></div></button><div className="playlist-actions"><button className="icon-btn small" type="button" onClick={()=>renamePlaylist(p.id)} aria-label="Ubah nama"><MoreIcon/></button><button className="icon-btn small" type="button" onClick={()=>deletePlaylist(p.id)} aria-label="Hapus playlist"><TrashIcon/></button></div></div>{p.tracks.length?<div className="playlist-track-list">{p.tracks.map(t=><div key={t.id} className="playlist-track"><button type="button" onClick={()=>openTrack(t,p.tracks,p.name)}><img src={t.artwork} alt=""/><span><strong>{t.title}</strong><small>{t.artist}</small></span></button><button type="button" className="icon-btn small" onClick={()=>removeTrackFromPlaylist(p.id,t.id)}><TrashIcon/></button></div>)}</div>:<div className="empty-copy playlist-empty">Playlist masih kosong.</div>}</div>)}{!playlists.length?<div className="empty-copy">Belum ada playlist. Buat playlist baru untuk menyimpan lagu.</div>:null}</div>
        <div className="section-container"><div className="section-title-row"><h2 className="section-title">Recently Played</h2>{recentPlayed.length?<button className="text-btn" type="button" onClick={clearHistory}>Hapus</button>:null}</div><div className="lib-list">{recentPlayed.slice(0,20).map(t=><button key={t.id} type="button" className="lib-item" onClick={()=>openTrack(t,recentPlayed,"Recently Played")}><img className="lib-item-img" src={t.artwork} alt={t.title}/><div className="lib-item-info"><div className="lib-item-title">{t.title}</div><div className="lib-item-sub">Baru diputar · {t.artist}</div></div></button>)}{!recentPlayed.length?<div className="empty-copy">Belum ada lagu terakhir diputar.</div>:null}</div></div>
      </section>

      <section className={`view-section ${activeView==="artist"?"active":""}`}>{artistLoading?<SkeletonArtistProfile/>:<><div className="artist-hero"><button type="button" className="back-btn" onClick={()=>setActiveView(returnView)}><BackIcon/></button><div className="artist-hero-meta"><img className="artist-hero-img" src={artistDetail?.artist.artwork||FALLBACK_ARTWORK} alt={artistDetail?.artist.name||"artist"}/><div><p className="artist-eyebrow">Profil artis</p><h1>{artistDetail?.artist.name||"Nama Artis"}</h1><p className="artist-subtext">{artistDetail?.artist.subscribersText||"Artis terpilih"}</p></div></div></div><div className="artist-actions-row"><button type="button" className="artist-play-btn" onClick={()=>artistDetail?.tracks[0]&&openTrack(artistDetail.tracks[0],artistDetail.tracks,artistDetail.artist.name)}><PlayIcon/></button></div><div className="section-container"><h2 className="section-title">Populer</h2><div className="vertical-list">{artistDetail?.tracks.map(t=><TrackRow key={t.id} track={t} active={currentTrack?.id===t.id} onClick={()=>openTrack(t,artistDetail.tracks,artistDetail.artist.name)} onArtistClick={()=>void openArtist(artistFromTrack(t))} onMenu={()=>setActionTrack(t)}/>)}</div></div>{artistDetail?.albums.length?<div className="section-container"><h2 className="section-title">Album</h2><div className="horizontal-scroll">{artistDetail.albums.map(i=><HorizontalCollectionCard key={i.id} item={i} onClick={()=>void openCollection(i)}/>)}</div></div>:null}{artistDetail?.playlists.length?<div className="section-container"><h2 className="section-title">Playlist</h2><div className="horizontal-scroll">{artistDetail.playlists.map(i=><HorizontalCollectionCard key={i.id} item={i} onClick={()=>void openCollection(i)}/>)}</div></div>:null}</>}</section>
    </main>

    {currentTrack&&!playerOpen&&!queueOpen&&!actionTrack&&!playlistOpen&&!sleepOpen&&!settingsOpen&&!isStatsOpen?<div className="mini-player"><button type="button" className="mini-player-main" onClick={()=>setPlayerOpen(true)}><img src={currentTrack.artwork} alt="Cover"/><div className="mini-player-info"><div className="mini-player-title">{currentTrack.title}</div><div className="mini-player-artist">{currentTrack.artist}</div></div></button><div className="mini-player-controls"><button type="button" className="mini-icon-btn" onClick={()=>handleToggleLike(currentTrack)} aria-label="Suka"><HeartIcon filled={likedTracks[currentTrack.id]}/></button><button type="button" className="mini-icon-btn" onClick={handleTogglePlay} aria-label={isPlaying?"Jeda":"Putar"}>{isPlaying?<PauseIcon/>:<PlayIcon/>}</button></div></div>:null}

    <nav className="bottom-nav"><button type="button" className={`nav-item ${activeView==="home"?"active":""}`} onClick={()=>setActiveView("home")}><HomeIcon/><span>Home</span></button><button type="button" className={`nav-item ${activeView==="search"?"active":""}`} onClick={()=>setActiveView("search")}><SearchIcon/><span>Cari</span></button><button type="button" className={`nav-item ${activeView==="library"?"active":""}`} onClick={()=>setActiveView("library")}><LibraryIcon/><span>Koleksi Kamu</span></button></nav>

    <div className={`modal-overlay ${playerOpen?"open":""}`}><div id="playerBg" style={{backgroundImage:`url(${playerBackground})`}}/><div className="player-modal-grid">
      <div className="player-modal-primary"><PlayerCard track={currentTrack} playing={isPlaying} liked={currentTrack?likedTracks[currentTrack.id]:false} progress={progress} currentTime={currentTime} duration={duration||currentTrack?.duration||0} volume={volume} loadingStream={loadingStream} onClose={()=>setPlayerOpen(false)} onTogglePlay={handleTogglePlay} onPrev={handlePrevious} onNext={handleNext} onLike={()=>currentTrack&&handleToggleLike(currentTrack)} onArtistClick={()=>currentTrack&&void openArtist(artistFromTrack(currentTrack))} onSeek={handleSeek} onVolume={setVolume} onQueue={()=>{setQueueOpen(true);setPlayerPanel("queue")}} onLyrics={()=>{setPlayerPanel("lyrics");setQueueOpen(false)}} onTimer={()=>setSleepOpen(true)} shuffle={shuffle} repeat={repeat} onShuffle={()=>setShuffle(v=>!v)} onRepeat={cycleRepeat}/></div>
      <div className={`lyrics-panel-shell ${playerPanel==="lyrics"?"mobile-panel-active":""}`}><div className="lyrics-panel-header"><div><div className="lyrics-eyebrow">Realtime lyrics</div><h3 className="lyrics-title">{currentTrack?.title||"Tidak ada lagu aktif"}</h3><p className="lyrics-subtitle">{lyricsLoading?"Memuat lirik...":visibleLyrics.length?"Sinkron dengan lagu":"Lirik belum tersedia"}</p></div><Equalizer active={isPlaying}/></div><div className="lyrics-list" ref={lyricsListRef}>{visibleLyrics.length?visibleLyrics.map((line,index)=><p key={`${line.time}-${index}`} ref={el=>{lyricRefs.current[index]=el}} className={`lyrics-line ${index===activeLyricIndex?"active":""}`} role="button" tabIndex={0} onClick={()=>handleSeek(line.time)} onKeyDown={e=>{if(e.key==="Enter"||e.key===" ")handleSeek(line.time)}}>{line.text}</p>):<div className="empty-copy">Putar lagu untuk melihat lyrics realtime di sini.</div>}</div><button type="button" className="lyrics-back-mobile" onClick={()=>setPlayerPanel("player")}><BackIcon/> Kembali ke player</button></div>
    </div></div>

    <div className={`overlay-panel ${queueOpen?"open":""}`} onClick={()=>setQueueOpen(false)}><div className="queue-sheet" onClick={e=>e.stopPropagation()}><div className="sheet-header"><div><span className="sheet-eyebrow">Antrean</span><h3>{queueTitle}</h3></div><button className="icon-btn" onClick={()=>setQueueOpen(false)}><CloseIcon/></button></div><div className="queue-actions"><button className="pill active" type="button" onClick={()=>currentTrack&&addToQueue(currentTrack,false)}>Tambah lagu aktif</button><button className={`pill ${shuffle?"active":""}`} type="button" onClick={()=>setShuffle(v=>!v)}><ShuffleIcon active={shuffle}/> Acak</button><button className={`pill ${autoplay?"active":""}`} type="button" onClick={()=>setAutoplay(v=>!v)}>Autoplay</button><button className="pill" type="button" onClick={saveQueueAsPlaylist}>Simpan playlist</button><button className="pill" type="button" onClick={clearQueue}>Bersihkan</button></div><div className="queue-list">{playQueue.map((t,index)=><div key={`${t.id}-${index}`} className={`queue-item ${index===queueIndex?"current":""}`}><button type="button" className="queue-main" onClick={()=>playQueueItem(index)}><img src={t.artwork} alt=""/><span><strong>{t.title}</strong><small>{t.artist}</small></span></button><div className="queue-item-actions"><button className="icon-btn small" type="button" disabled={index===0} onClick={()=>moveQueue(index,index-1)} aria-label="Naikkan"><BackIcon/></button><button className="icon-btn small" type="button" disabled={index===playQueue.length-1} onClick={()=>moveQueue(index,index+1)} aria-label="Turunkan"><ChevronDownIcon/></button><button className="icon-btn small" type="button" onClick={()=>removeFromQueue(index)} aria-label="Hapus"><TrashIcon/></button></div></div>)}{!playQueue.length?<div className="empty-copy">Antrean masih kosong.</div>:null}</div></div></div>

    {actionTrack?<div className="overlay-panel open" onClick={()=>setActionTrack(null)}><div className="action-sheet" onClick={e=>e.stopPropagation()}><div className="sheet-header"><div><span className="sheet-eyebrow">Aksi lagu</span><h3>{actionTrack.title}</h3></div><button className="icon-btn" onClick={()=>setActionTrack(null)}><CloseIcon/></button></div><button className="sheet-action" onClick={()=>{addToQueue(actionTrack);setActionTrack(null)}}>Tambahkan ke antrean</button><button className="sheet-action" onClick={()=>{addToQueue(actionTrack,true);setActionTrack(null)}}>Putar berikutnya</button><button className="sheet-action" onClick={()=>{setPlaylistTarget(actionTrack);setPlaylistOpen(true);setActionTrack(null)}}>Tambahkan ke playlist</button><button className="sheet-action" onClick={()=>{handleToggleLike(actionTrack);setActionTrack(null)}}>{likedTracks[actionTrack.id]?"Hapus dari lagu yang disukai":"Tambahkan ke lagu yang disukai"}</button></div></div>:null}

    {playlistOpen?<div className="overlay-panel open" onClick={()=>setPlaylistOpen(false)}><div className="action-sheet" onClick={e=>e.stopPropagation()}><div className="sheet-header"><div><span className="sheet-eyebrow">Playlist</span><h3>{playlistTarget?.title}</h3></div><button className="icon-btn" onClick={()=>setPlaylistOpen(false)}><CloseIcon/></button></div>{playlists.map(p=><button key={p.id} className="sheet-action" onClick={()=>{if(playlistTarget)addTrackToPlaylist(p.id,playlistTarget);setPlaylistOpen(false)}}>{p.name}<span>{p.tracks.some(t=>t.id===playlistTarget?.id)?"Sudah ada":""}</span></button>)}<button className="sheet-action primary" onClick={()=>{setPlaylistOpen(false);createPlaylist()}}><PlusIcon/> Buat playlist baru</button>{!playlists.length?<div className="empty-copy">Belum ada playlist.</div>:null}</div></div>:null}

    {sleepOpen?<div className="overlay-panel open" onClick={()=>setSleepOpen(false)}><div className="action-sheet compact-sheet" onClick={e=>e.stopPropagation()}><div className="sheet-header"><div><span className="sheet-eyebrow">Sleep timer</span><h3>{sleepSeconds?`Berakhir dalam ${formatTime(sleepSeconds)}`:"Pilih durasi"}</h3></div><button className="icon-btn" onClick={()=>setSleepOpen(false)}><CloseIcon/></button></div><div className="timer-grid">{[300,600,900,1800,3600].map(s=><button key={s} className="timer-option" onClick={()=>{setSleepSeconds(s);setSleepOpen(false);notify(`Sleep timer ${formatTime(s)}.`)}}>{formatTime(s)}</button>)}</div><button className="sheet-action" onClick={()=>{const raw=window.prompt("Durasi custom dalam menit");const min=Number(raw);if(Number.isFinite(min)&&min>0){setSleepSeconds(Math.round(min*60));setSleepOpen(false);notify(`Sleep timer ${min} menit.`)}}}>Custom</button>{sleepSeconds?<button className="sheet-action danger" onClick={()=>{setSleepSeconds(0);setSleepOpen(false);notify("Sleep timer dibatalkan.")}}>Batalkan timer</button>:null}</div></div>:null}

    {settingsOpen?<div className="overlay-panel open" onClick={()=>setSettingsOpen(false)}><div className="action-sheet compact-sheet" onClick={e=>e.stopPropagation()}><div className="sheet-header"><div><span className="sheet-eyebrow">Pengaturan pemutar</span><h3>Preferensi</h3></div><button className="icon-btn" onClick={()=>setSettingsOpen(false)}><CloseIcon/></button></div><button className={`sheet-action ${autoplay?"primary":""}`} onClick={()=>setAutoplay(v=>!v)}><span>Autoplay</span><span>{autoplay?"Aktif":"Mati"}</span></button><div className="settings-label">Kecepatan pemutaran</div><div className="timer-grid">{[0.75,1,1.25,1.5,2].map(rate=><button key={rate} className={`timer-option ${playbackRate===rate?"active": ""}`} onClick={()=>{setPlaybackRate(rate);notify(`Kecepatan ${rate}x.`)}}>{rate}x</button>)}</div><div className="settings-shortcuts"><strong>Pintasan keyboard</strong><span>Space: play/pause</span><span>← / →: mundur / maju 5 detik</span><span>↑ / ↓: volume</span></div></div></div>:null}

    {isStatsOpen?<div className="overlay-panel open" onClick={()=>setIsStatsOpen(false)}><div className="stats-sheet" onClick={e=>e.stopPropagation()}><div className="sheet-header"><div><span className="sheet-eyebrow">Statistik lokal</span><h3>Aktivitas mendengarkan</h3></div><button className="icon-btn" onClick={()=>setIsStatsOpen(false)}><CloseIcon/></button></div><div className="stats-grid"><div><strong>{stats.totalPlays}</strong><span>Total diputar</span></div><div><strong>{formatLongTime(stats.totalSeconds)}</strong><span>Total waktu</span></div></div><h4>Lagu paling sering diputar</h4><div className="stats-list">{topTracks.map(t=><div key={t.title+t.artist}><span><strong>{t.title}</strong><small>{t.artist}</small></span><b>{t.plays}x</b></div>)}{!topTracks.length?<div className="empty-copy">Belum ada data statistik.</div>:null}</div><h4>Artis paling sering diputar</h4><div className="stats-list">{topArtistList.map(a=><div key={a.artist}><span><strong>{a.artist}</strong></span><b>{a.plays}x</b></div>)}</div></div></div>:null}

    {toast?<div className="toast" role="status">{toast}</div>:null}

    <div className="hidden-player-host" aria-hidden="true"><ReactPlayer key={`${currentTrack?.id||"idle"}-${playbackSource?.mode||"none"}`} ref={playerRef} src={playbackSource?.src} playing={Boolean(currentTrack)&&isPlaying} playbackRate={playbackRate} controls={false} playsInline width={1} height={1} volume={volume/100} onReady={()=>{applyPlaybackRate();setLoadingStream(false)}} onCanPlay={()=>{applyPlaybackRate();setLoadingStream(false)}} onPlay={()=>{applyPlaybackRate();setIsPlaying(true)}} onPause={()=>setIsPlaying(false)} onEnded={handleNext} onDurationChange={e=>{applyPlaybackRate();setDuration(e.currentTarget.duration||currentTrack?.duration||0)}} onTimeUpdate={e=>setCurrentTime(e.currentTarget.currentTime||0)} onError={()=>{setLoadingStream(false);notify("Audio gagal dimainkan.")}}/></div>
  </>;
}
