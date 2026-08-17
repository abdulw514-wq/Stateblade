const els = {
  form: document.getElementById("searchForm"),
  input: document.getElementById("searchInput"),
  hint: document.getElementById("statusHint"),
  results: document.getElementById("results"),
  resultQuery: document.getElementById("resultQuery"),
  resultCount: document.getElementById("resultCount"),
  grid: document.getElementById("resultsGrid"),
  detail: document.getElementById("detail"),
  detailContent: document.getElementById("detailContent"),
  backBtn: document.getElementById("backBtn"),
  ticker: document.getElementById("tickerTrack"),
  platformToggle: document.getElementById("platformToggle"),
};

let currentPlatform = "youtube";

els.platformToggle.addEventListener("click", (e) => {
  const btn = e.target.closest(".platform-btn");
  if (!btn) return;
  currentPlatform = btn.dataset.platform;

  els.platformToggle.querySelectorAll(".platform-btn").forEach((b) => {
    const active = b === btn;
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", String(active));
  });

  els.input.placeholder =
    currentPlatform === "twitch"
      ? "Try “speedrunning”, “just chatting”, “valorant”…"
      : currentPlatform === "bluesky"
      ? "Try “ai safety”, “climate”, “indie games”…"
      : "Try “personal finance”, “home workouts”, “retro gaming”…";
});

const numberFmt = new Intl.NumberFormat("en-US");

function abbreviate(n) {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1).replace(/\.0$/, "") + "B";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child) node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

// ---------- Ticker (illustrative placeholder — not live API data) ----------
const tickerSamples = [
  "MrBeast  •  ▲ 240K subs this week",
  "Ali Abdaal  •  productivity  •  ▲ engagement",
  "trending: “ai tools”  •  ▲ 38% search volume",
  "Kurzgesagt  •  science  •  A+ grade",
  "trending: “budget travel”  •  ▲ 12% search volume",
  "Marques Brownlee  •  tech  •  A+ grade",
];
function renderTicker() {
  const items = tickerSamples.concat(tickerSamples).map((t) => el("span", {}, t));
  els.ticker.innerHTML = "";
  items.forEach((i) => els.ticker.appendChild(i));
}
renderTicker();

// ---------- Search ----------
els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = els.input.value.trim();
  if (!q) return;
  await runSearch(q);
});

async function runSearch(q) {
  setHint("Scanning the niche…");
  els.results.hidden = false;
  els.detail.hidden = true;
  els.grid.innerHTML = "";
  els.resultQuery.textContent = q;
  els.resultCount.textContent = "";
  els.grid.appendChild(spinnerRow());
  els.results.scrollIntoView({ behavior: "smooth", block: "start" });

  const endpoint =
    currentPlatform === "twitch"
      ? "/api/twitch-search"
      : currentPlatform === "bluesky"
      ? "/api/bluesky-search"
      : "/api/search";

  try {
    const res = await fetch(`${endpoint}?q=${encodeURIComponent(q)}`);
    const data = await res.json();

    if (!res.ok) {
      showGridError(data.error || "Something went wrong. Try again in a moment.");
      setHint("");
      return;
    }

    if (!data.channels || data.channels.length === 0) {
      showGridEmpty("No channels found for that keyword. Try a broader term.");
      els.resultCount.textContent = "0 channels";
      setHint("");
      return;
    }

    if (currentPlatform === "twitch") {
      renderTwitchGrid(data.channels);
      const liveCount = data.channels.filter((c) => c.isLive).length;
      els.resultCount.textContent = `${data.channels.length} channels · ${liveCount} live now`;
      setHint(data.note || "Powered by the official Twitch API.");
    } else if (currentPlatform === "bluesky") {
      renderBlueskyGrid(data.channels);
      els.resultCount.textContent = `${data.channels.length} accounts, ranked by followers`;
      setHint(data.note || "Powered by Bluesky's fully public API.");
    } else {
      renderGrid(data.channels);
      els.resultCount.textContent = `${data.channels.length} channels, ranked by subscribers`;
      setHint("Powered by the official YouTube Data API — real numbers, updated every few hours.");
    }
  } catch (err) {
    showGridError("Couldn't reach the server. Check your connection and try again.");
    setHint("");
  }
}

function setHint(text) {
  els.hint.textContent = text;
}

function spinnerRow() {
  return el("div", { class: "spinner-row", style: "grid-column: 1/-1;" }, el("div", { class: "spinner" }));
}

function showGridEmpty(msg) {
  els.grid.innerHTML = "";
  els.grid.appendChild(el("div", { class: "empty-state", style: "grid-column: 1/-1;" }, msg));
}
function showGridError(msg) {
  els.grid.innerHTML = "";
  els.grid.appendChild(el("div", { class: "error-state", style: "grid-column: 1/-1;" }, msg));
}

function renderGrid(channels) {
  els.grid.innerHTML = "";
  channels.forEach((c, idx) => {
    const card = el(
      "button",
      { class: "card", type: "button", "aria-label": `View ${c.title}` },
      [
        el("div", { class: "card-top" }, [
          el("img", { class: "card-thumb", src: c.thumbnail || "", alt: "" }),
          el("div", {}, [
            el("div", { class: "card-rank" }, `#${idx + 1} IN NICHE`),
            el("div", { class: "card-title" }, c.title || "Untitled channel"),
          ]),
        ]),
        el("div", { class: "card-stats" }, [
          el("div", {}, [
            el("span", { class: "stat-num" }, c.hiddenSubs ? "—" : abbreviate(c.subscribers)),
            el("span", { class: "stat-label" }, "SUBSCRIBERS"),
          ]),
          el("div", {}, [
            el("span", { class: "stat-num" }, abbreviate(c.totalViews)),
            el("span", { class: "stat-label" }, "TOTAL VIEWS"),
          ]),
          el("div", {}, [
            el("span", { class: "stat-num" }, numberFmt.format(c.videoCount)),
            el("span", { class: "stat-label" }, "VIDEOS"),
          ]),
        ]),
      ]
    );
    card.addEventListener("click", () => openChannel(c.id));
    els.grid.appendChild(card);
  });

  // Free-tier ad slot — wire up AdSense here once your site is approved.
  els.grid.parentElement.appendChild(
    el("div", { class: "ad-slot" }, "AD SLOT — connect AdSense after approval")
  );
}

function renderTwitchGrid(channels) {
  els.grid.innerHTML = "";
  channels.forEach((c, idx) => {
    const card = el("div", { class: "card" }, [
      el("div", { class: "card-top" }, [
        el("img", { class: "card-thumb", src: c.thumbnail || "", alt: "" }),
        el("div", {}, [
          el("div", { class: "card-rank" }, `#${idx + 1} IN NICHE`),
          el("div", { class: "card-title" }, c.title || "Untitled channel"),
        ]),
      ]),
      el(
        "div",
        { style: "margin: 8px 0;" },
        c.isLive
          ? el("span", { class: "live-badge" }, "LIVE")
          : el("span", { class: "offline-badge" }, "OFFLINE")
      ),
      el("div", { class: "card-stats" }, [
        el("div", {}, [
          el("span", { class: "stat-num" }, c.isLive ? abbreviate(c.viewers) : "—"),
          el("span", { class: "stat-label" }, "VIEWERS NOW"),
        ]),
        el("div", {}, [
          el("span", { class: "stat-num" }, c.game || "—"),
          el("span", { class: "stat-label" }, "CATEGORY"),
        ]),
      ]),
    ]);
    els.grid.appendChild(card);
  });

  els.grid.parentElement.appendChild(
    el("div", { class: "ad-slot" }, "AD SLOT — connect AdSense after approval")
  );
}

function renderBlueskyGrid(accounts) {
  els.grid.innerHTML = "";
  accounts.forEach((a, idx) => {
    const card = el("div", { class: "card" }, [
      el("div", { class: "card-top" }, [
        el("img", { class: "card-thumb", src: a.thumbnail || "", alt: "" }),
        el("div", {}, [
          el("div", { class: "card-rank" }, `#${idx + 1} IN NICHE`),
          el("div", { class: "card-title" }, a.title || a.handle),
          el("div", { style: "color: var(--muted); font-size: 0.8rem;" }, `@${a.handle}`),
        ]),
      ]),
      el("div", { class: "card-stats" }, [
        el("div", {}, [
          el("span", { class: "stat-num" }, abbreviate(a.followers)),
          el("span", { class: "stat-label" }, "FOLLOWERS"),
        ]),
        el("div", {}, [
          el("span", { class: "stat-num" }, String(a.postsInResults)),
          el("span", { class: "stat-label" }, "POSTS ON TOPIC"),
        ]),
      ]),
    ]);
    els.grid.appendChild(card);
  });

  els.grid.parentElement.appendChild(
    el("div", { class: "ad-slot" }, "AD SLOT — connect AdSense after approval")
  );
}

// ---------- Detail view ----------
els.backBtn.addEventListener("click", () => {
  els.detail.hidden = true;
  els.results.hidden = false;
  els.results.scrollIntoView({ behavior: "smooth", block: "start" });
});

async function openChannel(id) {
  els.results.hidden = true;
  els.detail.hidden = false;
  els.detailContent.innerHTML = "";
  els.detailContent.appendChild(spinnerRow());
  els.detail.scrollIntoView({ behavior: "smooth", block: "start" });

  try {
    const res = await fetch(`/api/channel?id=${encodeURIComponent(id)}`);
    const data = await res.json();

    if (!res.ok) {
      els.detailContent.innerHTML = "";
      els.detailContent.appendChild(el("div", { class: "error-state" }, data.error || "Couldn't load this channel."));
      return;
    }

    renderDetail(data);
  } catch (err) {
    els.detailContent.innerHTML = "";
    els.detailContent.appendChild(el("div", { class: "error-state" }, "Couldn't reach the server."));
  }
}

function renderDetail(data) {
  const { channel, videos, topTags } = data;
  els.detailContent.innerHTML = "";

  els.detailContent.appendChild(
    el("div", { class: "detail-header" }, [
      el("img", { class: "detail-thumb", src: channel.thumbnail || "", alt: "" }),
      el("div", {}, [
        el("h1", { class: "detail-title" }, channel.title || "Untitled channel"),
        el("p", { class: "detail-desc" }, (channel.description || "No description provided.").slice(0, 220)),
      ]),
      el("div", { class: "grade-badge", style: "font-size:1.1rem; padding:8px 16px;" }, `Grade ${channel.grade}`),
    ])
  );

  els.detailContent.appendChild(
    el("div", { class: "stat-row" }, [
      statBlock(channel.hiddenSubs ? "—" : abbreviate(channel.subscribers), "SUBSCRIBERS"),
      statBlock(abbreviate(channel.totalViews), "TOTAL VIEWS"),
      statBlock(numberFmt.format(channel.videoCount), "VIDEOS"),
      statBlock(channel.country || "—", "COUNTRY"),
    ])
  );

  els.detailContent.appendChild(el("h2", { class: "section-title" }, "Suggested keywords from top videos"));
  if (topTags && topTags.length > 0) {
    els.detailContent.appendChild(
      el(
        "div",
        { class: "tag-cloud" },
        topTags.map((t) => el("span", { class: "tag-chip" }, [t.tag, el("span", { class: "count" }, `×${t.count}`)]))
      )
    );
  } else {
    els.detailContent.appendChild(el("div", { class: "empty-state" }, "This channel's recent videos have no public tags."));
  }

  els.detailContent.appendChild(el("h2", { class: "section-title" }, "Recent videos"));
  if (videos && videos.length > 0) {
    els.detailContent.appendChild(
      el(
        "div",
        { class: "video-list" },
        videos.map((v) =>
          el("div", { class: "video-row" }, [
            el("img", { class: "video-thumb", src: v.thumbnail || "", alt: "" }),
            el("div", { class: "video-title" }, v.title || "Untitled video"),
            el("div", { class: "video-views" }, `${abbreviate(v.views)} views`),
          ])
        )
      )
    );
  } else {
    els.detailContent.appendChild(el("div", { class: "empty-state" }, "No recent videos found."));
  }

  els.detailContent.appendChild(el("div", { class: "ad-slot" }, "AD SLOT — connect AdSense after approval"));
}

function statBlock(value, label) {
  return el("div", { class: "stat-block" }, [
    el("span", { class: "stat-num" }, String(value)),
    el("span", { class: "stat-label" }, label),
  ]);
}
