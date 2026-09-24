const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
  const serviceKey = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const publishableKeys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
  const publishableKey = publishableKeys.default || Deno.env.get("SUPABASE_ANON_KEY");

  if (!url || !serviceKey || !publishableKey) return json({ error: "Server is not configured" }, 500);

  try {
    const body = await request.json();
    const identifier = String(body?.identifier || body?.username || "").trim().toLowerCase();
    const password = String(body?.password || "");
    if (!identifier || !password) return json({ error: "Username/email atau password salah." }, 401);

    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.91.0");
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    let email = "";
    let userId = "";
    let profile: any = null;

    if (identifier.includes("@")) {
      const { data, error } = await admin.auth.admin.getUserByEmail(identifier);
      if (error || !data.user?.email) return json({ error: "Username/email atau password salah." }, 401);
      email = data.user.email;
      userId = data.user.id;
      const { data: p } = await admin.from("profiles").select("id,is_banned,banned_until,ban_reason").eq("id", userId).maybeSingle();
      profile = p;
    } else {
      if (!/^[a-z0-9_.-]{3,24}$/.test(identifier)) return json({ error: "Username/email atau password salah." }, 401);
      const { data: p, error: profileError } = await admin.from("profiles").select("id,is_banned,banned_until,ban_reason").eq("username", identifier).maybeSingle();
      if (profileError || !p) return json({ error: "Username/email atau password salah." }, 401);
      profile = p;
      userId = p.id;
      const { data: userData, error: userError } = await admin.auth.admin.getUserById(userId);
      if (userError || !userData.user?.email) return json({ error: "Username/email atau password salah." }, 401);
      email = userData.user.email;
    }

    const banned = Boolean(profile?.is_banned) && (!profile?.banned_until || new Date(profile.banned_until).getTime() > Date.now());
    if (banned) {
      const until = profile?.banned_until ? ` sampai ${new Date(profile.banned_until).toLocaleString("id-ID")}` : "";
      return json({ error: `Akun ini sedang diblokir${until}.${profile?.ban_reason ? ` Alasan: ${profile.ban_reason}` : ""}` }, 403);
    }

    const tokenResponse = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: publishableKey },
      body: JSON.stringify({ email, password }),
    });
    const tokenBody = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenBody.access_token || !tokenBody.refresh_token) return json({ error: "Username/email atau password salah." }, 401);

    return json({ access_token: tokenBody.access_token, refresh_token: tokenBody.refresh_token, user_id: userId }, 200);
  } catch (error) {
    console.error(error);
    return json({ error: "Username/email atau password salah." }, 401);
  }
});

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
