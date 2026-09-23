export type SocialProfile = {
  id: string;
  username: string;
  avatar_url: string | null;
  bio: string | null;
  country: string | null;
  last_seen: string | null;
  created_at: string;
  updated_at: string;
};

export type SocialMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  receiver_id: string;
  message: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  read_at: string | null;
  deleted_at: string | null;
};

export type SocialConversation = {
  id: string;
  updated_at: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  other: SocialProfile;
  unread: number;
};

export type SharedSong = {
  type: "song";
  songId: string;
  title: string;
  artist: string;
  artwork: string;
  videoId: string;
  duration: number;
  youtubeUrl: string;
};

export type SharedPlaylist = {
  type: "playlist";
  playlistId: string;
  name: string;
  tracks: Array<{
    id: string;
    title: string;
    artist: string;
    artwork: string;
    videoId: string;
    duration: number;
    youtubeUrl: string;
  }>;
};
