// StateBlade Worker
// Routes /api/search and /api/channel to the YouTube Data API (server-side,
// key never touches the browser). Everything else falls through to the
// static site in /public (index.html, styles.css, script.js) via env.ASSETS.

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/search") {
      return handleSearch(request, env, ctx);
    }
    if (url.pathname === "/api/channel") {
      return handleChannel(request, env, ctx);
    }
    if (url.pathname === "/api/twitch-search") {
      return handleTwitchSearch(request, env, ctx);
    }
    if (url.pathname === "/api/bluesky-search") {
      return handleBlueskySearch(request, env, ctx);
    }
    if (url.pathname === "/api/kick-search") {
      return handleKickSearch(request, env, ctx);
    }

    // Not an API route — serve the static site
    return env.ASSETS.fetch(request);
  },
};

// ---------- /api/search?q=keyword ----------
async function handleSearch(request, env, ctx) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();

  if (!q) return json({ error: "Missing query parameter 'q'." }, 400);

  const cache = caches.default;
  const cacheKey = new Request(url.toString(), request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  if (!env.YOUTUBE_API_KEY) {
    return json(
      { error: "Server is missing YOUTUBE_API_KEY. Set it in Cloudflare Workers > Settings > Variables and Secrets." },
      500
    );
  }

  try {
    const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
    searchUrl.searchParams.set("part", "snippet");
    searchUrl.searchParams.set("q", q);
    searchUrl.searchParams.set("type", "channel");
    searchUrl.searchParams.set("maxResults", "12");
    searchUrl.searchParams.set("key", env.YOUTUBE_API_KEY);

    const searchRes = await fetch(searchUrl.toString());
    const searchData = await searchRes.json();

    if (!searchRes.ok) {
      return json({ error: searchData?.error?.message || "YouTube search failed." }, searchRes.status);
    }

    const channelIds = (searchData.items || [])
      .map((item) => item.snippet?.channelId || item.id?.channelId)
      .filter(Boolean);

    if (channelIds.length === 0) {
      const empty = json({ query: q, channels: [] });
      ctx.waitUntil(cache.put(cacheKey, empty.clone()));
      return empty;
    }

    const statsUrl = new URL("https://www.googleapis.com/youtube/v3/channels");
    statsUrl.searchParams.set("part", "snippet,statistics");
    statsUrl.searchParams.set("id", channelIds.join(","));
    statsUrl.searchParams.set("key", env.YOUTUBE_API_KEY);

    const statsRes = await fetch(statsUrl.toString());
    const statsData = await statsRes.json();

    if (!statsRes.ok) {
      return json({ error: statsData?.error?.message || "YouTube channel lookup failed." }, statsRes.status);
    }

    const channels = (statsData.items || [])
      .map((c) => ({
        id: c.id,
        title: c.snippet?.title,
        description: c.snippet?.description,
        thumbnail: c.snippet?.thumbnails?.medium?.url || c.snippet?.thumbnails?.default?.url,
        country: c.snippet?.country || null,
        publishedAt: c.snippet?.publishedAt,
        subscribers: safeInt(c.statistics?.subscriberCount),
        totalViews: safeInt(c.statistics?.viewCount),
        videoCount: safeInt(c.statistics?.videoCount),
        hiddenSubs: !!c.statistics?.hiddenSubscriberCount,
      }))
      .sort((a, b) => (b.subscribers || 0) - (a.subscribers || 0));

    const result = json({ query: q, channels });
    ctx.waitUntil(cache.put(cacheKey, result.clone()));
    return result;
  } catch (err) {
    return json({ error: "Unexpected server error.", detail: String(err) }, 500);
  }
}

// ---------- /api/channel?id=CHANNEL_ID ----------
async function handleChannel(request, env, ctx) {
  const url = new URL(request.url);
  const id = (url.searchParams.get("id") || "").trim();

  if (!id) return json({ error: "Missing query parameter 'id'." }, 400);

  const cache = caches.default;
  const cacheKey = new Request(url.toString(), request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  if (!env.YOUTUBE_API_KEY) {
    return json(
      { error: "Server is missing YOUTUBE_API_KEY. Set it in Cloudflare Workers > Settings > Variables and Secrets." },
      500
    );
  }

  try {
    const chUrl = new URL("https://www.googleapis.com/youtube/v3/channels");
    chUrl.searchParams.set("part", "snippet,statistics,contentDetails");
    chUrl.searchParams.set("id", id);
    chUrl.searchParams.set("key", env.YOUTUBE_API_KEY);

    const chRes = await fetch(chUrl.toString());
    const chData = await chRes.json();
    if (!chRes.ok) return json({ error: chData?.error?.message || "Channel lookup failed." }, chRes.status);

    const channel = chData.items?.[0];
    if (!channel) return json({ error: "Channel not found." }, 404);

    const uploadsPlaylistId = channel.contentDetails?.relatedPlaylists?.uploads;

    let videos = [];
    let topTags = [];

    if (uploadsPlaylistId) {
      const plUrl = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
      plUrl.searchParams.set("part", "snippet");
      plUrl.searchParams.set("playlistId", uploadsPlaylistId);
      plUrl.searchParams.set("maxResults", "15");
      plUrl.searchParams.set("key", env.YOUTUBE_API_KEY);

      const plRes = await fetch(plUrl.toString());
      const plData = await plRes.json();

      const videoIds = (plData.items || [])
        .map((i) => i.snippet?.resourceId?.videoId)
        .filter(Boolean);

      if (videoIds.length > 0) {
        const vUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
        vUrl.searchParams.set("part", "snippet,statistics");
        vUrl.searchParams.set("id", videoIds.join(","));
        vUrl.searchParams.set("key", env.YOUTUBE_API_KEY);

        const vRes = await fetch(vUrl.toString());
        const vData = await vRes.json();

        videos = (vData.items || []).map((v) => ({
          id: v.id,
          title: v.snippet?.title,
          publishedAt: v.snippet?.publishedAt,
          thumbnail: v.snippet?.thumbnails?.medium?.url,
          tags: v.snippet?.tags || [],
          views: safeInt(v.statistics?.viewCount),
          likes: safeInt(v.statistics?.likeCount),
          comments: safeInt(v.statistics?.commentCount),
        }));

        const freq = new Map();
        for (const v of videos) {
          for (const t of v.tags) {
            const key = t.toLowerCase().trim();
            if (!key) continue;
            freq.set(key, (freq.get(key) || 0) + 1);
          }
        }
        topTags = [...freq.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)
          .map(([tag, count]) => ({ tag, count }));
      }
    }

    const subs = safeInt(channel.statistics?.subscriberCount);
    const totalViews = safeInt(channel.statistics?.viewCount);
    const videoCount = safeInt(channel.statistics?.videoCount);

    const result = json({
      channel: {
        id: channel.id,
        title: channel.snippet?.title,
        description: channel.snippet?.description,
        thumbnail: channel.snippet?.thumbnails?.medium?.url,
        country: channel.snippet?.country || null,
        publishedAt: channel.snippet?.publishedAt,
        subscribers: subs,
        totalViews,
        videoCount,
        grade: computeGrade({ subs, totalViews, videoCount, videos }),
      },
      videos,
      topTags,
    });

    ctx.waitUntil(cache.put(cacheKey, result.clone()));
    return result;
  } catch (err) {
    return json({ error: "Unexpected server error.", detail: String(err) }, 500);
  }
}

// ---------- /api/twitch-search?q=keyword ----------
// Twitch doesn't publicly expose follower counts (locked down since 2023 —
// it now requires the channel owner's own token). So instead we rank by
// live viewer count where available, which is public data via app tokens.
async function handleTwitchSearch(request, env, ctx) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();

  if (!q) return json({ error: "Missing query parameter 'q'." }, 400);

  const cache = caches.default;
  const cacheKey = new Request(url.toString(), request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) {
    return json(
      { error: "Server is missing TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET. Set them in Cloudflare Workers > Settings > Variables and Secrets." },
      500
    );
  }

  try {
    let token = await getTwitchToken(env, ctx);

    // Step 1: search channels matching the keyword
    const searchUrl = new URL("https://api.twitch.tv/helix/search/channels");
    searchUrl.searchParams.set("query", q);
    searchUrl.searchParams.set("first", "20");

    let searchRes = await fetch(searchUrl.toString(), {
      headers: {
        "Client-Id": env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`,
      },
    });

    // If the cached token is stale/invalid (e.g. secret was rotated since it
    // was cached), force a fresh one and retry once before giving up.
    if (searchRes.status === 401) {
      token = await getTwitchToken(env, ctx, { forceRefresh: true });
      searchRes = await fetch(searchUrl.toString(), {
        headers: {
          "Client-Id": env.TWITCH_CLIENT_ID,
          Authorization: `Bearer ${token}`,
        },
      });
    }

    const searchData = await searchRes.json();

    if (!searchRes.ok) {
      return json(
        { error: searchData?.message || `Twitch search failed (${searchRes.status}).`, detail: JSON.stringify(searchData).slice(0, 300) },
        searchRes.status
      );
    }

    const items = searchData.data || [];
    if (items.length === 0) {
      const empty = json({ query: q, channels: [] });
      ctx.waitUntil(cache.put(cacheKey, empty.clone()));
      return empty;
    }

    // Step 2: pull live viewer counts for any of those channels currently live
    const userIds = items.map((c) => c.id).filter(Boolean);
    const streamsUrl = new URL("https://api.twitch.tv/helix/streams");
    userIds.slice(0, 100).forEach((id) => streamsUrl.searchParams.append("user_id", id));

    const streamsRes = await fetch(streamsUrl.toString(), {
      headers: {
        "Client-Id": env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${token}`,
      },
    });
    const streamsData = await streamsRes.json();
    const liveByUserId = new Map(
      (streamsData.data || []).map((s) => [s.user_id, s])
    );

    const channels = items
      .map((c) => {
        const live = liveByUserId.get(c.id);
        return {
          id: c.id,
          title: c.display_name,
          thumbnail: c.thumbnail_url,
          game: c.game_name || null,
          isLive: !!c.is_live,
          viewers: live ? safeInt(live.viewer_count) : 0,
          startedAt: live ? live.started_at : null,
          tags: c.tags || [],
        };
      })
      .sort((a, b) => {
        if (a.isLive !== b.isLive) return a.isLive ? -1 : 1;
        return b.viewers - a.viewers;
      });

    const result = json({ query: q, channels, note: "Twitch doesn't expose follower counts publicly — ranked by current live viewers instead." });
    ctx.waitUntil(cache.put(cacheKey, result.clone()));
    return result;
  } catch (err) {
    return json({ error: "Unexpected server error.", detail: String(err) }, 500);
  }
}

// Fetches (and edge-caches) a Twitch app access token via client_credentials.
// Tokens last ~60 days; we cache ours for 12 hours at a time to stay safe
// and simple, refreshing well before real expiry. Pass forceRefresh to
// bypass a stale cached token (e.g. after a 401 from a rotated secret).
async function getTwitchToken(env, ctx, { forceRefresh = false } = {}) {
  const cache = caches.default;
  const tokenCacheKey = new Request("https://internal.stateblade/twitch-token");

  if (forceRefresh) {
    await cache.delete(tokenCacheKey);
  } else {
    const cached = await cache.match(tokenCacheKey);
    if (cached) {
      const data = await cached.json();
      return data.access_token;
    }
  }

  const tokenUrl = new URL("https://id.twitch.tv/oauth2/token");
  tokenUrl.searchParams.set("client_id", env.TWITCH_CLIENT_ID);
  tokenUrl.searchParams.set("client_secret", env.TWITCH_CLIENT_SECRET);
  tokenUrl.searchParams.set("grant_type", "client_credentials");

  const res = await fetch(tokenUrl.toString(), { method: "POST" });
  const data = await res.json();

  if (!res.ok || !data.access_token) {
    throw new Error(data?.message || "Failed to obtain Twitch access token.");
  }

  const tokenResponse = new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=43200", // 12 hours
    },
  });
  ctx.waitUntil(cache.put(tokenCacheKey, tokenResponse));

  return data.access_token;
}

// ---------- /api/bluesky-search?q=keyword ----------
// Bluesky's edge blocks anonymous requests from cloud/datacenter IPs
// (including Cloudflare Workers) as a bot-prevention measure — even though
// the API is nominally "public." So we authenticate with a lightweight App
// Password (not the account's real password) to get past that, same
// two-step pattern as before: search posts, then fetch real follower counts
// for the top candidate authors.
async function handleBlueskySearch(request, env, ctx) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();

  if (!q) return json({ error: "Missing query parameter 'q'." }, 400);

  const cache = caches.default;
  const cacheKey = new Request(url.toString(), request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  if (!env.BLUESKY_HANDLE || !env.BLUESKY_APP_PASSWORD) {
    return json(
      { error: "Server is missing BLUESKY_HANDLE / BLUESKY_APP_PASSWORD. Set them in Cloudflare Workers > Settings > Variables and Secrets." },
      500
    );
  }

  try {
    let token = await getBlueskySession(env, ctx);
    const authHeaders = () => ({
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    });

    // Step 1: search posts matching the keyword
    const searchUrl = new URL("https://bsky.social/xrpc/app.bsky.feed.searchPosts");
    searchUrl.searchParams.set("q", q);
    searchUrl.searchParams.set("limit", "50");

    let searchRes = await fetch(searchUrl.toString(), { headers: authHeaders() });

    // Self-heal: if the cached session token is stale/invalid, force a fresh
    // login and retry once before giving up.
    if (searchRes.status === 401 || searchRes.status === 403) {
      token = await getBlueskySession(env, ctx, { forceRefresh: true });
      searchRes = await fetch(searchUrl.toString(), { headers: authHeaders() });
    }

    const searchBodyText = await searchRes.text();
    if (!searchRes.ok) {
      return json(
        { error: `Bluesky search failed (${searchRes.status}).`, detail: searchBodyText.slice(0, 300) },
        searchRes.status
      );
    }

    let searchData;
    try {
      searchData = JSON.parse(searchBodyText);
    } catch {
      return json({ error: "Bluesky returned an unexpected (non-JSON) response.", detail: searchBodyText.slice(0, 300) }, 502);
    }

    const posts = searchData.posts || [];
    if (posts.length === 0) {
      const empty = json({ query: q, channels: [] });
      ctx.waitUntil(cache.put(cacheKey, empty.clone()));
      return empty;
    }

    // Tally posts + engagement per author from the basic profiles in results
    const byAuthor = new Map();
    for (const post of posts) {
      const author = post.author;
      if (!author?.did) continue;

      const engagement = safeInt(post.likeCount) + safeInt(post.repostCount) + safeInt(post.replyCount);

      if (!byAuthor.has(author.did)) {
        byAuthor.set(author.did, {
          did: author.did,
          handle: author.handle,
          title: author.displayName || author.handle,
          thumbnail: author.avatar || "",
          postsInResults: 0,
          totalEngagement: 0,
        });
      }
      const entry = byAuthor.get(author.did);
      entry.postsInResults += 1;
      entry.totalEngagement += engagement;
    }

    // Take the top 25 candidates by engagement to look up real follower counts
    const candidates = [...byAuthor.values()]
      .sort((a, b) => b.totalEngagement - a.totalEngagement)
      .slice(0, 25);

    let followerMap = new Map();
    if (candidates.length > 0) {
      const profilesUrl = new URL("https://bsky.social/xrpc/app.bsky.actor.getProfiles");
      candidates.forEach((c) => profilesUrl.searchParams.append("actors", c.did));

      const profilesRes = await fetch(profilesUrl.toString(), { headers: authHeaders() });
      if (profilesRes.ok) {
        const profilesData = await profilesRes.json();
        followerMap = new Map(
          (profilesData.profiles || []).map((p) => [p.did, safeInt(p.followersCount)])
        );
      }
      // If this second call fails, we just fall back to 0 followers below
      // rather than failing the whole request.
    }

    const channels = candidates
      .map((c) => ({
        id: c.did,
        title: c.title,
        handle: c.handle,
        thumbnail: c.thumbnail,
        followers: followerMap.get(c.did) || 0,
        postsInResults: c.postsInResults,
        totalEngagement: c.totalEngagement,
        url: `https://bsky.app/profile/${c.handle}`,
      }))
      .sort((a, b) => b.followers - a.followers || b.totalEngagement - a.totalEngagement);

    const result = json({
      query: q,
      channels,
      note: "Ranked by follower count among accounts posting about this topic, via the Bluesky API.",
    });
    ctx.waitUntil(cache.put(cacheKey, result.clone()));
    return result;
  } catch (err) {
    return json({ error: "Unexpected server error while querying Bluesky.", detail: String(err?.message || err) }, 500);
  }
}

// Logs into Bluesky via an App Password (com.atproto.server.createSession)
// and caches the resulting access token. Sessions are valid for a couple
// hours; we cache for 90 minutes to stay safely within that. Pass
// forceRefresh to bypass a stale cached token (e.g. after a 401/403).
async function getBlueskySession(env, ctx, { forceRefresh = false } = {}) {
  const cache = caches.default;
  const sessionCacheKey = new Request("https://internal.stateblade/bluesky-session");

  if (forceRefresh) {
    await cache.delete(sessionCacheKey);
  } else {
    const cached = await cache.match(sessionCacheKey);
    if (cached) {
      const data = await cached.json();
      return data.accessJwt;
    }
  }

  const res = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identifier: env.BLUESKY_HANDLE,
      password: env.BLUESKY_APP_PASSWORD,
    }),
  });
  const data = await res.json();

  if (!res.ok || !data.accessJwt) {
    throw new Error(data?.message || "Failed to log in to Bluesky. Check BLUESKY_HANDLE and BLUESKY_APP_PASSWORD.");
  }

  const sessionResponse = new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=5400", // 90 minutes
    },
  });
  ctx.waitUntil(cache.put(sessionCacheKey, sessionResponse));

  return data.accessJwt;
}


// ---------- /api/kick-search?q=username ----------
// IMPORTANT: Kick's official public API (api.kick.com/public/v1) has NO
// keyword/fuzzy search endpoint for channels. The Channels endpoint only
// supports an EXACT lookup by `slug` (username) or `broadcaster_user_id`.
// (Kick's own docs: https://docs.kick.com/apis/channels)
//
// So this treats `q` as a candidate username: it slugifies it and does an
// exact-match lookup. If it doesn't exist, we return an empty result with
// a clear message instead of pretending to "search" and silently failing.
//
// Set KICK_CLIENT_ID and KICK_CLIENT_SECRET in Workers secrets.
async function handleKickSearch(request, env, ctx) {
  const url = new URL(request.url);
  const qRaw = (url.searchParams.get("q") || "").trim();

  if (!qRaw) return json({ error: "Missing query parameter 'q'." }, 400);

  // Kick usernames/slugs: lowercase letters, numbers, hyphens, underscores.
  const slug = qRaw
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "");

  if (!slug) {
    return json({ query: qRaw, channels: [], note: "Enter a valid Kick username." });
  }

  const cache = caches.default;
  const cacheKey = new Request(url.toString(), request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  if (!env.KICK_CLIENT_ID || !env.KICK_CLIENT_SECRET) {
    return json(
      { error: "Server is missing KICK_CLIENT_ID / KICK_CLIENT_SECRET. Set them in Cloudflare Workers > Settings > Variables and Secrets." },
      500
    );
  }

  try {
    const channel = await fetchKickChannelBySlug(slug, env, ctx);

    if (!channel) {
      const empty = json({
        query: qRaw,
        channels: [],
        note: "Kick's public API only supports exact-username lookup, not keyword search. No channel matches that username exactly — check the spelling.",
      });
      ctx.waitUntil(cache.put(cacheKey, empty.clone()));
      return empty;
    }

    // Enrich with avatar via the Users endpoint (Channels response has no profile pic).
    let profilePicture = "";
    try {
      const token = await getKickToken(env, ctx);
      const usersUrl = new URL("https://api.kick.com/public/v1/users");
      usersUrl.searchParams.set("id", String(channel.broadcaster_user_id));
      const usersRes = await fetch(usersUrl.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
          "Client-Id": env.KICK_CLIENT_ID,
          Accept: "application/json",
        },
      });
      if (usersRes.ok) {
        const usersData = await usersRes.json();
        profilePicture = usersData?.data?.[0]?.profile_picture || "";
      }
    } catch {
      // Non-fatal — just skip the avatar.
    }

    const channels = [
      {
        id: String(channel.broadcaster_user_id || ""),
        title: channel.slug || slug,
        thumbnail: profilePicture,
        slug: channel.slug || slug,
        isLive: !!channel.stream?.is_live,
        viewers: safeInt(channel.stream?.viewer_count || 0),
        category: channel.category?.name || null,
        streamTitle: channel.stream_title || null,
        url: `https://kick.com/${channel.slug || slug}`,
      },
    ];

    const result = json({
      query: qRaw,
      channels,
      note: "Powered by the official Kick API (exact-username lookup).",
    });
    ctx.waitUntil(cache.put(cacheKey, result.clone()));
    return result;
  } catch (err) {
    return json({ error: "Unexpected server error.", detail: String(err) }, 500);
  }
}

// Fetches a single channel by exact slug. Returns null on 404/not-found,
// throws on real errors (auth failures, 5xx, etc.).
async function fetchKickChannelBySlug(slug, env, ctx, { retried = false } = {}) {
  const token = await getKickToken(env, ctx);

  const lookupUrl = new URL("https://api.kick.com/public/v1/channels");
  lookupUrl.searchParams.set("slug", slug);

  const res = await fetch(lookupUrl.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      "Client-Id": env.KICK_CLIENT_ID,
      Accept: "application/json",
    },
  });

  if (res.status === 404) return null;

  // If the cached token expired/was rejected, refresh once and retry.
  if (res.status === 401 && !retried) {
    await getKickToken(env, ctx, { forceRefresh: true });
    return fetchKickChannelBySlug(slug, env, ctx, { retried: true });
  }

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data?.message || `Kick channel lookup failed (${res.status}).`);
  }

  const items = data?.data || [];
  return items[0] || null;
}

// Fetches and edge-caches a Kick OAuth2 app token (client_credentials).
// Tokens last ~24 hours; cached for 12 hours to stay safe.
async function getKickToken(env, ctx, { forceRefresh = false } = {}) {
  const cache = caches.default;
  const tokenCacheKey = new Request("https://internal.stateblade/kick-token");

  if (forceRefresh) {
    await cache.delete(tokenCacheKey);
  } else {
    const cached = await cache.match(tokenCacheKey);
    if (cached) {
      const data = await cached.json();
      return data.access_token;
    }
  }

  const res = await fetch("https://id.kick.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: env.KICK_CLIENT_ID,
      client_secret: env.KICK_CLIENT_SECRET,
    }).toString(),
  });

  const data = await res.json();

  if (!res.ok || !data.access_token) {
    throw new Error(data?.message || data?.error_description || "Failed to obtain Kick access token.");
  }

  const tokenResponse = new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=43200", // 12 hours
    },
  });
  ctx.waitUntil(cache.put(tokenCacheKey, tokenResponse));

  return data.access_token;
}

// A simple, transparent heuristic grade (SocialBlade-style A+ to C)
// based on channel size, reach, and recent engagement. Not an official score.
function computeGrade({ subs, totalViews, videoCount, videos }) {
  const avgViewsPerVideo = videoCount > 0 ? totalViews / videoCount : 0;
  const recentEngagement =
    videos.length > 0
      ? videos.reduce((sum, v) => sum + (v.views > 0 ? (v.likes + v.comments) / v.views : 0), 0) / videos.length
      : 0;

  let score = 0;
  score += Math.min(subs / 1_000_000, 1) * 40;
  score += Math.min(avgViewsPerVideo / 500_000, 1) * 30;
  score += Math.min(recentEngagement * 1000, 1) * 30;

  if (score >= 85) return "A+";
  if (score >= 70) return "A";
  if (score >= 55) return "B+";
  if (score >= 40) return "B";
  if (score >= 25) return "C+";
  return "C";
}

function safeInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=21600",
    },
  });
}
