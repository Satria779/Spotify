import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { supabase, supabaseConfigured } from "./supabase";
import type { SocialConversation, SocialMessage, SocialProfile, SharedPlaylist, SharedSong } from "./types";
import type { PipedTrack } from "../utils/piped";
import CommunityFeatures from "./CommunityFeatures";

function Icon({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">{children}</svg>;
}
const Back = () => <Icon><path d="m15 5-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></Icon>;
const Send = () => <Icon><path d="m4 4 16 8-16 8 2.4-7L15 12 6.4 11 4 4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></Icon>;
const Search = () => <Icon><circle cx="11" cy="11" r="6.6" stroke="currentColor" strokeWidth="1.9"/><path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/></Icon>;
const More = () => <Icon><circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/></Icon>;
const Close = () => <Icon><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></Icon>;
const UserIcon = () => <Icon><circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8"/><path d="M5 20c.9-3.5 3.1-5.2 7-5.2s6.1 1.7 7 5.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></Icon>;
const Plus = () => <Icon><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"/></Icon>;

const countryOptions = ["Indonesia", "Malaysia", "Singapore", "Thailand", "Philippines", "Vietnam", "Japan", "South Korea", "United States", "United Kingdom", "Australia", "Other"];

function timeLabel(value: string | null) {
  if (!value) return "Offline";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "Baru saja";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} menit lalu`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} jam lalu`;
  return `${Math.floor(seconds / 86400)} hari lalu`;
}
function isOnline(profile: SocialProfile | null, onlineIds: Set<string>) {
  return Boolean(profile && onlineIds.has(profile.id));
}
function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Terjadi kesalahan. Coba lagi.";
}

function AuthPanel({ onReady }: { onReady: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [identifier, setIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true); setError(""); setNotice("");
    try {
      if (mode === "register") {
        if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(username)) throw new Error("Username 3–24 karakter dan hanya boleh huruf, angka, titik, garis bawah, atau tanda minus.");
        if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Email tidak valid.");
        if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) throw new Error("Password minimal 8 karakter dan harus memiliki huruf besar, huruf kecil, serta angka.");
        if (password !== confirm) throw new Error("Konfirmasi password tidak cocok.");
        const { data, error: signUpError } = await supabase.auth.signUp({ email: email.trim().toLowerCase(), password, options: { data: { username: username.trim().toLowerCase() } } });
        if (signUpError) throw signUpError;
        if (data.session) onReady();
        else setNotice("Akun berhasil dibuat. Cek email jika verifikasi email diaktifkan di Supabase.");
      } else {
        const value = identifier.trim();
        if (!value || !password) throw new Error("Isi username/email dan password.");
        const { data, error: lookupError } = await supabase.functions.invoke("login-with-username", { body: { identifier: value.toLowerCase(), password } });
        if (lookupError || !data?.access_token || !data?.refresh_token) {
          const message = data?.error || lookupError?.message || "Username/email atau password salah.";
          throw new Error(message);
        }
        const { error: sessionError } = await supabase.auth.setSession({ access_token: data.access_token, refresh_token: data.refresh_token });
        if (sessionError) throw sessionError;
        onReady();
      }
    } catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  }

  return <div className="social-auth-shell"><div className="social-auth-card"><div className="social-brand-mark"><UserIcon/></div><h1>{mode === "login" ? "Masuk ke akun" : "Buat akun"}</h1><p className="social-muted">Gunakan akunmu untuk pesan, follow, dan berbagi musik.</p><form onSubmit={submit} className="social-form">
    {mode === "register" ? <><label>Username<input value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" placeholder="username"/></label><label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" placeholder="nama@email.com"/></label> </> : <label>Email atau username<input value={identifier} onChange={e=>setIdentifier(e.target.value)} autoComplete="username" placeholder="email atau username"/></label>}
    <label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder="Minimal 8 karakter"/></label>
    {mode === "register" ? <label>Konfirmasi password<input type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} autoComplete="new-password" placeholder="Ulangi password"/></label> : null}
    {error?<div className="social-error">{error}</div>:null}{notice?<div className="social-notice">{notice}</div>:null}
    <button className="social-primary-btn" disabled={busy} type="submit">{busy ? "Memproses..." : mode === "login" ? "Masuk" : "Daftar"}</button>
  </form><button className="social-link-btn" type="button" onClick={()=>{setMode(mode === "login" ? "register" : "login");setError("");setNotice("")}}>{mode === "login" ? "Belum punya akun? Daftar" : "Sudah punya akun? Masuk"}</button></div></div>;
}

export default function SocialPanel({ currentTrack, playlists, onPlayTrack, onPlayPlaylist, onImportPlaylist, notify }: { currentTrack: PipedTrack | null; playlists: Array<{ id: string; name: string; tracks: PipedTrack[] }>; onPlayTrack: (track: PipedTrack) => void; onPlayPlaylist: (tracks: PipedTrack[]) => void; onImportPlaylist: (name: string, tracks: PipedTrack[]) => void; notify: (message: string) => void }) {
  const [sessionReady, setSessionReady] = useState(false);
  const [profile, setProfile] = useState<SocialProfile | null>(null);
  const [profiles, setProfiles] = useState<SocialProfile[]>([]);
  const [conversations, setConversations] = useState<SocialConversation[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<SocialConversation | null>(null);
  const [messages, setMessages] = useState<SocialMessage[]>([]);
  const [messageInput, setMessageInput] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [socialView, setSocialView] = useState<"messages" | "search" | "profile" | "user" | "admin" | "community">("messages");
  const [userProfile, setUserProfile] = useState<SocialProfile | null>(null);
  const [followers, setFollowers] = useState(0);
  const [following, setFollowing] = useState(0);
  const [followingUser, setFollowingUser] = useState(false);
  const [blockedUser, setBlockedUser] = useState(false);
  const [otherTyping, setOtherTyping] = useState(false);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [connectionState, setConnectionState] = useState<"connected"|"reconnecting">("connected");
  const [messageHasMore, setMessageHasMore] = useState(false);
  const [messageLoadingMore, setMessageLoadingMore] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editUsername, setEditUsername] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editCountry, setEditCountry] = useState("");
  const [editLikedPublic, setEditLikedPublic] = useState(true);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [userPlaylists, setUserPlaylists] = useState<Array<{id:string;name:string;is_public:boolean;tracks:PipedTrack[]}>>([]);
  const [userLikedSongs, setUserLikedSongs] = useState<PipedTrack[]>([]);
  const [adminUsers, setAdminUsers] = useState<SocialProfile[]>([]);
  const [adminSearch, setAdminSearch] = useState("");
  const [adminLoading, setAdminLoading] = useState(false);
  const typingTimer = useRef<number | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const presenceChannel = useRef<ReturnType<NonNullable<typeof supabase>["channel"]> | null>(null);
  const chatChannel = useRef<ReturnType<NonNullable<typeof supabase>["channel"]> | null>(null);

  const configured = supabaseConfigured && Boolean(supabase);

  async function loadProfile(userId: string) {
    if (!supabase) return null;

    const columns = "id,username,avatar_url,bio,country,last_seen,created_at,updated_at,role,is_verified,verified_by,is_banned,banned_until,ban_reason,liked_songs_public";
    const { data, error } = await supabase.from("profiles").select(columns).eq("id", userId).maybeSingle();

    if (error) throw error;

    // Older accounts may exist in Auth without a matching public.profiles row.
    // Create the missing row from Auth metadata so the profile page can render.
    if (!data) {
      const { data: authData } = await supabase.auth.getUser();
      const authUser = authData.user;
      const rawUsername = String(authUser?.user_metadata?.username || authUser?.email?.split("@")[0] || `user-${userId.slice(0, 8)}`)
        .toLowerCase()
        .replace(/[^a-z0-9_.-]/g, "-")
        .slice(0, 24);
      const username = rawUsername.length >= 3 ? rawUsername : `user-${userId.slice(0, 8)}`;

      const { data: created, error: createError } = await supabase
        .from("profiles")
        .upsert({ id: userId, username }, { onConflict: "id" })
        .select(columns)
        .single();

      if (createError) throw createError;
      setProfile(created as SocialProfile);
      return created as SocialProfile;
    }

    setProfile(data as SocialProfile);
    return data as SocialProfile;
  }


  async function loadUserMusic(userId: string) {
    if (!supabase) return;
    const { data: playlistRows, error: playlistError } = await supabase
      .from("user_playlists")
      .select("id,name,is_public,updated_at,user_playlist_tracks(track_id,position,track)")
      .eq("owner_id", userId)
      .or(`is_public.eq.true,owner_id.eq.${profile?.id || userId}`)
      .order("updated_at", { ascending: false });
    if (!playlistError) {
      setUserPlaylists((playlistRows || []).map((row:any) => ({
        id: row.id, name: row.name, is_public: row.is_public,
        tracks: (row.user_playlist_tracks || []).sort((a:any,b:any)=>a.position-b.position).map((t:any)=>t.track).filter(Boolean)
      })));
    }
    const { data: likedRows, error: likedError } = await supabase
      .from("user_liked_songs").select("track_id,track,created_at").eq("user_id", userId).order("created_at", { ascending: false });
    if (!likedError) setUserLikedSongs((likedRows || []).map((r:any)=>r.track).filter(Boolean));
  }

  async function loadAdminUsers(query = adminSearch) {
    if (!supabase || profile?.role !== "founder") return;
    setAdminLoading(true);
    try {
      const { data, error } = await supabase.rpc("admin_list_users", { search_text: query.trim() });
      if (error) throw error;
      setAdminUsers((data || []) as SocialProfile[]);
    } catch (err) { setNotice(errorText(err)); }
    finally { setAdminLoading(false); }
  }

  async function adminVerify(user: SocialProfile) {
    if (!supabase) return;
    const next = !user.is_verified;
    const { error } = await supabase.rpc("admin_set_verified", { target_user_id: user.id, enabled: next });
    if (error) { setNotice(error.message); return; }
    setAdminUsers(prev => prev.map(u => u.id === user.id ? { ...u, is_verified: next, verified_by: next ? profile?.id : null } : u));
  }

  async function adminSetRole(user: SocialProfile) {
    if (!supabase || profile?.role !== "founder" || user.role === "founder") return;
    const next = user.role === "admin" ? "member" : "admin";
    const { error } = await supabase.rpc("set_community_role", { target_user_id: user.id, new_role: next });
    if (error) { setNotice(error.message); return; }
    setAdminUsers(prev => prev.map(u => u.id === user.id ? { ...u, role: next } : u));
  }

  async function adminBan(user: SocialProfile) {
    if (!supabase) return;
    const next = !Boolean(user.is_banned);
    const reason = next ? (window.prompt("Alasan ban", "Pelanggaran aturan komunitas") || "Pelanggaran aturan komunitas") : "";
    if (next && !reason.trim()) return;
    const { error } = await supabase.rpc("admin_set_ban", { target_user_id: user.id, banned: next, reason: next ? reason : null, until_at: null });
    if (error) { setNotice(error.message); return; }
    setAdminUsers(prev => prev.map(u => u.id === user.id ? { ...u, is_banned: next, ban_reason: next ? reason : null, banned_until: null } : u));
  }

  useEffect(() => {
    if (!supabase) return;
    let alive = true;

    const applySession = async (session: any) => {
      if (!alive) return;
      setSessionReady(false);

      if (!session) {
        setProfile(null);
        setConversations([]);
        setSelectedConversation(null);
        setSessionReady(false);
        return;
      }

      try {
        const loaded = await loadProfile(session.user.id);
        if (loaded?.is_banned && (!loaded.banned_until || new Date(loaded.banned_until).getTime() > Date.now())) {
          await supabase.auth.signOut();
          setNotice(`Akun sedang diblokir${loaded.ban_reason ? `: ${loaded.ban_reason}` : ""}`);
          return;
        }
        await loadUserMusic(session.user.id);
      } catch (error) {
        console.error("Gagal memuat profil:", error);
        setProfile(null);
      } finally {
        if (alive) setSessionReady(true);
      }
    };

    void supabase.auth.getSession().then(({ data }) => applySession(data.session));

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      void applySession(session);
    });

    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, []);


  useEffect(() => {
    if (!supabase || !sessionReady || !profile) return;
    let cancelled = false;
    const channel = supabase.channel("presence:global", { config: { presence: { key: profile.id }, private: true } });
    presenceChannel.current = channel;
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<{ user_id: string }>();
      const ids = new Set<string>(); Object.values(state).flat().forEach((item: any) => ids.add(item.user_id));
      if (!cancelled) setOnlineIds(ids);
    }).on("presence", { event: "join" }, ({ key }) => setOnlineIds(prev => new Set(prev).add(String(key)))).on("presence", { event: "leave" }, ({ key }) => setOnlineIds(prev => { const next = new Set(prev); next.delete(String(key)); return next; }));
    void channel.subscribe(async status => { if (status === "SUBSCRIBED") await channel.track({ user_id: profile.id }); });
    const touch = () => { void supabase.from("profiles").update({ last_seen: new Date().toISOString() }).eq("id", profile.id); };
    touch(); const interval = window.setInterval(touch, 60000);
    return () => { cancelled = true; window.clearInterval(interval); void channel.untrack(); void supabase.removeChannel(channel); presenceChannel.current = null; };
  }, [sessionReady, profile?.id]);

  async function loadConversations() {
    if (!supabase || !profile) return;

    // Use a server-side RPC instead of querying conversations/conversation_members
    // directly. This keeps membership checks inside a SECURITY DEFINER function
    // and avoids exposing conversation rows to the client unnecessarily.
    const { data, error } = await supabase.rpc("get_my_conversations");
    if (error) { setNotice(error.message); return; }

    const result: SocialConversation[] = ((data || []) as any[])
      .filter(row => row?.other)
      .map(row => ({
        id: String(row.conversation_id),
        updated_at: row.updated_at || row.last_message_at || new Date().toISOString(),
        last_message_at: row.last_message_at || null,
        last_message_preview: row.last_message_preview || null,
        other: row.other as SocialProfile,
        unread: Number(row.unread || 0),
      }));

    setConversations(result);
  }

  useEffect(() => { if (sessionReady && profile) void loadConversations(); }, [sessionReady, profile?.id]);

  useEffect(() => {
    if (!profile || (socialView !== "profile" && socialView !== "user")) return;
    void loadUserMusic(socialView === "user" && userProfile ? userProfile.id : profile.id);
  }, [socialView, userProfile?.id, profile?.id]);

  useEffect(() => {
    if (!supabase || !sessionReady || !profile) return;
    const channel = supabase.channel(`messages:${profile.id}`);
    channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `receiver_id=eq.${profile.id}` }, payload => {
      const incoming = payload.new as SocialMessage;
      if (selectedConversation?.id === incoming.conversation_id) {
        setMessages(prev => prev.some(m=>m.id===incoming.id)?prev:[...prev,incoming]);
        void supabase.rpc("mark_messages_read", { target_conversation_id: incoming.conversation_id });
      }
      void loadConversations();
    }).on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `receiver_id=eq.${profile.id}` }, payload => {
      const updated = payload.new as SocialMessage;
      setMessages(prev=>prev.map(m=>m.id===updated.id?updated:m));
    }).on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages", filter: `sender_id=eq.${profile.id}` }, payload => {
      // This is the sender's read receipt: the receiver updates read_at on our message.
      const updated = payload.new as SocialMessage;
      setMessages(prev=>prev.map(m=>m.id===updated.id?updated:m));
      void loadConversations();
    });
    void channel.subscribe(status => { setConnectionState(status === "SUBSCRIBED" ? "connected" : "reconnecting"); });
    return () => { void supabase.removeChannel(channel); };
  }, [sessionReady, profile?.id, selectedConversation?.id]);

  useEffect(() => { messageEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length]);
  useEffect(() => () => { if (typingTimer.current) window.clearTimeout(typingTimer.current); if (supabase && chatChannel.current) void supabase.removeChannel(chatChannel.current); }, []);

  async function openConversation(conversation: SocialConversation) {
    if (!supabase || !profile) return;
    setSelectedConversation(conversation); setSocialView("messages"); setMessages([]); setOtherTyping(false);
    const { data, error } = await supabase.from("messages").select("id,conversation_id,sender_id,receiver_id,message,metadata,created_at,read_at,deleted_at").eq("conversation_id", conversation.id).order("created_at", { ascending: false }).limit(60);
    if (error) { setNotice(error.message); return; }
    const initial = (data as SocialMessage[]).reverse();
    setMessages(initial);
    setMessageHasMore(initial.length === 60);
    await supabase.rpc("mark_messages_read", { target_conversation_id: conversation.id });
    await supabase.rpc("mark_chat_notifications_read", { target_conversation_id: conversation.id });
    await loadConversations();
    if (chatChannel.current) void supabase.removeChannel(chatChannel.current);
    const channel = supabase.channel(`chat:${conversation.id}`, { config: { private: true } });
    chatChannel.current = channel;
    channel.on("broadcast", { event: "typing" }, payload => { if (payload.payload?.user_id !== profile.id) setOtherTyping(Boolean(payload.payload?.typing)); });
    void channel.subscribe();
  }

  async function loadOlderMessages() {
    if (!supabase || !selectedConversation || messageLoadingMore || !messages.length) return;
    setMessageLoadingMore(true);
    const oldest = messages[0]?.created_at;
    try {
      const { data, error } = await supabase.from("messages").select("id,conversation_id,sender_id,receiver_id,message,metadata,created_at,read_at,deleted_at").eq("conversation_id", selectedConversation.id).lt("created_at", oldest).order("created_at", { ascending: false }).limit(60);
      if (error) throw error;
      const older = (data as SocialMessage[]).reverse();
      setMessages(prev => [...older, ...prev]);
      setMessageHasMore(older.length === 60);
    } catch (err) { setNotice(errorText(err)); }
    finally { setMessageLoadingMore(false); }
  }

  async function startConversation(target: SocialProfile) {
    if (!supabase || !profile) return;
    setBusy(true); setNotice("");
    try {
      const { data, error } = await supabase.rpc("create_direct_conversation", { target_user_id: target.id });
      if (error) throw error;
      const id = data as string;
      const conversation: SocialConversation = { id, updated_at: new Date().toISOString(), last_message_at: null, last_message_preview: null, other: target, unread: 0 };
      await loadConversations(); setSelectedConversation(conversation); await openConversation(conversation);
    } catch (err) { setNotice(errorText(err)); }
    finally { setBusy(false); }
  }

  async function sendMessage(e?: FormEvent) {
    e?.preventDefault(); if (!supabase || !profile || !selectedConversation || blockedUser) return;
    const text = messageInput.trim(); if (!text) return;
    setMessageInput(""); if (typingTimer.current) window.clearTimeout(typingTimer.current);
    if (chatChannel.current) void chatChannel.current.send({ type: "broadcast", event: "typing", payload: { user_id: profile.id, typing: false } });
    const { data, error } = await supabase.from("messages").insert({ conversation_id: selectedConversation.id, sender_id: profile.id, receiver_id: selectedConversation.other.id, message: text }).select("id,conversation_id,sender_id,receiver_id,message,metadata,created_at,read_at,deleted_at").single();
    if (error) { setMessageInput(text); setNotice(error.message); return; }
    if (data) setMessages(prev => prev.some(m=>m.id===data.id)?prev:[...prev,data as SocialMessage]);
    await loadConversations();
  }

  function onTyping(value: string) {
    setMessageInput(value);
    if (chatChannel.current && profile) void chatChannel.current.send({ type: "broadcast", event: "typing", payload: { user_id: profile.id, typing: Boolean(value.trim()) } });
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => { if (chatChannel.current && profile) void chatChannel.current.send({ type: "broadcast", event: "typing", payload: { user_id: profile.id, typing: false } }); }, 1200);
  }

  async function searchUsers(value: string) {
    if (!supabase || !profile) return;
    const query = value.trim(); if (!query) { setProfiles([]); return; }
    const { data, error } = await supabase.from("profiles").select("id,username,avatar_url,bio,country,last_seen,created_at,updated_at,role,is_verified,verified_by,is_banned,banned_until,ban_reason,liked_songs_public").ilike("username", `%${query}%`).neq("id", profile.id).limit(20);
    if (!error) setProfiles((data || []) as SocialProfile[]); else setNotice(error.message);
  }
  useEffect(() => { const id = window.setTimeout(()=>void searchUsers(searchInput), 300); return ()=>window.clearTimeout(id); }, [searchInput, profile?.id]);

  async function openUser(user: SocialProfile) {
    if (!supabase || !profile) return;
    setUserProfile(user); setSocialView("user");
    void supabase.rpc("track_profile_visit", { target_profile_id: user.id });
    const [{ count: followerCount }, { count: followingCount }, { data: follow }, { data: block }] = await Promise.all([
      supabase.from("follows").select("follower_id", { count: "exact", head: true }).eq("following_id", user.id),
      supabase.from("follows").select("following_id", { count: "exact", head: true }).eq("follower_id", user.id),
      supabase.from("follows").select("follower_id").eq("follower_id", profile.id).eq("following_id", user.id).maybeSingle(),
      supabase.from("blocks").select("blocker_id").or(`and(blocker_id.eq.${profile.id},blocked_id.eq.${user.id}),and(blocker_id.eq.${user.id},blocked_id.eq.${profile.id})`).maybeSingle(),
    ]);
    setFollowers(followerCount || 0); setFollowing(followingCount || 0); setFollowingUser(Boolean(follow)); setBlockedUser(Boolean(block)); void loadUserMusic(user.id);
  }

  async function toggleFollow() {
    if (!supabase || !profile || !userProfile) return;
    if (followingUser) { const { error } = await supabase.from("follows").delete().eq("follower_id", profile.id).eq("following_id", userProfile.id); if (error) setNotice(error.message); else { setFollowingUser(false); setFollowers(v=>Math.max(0,v-1)); } }
    else { const { error } = await supabase.from("follows").insert({ follower_id: profile.id, following_id: userProfile.id }); if (error) setNotice(error.message); else { setFollowingUser(true); setFollowers(v=>v+1); } }
  }

  async function toggleBlock() {
    if (!supabase || !profile || !userProfile) return;
    if (blockedUser) { const { error } = await supabase.from("blocks").delete().eq("blocker_id", profile.id).eq("blocked_id", userProfile.id); if (error) setNotice(error.message); else setBlockedUser(false); }
    else { const { error } = await supabase.from("blocks").insert({ blocker_id: profile.id, blocked_id: userProfile.id }); if (error) setNotice(error.message); else { setBlockedUser(true); notify("User diblokir."); } }
  }

  async function reportUser(reason: string) {
    if (!supabase || !profile || !userProfile) return;
    const { error } = await supabase.from("reports").insert({ reporter_id: profile.id, reported_user_id: userProfile.id, reason });
    if (error) setNotice(error.message); else notify("Laporan tersimpan.");
  }

  async function saveProfile(e: FormEvent) {
    e.preventDefault(); if (!supabase || !profile) return;
    setBusy(true); setNotice("");
    try {
      if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(editUsername)) throw new Error("Username tidak valid.");
      let avatarUrl = profile.avatar_url;
      if (avatarFile) {
        const ext = avatarFile.name.split(".").pop()?.toLowerCase() || "jpg";
        const path = `${profile.id}/avatar.${ext}`;
        const { error: uploadError } = await supabase.storage.from("avatars").upload(path, avatarFile, { upsert: true, contentType: avatarFile.type || "image/jpeg" });
        if (uploadError) throw uploadError;
        const { data } = supabase.storage.from("avatars").getPublicUrl(path); avatarUrl = data.publicUrl;
      }
      const { data, error } = await supabase.from("profiles").update({ username: editUsername.toLowerCase(), bio: editBio.trim().slice(0, 160), country: editCountry || null, avatar_url: avatarUrl, liked_songs_public: editLikedPublic }).eq("id", profile.id).select().single();
      if (error) throw error;
      if (newPassword) {
        if (newPassword.length < 8 || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) throw new Error("Password baru minimal 8 karakter dan harus memiliki huruf besar, huruf kecil, serta angka.");
        if (newPassword !== confirmNewPassword) throw new Error("Konfirmasi password baru tidak cocok.");
        const { error: passwordError } = await supabase.auth.updateUser({ password: newPassword });
        if (passwordError) throw passwordError;
      }
      setProfile(data as SocialProfile); setEditOpen(false); setAvatarFile(null); setNewPassword(""); setConfirmNewPassword(""); notify("Profil diperbarui.");
    } catch (err) { setNotice(errorText(err)); } finally { setBusy(false); }
  }

  async function deleteMessage(messageId: string) {
    if (!supabase || !profile) return;
    const { error } = await supabase.rpc("delete_message_for_everyone", { target_message_id: messageId });
    if (error) setNotice(error.message);
    else setMessages(prev => prev.map(message => message.id === messageId ? { ...message, deleted_at: new Date().toISOString(), message: "Pesan dihapus", metadata: null } : message));
  }

  async function sharePayload(payload: SharedSong | SharedPlaylist) {
    if (!supabase || !profile || !selectedConversation) return;
    const receiver = selectedConversation.other.id;
    const { data, error } = await supabase.from("messages").insert({ conversation_id: selectedConversation.id, sender_id: profile.id, receiver_id: receiver, message: payload.type === "song" ? `Membagikan lagu: ${payload.title}` : `Membagikan playlist: ${payload.name}`, metadata: payload }).select().single();
    if (error) setNotice(error.message); else { if (data) setMessages(prev=>[...prev,data as SocialMessage]); setShareOpen(false); await loadConversations(); }
  }

  async function signOut() { if (!supabase) return; await supabase.auth.signOut(); setSessionReady(false); }

  function VerifiedBadge({ founder = false }: { founder?: boolean }) {
    return <span className={`verified-badge ${founder ? "founder" : "user"}`} title={founder ? "Founder terverifikasi" : "Pengguna terverifikasi"} aria-label={founder ? "Founder terverifikasi" : "Pengguna terverifikasi"}>✓</span>;
  }
  const profileName = (p: SocialProfile) => <>{p.username}{p.role === "founder" ? <VerifiedBadge founder /> : p.is_verified ? <VerifiedBadge /> : null}{p.role === "admin" ? <span className="role-admin-inline" title="Admin">Admin</span> : null}</>;

  const selectedOther = selectedConversation?.other || null;
  const currentShareSong: SharedSong | null = currentTrack ? { type: "song", songId: currentTrack.id, title: currentTrack.title, artist: currentTrack.artist, artwork: currentTrack.artwork, videoId: currentTrack.videoId, duration: currentTrack.duration, youtubeUrl: currentTrack.youtubeUrl } : null;

  if (!configured) return <div className="social-config-panel"><h2>Akun & Sosial</h2><p>Fitur akun belum dikonfigurasi.</p><code>VITE_SUPABASE_URL</code><code>VITE_SUPABASE_PUBLISHABLE_KEY</code><p className="social-muted">Tambahkan kedua environment variable tersebut di project/hosting untuk mengaktifkan akun, database, dan realtime.</p></div>;
  if (!sessionReady) {
    return profile ? <div className="social-root"><div className="social-empty"><p>Memuat profil...</p></div></div> : <AuthPanel onReady={()=>setSessionReady(true)} />;
  }

  if (!profile) {
    return <div className="social-root"><div className="social-empty"><h3>Profil belum tersedia</h3><p>Data profil akun belum berhasil dimuat. Coba muat ulang setelah login.</p><button type="button" className="social-primary-btn compact" onClick={()=>void supabase?.auth.getSession().then(({data})=>data.session && loadProfile(data.session.user.id))}>Muat profil</button></div></div>;
  }

  return <div className="social-root">
    <div className="social-header"><div><span className="social-eyebrow">Sosial</span><h1>{socialView === "messages" ? "Pesan" : socialView === "search" ? "Cari pengguna" : socialView === "profile" ? "Profil kamu" : socialView === "admin" ? "Admin" : socialView === "community" ? "Komunitas" : userProfile?.username || "Profil"}</h1></div><div className="social-header-actions"><button type="button" className="social-icon-btn" onClick={()=>setSocialView("search")} aria-label="Cari pengguna"><Search/></button><button type="button" className="social-icon-btn" onClick={()=>setSocialView("profile")} aria-label="Profil"><UserIcon/></button><button type="button" className="social-secondary-btn community-open-btn" onClick={()=>setSocialView("community")}>Komunitas</button></div></div>

    {socialView === "community" ? <CommunityFeatures profile={profile} notify={notify} onBack={()=>setSocialView("messages")} /> : null}

    {socialView === "messages" ? <>
      {selectedConversation ? <div className="social-chat">
        <div className="social-chat-header"><button type="button" className="social-icon-btn" onClick={()=>{setSelectedConversation(null);void loadConversations()}}><Back/></button><button type="button" className="social-user-head" onClick={()=>openUser(selectedOther!)}><img src={selectedOther?.avatar_url || "/images/satriamusic-cover.jpg"} alt=""/><span><strong>{selectedOther ? profileName(selectedOther) : "User"}</strong><small>{isOnline(selectedOther,onlineIds) ? "Online" : timeLabel(selectedOther?.last_seen || null)}</small></span></button><button type="button" className="social-icon-btn" onClick={()=>openUser(selectedOther!)}><More/></button></div>{connectionState === "reconnecting" ? <div className="social-reconnect-line">Menghubungkan ulang...</div> : null}
        <div className="social-messages-list">{messageHasMore?<button type="button" className="load-more-messages" onClick={()=>void loadOlderMessages()} disabled={messageLoadingMore}>{messageLoadingMore?"Memuat...":"Muat pesan sebelumnya"}</button>:null}{messages.map(m=>{const shared=m.metadata as any; return <div key={m.id} className={`social-message-row ${m.sender_id===profile?.id?"mine":"theirs"}`}><div className="social-bubble">{m.deleted_at?<span className="social-deleted">Pesan dihapus</span>:shared?.type === "song" ? <button type="button" className="shared-card" onClick={()=>onPlayTrack({id:shared.songId,title:shared.title,artist:shared.artist,artwork:shared.artwork,videoId:shared.videoId,duration:shared.duration,youtubeUrl:shared.youtubeUrl,source:"search"})}><img src={shared.artwork} alt=""/><span><strong>{shared.title}</strong><small>{shared.artist}</small></span></button> : shared?.type === "playlist" ? <div className="shared-card"><span><strong>{shared.name}</strong><small>{shared.tracks?.length || 0} lagu</small></span><div className="shared-card-actions"><button type="button" className="social-small-action" onClick={()=>onPlayPlaylist((shared.tracks || []).map((track:any)=>({...track,source:"playlist"})))}>Putar</button><button type="button" className="social-small-action" onClick={()=>onImportPlaylist(shared.name, (shared.tracks || []).map((track:any)=>({...track,source:"playlist"})))}>Simpan</button></div></div> : <span>{m.message}</span>} {m.sender_id===profile?.id && !m.deleted_at ? <button type="button" className="message-delete-btn" onClick={()=>void deleteMessage(m.id)}>Hapus</button> : null}<small className="message-meta">{new Date(m.created_at).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"})}{m.sender_id===profile?.id ? <span className={`message-read-receipt ${m.read_at ? "is-read" : ""}`} title={m.read_at ? `Dibaca ${new Date(m.read_at).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"})}` : "Terkirim"} aria-label={m.read_at ? "Dibaca" : "Terkirim"}>{m.read_at ? " ✓✓" : " ✓"}</span> : null}</small></div></div>})}<div ref={messageEndRef}/></div>
        {otherTyping?<div className="typing-line">Sedang mengetik...</div>:null}
        {blockedUser?<div className="social-blocked-note">Kamu memblokir atau diblokir oleh user ini.</div>:<form className="social-composer" onSubmit={sendMessage}><button type="button" className="social-icon-btn" onClick={()=>setShareOpen(true)} aria-label="Bagikan lagu"><Plus/></button><input value={messageInput} onChange={e=>onTyping(e.target.value)} placeholder="Tulis pesan..." maxLength={2000}/><button type="submit" className="social-send-btn" disabled={!messageInput.trim()}><Send/></button></form>}
      </div> : <div className="social-conversations">{conversations.length ? conversations.map(c=><button key={c.id} type="button" className="social-conversation-row" onClick={()=>void openConversation(c)}><img src={c.other.avatar_url || "/images/satriamusic-cover.jpg"} alt=""/><span><strong>{profileName(c.other)}</strong><small>{c.last_message_preview || "Belum ada pesan"}</small></span><aside><time>{c.last_message_at ? new Date(c.last_message_at).toLocaleDateString("id-ID",{day:"2-digit",month:"2-digit"}) : ""}</time>{c.unread?<b>{c.unread}</b>:null}</aside></button>) : <div className="social-empty"><UserIcon/><h3>Belum ada percakapan</h3><p>Cari user lain untuk memulai chat realtime.</p><button type="button" className="social-primary-btn compact" onClick={()=>setSocialView("search")}>Cari pengguna</button></div>}</div>}
    </> : null}

    {socialView === "search" ? <div className="social-search-page"><div className="social-search-box"><Search/><input autoFocus value={searchInput} onChange={e=>setSearchInput(e.target.value)} placeholder="Cari username..."/></div><div className="social-list">{profiles.map(user=><button type="button" key={user.id} className="social-user-row" onClick={()=>void openUser(user)}><img src={user.avatar_url || "/images/satriamusic-cover.jpg"} alt=""/><span><strong>{profileName(user)}</strong><small>{user.country || "Negara belum diatur"}</small></span><em>{isOnline(user,onlineIds)?"Online":"Offline"}</em></button>)}{searchInput.trim()&&!profiles.length?<div className="social-empty small"><p>Tidak ada user yang cocok.</p></div>:null}</div></div> : null}

    {socialView === "profile" && profile ? <div className="social-profile-page"><div className="social-profile-card"><img className="social-profile-avatar" src={profile.avatar_url || "/images/satriamusic-cover.jpg"} alt=""/><h2>{profileName(profile)}</h2><p>{profile.bio || "Belum ada bio."}</p><span>{profile.country || "Negara belum diatur"}</span><div className="social-profile-stats"><b>{following}<small>Following</small></b><b>{followers}<small>Followers</small></b></div><div className="social-profile-actions"><button className="social-primary-btn compact" type="button" onClick={()=>{setEditUsername(profile.username);setEditBio(profile.bio||"");setEditCountry(profile.country||"");setEditLikedPublic(profile.liked_songs_public !== false);setEditOpen(true)}}>Edit profil</button>{profile.role === "founder" ? <button className="social-secondary-btn" type="button" onClick={()=>{setSocialView("admin");void loadAdminUsers("")}}>Admin</button> : null}<button className="social-secondary-btn" type="button" onClick={()=>void signOut()}>Keluar</button></div></div><div className="social-profile-music"><h3>Playlist kamu</h3>{userPlaylists.map(p=><button className="profile-music-row" key={p.id} type="button" onClick={()=>onPlayPlaylist(p.tracks)}><span><strong>{p.name}</strong><small>{p.tracks.length} lagu</small></span></button>)}{!userPlaylists.length?<p className="social-muted">Belum ada playlist tersimpan di akun.</p>:null}<h3>Lagu disukai</h3>{userLikedSongs.slice(0,20).map(t=><button className="profile-music-row" key={t.id} type="button" onClick={()=>onPlayTrack(t)}><span><strong>{t.title}</strong><small>{t.artist}</small></span></button>)}{!userLikedSongs.length?<p className="social-muted">Belum ada lagu yang disukai.</p>:null}</div></div> : null}

    {socialView === "user" && userProfile ? <div className="social-profile-page"><button type="button" className="social-back-text" onClick={()=>setSocialView("search")}><Back/> Kembali</button><div className="social-profile-card"><img className="social-profile-avatar" src={userProfile.avatar_url || "/images/satriamusic-cover.jpg"} alt=""/><h2>{profileName(userProfile)}</h2><p>{userProfile.bio || "Belum ada bio."}</p><span>{userProfile.country || "Negara belum diatur"}</span><div className="social-profile-stats"><b>{followers}<small>Followers</small></b><b>{following}<small>Following</small></b></div><div className="social-profile-actions"><button className="social-primary-btn compact" type="button" onClick={()=>void toggleFollow()}>{followingUser?"Berhenti mengikuti":"Ikuti"}</button><button className="social-secondary-btn" type="button" disabled={busy||blockedUser} onClick={()=>void startConversation(userProfile)}>Pesan</button></div><div className="social-danger-actions"><button type="button" onClick={()=>void toggleBlock()}>{blockedUser?"Buka blokir":"Blokir user"}</button><div className="social-report-row"><button type="button" onClick={()=>void reportUser("spam")}>Laporkan spam</button><button type="button" onClick={()=>void reportUser("harassment")}>Laporkan harassment</button><button type="button" onClick={()=>void reportUser("other")}>Laporkan lainnya</button></div></div></div><div className="social-profile-music"><h3>Playlist publik</h3>{userPlaylists.map(p=><button className="profile-music-row" key={p.id} type="button" onClick={()=>onPlayPlaylist(p.tracks)}><span><strong>{p.name}</strong><small>{p.tracks.length} lagu</small></span></button>)}{!userPlaylists.length?<p className="social-muted">Belum ada playlist publik.</p>:null}{userProfile.liked_songs_public !== false ? <><h3>Lagu disukai</h3>{userLikedSongs.slice(0,20).map(t=><button className="profile-music-row" key={t.id} type="button" onClick={()=>onPlayTrack(t)}><span><strong>{t.title}</strong><small>{t.artist}</small></span></button>)}{!userLikedSongs.length?<p className="social-muted">Belum ada lagu yang disukai.</p>:null}</> : <p className="social-muted">Lagu disukai disembunyikan user ini.</p>}</div></div> : null}


    {socialView === "admin" && profile?.role === "founder" ? <div className="social-admin-page"><button type="button" className="social-back-text" onClick={()=>setSocialView("profile")}><Back/> Kembali</button><div className="social-admin-toolbar"><input value={adminSearch} onChange={e=>setAdminSearch(e.target.value)} placeholder="Cari username..."/><button className="social-secondary-btn" type="button" onClick={()=>void loadAdminUsers()}>Cari</button></div>{adminLoading?<div className="social-empty small"><p>Memuat user...</p></div>:adminUsers.map(u=><div className="admin-user-row" key={u.id}><img src={u.avatar_url || "/images/satriamusic-cover.jpg"} alt=""/><div><strong>{profileName(u)}</strong><small>{u.is_banned ? `Dibanned${u.ban_reason ? `: ${u.ban_reason}` : ""}` : "Aktif"}</small></div><div className="admin-user-actions">{u.role !== "founder" ? <><button type="button" onClick={()=>void adminVerify(u)}>{u.is_verified?"Cabut verified":"Beri verified"}</button><button type="button" onClick={()=>void adminSetRole(u)}>{u.role==="admin"?"Jadikan member":"Jadikan admin"}</button><button type="button" className={u.is_banned?"":"danger"} onClick={()=>void adminBan(u)}>{u.is_banned?"Buka ban":"Ban akun"}</button></> : null}</div></div>)}{!adminLoading&&!adminUsers.length?<div className="social-empty small"><p>Tidak ada user.</p></div>:null}</div> : null}

    {editOpen && profile ? <div className="social-modal" onClick={()=>setEditOpen(false)}><form className="social-modal-card" onClick={e=>e.stopPropagation()} onSubmit={saveProfile}><div className="social-modal-head"><h3>Edit profil</h3><button type="button" className="social-icon-btn" onClick={()=>setEditOpen(false)}><Close/></button></div><label>Username<input value={editUsername} onChange={e=>setEditUsername(e.target.value)}/></label><label>Bio<textarea value={editBio} maxLength={160} onChange={e=>setEditBio(e.target.value)}/></label><label>Negara<select value={editCountry} onChange={e=>setEditCountry(e.target.value)}><option value="">Pilih negara</option>{countryOptions.map(c=><option key={c}>{c}</option>)}</select></label><label className="check-row"><input type="checkbox" checked={editLikedPublic} onChange={e=>setEditLikedPublic(e.target.checked)}/> Tampilkan lagu disukai di profil publik</label><label>Avatar<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>setAvatarFile(e.target.files?.[0] || null)}/></label><label>Password baru<input type="password" value={newPassword} autoComplete="new-password" onChange={e=>setNewPassword(e.target.value)} placeholder="Kosongkan jika tidak ingin mengubah"/></label><label>Konfirmasi password baru<input type="password" value={confirmNewPassword} autoComplete="new-password" onChange={e=>setConfirmNewPassword(e.target.value)} placeholder="Ulangi password baru"/></label>{notice?<div className="social-error">{notice}</div>:null}<button type="submit" className="social-primary-btn" disabled={busy}>{busy?"Menyimpan...":"Simpan perubahan"}</button></form></div> : null}

    {shareOpen && selectedConversation ? <div className="social-modal" onClick={()=>setShareOpen(false)}><div className="social-modal-card" onClick={e=>e.stopPropagation()}><div className="social-modal-head"><h3>Bagikan ke {selectedConversation.other.username}</h3><button type="button" className="social-icon-btn" onClick={()=>setShareOpen(false)}><Close/></button></div>{currentShareSong?<button type="button" className="share-choice" onClick={()=>void sharePayload(currentShareSong)}><img src={currentShareSong.artwork} alt=""/><span><strong>{currentShareSong.title}</strong><small>{currentShareSong.artist}</small></span></button>:null}{playlists.map(p=>{const payload:SharedPlaylist={type:"playlist",playlistId:p.id,name:p.name,tracks:p.tracks.map(t=>({id:t.id,title:t.title,artist:t.artist,artwork:t.artwork,videoId:t.videoId,duration:t.duration,youtubeUrl:t.youtubeUrl}))};return <button type="button" className="share-choice" key={p.id} onClick={()=>void sharePayload(payload)}><span><strong>{p.name}</strong><small>{p.tracks.length} lagu</small></span></button>})}{!currentShareSong&&!playlists.length?<div className="social-empty small"><p>Tidak ada lagu atau playlist untuk dibagikan.</p></div>:null}</div></div>:null}

    {notice && !editOpen ? <div className="social-inline-notice" role="status">{notice}<button type="button" onClick={()=>setNotice("")}><Close/></button></div>:null}
  </div>;
}
