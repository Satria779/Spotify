const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (request) => {
  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: cors,
    });
  }

  // Only allow POST
  if (request.method !== "POST") {
    return new Response(
      JSON.stringify({
        error: "Method not allowed",
      }),
      {
        status: 405,
        headers: {
          ...cors,
          "Content-Type": "application/json",
        },
      },
    );
  }

  // Supabase automatically provides these on hosted Edge Functions
  const url = Deno.env.get("SUPABASE_URL");

  const secretKeys = JSON.parse(
    Deno.env.get("SUPABASE_SECRET_KEYS") || "{}",
  );

  const serviceKey =
    secretKeys.default ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  const publishableKeys = JSON.parse(
    Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}",
  );

  const publishableKey =
    publishableKeys.default ||
    Deno.env.get("SUPABASE_ANON_KEY");

  if (!url || !serviceKey || !publishableKey) {
    return new Response(
      JSON.stringify({
        error: "Server is not configured",
      }),
      {
        status: 500,
        headers: {
          ...cors,
          "Content-Type": "application/json",
        },
      },
    );
  }

  try {
    const body = await request.json();

    const username = String(
      body?.username || "",
    )
      .trim()
      .toLowerCase();

    const password = String(
      body?.password || "",
    );

    // Validate username and password
    if (
      !/^[a-z0-9_.-]{3,24}$/.test(username) ||
      !password
    ) {
      return new Response(
        JSON.stringify({
          error: "Invalid credentials",
        }),
        {
          status: 401,
          headers: {
            ...cors,
            "Content-Type": "application/json",
          },
        },
      );
    }

    // Supabase client
    const { createClient } = await import(
      "https://esm.sh/@supabase/supabase-js@2.91.0"
    );

    const admin = createClient(
      url,
      serviceKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

    // Find profile by username
    const {
      data: profile,
      error: profileError,
    } = await admin
      .from("profiles")
      .select("id")
      .eq("username", username)
      .maybeSingle();

    if (profileError || !profile) {
      return new Response(
        JSON.stringify({
          error: "Invalid credentials",
        }),
        {
          status: 401,
          headers: {
            ...cors,
            "Content-Type": "application/json",
          },
        },
      );
    }

    // Get user's auth account
    const {
      data: userData,
      error: userError,
    } = await admin.auth.admin.getUserById(
      profile.id,
    );

    const email = userData.user?.email;

    if (userError || !email) {
      return new Response(
        JSON.stringify({
          error: "Invalid credentials",
        }),
        {
          status: 401,
          headers: {
            ...cors,
            "Content-Type": "application/json",
          },
        },
      );
    }

    // Login using email internally
    const tokenResponse = await fetch(
      `${url}/auth/v1/token?grant_type=password`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "apikey": publishableKey,
        },

        body: JSON.stringify({
          email,
          password,
        }),
      },
    );

    const tokenBody =
      await tokenResponse.json();

    // Login failed
    if (
      !tokenResponse.ok ||
      !tokenBody.access_token ||
      !tokenBody.refresh_token
    ) {
      return new Response(
        JSON.stringify({
          error: "Invalid credentials",
        }),
        {
          status: 401,
          headers: {
            ...cors,
            "Content-Type": "application/json",
          },
        },
      );
    }

    // Login successful
    return new Response(
      JSON.stringify({
        access_token:
          tokenBody.access_token,

        refresh_token:
          tokenBody.refresh_token,
      }),
      {
        status: 200,
        headers: {
          ...cors,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (error) {
    console.error(error);

    return new Response(
      JSON.stringify({
        error: "Invalid credentials",
      }),
      {
        status: 401,
        headers: {
          ...cors,
          "Content-Type": "application/json",
        },
      },
    );
  }
});
