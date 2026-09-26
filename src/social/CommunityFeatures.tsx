import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { supabase } from "./supabase";
import type { SocialProfile } from "./types";

type GroupMessage = {
  id: string;
  group_id: string;
  sender_id: string | null;
  message: string | null;
  image_url: string | null;
  created_at: string;
  deleted_at: string | null;
  is_pinned: boolean;
  pinned_at: string | null;
  is_system?: boolean;
  system_message?: string | null;
  sender?: SocialProfile;
};

type Story = {
  id: string;
  user_id: string;
  media_url: string;
  media_type: "image";
  caption: string | null;
  created_at: string;
  expires_at: string;
  owner?: SocialProfile;
  mentions?: SocialProfile[];
};

type Visitor = {
  id: string;
  visited_at: string;
  visitor?: SocialProfile;
};

type StoryViewer = {
  id: string;
  viewed_at: string;
  viewer?: SocialProfile;
};

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {children}
    </svg>
  );
}

const Send = () => (
  <Icon>
    <path
      d="m4 4 16 8-16 8 2.4-7L15 12 6.4 11 4 4Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
  </Icon>
);

const ImageIcon = () => (
  <Icon>
    <rect
      x="3"
      y="4"
      width="18"
      height="16"
      rx="2"
      stroke="currentColor"
      strokeWidth="1.8"
    />
    <circle
      cx="8"
      cy="9"
      r="1.5"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path
      d="m4 17 5-5 4 4 2-2 5 5"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
  </Icon>
);

const Pin = () => (
  <Icon>
    <path
      d="m9 4 6 6m-8.5-3.5 7 7M6 13l5 5m-8 3 5-5 3 3-5 5M14 3l7 7-3 3-7-7 3-3Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Icon>
);

const Back = () => (
  <Icon>
    <path
      d="m15 5-7 7 7 7"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </Icon>
);

function roleLabel(role?: SocialProfile["role"]) {
  return role === "founder"
    ? "Founder"
    : role === "admin"
      ? "Admin"
      : "Member";
}

function RoleBadge({ role }: { role?: SocialProfile["role"] }) {
  return (
    <span
      className={`community-role-badge role-${
        role === "founder"
          ? "founder"
          : role === "admin"
            ? "admin"
            : "member"
      }`}
    >
      {roleLabel(role)}
    </span>
  );
}

function Verified({ profile }: { profile?: SocialProfile }) {
  if (!profile?.is_verified && profile?.role !== "founder") return null;

  return (
    <span
      className="community-verified"
      title="Akun terverifikasi"
      aria-label="Akun terverifikasi"
    >
      ✓
    </span>
  );
}

export default function CommunityFeatures({
  profile,
  notify,
  onBack,
}: {
  profile: SocialProfile;
  notify: (message: string) => void;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<"group" | "stories" | "visitors">("group");

  const [groupId, setGroupId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("Global Community");

  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [input, setInput] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);

  const [stories, setStories] = useState<Story[]>([]);
  const [visitors, setVisitors] = useState<Visitor[]>([]);

  const [storyFile, setStoryFile] = useState<File | null>(null);
  const [storyCaption, setStoryCaption] = useState("");
  const [storyViewers, setStoryViewers] = useState<StoryViewer[]>([]);
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const endRef = useRef<HTMLDivElement | null>(null);

  const canPin =
    profile.role === "founder" || profile.role === "admin";

  const canModerate =
    profile.role === "founder" || profile.role === "admin";

  /*
   * =========================================================
   * LOAD GLOBAL COMMUNITY
   * =========================================================
   *
   * FIX:
   * Jangan memakai RPC get_global_group.
   * Ambil langsung dari public.community_groups.
   *
   * Struktur tabel:
   * - id
   * - slug
   * - name
   * - is_global
   */
  async function loadGroup() {
    if (!supabase) return;

    setNotice("");

    const { data: row, error } = await supabase
      .from("community_groups")
      .select("id, slug, name, is_global")
      .eq("slug", "global-community")
      .eq("is_global", true)
      .maybeSingle();

    if (error) {
      console.error(
        "[Community] Failed to load global group:",
        error
      );

      setNotice(`Gagal memuat grup: ${error.message}`);
      return;
    }

    if (!row) {
      console.error(
        "[Community] Global Community tidak ditemukan"
      );

      setNotice(
        "Global Community tidak ditemukan di database."
      );

      setGroupId(null);
      setMessages([]);

      return;
    }

    console.log(
      "[Community] Global Community loaded:",
      row
    );

    setGroupId(row.id);
    setGroupName(row.name || "Global Community");

    /*
     * Load group messages
     */
    const { data: ms, error: me } = await supabase
      .from("group_messages")
      .select(`
        id,
        group_id,
        sender_id,
        message,
        image_url,
        created_at,
        deleted_at,
        is_pinned,
        pinned_at,
        is_system,
        system_message,
        sender:profiles!group_messages_sender_id_fkey(
          id,
          username,
          avatar_url,
          role,
          is_verified
        )
      `)
      .eq("group_id", row.id)
      .order("created_at", {
        ascending: true,
      })
      .limit(150);

    if (me) {
      console.error(
        "[Community] Failed to load messages:",
        me
      );

      setNotice(
        `Gagal memuat pesan: ${me.message}`
      );

      return;
    }

    setMessages(
      (ms || []) as unknown as GroupMessage[]
    );
  }

  /*
   * =========================================================
   * STORIES
   * =========================================================
   */

  async function loadStories() {
    if (!supabase) return;

    const { data, error } = await supabase
      .from("stories")
      .select(
        "id,user_id,media_url,media_type,caption,created_at,expires_at,owner:profiles!stories_user_id_fkey(id,username,avatar_url,role,is_verified),mentions:story_mentions(mentioned:profiles!story_mentions_mentioned_user_id_fkey(id,username,avatar_url,role,is_verified))"
      )
      .gt(
        "expires_at",
        new Date().toISOString()
      )
      .order("created_at", {
        ascending: false,
      });

    if (error) {
      setNotice(error.message);
      return;
    }

    setStories(
      ((data || []) as any[]).map((st) => ({
        ...st,
        mentions: (st.mentions || [])
          .map((m: any) => m.mentioned)
          .filter(Boolean),
      })) as Story[]
    );
  }

  /*
   * =========================================================
   * PROFILE VISITORS
   * =========================================================
   */

  async function loadVisitors() {
    if (!supabase) return;

    const { data, error } = await supabase
      .from("profile_visits")
      .select(
        "id,visited_at,visitor:profiles!profile_visits_visitor_id_fkey(id,username,avatar_url,role,is_verified)"
      )
      .eq("visited_id", profile.id)
      .order("visited_at", {
        ascending: false,
      })
      .limit(100);

    if (error) {
      setNotice(error.message);
      return;
    }

    setVisitors(
      (data || []) as unknown as Visitor[]
    );
  }

  /*
   * =========================================================
   * TAB LOADER
   * =========================================================
   */

  useEffect(() => {
    if (tab === "group") {
      void loadGroup();
    }

    if (tab === "stories") {
      void loadStories();
    }

    if (tab === "visitors") {
      void loadVisitors();
    }
  }, [tab, profile.id]);

  /*
   * =========================================================
   * REALTIME GROUP CHAT
   * =========================================================
   */

  useEffect(() => {
    if (!supabase || !groupId) return;

    const channel = supabase.channel(
      `global-group:${groupId}`
    );

    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "group_messages",
        filter: `group_id=eq.${groupId}`,
      },
      () => {
        void loadGroup();
      }
    );

    void channel.subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [groupId]);

  /*
   * =========================================================
   * AUTO SCROLL
   * =========================================================
   */

  useEffect(() => {
    endRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages.length]);

  /*
   * =========================================================
   * SEND GROUP MESSAGE
   * =========================================================
   */

  async function sendGroupMessage(
    e?: FormEvent
  ) {
    e?.preventDefault();

    if (!supabase || !groupId) return;

    const text = input.trim();

    if (!text && !imageFile) return;

    setBusy(true);
    setNotice("");

    try {
      let imageUrl: string | null = null;

      if (imageFile) {
        if (!imageFile.type.startsWith("image/")) {
          throw new Error(
            "File harus berupa gambar."
          );
        }

        if (imageFile.size > 8 * 1024 * 1024) {
          throw new Error(
            "Foto maksimal 8 MB."
          );
        }

        const ext =
          imageFile.name
            .split(".")
            .pop()
            ?.toLowerCase() || "jpg";

        const path = `${profile.id}/${crypto.randomUUID()}.${ext}`;

        const { error } =
          await supabase.storage
            .from("group-media")
            .upload(
              path,
              imageFile,
              {
                contentType: imageFile.type,
                upsert: false,
              }
            );

        if (error) throw error;

        imageUrl =
          supabase.storage
            .from("group-media")
            .getPublicUrl(path)
            .data.publicUrl;
      }

      const { error } =
        await supabase
          .from("group_messages")
          .insert({
            group_id: groupId,
            sender_id: profile.id,
            message: text || null,
            image_url: imageUrl,
          });

      if (error) throw error;

      setInput("");
      setImageFile(null);

      await loadGroup();
    } catch (e) {
      setNotice(
        e instanceof Error
          ? e.message
          : "Pesan ditolak oleh moderasi komunitas."
      );
    } finally {
      setBusy(false);
    }
  }

  /*
   * =========================================================
   * DELETE MESSAGE
   * =========================================================
   */

  async function deleteGroupMessage(
    id: string
  ) {
    if (!supabase) return;

    const { error } =
      await supabase.rpc(
        "delete_group_message",
        {
          target_message_id: id,
        }
      );

    if (error) {
      setNotice(error.message);
    } else {
      await loadGroup();
    }
  }

  /*
   * =========================================================
   * KICK MEMBER
   * =========================================================
   */

  async function kickMember(
    userId: string
  ) {
    if (!supabase) return;

    const { error } =
      await supabase.rpc(
        "kick_group_member",
        {
          target_user_id: userId,
        }
      );

    if (error) {
      setNotice(error.message);
    } else {
      notify(
        "Member dikeluarkan dari komunitas."
      );

      await loadGroup();
    }
  }

  /*
   * =========================================================
   * PIN MESSAGE
   * =========================================================
   */

  async function pinMessage(
    id: string
  ) {
    if (!supabase || !canPin) return;

    const { error } =
      await supabase.rpc(
        "pin_group_message",
        {
          target_message_id: id,
        }
      );

    if (error) {
      setNotice(error.message);
    } else {
      await loadGroup();
    }
  }

  /*
   * =========================================================
   * POST STORY
   * =========================================================
   */

  async function postStory(
    e?: FormEvent
  ) {
    e?.preventDefault();

    if (!supabase || !storyFile) return;

    setBusy(true);
    setNotice("");

    try {
      if (!storyFile.type.startsWith("image/")) {
        throw new Error(
          "Story harus berupa gambar."
        );
      }

      if (storyFile.size > 8 * 1024 * 1024) {
        throw new Error(
          "Foto maksimal 8 MB."
        );
      }

      const ext =
        storyFile.name
          .split(".")
          .pop()
          ?.toLowerCase() || "jpg";

      const path =
        `${profile.id}/${crypto.randomUUID()}.${ext}`;

      const { error } =
        await supabase.storage
          .from("stories")
          .upload(
            path,
            storyFile,
            {
              contentType: storyFile.type,
              upsert: false,
            }
          );

      if (error) throw error;

      const url =
        supabase.storage
          .from("stories")
          .getPublicUrl(path)
          .data.publicUrl;

      const {
        data: story,
        error: insertError,
      } = await supabase
        .from("stories")
        .insert({
          user_id: profile.id,
          media_url: url,
          media_type: "image",
          caption:
            storyCaption.trim() || null,
        })
        .select("id")
        .single();

      if (insertError) {
        throw insertError;
      }

      const tags = [
        ...storyCaption.matchAll(
          /@([a-zA-Z0-9_.-]{3,24})/g
        ),
      ].map((m) => m[1].toLowerCase());

      if (tags.length) {
        const { data: tagged } =
          await supabase
            .from("profiles")
            .select("id,username")
            .in("username", tags);

        if (tagged?.length) {
          await supabase
            .from("story_mentions")
            .insert(
              tagged.map((u) => ({
                story_id: story.id,
                mentioned_user_id: u.id,
              }))
            );
        }
      }

      setStoryFile(null);
      setStoryCaption("");

      await loadStories();

      notify("Story diposting.");
    } catch (e) {
      setNotice(
        e instanceof Error
          ? e.message
          : "Gagal membuat story."
      );
    } finally {
      setBusy(false);
    }
  }

  /*
   * =========================================================
   * OPEN STORY
   * =========================================================
   */

  async function openStory(
    st: Story
  ) {
    if (!supabase) return;

    setSelectedStory(st);

    if (st.user_id !== profile.id) {
      await supabase.rpc(
        "record_story_view",
        {
          target_story_id: st.id,
        }
      );
    }

    if (st.user_id === profile.id) {
      const { data, error } =
        await supabase
          .from("story_views")
          .select(
            "id,viewed_at,viewer:profiles!story_views_viewer_id_fkey(id,username,avatar_url,role,is_verified)"
          )
          .eq("story_id", st.id)
          .order("viewed_at", {
            ascending: false,
          });

      if (error) {
        setNotice(error.message);
      } else {
        setStoryViewers(
          (data || []) as unknown as StoryViewer[]
        );
      }
    }
  }

  /*
   * =========================================================
   * DELETE STORY
   * =========================================================
   */

  async function deleteStory(
    id: string
  ) {
    if (!supabase) return;

    const { error } =
      await supabase
        .from("stories")
        .delete()
        .eq("id", id)
        .eq("user_id", profile.id);

    if (error) {
      setNotice(error.message);
    } else {
      await loadStories();
    }
  }

  /*
   * =========================================================
   * UI
   * =========================================================
   */

  return (
    <div className="community-root">

      <div className="community-top">
        <button
          className="social-back-text"
          onClick={onBack}
        >
          <Back />
          Kembali
        </button>

        <div>
          <h2>Komunitas</h2>
          <p>
            Chat grup, story, dan pengunjung profil
          </p>
        </div>
      </div>

      <div className="community-tabs">
        <button
          className={tab === "group" ? "active" : ""}
          onClick={() => setTab("group")}
        >
          Grup
        </button>

        <button
          className={tab === "stories" ? "active" : ""}
          onClick={() => setTab("stories")}
        >
          Story
        </button>

        <button
          className={tab === "visitors" ? "active" : ""}
          onClick={() => setTab("visitors")}
        >
          Pengunjung
        </button>
      </div>

      {notice ? (
        <div className="social-inline-notice">
          {notice}

          <button
            onClick={() => setNotice("")}
          >
            ×
          </button>
        </div>
      ) : null}

      {tab === "group" ? (
        <div className="community-group">

          <div className="community-group-head">
            <div>
              <strong>
                {groupName}
              </strong>

              <small>
                Semua akun baru otomatis menjadi member
              </small>
            </div>

            <RoleBadge
              role={profile.role}
            />
          </div>

          <div className="community-messages">

            {messages.map((m) => (
              <div
                key={m.id}
                className={`community-message ${
                  m.sender_id === profile.id
                    ? "mine"
                    : ""
                }`}
              >

                <img
                  src={
                    m.sender?.avatar_url ||
                    "/images/satriamusic-cover.jpg"
                  }
                  alt=""
                />

                <div className="community-message-body">

                  <div className="community-message-name">

                    <strong>
                      {m.is_system
                        ? "Community Bot"
                        : m.sender?.username ||
                          "User"}
                    </strong>

                    {m.is_system ? (
                      <span className="community-bot-badge">
                        BOT
                      </span>
                    ) : (
                      <>
                        <Verified
                          profile={m.sender}
                        />

                        <RoleBadge
                          role={m.sender?.role}
                        />
                      </>
                    )}

                  </div>

                  {m.image_url ? (
                    <img
                      className="community-photo"
                      src={m.image_url}
                      alt="Foto pesan"
                    />
                  ) : null}

                  {m.is_system ? (
                    <div className="community-message-text community-bot-message">
                      {m.system_message ||
                        "Pesan dihapus oleh moderasi."}
                    </div>
                  ) : m.message ? (
                    <div className="community-message-text">
                      {m.deleted_at
                        ? "Pesan dihapus"
                        : m.message}
                    </div>
                  ) : null}

                  <small>
                    {new Date(
                      m.created_at
                    ).toLocaleString(
                      "id-ID",
                      {
                        hour: "2-digit",
                        minute: "2-digit",
                        day: "2-digit",
                        month: "2-digit",
                      }
                    )}

                    {m.is_pinned
                      ? " · Disematkan"
                      : ""}
                  </small>

                  <div className="community-message-actions">

                    {!m.deleted_at &&
                    (
                      m.sender_id ===
                        profile.id ||
                      (
                        canModerate &&
                        m.sender?.role !==
                          "founder" &&
                        (
                          profile.role ===
                            "founder" ||
                          m.sender?.role !==
                            "admin"
                        )
                      )
                    ) ? (
                      <button
                        onClick={() =>
                          void deleteGroupMessage(
                            m.id
                          )
                        }
                      >
                        Hapus
                      </button>
                    ) : null}

                    {canPin &&
                    !m.deleted_at ? (
                      <button
                        onClick={() =>
                          void pinMessage(
                            m.id
                          )
                        }
                      >
                        <Pin />
                        {m.is_pinned
                          ? "Lepas"
                          : "Sematkan"}
                      </button>
                    ) : null}

                    {canModerate &&
                    m.sender_id &&
                    m.sender_id !== profile.id &&
                    m.sender?.role !==
                      "founder" &&
                    (
                      profile.role ===
                        "founder" ||
                      m.sender?.role ===
                        "member"
                    ) ? (
                      <button
                        onClick={() =>
                          void kickMember(
                            m.sender_id!
                          )
                        }
                      >
                        Kick
                      </button>
                    ) : null}

                  </div>

                </div>
              </div>
            ))}

            <div ref={endRef} />

            {!messages.length ? (
              <div className="social-empty small">
                <p>
                  Belum ada pesan di grup.
                </p>
              </div>
            ) : null}

          </div>

          <form
            className="community-composer"
            onSubmit={sendGroupMessage}
          >

            <label
              className="social-icon-btn"
              title="Kirim foto"
            >
              <ImageIcon />

              <input
                hidden
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) =>
                  setImageFile(
                    e.target.files?.[0] ||
                      null
                  )
                }
              />
            </label>

            {imageFile ? (
              <span className="community-file">
                {imageFile.name}
              </span>
            ) : null}

            <input
              value={input}
              onChange={(e) =>
                setInput(e.target.value)
              }
              placeholder="Tulis di grup..."
              maxLength={2000}
            />

            <button
              className="social-send-btn"
              disabled={
                busy ||
                (
                  !input.trim() &&
                  !imageFile
                )
              }
            >
              <Send />
            </button>

          </form>
        </div>
      ) : null}

      {tab === "stories" ? (
        <div className="community-stories">

          <form
            className="community-story-create"
            onSubmit={postStory}
          >
            <h3>Buat story</h3>

            <label className="story-upload">
              Pilih foto

              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) =>
                  setStoryFile(
                    e.target.files?.[0] ||
                      null
                  )
                }
              />
            </label>

            <input
              value={storyCaption}
              onChange={(e) =>
                setStoryCaption(
                  e.target.value
                )
              }
              placeholder="Tambahkan caption (opsional)"
              maxLength={160}
            />

            <button
              className="social-primary-btn compact"
              disabled={
                busy || !storyFile
              }
            >
              {busy
                ? "Memproses..."
                : "Posting story"}
            </button>
          </form>

          <div className="story-grid">

            {stories.map((st) => (
              <article
                className="story-card"
                key={st.id}
              >

                <button
                  className="story-open"
                  onClick={() =>
                    void openStory(st)
                  }
                >
                  <img
                    src={st.media_url}
                    alt="Story"
                  />
                </button>

                <div>

                  <strong>
                    {st.owner?.username ||
                      "User"}
                  </strong>

                  <Verified
                    profile={st.owner}
                  />

                  <RoleBadge
                    role={st.owner?.role}
                  />

                  {st.caption ? (
                    <p>{st.caption}</p>
                  ) : null}

                  {st.mentions?.length ? (
                    <small className="story-tags">
                      Ditandai:{" "}
                      {st.mentions.map(
                        (m, i) => (
                          <span key={m.id}>
                            {i ? ", " : ""}
                            @{m.username}
                          </span>
                        )
                      )}
                    </small>
                  ) : null}

                  <small>
                    {new Date(
                      st.created_at
                    ).toLocaleString(
                      "id-ID",
                      {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      }
                    )}
                  </small>

                  {st.user_id ===
                  profile.id ? (
                    <>
                      <button
                        onClick={() =>
                          void deleteStory(
                            st.id
                          )
                        }
                      >
                        Hapus story
                      </button>

                      <button
                        className="story-viewers-btn"
                        onClick={() =>
                          void openStory(st)
                        }
                      >
                        Lihat penonton
                      </button>
                    </>
                  ) : null}

                </div>

              </article>
            ))}

          </div>

          {!stories.length ? (
            <div className="social-empty small">
              <p>
                Belum ada story aktif.
              </p>
            </div>
          ) : null}

        </div>
      ) : null}

      {selectedStory ? (
        <div
          className="story-view-modal"
          onClick={() =>
            setSelectedStory(null)
          }
        >
          <div
            className="story-view-sheet"
            onClick={(e) =>
              e.stopPropagation()
            }
          >

            <button
              className="story-view-close"
              onClick={() =>
                setSelectedStory(null)
              }
            >
              Tutup
            </button>

            <img
              src={selectedStory.media_url}
              alt="Story"
            />

            <div className="story-view-meta">

              <strong>
                {selectedStory.owner
                  ?.username || "User"}
              </strong>

              <Verified
                profile={
                  selectedStory.owner
                }
              />

              <RoleBadge
                role={
                  selectedStory.owner?.role
                }
              />

              {selectedStory.caption ? (
                <p>
                  {selectedStory.caption}
                </p>
              ) : null}

              {selectedStory.user_id ===
              profile.id ? (
                <div className="story-viewer-list">

                  <strong>
                    {storyViewers.length}{" "}
                    penonton
                  </strong>

                  {storyViewers.map(
                    (v) => (
                      <div key={v.id}>

                        <img
                          src={
                            v.viewer
                              ?.avatar_url ||
                            "/images/satriamusic-cover.jpg"
                          }
                          alt=""
                        />

                        <span>
                          {v.viewer
                            ?.username ||
                            "User"}
                        </span>

                        <Verified
                          profile={
                            v.viewer
                          }
                        />

                      </div>
                    )
                  )}

                </div>
              ) : (
                <small>
                  Story dibuka dan
                  kunjungan dicatat.
                </small>
              )}

            </div>
          </div>
        </div>
      ) : null}

      {tab === "visitors" ? (
        <div className="community-visitors">

          <div className="community-section-title">
            <h3>
              Yang mengunjungi profilmu
            </h3>

            <small>
              Pengunjung dicatat saat
              mereka membuka profilmu.
            </small>
          </div>

          {visitors.map((v) => (
            <div
              className="community-visitor-row"
              key={v.id}
            >

              <img
                src={
                  v.visitor?.avatar_url ||
                  "/images/satriamusic-cover.jpg"
                }
                alt=""
              />

              <div>

                <strong>
                  {v.visitor?.username ||
                    "User"}
                </strong>

                <Verified
                  profile={v.visitor}
                />

                <RoleBadge
                  role={v.visitor?.role}
                />

                <small>
                  {new Date(
                    v.visited_at
                  ).toLocaleString(
                    "id-ID"
                  )}
                </small>

              </div>

            </div>
          ))}

          {!visitors.length ? (
            <div className="social-empty small">
              <p>
                Belum ada pengunjung tercatat.
              </p>
            </div>
          ) : null}

        </div>
      ) : null}

    </div>
  );
}
