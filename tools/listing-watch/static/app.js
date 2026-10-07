/* Listing Watch front end. No build step and no libraries. */
"use strict";

const state = {
  summary: null, meta: null, agents: [], person: "",
  ready: { filter: "ready", q: "", suburb: "", selected: new Set(), agent: "" },
  watch: { filter: "owner", q: "" },
  tracker: { filter: "open", q: "", agent: "" },
  lastUnread: null,
};

// ---------- helpers ----------

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseISO(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}
// Always spell the month so 03/04 can never be misread.
function fmtDate(iso, withDay = true) {
  const d = parseISO(iso);
  if (!d) return "";
  return `${withDay ? DAYS[d.getDay()] + " " : ""}${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
function fmtWhen(ts) {
  if (!ts) return "";
  const time = ts.slice(11, 16);
  return `${fmtDate(ts)}${time ? ", " + time : ""}`;
}
function relDays(iso) {
  const today = parseISO(state.summary?.today);
  const d = parseISO(iso);
  if (!today || !d) return "";
  const n = Math.round((d - today) / 86400000);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}
function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const threshold = () => state.summary?.settings?.threshold_days ?? 70;
const telHref = (p) => "tel:" + String(p).replace(/[^\d+]/g, "");

async function api(path, opts = {}) {
  const headers = { "X-Person": encodeURIComponent(state.person || "") };
  if (opts.json !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(path, {
    method: opts.method || (opts.json !== undefined || opts.body ? "POST" : "GET"),
    headers, body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body,
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) throw new Error((data && data.error) || `Something went wrong (${res.status}).`);
  return data;
}

function toast(msg, error = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast" + (error ? " error" : "");
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), error ? 7000 : 3500);
}

// Run an action that changes data. Shows the server's reason if it refuses.
async function act(fn, success) {
  if (!state.person) {
    $("#person-wrap").classList.add("missing");
    $("#person").focus();
    showModal(`<h2>Who are you?</h2><p>Choose your name in the <b>You are</b> box at the top right first. Every change is saved with the name of the person who made it.</p><div class="row end"><button class="btn" data-close>OK</button></div>`);
    return false;
  }
  try {
    const r = await fn();
    if (success) toast(success);
    return r ?? true;
  } catch (e) {
    if (e.message.includes("\n")) {
      showModal(`<h2>That didn't go through</h2><pre>${esc(e.message)}</pre><div class="row end"><button class="btn" data-close>OK</button></div>`);
    } else {
      toast(e.message, true);
    }
    return false;
  }
}

function showModal(html) {
  $("#modal-panel").innerHTML = html;
  $("#modal").hidden = false;
  const first = $("#modal-panel").querySelector("[autofocus], .btn:not(.ghost)") || $("#modal-panel").querySelector("button");
  first && first.focus();
}
function closeModal() { $("#modal").hidden = true; }

function confirmBox({ title, body, ok = "Yes, go ahead", danger = false }) {
  return new Promise((resolve) => {
    showModal(`<h2>${esc(title)}</h2><div>${body}</div>
      <div class="row end"><button class="btn ghost" data-answer="no">Cancel</button>
      <button class="btn ${danger ? "danger" : ""}" data-answer="yes">${esc(ok)}</button></div>`);
    $("#modal-panel").querySelectorAll("[data-answer]").forEach((b) =>
      b.addEventListener("click", () => { closeModal(); resolve(b.dataset.answer === "yes"); }));
    $("#modal-panel .btn.ghost").focus();
  });
}

// Ask for one line of text in the page (browser prompt boxes are blocked in some places).
function askText({ title, label, hint = "", value = "", ok = "Save" }) {
  return new Promise((resolve) => {
    showModal(`<h2>${esc(title)}</h2><form id="ask-form"><label class="field"><span>${esc(label)}</span>
      <input class="input" id="ask-input" value="${esc(value)}" autocomplete="name" required autofocus></label>
      ${hint ? `<p class="sub">${esc(hint)}</p>` : ""}
      <div class="row end"><button type="button" class="btn ghost" data-answer="no">Cancel</button><button class="btn" type="submit">${esc(ok)}</button></div></form>`);
    const input = $("#ask-input");
    input.focus();
    input.select();
    $("#ask-form").addEventListener("submit", (e) => { e.preventDefault(); const v = input.value.trim(); if (!v) return; closeModal(); resolve(v); });
    $("#modal-panel [data-answer=no]").addEventListener("click", () => { closeModal(); resolve(null); });
  });
}

// ---------- chrome: person, counts, banners, notifications ----------

async function loadAgents() {
  state.agents = await api("/api/agents");
  const sel = $("#person");
  let saved = "";
  try { saved = localStorage.getItem("lw-person") || ""; } catch {}
  const names = state.agents.filter((a) => a.active).map((a) => a.name);
  const extra = saved && !names.includes(saved) ? [saved] : [];
  sel.innerHTML = `<option value="">Choose your name</option>` +
    [...names, ...extra].map((n) => `<option ${n === saved ? "selected" : ""}>${esc(n)}</option>`).join("") +
    `<option value="__other">Someone else...</option>`;
  state.person = sel.value === "__other" ? "" : sel.value;
  $("#person-wrap").classList.toggle("missing", !state.person);
}

$("#person").addEventListener("change", async (e) => {
  let v = e.target.value;
  if (v === "__other") {
    e.target.value = state.person;
    v = await askText({ title: "Who are you?", label: "Your name", hint: "For example the office manager. It's saved with every change you make.", ok: "Continue" });
    if (!v) return;
  }
  state.person = v;
  try { localStorage.setItem("lw-person", v); } catch {}
  loadAgents();
  if (location.hash.startsWith("#/tracker")) render();
});

async function refreshSummary() {
  const s = await api("/api/summary");
  state.summary = s;
  const c = s.counts;
  $("#office").textContent = s.settings.office_name || `Listings over ${s.settings.threshold_days} days`;
  $("#c-ready").textContent = c.ready_to_assign || "";
  $("#c-ready").classList.toggle("hot", c.just_hit > 0);
  $("#c-watch").textContent = c.watching || "";
  const trackerHot = c.follow_ups_due + c.stop_calling;
  $("#c-tracker").textContent = trackerHot || c.in_progress || "";
  $("#c-tracker").classList.toggle("hot", trackerHot > 0);
  const badge = $("#unread");
  badge.hidden = !s.unread;
  badge.textContent = s.unread;
  if (state.lastUnread !== null && s.unread > state.lastUnread) browserNotify();
  state.lastUnread = s.unread;
  renderBanners();
  return s;
}

function renderBanners() {
  const s = state.summary, c = s.counts, out = [];
  if (c.stop_calling) out.push(`<div class="banner danger"><b>Stop calling:</b> ${plural(c.stop_calling, "property you are working is", "properties you are working are")} no longer for sale. <a class="btn small danger" href="#/tracker/stop">Show me</a></div>`);
  if (s.data_age_days !== null && s.data_age_days >= s.settings.stale_after_days)
    out.push(`<div class="banner warn">The for-sale data is ${s.data_age_days} days old. Day counts and sold properties may be wrong until you import a fresh export. <a class="btn small" href="#/import">Import now</a></div>`);
  if (!s.settings.our_agencies.length && c.listings)
    out.push(`<div class="banner warn">Your agency name isn't set, so your own listings could end up on contact sheets. <a class="btn small" href="#/settings">Set it</a></div>`);
  $("#banners").innerHTML = out.join("");
}

async function browserNotify() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const list = await api("/api/notifications");
  const n = list.find((x) => !x.read_at);
  if (n) new Notification("Listing Watch: " + n.title, { body: n.body.split("\n").slice(0, 4).join("\n") });
}

$("#bell").addEventListener("click", openNotifications);

async function openNotifications() {
  const list = await api("/api/notifications");
  $("#drawer-panel").innerHTML = `
    <div class="drawer-head"><div><h2>Notifications</h2><div class="sub">Properties that hit ${threshold()} days, follow-ups due, and sold or withdrawn properties.</div></div>
    <button class="close" data-close aria-label="Close">&times;</button></div>
    <div class="drawer-body">
      <div class="row">${list.some((n) => !n.read_at) ? `<button class="btn small ghost" id="mark-read">Mark all as read</button>` : ""}
      ${"Notification" in window && Notification.permission !== "granted" ? `<button class="btn small ghost" id="allow-notify">Show alerts on this computer</button>` : ""}</div>
      <div class="card">${list.length ? `<ul class="notes">${list.map(noteItem).join("")}</ul>` : `<div class="empty"><b>Nothing yet</b>When a watchlist property hits ${threshold()} days it shows up here.</div>`}</div>
    </div>`;
  openDrawer();
  $("#mark-read")?.addEventListener("click", async () => { await api("/api/notifications/read", { json: {} }); await refreshSummary(); openNotifications(); });
  $("#allow-notify")?.addEventListener("click", async () => { await Notification.requestPermission(); openNotifications(); });
  $("#drawer-panel").querySelectorAll("[data-lead]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); openLead(+a.dataset.lead); }));
}

function noteItem(n) {
  const ids = JSON.parse(n.lead_ids || "[]");
  const kinds = { crossed: "Ready to assign", off_market: "Tracker", follow_up: "Tracker", stale: "Import data" };
  const link = { crossed: "#/ready", off_market: "#/tracker/stop", follow_up: "#/tracker/due", stale: "#/import" }[n.kind];
  return `<li class="${n.read_at ? "" : "unread"}"><div class="t">${esc(n.title)}</div>
    <div class="b">${esc(n.body)}</div>
    <div class="row small"><span class="when">${esc(fmtWhen(n.created_at))}</span>
    ${link ? `<a href="${link}" data-close>Go to ${kinds[n.kind]}</a>` : ""}
    ${ids.length === 1 ? `<a href="#" data-lead="${ids[0]}">Open property</a>` : ""}</div></li>`;
}

function openDrawer() { $("#drawer").hidden = false; $("#drawer-panel").scrollTop = 0; $("#drawer .close")?.focus(); }
function closeDrawer() { $("#drawer").hidden = true; }

document.addEventListener("click", (e) => {
  if (e.target.closest("[data-close]")) {
    if (e.target.closest("#modal")) closeModal(); else closeDrawer();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("#modal").hidden) closeModal(); else if (!$("#drawer").hidden) closeDrawer();
});

// ---------- router ----------

const views = { today: viewToday, ready: viewReady, watch: viewWatch, tracker: viewTracker, sheets: viewSheets, insights: viewInsights, import: viewImport, settings: viewSettings };

async function render() {
  const [, name = "today", arg] = (location.hash || "#/today").split("/");
  document.querySelectorAll("#tabs a").forEach((a) => {
    if (a.dataset.tab === name) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  $("#actionbar")?.remove();
  const fn = views[name] || viewToday;
  try {
    await fn(arg);
  } catch (e) {
    $("#view").innerHTML = `<div class="card"><h2>Couldn't load this page</h2><p>${esc(e.message)}</p><button class="btn" onclick="location.reload()">Try again</button></div>`;
  }
}
window.addEventListener("hashchange", () => { closeDrawer(); render(); window.scrollTo(0, 0); });

// ---------- Today ----------

async function viewToday() {
  const s = await refreshSummary();
  const c = s.counts;
  const notes = await api("/api/notifications");
  const hasAgency = s.settings.our_agencies.length > 0;
  const setup = [
    [hasAgency, `Add your agency's name in <a href="#/settings">Settings</a> so your own listings are left out.`],
    [state.agents.length > 0, `Add your associate agents in <a href="#/settings">Settings</a>.`],
    [c.contacts > 0, `Import <b>our database</b> (owners and their phone numbers) in <a href="#/import">Import data</a>.`],
    [c.listings > 0, `Import <b>everything currently for sale</b> in <a href="#/import">Import data</a>.`],
  ];
  const setupDone = setup.every(([d]) => d);
  $("#view").innerHTML = `
    <h1>Today, ${esc(fmtDate(s.today))}</h1>
    <p class="lede">Properties listed with other agencies for ${threshold()} days or more, matched to owners in our database.</p>
    ${setupDone ? "" : `<div class="card" style="margin-bottom:18px"><h2>Getting set up</h2><ol class="steps">${setup.map(([d, t]) => `<li class="${d ? "done" : ""}"><span>${t}</span></li>`).join("")}</ol></div>`}
    <div class="stats">
      <a class="stat go" href="#/ready"><div class="num">${c.ready_to_assign}</div><div class="lbl">Ready to assign</div><div class="sub">${c.just_hit ? `<b>${c.just_hit} just hit ${threshold()} days.</b> ` : ""}Owner known, nobody calling yet</div></a>
      <a class="stat ${c.follow_ups_due ? "hot" : ""}" href="#/tracker/due"><div class="num">${c.follow_ups_due}</div><div class="lbl">Follow-ups due</div><div class="sub">Call-backs and appraisals for today or overdue</div></a>
      <a class="stat ${c.stop_calling ? "hot" : ""}" href="#/tracker/stop" ${c.stop_calling ? "" : "hidden"}><div class="num">${c.stop_calling}</div><div class="lbl">Stop calling</div><div class="sub">Sold or withdrawn while being worked</div></a>
      <a class="stat soon" href="#/watch"><div class="num">${c.hitting_soon}</div><div class="lbl">Hitting ${threshold()} days soon</div><div class="sub">In the next ${s.settings.soon_days} days (${c.watching} on the watchlist)</div></a>
      <a class="stat" href="#/ready/check"><div class="num">${c.needs_check}</div><div class="lbl">Owner match to check</div><div class="sub">Address looks close but not exact</div></a>
      <a class="stat" href="#/tracker"><div class="num">${c.in_progress}</div><div class="lbl">Being worked</div><div class="sub">Assigned and not finished</div></a>
      <a class="stat" href="#/tracker/won"><div class="num">${c.won}</div><div class="lbl">Listed with us</div><div class="sub">Switched to our agency</div></a>
    </div>
    <div class="grid cols-2">
      <div class="card"><div class="row"><h2>Notifications</h2><span class="spacer"></span>${notes.some((n) => !n.read_at) ? `<button class="btn small ghost" id="read-all">Mark all as read</button>` : ""}</div>
        ${notes.length ? `<ul class="notes">${notes.slice(0, 8).map(noteItem).join("")}</ul>` : `<p class="muted">Nothing yet. You'll be told here the day a watchlist property hits ${threshold()} days.</p>`}</div>
      <div class="card"><h2>Data</h2>
        <dl class="kv">
          <dt>For sale</dt><dd>${c.listings ? `${c.listings} properties, ${c.ours} with us` : "Not imported yet"}<div class="sub">${s.last_import.listings ? `Imported ${esc(fmtWhen(s.last_import.listings.imported_at))}` : ""}</div></dd>
          <dt>Our database</dt><dd>${c.contacts ? `${c.contacts} contacts` : "Not imported yet"}<div class="sub">${s.last_import.contacts ? `Imported ${esc(fmtWhen(s.last_import.contacts.imported_at))}` : ""}</div></dd>
          <dt>Not in our database</dt><dd>${c.no_owner} propert${c.no_owner === 1 ? "y" : "ies"} over ${threshold()} days <a href="#/ready/none">see list</a></dd>
        </dl>
        <p class="sub" style="margin-top:12px">Import a fresh for-sale export every few days. Anything missing from it is marked sold or withdrawn and taken off contact sheets.</p>
        <a class="btn ghost small" href="#/import">Import data</a></div>
    </div>`;
  $("#read-all")?.addEventListener("click", async () => { await api("/api/notifications/read", { json: {} }); viewToday(); });
  $("#view").querySelectorAll("[data-lead]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); openLead(+a.dataset.lead); }));
}

// ---------- shared row bits ----------

function ownerCell(l) {
  const usable = l.contacts.filter((c) => c.quality === "exact" || c.quality === "confirmed");
  if (!l.contacts.length) return `<span class="pill none">Not in our database</span>`;
  if (!usable.length) return `<span class="pill check">Check owner match</span><div class="sub">${esc(l.contacts.map((c) => c.name).join(", "))}</div>`;
  return usable.map((c) => `<div><b>${esc(c.name)}</b>${c.do_not_contact ? ` <span class="pill dnc">Do not contact</span>` : ""}</div>
    <div class="phone">${esc(c.phone || c.phone2 || "")}</div>${!c.phone && !c.phone2 ? `<div class="sub">${c.email ? esc(c.email) : "No phone on file"}</div>` : ""}`).join("");
}

function propertyCell(l) {
  const bits = [l.property_type, l.bedrooms ? `${l.bedrooms} bed` : "", l.price].filter(Boolean).map(esc).join(" &middot; ");
  return `<div class="addr">${esc(l.address)}</div>${bits ? `<div class="sub">${bits}</div>` : ""}`;
}

function filterText(list, q) {
  if (!q) return list;
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter((l) => {
    const hay = [l.address, l.address_raw, l.agency, l.listing_agent, l.agent_name, ...l.contacts.flatMap((c) => [c.name, c.phone, c.phone2, c.email])].join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

function bindRowClicks(root) {
  root.querySelectorAll("tr[data-id]").forEach((tr) => tr.addEventListener("click", (e) => {
    if (e.target.closest("input, a, button, label")) return;
    openLead(+tr.dataset.id);
  }));
}

// ---------- Ready to assign ----------

async function viewReady(arg) {
  const st = state.ready;
  if (arg) st.filter = arg;
  await refreshSummary();
  const all = await api("/api/leads?view=ready");
  const groups = {
    ready: { label: "Ready to assign", test: (l) => !l.blockers.length },
    check: { label: "Owner match to check", test: (l) => l.match === "check" && !l.do_not_contact },
    none: { label: "Not in our database", test: (l) => l.match === "none" },
    dnc: { label: "Do not contact", test: (l) => l.do_not_contact },
  };
  const counts = Object.fromEntries(Object.entries(groups).map(([k, g]) => [k, all.filter(g.test).length]));
  const suburbs = [...new Set(all.map((l) => l.suburb).filter(Boolean))].sort();
  let list = all.filter(groups[st.filter]?.test || groups.ready.test);
  if (st.suburb) list = list.filter((l) => l.suburb === st.suburb);
  list = filterText(list, st.q);
  // Drop selections that are no longer on screen or no longer allowed.
  const allowed = new Set(all.filter((l) => !l.blockers.length).map((l) => l.id));
  st.selected = new Set([...st.selected].filter((id) => allowed.has(id)));

  const help = {
    ready: `Listed ${threshold()}+ days with another agency, still for sale, and the owner is in our database. Tick the ones to hand out, choose the agent, then make the contact sheet. Each property can only be on one agent's sheet at a time.`,
    check: "The address in our database is close to the listing but not identical (for example the suburb is missing). Open each one and confirm whether it's the same owner. Confirmed ones move to Ready.",
    none: "These have been on the market long enough but the owner isn't in our database, so there's nobody to call. Door-knock or letterbox if worth it.",
    dnc: "The owner is flagged do-not-contact in our database or asked us not to call. These never go on a contact sheet.",
  }[st.filter];

  $("#view").innerHTML = `
    <h1>Ready to assign</h1>
    <p class="lede">${help}</p>
    <div class="chips">${Object.entries(groups).map(([k, g]) => `<button class="chip" data-filter="${k}" aria-pressed="${st.filter === k}">${g.label}<span class="n">${counts[k]}</span></button>`).join("")}</div>
    <div class="toolbar">
      <input class="search" type="search" placeholder="Search address, owner, phone or agency" value="${esc(st.q)}" id="q">
      <select class="input" id="suburb" style="width:auto"><option value="">All suburbs</option>${suburbs.map((s) => `<option ${s === st.suburb ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>
      <span class="spacer"></span>
      <a class="btn ghost small" href="/export/leads.csv?view=ready">Download list</a>
    </div>
    <div class="table-wrap">${list.length ? `
      <table class="list"><thead><tr>
        ${st.filter === "ready" ? `<th class="check"><input type="checkbox" id="all" aria-label="Select all shown"></th>` : ""}
        <th>Days listed</th><th>Property</th><th>Owner</th><th>Current agency</th>${st.filter === "ready" ? "" : "<th>Why it can't go on a sheet</th>"}
      </tr></thead><tbody>
      ${list.map((l) => `<tr data-id="${l.id}" class="${st.selected.has(l.id) ? "selected" : ""} ${l.blockers.length ? "blocked" : ""}">
        ${st.filter === "ready" ? `<td class="check"><input type="checkbox" data-pick="${l.id}" ${st.selected.has(l.id) ? "checked" : ""} aria-label="Select ${esc(l.address)}"></td>` : ""}
        <td><div class="days">${l.days}<small>since ${esc(fmtDate(l.listed_date, false))}</small></div>${l.just_hit ? `<span class="pill hit">Just hit ${threshold()}</span>` : ""}</td>
        <td>${propertyCell(l)}</td>
        <td>${ownerCell(l)}</td>
        <td>${esc(l.agency)}<div class="sub">${esc(l.listing_agent || "")}</div></td>
        ${st.filter === "ready" ? "" : `<td><ul class="reasons">${l.blockers.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>${l.match === "check" ? `<button class="btn small" data-open="${l.id}">Check match</button>` : ""}</td>`}
      </tr>`).join("")}
      </tbody></table>` : `<div class="empty"><b>${st.filter === "ready" ? "Nothing waiting" : "None"}</b>${st.filter === "ready" ? `Everything over ${threshold()} days is already assigned, or nothing has reached ${threshold()} days. The watchlist shows what's coming.` : ""}</div>`}
    </div>`;

  $("#view").querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => { location.hash = `#/ready/${b.dataset.filter}`; }));
  $("#q").addEventListener("input", debounce((e) => { st.q = e.target.value; viewReady().then(() => { const q = $("#q"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }); }, 250));
  $("#suburb").addEventListener("change", (e) => { st.suburb = e.target.value; viewReady(); });
  $("#view").querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openLead(+b.dataset.open)));
  $("#view").querySelectorAll("[data-pick]").forEach((cb) => cb.addEventListener("change", () => {
    const id = +cb.dataset.pick;
    cb.checked ? st.selected.add(id) : st.selected.delete(id);
    cb.closest("tr").classList.toggle("selected", cb.checked);
    renderActionBar(list);
  }));
  const allBox = $("#all");
  if (allBox) {
    allBox.checked = list.length > 0 && list.every((l) => st.selected.has(l.id));
    allBox.addEventListener("change", () => {
      list.forEach((l) => (allBox.checked ? st.selected.add(l.id) : st.selected.delete(l.id)));
      viewReady();
    });
  }
  bindRowClicks($("#view"));
  renderActionBar(list);
}

function renderActionBar(list) {
  $("#actionbar")?.remove();
  const st = state.ready;
  if (!st.selected.size) return;
  const agents = state.agents.filter((a) => a.active);
  const bar = document.createElement("div");
  bar.className = "actionbar";
  bar.id = "actionbar";
  bar.innerHTML = `<div class="inner">
    <b>${plural(st.selected.size, "property", "properties")} selected</b>
    <button class="linkish" id="clear-sel" style="color:inherit">Clear</button>
    <span class="spacer"></span>
    ${agents.length ? `<label class="row" style="gap:8px">Give to
      <select id="sheet-agent"><option value="">Choose an agent</option>${agents.map((a) => `<option value="${a.id}" ${String(a.id) === String(st.agent) ? "selected" : ""}>${esc(a.name)}</option>`).join("")}</select></label>
      <button class="btn big" id="make-sheet">Make contact sheet</button>`
      : `<span>Add your agents in <a href="#/settings" style="color:inherit">Settings</a> first.</span>`}
  </div>`;
  document.body.appendChild(bar);
  $("#clear-sel").addEventListener("click", () => { st.selected.clear(); viewReady(); });
  $("#sheet-agent")?.addEventListener("change", (e) => (st.agent = e.target.value));
  $("#make-sheet")?.addEventListener("click", makeSheet);
}

async function makeSheet() {
  const st = state.ready;
  const agent = state.agents.find((a) => String(a.id) === String(st.agent));
  if (!agent) { toast("Choose which agent the sheet is for.", true); $("#sheet-agent").focus(); return; }
  const all = await api("/api/leads?view=ready");
  const picked = all.filter((l) => st.selected.has(l.id));
  const ok = await confirmBox({
    title: `Make a contact sheet for ${agent.name}?`,
    body: `<p>${plural(picked.length, "property", "properties")} will be assigned to <b>${esc(agent.name)}</b>. Nobody else can be given ${picked.length === 1 ? "it" : "them"} until ${picked.length === 1 ? "it's" : "they're"} returned to the pool.</p>
      <ul class="small">${picked.slice(0, 12).map((l) => `<li>${esc(l.address)} (${l.days} days)</li>`).join("")}${picked.length > 12 ? `<li>and ${picked.length - 12} more</li>` : ""}</ul>`,
    ok: `Assign to ${agent.name}`,
  });
  if (!ok) return;
  const r = await act(() => api("/api/sheets", { json: { agent_id: agent.id, lead_ids: picked.map((l) => l.id) } }));
  if (!r) return;
  st.selected.clear();
  toast(`Contact sheet #${r.sheet_id} made for ${agent.name}.`);
  location.hash = `#/sheets/${r.sheet_id}`;
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---------- Watchlist ----------

async function viewWatch(arg) {
  const st = state.watch;
  if (arg) st.filter = arg;
  const s = await refreshSummary();
  const all = await api("/api/leads?view=watch");
  const owned = (l) => l.contacts.length > 0;
  let list = st.filter === "owner" ? all.filter(owned) : all;
  list = filterText(list, st.q);
  const soon = s.settings.soon_days;
  const bands = [
    ["This week", (l) => l.days_to_go <= 7],
    [`In 8 to ${soon} days`, (l) => l.days_to_go > 7 && l.days_to_go <= soon],
    ["Later", (l) => l.days_to_go > soon],
  ];
  const T = threshold();
  $("#view").innerHTML = `
    <h1>Watchlist</h1>
    <p class="lede">Listed with other agencies for under ${T} days. Each one moves to <a href="#/ready">Ready to assign</a> on the day it hits ${T}, and you get a notification. Nothing here needs calling yet.</p>
    <div class="chips">
      <button class="chip" data-filter="owner" aria-pressed="${st.filter === "owner"}">Owner in our database<span class="n">${all.filter(owned).length}</span></button>
      <button class="chip" data-filter="all" aria-pressed="${st.filter === "all"}">Everything for sale<span class="n">${all.length}</span></button>
    </div>
    <div class="toolbar"><input class="search" type="search" placeholder="Search address, owner or agency" value="${esc(st.q)}" id="q">
      <span class="spacer"></span><a class="btn ghost small" href="/export/leads.csv?view=watch">Download list</a></div>
    ${list.length ? bands.map(([label, test]) => {
      const rows = list.filter(test);
      if (!rows.length) return "";
      return `<h2 style="margin-top:18px">${label} <span class="muted">(${rows.length})</span></h2>
      <div class="table-wrap"><table class="list"><thead><tr><th>Hits ${T} days</th><th>Progress</th><th>Property</th><th>Owner</th><th>Current agency</th></tr></thead><tbody>
      ${rows.map((l) => `<tr data-id="${l.id}">
        <td class="nowrap"><b>${esc(fmtDate(l.hits_on))}</b><div class="sub">${esc(relDays(l.hits_on))}</div></td>
        <td><div class="bar ${l.days_to_go <= 7 ? "near" : ""}"><span style="width:${Math.min(100, (l.days / T) * 100)}%"></span></div><div class="sub">${l.days} of ${T} days</div></td>
        <td>${propertyCell(l)}</td><td>${ownerCell(l)}</td>
        <td>${esc(l.agency)}<div class="sub">${esc(l.listing_agent || "")}</div></td></tr>`).join("")}
      </tbody></table></div>`;
    }).join("") : `<div class="table-wrap"><div class="empty"><b>Nothing on the watchlist</b>Import the for-sale data to fill it.</div></div>`}`;
  $("#view").querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => { location.hash = `#/watch/${b.dataset.filter}`; }));
  $("#q").addEventListener("input", debounce((e) => { st.q = e.target.value; viewWatch().then(() => { const q = $("#q"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }); }, 250));
  bindRowClicks($("#view"));
}

// ---------- Tracker ----------

async function viewTracker(arg) {
  const st = state.tracker;
  if (arg) st.filter = arg;
  await refreshSummary();
  const all = await api("/api/leads?view=tracker");
  const open = ["assigned", "no_answer", "left_message", "call_back", "appraisal"];
  const filters = {
    open: ["Being worked", (l) => open.includes(l.status)],
    due: ["Follow-ups due", (l) => l.follow_up_due],
    stop: ["Stop calling", (l) => open.includes(l.status) && !l.for_sale],
    assigned: ["Not called yet", (l) => l.status === "assigned"],
    trying: ["No answer / message left", (l) => l.status === "no_answer" || l.status === "left_message"],
    call_back: ["Call back", (l) => l.status === "call_back"],
    appraisal: ["Appraisal booked", (l) => l.status === "appraisal"],
    won: ["Listed with us", (l) => l.status === "won"],
    closed: ["Closed", (l) => ["not_interested", "wrong_number", "dnc"].includes(l.status)],
    all: ["Everything", () => true],
  };
  const agentNames = [...new Set(all.map((l) => l.agent_name).filter(Boolean))].sort();
  let base = st.agent ? all.filter((l) => l.agent_name === st.agent) : all;
  let list = filterText(base.filter((filters[st.filter] || filters.open)[1]), st.q);
  $("#view").innerHTML = `
    <h1>Tracker</h1>
    <p class="lede">Every property that has been handed to an agent, and where it's up to. Click a row to log a call.</p>
    <div class="chips">${Object.entries(filters).map(([k, [label, test]]) => {
      const n = base.filter(test).length;
      if ((k === "stop" || k === "due") && !n) return "";
      return `<button class="chip" data-filter="${k}" aria-pressed="${st.filter === k}">${label}<span class="n">${n}</span></button>`;
    }).join("")}</div>
    <div class="toolbar">
      <input class="search" type="search" placeholder="Search address, owner, phone or agent" value="${esc(st.q)}" id="q">
      <select class="input" id="agent-filter" style="width:auto"><option value="">All agents</option>${agentNames.map((n) => `<option ${n === st.agent ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>
      ${state.person && agentNames.includes(state.person) && st.agent !== state.person ? `<button class="btn ghost small" id="mine">Only mine</button>` : ""}
      <span class="spacer"></span><a class="btn ghost small" href="/export/leads.csv?view=tracker">Download list</a>
    </div>
    <div class="table-wrap">${list.length ? `<table class="list"><thead><tr><th>Status</th><th>Property</th><th>Owner</th><th>Agent</th><th>Next step</th><th>Calls</th></tr></thead><tbody>
      ${list.map((l) => {
        const stop = open.includes(l.status) && !l.for_sale;
        return `<tr data-id="${l.id}" class="${stop ? "alert" : ""}">
        <td>${stop ? `<span class="pill stop">STOP: no longer for sale</span><br>` : ""}<span class="pill ${l.status}">${esc(l.status_label)}</span></td>
        <td>${propertyCell(l)}<div class="sub">${l.days} days listed &middot; ${esc(l.agency)}</div></td>
        <td>${ownerCell(l)}</td>
        <td>${esc(l.agent_name || "")}${l.sheet_id ? `<div class="sub">Sheet #${l.sheet_id}</div>` : ""}</td>
        <td class="nowrap">${l.follow_up_on ? `<span class="pill ${l.follow_up_due ? "due" : "call_back"}">${esc(fmtDate(l.follow_up_on))}</span><div class="sub">${esc(relDays(l.follow_up_on))}</div>` : l.status === "assigned" ? `<span class="sub">First call</span>` : ""}</td>
        <td class="mono">${l.attempts}${l.last_contact_on ? `<div class="sub">last ${esc(relDays(l.last_contact_on))}</div>` : ""}</td></tr>`;
      }).join("")}</tbody></table>` : `<div class="empty"><b>Nothing here</b>${all.length ? "Try another filter." : "Make a contact sheet from Ready to assign to start."}</div>`}</div>`;
  $("#view").querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => { location.hash = `#/tracker/${b.dataset.filter}`; }));
  $("#q").addEventListener("input", debounce((e) => { st.q = e.target.value; viewTracker().then(() => { const q = $("#q"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }); }, 250));
  $("#agent-filter").addEventListener("change", (e) => { st.agent = e.target.value; viewTracker(); });
  $("#mine")?.addEventListener("click", () => { st.agent = state.person; viewTracker(); });
  bindRowClicks($("#view"));
}

// ---------- Lead drawer ----------

async function openLead(id) {
  let l;
  try { l = await api(`/api/leads/${id}`); } catch (e) { toast(e.message, true); return; }
  const meta = state.meta;
  const T = threshold();
  const open = ["assigned", "no_answer", "left_message", "call_back", "appraisal"].includes(l.status);
  const usable = l.contacts.filter((c) => c.quality === "exact" || c.quality === "confirmed");
  const alerts = [];
  if (!l.for_sale) alerts.push(`<div class="alertbox danger">No longer for sale (gone from the import on ${esc(fmtDate(l.off_market_on))}). Sold or withdrawn. ${open ? "Do not call." : ""}</div>`);
  if (l.do_not_contact) alerts.push(`<div class="alertbox danger">Do not contact this owner.</div>`);
  if (l.ours) alerts.push(`<div class="alertbox info">This is our own listing.</div>`);
  if (l.match === "check") alerts.push(`<div class="alertbox warn">The owner match needs checking before anyone calls. See "Who owns it" below.</div>`);
  if (l.match === "none") alerts.push(`<div class="alertbox warn">The owner isn't in our database.</div>`);
  if (!l.eligible && l.for_sale) alerts.push(`<div class="alertbox info">On the watchlist. Hits ${T} days on ${esc(fmtDate(l.hits_on))} (${esc(relDays(l.hits_on))}).</div>`);
  if (l.follow_up_due) alerts.push(`<div class="alertbox warn">${esc(l.status_label)} was due ${esc(fmtDate(l.follow_up_on))}.</div>`);

  const canLog = l.status !== "new";
  const lastUndoable = l.activity.find((a) => a.kind === "outcome" || a.kind === "note");
  const undoOk = lastUndoable && l.activity[0] && l.activity[0].id === lastUndoable.id;

  $("#drawer-panel").innerHTML = `
    <div class="drawer-head">
      <div><div class="row" style="gap:6px"><span class="pill ${l.do_not_contact ? "dnc" : l.status}">${esc(l.status_label)}</span>${l.agent_name ? `<span class="sub">${esc(l.agent_name)}${l.sheet_id ? `, sheet #${l.sheet_id}` : ""}</span>` : ""}</div>
      <h2>${esc(l.address)}</h2><div class="sub">Lead #${l.id}</div></div>
      <div style="text-align:right"><div class="days">${l.days}<small>days listed</small></div></div>
      <button class="close" data-close aria-label="Close">&times;</button>
    </div>
    <div class="drawer-body">
      ${alerts.join("")}
      <section class="card"><h3>Who owns it</h3>
        ${usable.length ? usable.map((c) => `<div class="contact">
          <div class="name">${esc(c.name)} ${c.do_not_contact ? `<span class="pill dnc">Do not contact</span>` : ""} ${c.quality === "confirmed" ? `<span class="pill appraisal">Match confirmed</span>` : ""}</div>
          ${c.phone ? `<a class="phone" href="${telHref(c.phone)}">${esc(c.phone)}</a>${c.extra?.phone_labels?.[0] ? ` <span class="sub">${esc(c.extra.phone_labels[0])}</span>` : ""}` : `<div class="sub">No phone on file</div>`}
          ${c.phone2 ? `<div><a class="phone" style="font-size:16px" href="${telHref(c.phone2)}">${esc(c.phone2)}</a> <span class="sub">${esc(c.extra?.phone_labels?.[1] || "other")}</span></div>` : ""}
          ${c.email ? `<div><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></div>` : ""}
          ${(c.extra?.phone_notes || []).map((t) => `<div class="alertbox ${/deceas|passed away|died|do\s*not|dnc|wrong number|disconnected/i.test(t) ? "danger" : "warn"}" style="margin-top:6px">CRM phone field says: ${esc(t)}</div>`).join("")}
          ${c.extra?.tags || c.extra?.source ? `<div class="sub">How we know them: ${esc([c.extra.tags, c.extra.source ? "source: " + c.extra.source : ""].filter(Boolean).join(" · "))}</div>` : ""}
          ${c.extra?.last_note ? `<div class="sub" style="margin-top:4px">Last note (${esc([String(c.extra.last_note_at || "").slice(0, 10), c.extra.last_note_by].filter(Boolean).join(", "))}): <i>"${esc(c.extra.last_note)}"</i></div>` : ""}
          <div class="sub">In our database as: ${esc(c.address_raw)}</div>
          ${c.notes ? `<div class="sub">Notes: ${esc(c.notes)}</div>` : ""}
        </div>`).join("") : `<p class="muted">No confirmed owner.</p>`}
        ${l.candidates.filter((c) => c.quality === "check" || c.decision).length ? `
          <h3 style="margin-top:14px">Possible owners to check</h3>
          <p class="sub">Compare the two addresses. Only confirm if they are the same property. A missing suburb or a different street type (Street or Road) is why these weren't matched automatically.</p>
          ${l.candidates.filter((c) => c.quality === "check" || c.decision).map((c) => `<div class="contact">
            <div class="name">${esc(c.name)}</div>
            <dl class="kv" style="margin:6px 0"><dt>For sale</dt><dd>${esc(l.address)}</dd><dt>Our database</dt><dd>${esc(c.address)}<div class="sub">Written as: ${esc(c.address_raw)}</div></dd></dl>
            <div class="row" style="margin-top:8px">
              ${c.decision === "confirm" ? `<span class="pill appraisal">Confirmed</span><button class="btn small ghost" data-match="clear" data-contact="${c.id}">Undo</button>`
                : c.decision === "reject" ? `<span class="pill none">Marked not the owner</span><button class="btn small ghost" data-match="clear" data-contact="${c.id}">Undo</button>`
                : `<button class="btn small" data-match="confirm" data-contact="${c.id}">Same property, confirm</button><button class="btn small ghost" data-match="reject" data-contact="${c.id}">Not the same</button>`}
            </div></div>`).join("")}` : ""}
      </section>

      ${canLog ? `<section class="card" id="log"><h3>Log a contact</h3>
        ${!l.for_sale || l.do_not_contact ? `<p class="badline">Don't call. You can still add a note.</p>` : ""}
        <div class="field"><span>How</span><div class="seg" id="method">${Object.entries(meta.methods).map(([k, v], i) => `<button type="button" data-v="${k}" aria-pressed="${i === 0}">${esc(v)}</button>`).join("")}</div></div>
        <div class="field" style="margin-top:12px"><span>What happened</span><div class="outcomes" id="outcome">${Object.entries(meta.outcomes).map(([k, v]) => `<button type="button" class="outcome" data-v="${k}" aria-pressed="false">${esc(v.label)}</button>`).join("")}</div></div>
        <div class="field" id="date-field" hidden style="margin-top:12px"><span id="date-label">Date</span>
          <div class="row"><input type="date" class="input" id="fdate" style="width:auto" min="${esc(state.summary.today)}">
          <div class="seg">${[["Tomorrow", 1], ["In 3 days", 3], ["Next week", 7], ["In 2 weeks", 14]].map(([t, n]) => `<button type="button" data-days="${n}">${t}</button>`).join("")}</div></div>
          <div class="hint" id="date-read"></div></div>
        <label class="field" style="margin-top:12px"><span>Notes</span><textarea class="input" id="note" placeholder="What did they say? Who is their agent contract with, when does it end, price expectations..."></textarea></label>
        <div class="row" style="margin-top:12px"><button class="btn big" id="save-log" disabled>Choose what happened</button>
          <span class="sub">Saved as ${state.person ? `<b>${esc(state.person)}</b>` : `<b class="badline">nobody: choose your name at the top</b>`}</span></div>
      </section>` : l.for_sale && l.eligible && !l.blockers.length ? `<div class="alertbox info">Not on anyone's contact sheet yet. Assign it from <a href="#/ready" data-close>Ready to assign</a> before calling, so two agents don't ring the same owner.</div>` : ""}

      <section class="card"><h3>Listing</h3><dl class="kv">
        <dt>Agency</dt><dd>${esc(l.agency)}${l.listing_agent ? `, ${esc(l.listing_agent)}` : ""}</dd>
        <dt>Date listed</dt><dd>${esc(fmtDate(l.listed_date))} (${l.days} days)</dd>
        <dt>Hit ${T} days</dt><dd>${esc(fmtDate(l.hits_on))}</dd>
        ${l.price ? `<dt>Price</dt><dd>${esc(l.price)}</dd>` : ""}
        ${l.property_type || l.bedrooms ? `<dt>Property</dt><dd>${esc([l.bedrooms && l.bedrooms !== "-" ? l.bedrooms + " bed" : "", l.extra?.bathrooms ? l.extra.bathrooms + " bath" : "", l.extra?.car_spaces ? l.extra.car_spaces + " car" : "", l.property_type, l.extra?.land_size ? l.extra.land_size + "m²" : ""].filter(Boolean).join(" · "))}</dd>` : ""}
        ${l.extra?.listing_type ? `<dt>Sale method</dt><dd>${esc(l.extra.listing_type)}</dd>` : ""}
        ${l.extra?.owner_type ? `<dt>Owner type</dt><dd>${esc(l.extra.owner_type)}</dd>` : ""}
        ${l.extra?.first_price && l.extra.first_price !== l.price ? `<dt>First listed at</dt><dd>${esc(l.extra.first_price)}</dd>` : ""}
        ${l.url ? `<dt>Listing</dt><dd><a href="${esc(l.url)}" target="_blank" rel="noopener">Open listing</a></dd>` : ""}
        <dt>As imported</dt><dd>${esc(l.address_raw)}</dd>
      </dl></section>

      <section class="card"><div class="row"><h3>History</h3><span class="spacer"></span>${undoOk ? `<button class="btn small ghost" id="undo">Undo last entry</button>` : ""}</div>
        ${l.activity.length ? `<ul class="timeline">${l.activity.map((a) => `<li class="${a.kind === "outcome" ? "outcome-row" : ""}">
          <div><b>${esc(a.kind === "outcome" ? meta.outcomes[a.outcome]?.label || a.outcome : { note: "Note", assign: "Assigned", release: "Returned to pool", match: "Owner match", undo: "Undo" }[a.kind] || a.kind)}</b>
          ${a.method && a.kind === "outcome" ? `<span class="sub"> by ${esc(meta.methods[a.method] || a.method).toLowerCase()}</span>` : ""}
          ${a.follow_up_on ? ` <span class="pill call_back">${esc(fmtDate(a.follow_up_on))}</span>` : ""}</div>
          ${a.note ? `<div>${esc(a.note)}</div>` : ""}<div class="when">${esc(fmtWhen(a.at))} &middot; ${esc(a.by || "")}</div></li>`).join("")}</ul>` : `<p class="muted">Nothing yet.</p>`}
      </section>

      ${l.status !== "new" ? `<section class="card"><h3>Hand over</h3>
        <div class="row"><select class="input" id="re-agent" style="width:auto"><option value="">Move to another agent</option>${state.agents.filter((a) => a.active && a.id !== l.agent_id).map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select>
        <button class="btn small ghost" id="re-go">Move</button>
        <span class="spacer"></span>${l.do_not_contact ? "" : `<button class="btn small ghost" id="release">Return to pool</button>`}</div>
        <p class="sub">Return to pool takes it off ${esc(l.agent_name || "the agent")} and puts it back in Ready to assign. The history stays.</p></section>` : ""}
    </div>`;
  openDrawer();
  bindLead(l);
}

function bindLead(l) {
  const panel = $("#drawer-panel");
  const reopen = () => { openLead(l.id); refreshSummary(); rerenderBehind(); };
  panel.querySelectorAll("[data-match]").forEach((b) => b.addEventListener("click", async () => {
    const decision = b.dataset.match;
    if (await act(() => api(`/api/leads/${l.id}/match`, { json: { contact_id: +b.dataset.contact, decision } }),
      { confirm: "Owner confirmed.", reject: "Marked as not the owner.", clear: "Decision cleared." }[decision])) reopen();
  }));

  const log = $("#log");
  if (log) {
    let method = "call", outcome = null;
    const save = $("#save-log"), dateField = $("#date-field"), fdate = $("#fdate"), dateRead = $("#date-read");
    const refresh = () => {
      const spec = outcome && state.meta.outcomes[outcome];
      dateField.hidden = !(spec && spec.needs_date);
      $("#date-label").textContent = outcome === "appraisal" ? "Appraisal date (required)" : "Call back on (required)";
      dateRead.textContent = fdate.value ? `${fmtDate(fdate.value)}, ${relDays(fdate.value)}` : "";
      const needsDate = spec && spec.needs_date && !fdate.value;
      const needsNote = outcome === "note" && !$("#note").value.trim();
      save.disabled = !outcome || needsDate || needsNote;
      save.textContent = !outcome ? "Choose what happened" : needsDate ? "Choose the date" : needsNote ? "Type the note" : `Save: ${spec.label}`;
    };
    $("#method").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      method = b.dataset.v;
      $("#method").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    }));
    $("#outcome").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      outcome = b.dataset.v;
      $("#outcome").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
      refresh();
    }));
    dateField.querySelectorAll("[data-days]").forEach((b) => b.addEventListener("click", () => { fdate.value = addDays(state.summary.today, +b.dataset.days); refresh(); }));
    fdate.addEventListener("input", refresh);
    $("#note").addEventListener("input", refresh);
    save.addEventListener("click", async () => {
      const spec = state.meta.outcomes[outcome];
      if (["dnc", "won", "not_interested"].includes(outcome)) {
        const ok = await confirmBox({ title: `Mark as "${spec.label}"?`, body: outcome === "dnc" ? "<p>This owner won't be put on any contact sheet again.</p>" : "<p>This closes the property in the tracker.</p>", ok: `Yes, ${spec.label.toLowerCase()}`, danger: outcome === "dnc" });
        if (!ok) return;
      }
      if ((!l.for_sale || l.do_not_contact) && outcome !== "note") {
        const ok = await confirmBox({ title: "This owner shouldn't be called", body: `<p>${!l.for_sale ? "The property is no longer for sale." : "The owner is do-not-contact."} Log it anyway?</p>`, ok: "Log it anyway", danger: true });
        if (!ok) return;
      }
      if (await act(() => api(`/api/leads/${l.id}/log`, { json: { outcome, method, note: $("#note").value, follow_up_on: fdate.value || null } }), "Saved.")) reopen();
    });
  }
  $("#undo")?.addEventListener("click", async () => {
    const last = l.activity[0];
    const label = last.kind === "outcome" ? state.meta.outcomes[last.outcome]?.label : "note";
    if (await confirmBox({ title: "Undo the last entry?", body: `<p>Removes <b>${esc(label)}</b> logged by ${esc(last.by)} on ${esc(fmtWhen(last.at))} and puts the status back to what it was.</p>`, ok: "Undo it" }))
      if (await act(() => api(`/api/leads/${l.id}/undo`, { json: {} }), "Undone.")) reopen();
  });
  $("#re-go")?.addEventListener("click", async () => {
    const id = $("#re-agent").value;
    const a = state.agents.find((x) => String(x.id) === id);
    if (!a) { toast("Choose the agent to move it to.", true); return; }
    if (await confirmBox({ title: `Move to ${a.name}?`, body: `<p>${esc(l.agent_name || "The current agent")} should stop working this one.</p>`, ok: `Move to ${a.name}` }))
      if (await act(() => api(`/api/leads/${l.id}/reassign`, { json: { agent_id: a.id } }), `Moved to ${a.name}.`)) reopen();
  });
  $("#release")?.addEventListener("click", async () => {
    if (await confirmBox({ title: "Return to the pool?", body: `<p>${esc(l.agent_name || "The agent")} stops working it and it goes back to Ready to assign. The history is kept.</p>`, ok: "Return to pool" }))
      if (await act(() => api(`/api/leads/${l.id}/release`, { json: {} }), "Returned to the pool.")) reopen();
  });
}

// Refresh the page behind the drawer without closing it.
function rerenderBehind() {
  const sy = window.scrollY;
  const [, name = "today"] = (location.hash || "#/today").split("/");
  const fn = views[name];
  if (fn && name !== "import" && name !== "settings") fn().then(() => window.scrollTo(0, sy));
}

// ---------- Contact sheets ----------

async function viewSheets(arg) {
  if (arg) return viewSheet(+arg);
  await refreshSummary();
  const sheets = await api("/api/sheets");
  $("#view").innerHTML = `
    <h1>Contact sheets</h1>
    <p class="lede">Each sheet is a set of properties given to one agent. Print it or download it, and log every call in the app so the tracker stays right. To make a new one, go to <a href="#/ready">Ready to assign</a>.</p>
    <div class="table-wrap">${sheets.length ? `<table class="list"><thead><tr><th>Sheet</th><th>Agent</th><th>Made</th><th>Progress</th><th></th></tr></thead><tbody>
    ${sheets.map((s) => `<tr data-sheet="${s.id}"><td><b>#${s.id}</b></td><td><b>${esc(s.agent)}</b></td><td>${esc(fmtWhen(s.created_at))}<div class="sub">by ${esc(s.created_by)}</div></td>
      <td><div class="bar" style="max-width:220px"><span style="width:${s.total ? ((s.done + s.working) / s.total) * 100 : 0}%"></span></div>
      <div class="sub">${s.not_called} not called, ${s.working} in progress, ${s.done} finished${s.total - s.not_called - s.working - s.done ? `, ${s.total - s.not_called - s.working - s.done} moved off` : ""}</div></td>
      <td class="nowrap"><a class="btn small ghost" href="/sheet/${s.id}/print" target="_blank">Print</a> <a class="btn small ghost" href="/sheet/${s.id}.csv">Spreadsheet</a></td></tr>`).join("")}
    </tbody></table>` : `<div class="empty"><b>No sheets yet</b>Tick properties in Ready to assign and choose an agent.</div>`}</div>`;
  $("#view").querySelectorAll("tr[data-sheet]").forEach((tr) => tr.addEventListener("click", (e) => { if (!e.target.closest("a")) location.hash = `#/sheets/${tr.dataset.sheet}`; }));
}

async function viewSheet(id) {
  await refreshSummary();
  const s = await api(`/api/sheets/${id}`);
  $("#view").innerHTML = `
    <p><a href="#/sheets">&larr; All contact sheets</a></p>
    <div class="row"><div><h1>Contact sheet #${s.id} for ${esc(s.agent)}</h1>
      <p class="lede">Made ${esc(fmtWhen(s.created_at))} by ${esc(s.created_by)}. ${plural(s.leads.length, "property", "properties")}.</p></div>
      <span class="spacer"></span><a class="btn" href="/sheet/${s.id}/print" target="_blank">Print sheet</a><a class="btn ghost" href="/sheet/${s.id}.csv">Download spreadsheet</a></div>
    <div class="table-wrap"><table class="list"><thead><tr><th>#</th><th>Status</th><th>Property</th><th>Owner</th><th>Days listed</th><th>Next step</th></tr></thead><tbody>
    ${s.leads.map((l, i) => {
      const stop = !l.for_sale || l.do_not_contact || l.moved;
      return `<tr data-id="${l.id}" class="${stop ? "alert" : ""}"><td><b>${i + 1}</b></td>
      <td>${!l.for_sale ? `<span class="pill stop">STOP: no longer for sale</span><br>` : l.moved ? `<span class="pill stop">Moved off this sheet</span><br>` : ""}<span class="pill ${l.status}">${esc(l.status_label)}</span>${l.moved && l.agent_name ? `<div class="sub">Now with ${esc(l.agent_name)}</div>` : ""}</td>
      <td>${propertyCell(l)}<div class="sub">${esc(l.agency)}</div></td><td>${ownerCell(l)}</td><td class="days">${l.days}</td>
      <td class="nowrap">${l.follow_up_on ? `<span class="pill ${l.follow_up_due ? "due" : "call_back"}">${esc(fmtDate(l.follow_up_on))}</span>` : ""}</td></tr>`;
    }).join("")}</tbody></table></div>`;
  bindRowClicks($("#view"));
}

// ---------- Import ----------

const importState = { kind: null, preview: null, mapping: {}, full: true, check: null };

async function viewImport() {
  const s = await refreshSummary();
  const imports = await api("/api/imports");
  const ip = importState;
  const card = (kind, title, what, full) => {
    const last = s.last_import[kind];
    return `<div class="card"><h2>${title}</h2><p class="sub">${what}</p>
      <p class="small">${last ? `Last import: <b>${esc(fmtWhen(last.imported_at))}</b> (${esc(last.filename)})` : `<span class="badline">Not imported yet</span>`}</p>
      <label class="drop" data-drop="${kind}"><input type="file" accept=".csv,.xlsx,.txt,.tsv" hidden data-file="${kind}">
        <b>Choose a file</b> or drop it here<div class="sub">CSV or Excel (.xlsx)</div></label>
      <p class="sub" style="margin-top:8px">${full}</p></div>`;
  };
  $("#view").innerHTML = `
    <h1>Import data</h1>
    <p class="lede">Bring in the two lists. Columns are matched for you and you can change any of them before anything is saved. Nothing is imported until you press the final button.</p>
    <div id="wizard"></div>
    <div class="grid cols-2" id="cards" ${ip.preview ? "hidden" : ""}>
      ${card("contacts", "1. Our database", "Owners and their contact details: name, phone, email and the property address.", "Usually a full export from the CRM, which replaces the previous one. Your match decisions and call history are kept.")}
      ${card("listings", "2. Everything for sale", "Every property currently for sale in your area: address, agency, and the date listed or days on market.", "Import a fresh export every few days. Anything missing from a full export is marked sold or withdrawn.")}
    </div>
    <h2 style="margin-top:26px">Past imports</h2>
    <div class="table-wrap">${imports.length ? `<table class="list"><thead><tr><th>When</th><th>What</th><th>File</th><th>Rows used</th><th>Skipped</th><th>By</th></tr></thead><tbody>
      ${imports.map((i) => `<tr data-imp="${i.id}"><td>${esc(fmtWhen(i.imported_at))}</td><td>${i.kind === "contacts" ? "Our database" : "For sale"}${i.full_snapshot ? "" : " (added to)"}</td><td>${esc(i.filename)}</td><td>${i.rows_used}</td><td>${i.rows_skipped ? `<button class="linkish" data-problems="${i.id}">${i.rows_skipped}, see why</button>` : "0"}</td><td>${esc(i.imported_by)}</td></tr>`).join("")}
    </tbody></table>` : `<div class="empty">No imports yet.</div>`}</div>`;
  $("#view").querySelectorAll("[data-problems]").forEach((b) => b.addEventListener("click", () => {
    const i = imports.find((x) => String(x.id) === b.dataset.problems);
    const probs = JSON.parse(i.problems || "[]");
    showModal(`<h2>Rows skipped in ${esc(i.filename)}</h2><div class="problems"><table class="list" style="min-width:0"><tbody>${probs.map((p) => `<tr><td>Row ${p.row}</td><td>${esc(p.reason)}</td></tr>`).join("")}</tbody></table></div><div class="row end"><button class="btn" data-close>Close</button></div>`);
  }));
  $("#view").querySelectorAll("[data-file]").forEach((inp) => inp.addEventListener("change", () => inp.files[0] && startImport(inp.dataset.file, inp.files[0])));
  $("#view").querySelectorAll("[data-drop]").forEach((zone) => {
    zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("over"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("over"));
    zone.addEventListener("drop", (e) => { e.preventDefault(); zone.classList.remove("over"); const f = e.dataTransfer.files[0]; if (f) startImport(zone.dataset.drop, f); });
  });
  if (ip.preview) renderWizard();
}

async function startImport(kind, file) {
  if (!state.person) return act(async () => {});
  try {
    const buf = await file.arrayBuffer();
    const p = await api(`/api/import/preview?kind=${kind}&filename=${encodeURIComponent(file.name)}`, { body: buf });
    Object.assign(importState, { kind, preview: p, mapping: { ...p.mapping }, full: true, check: null });
    $("#cards").hidden = true;
    renderWizard();
  } catch (e) { toast(e.message, true); }
}

async function renderWizard() {
  const ip = importState, p = ip.preview;
  const isListings = ip.kind === "listings";
  const colOptions = (field) => `<option value="">Not in this file</option>` + p.headers.map((h, i) => `<option value="${i}" ${ip.mapping[field] === i ? "selected" : ""}>${esc(h || `Column ${i + 1}`)}</option>`).join("");
  const examples = (field) => {
    const i = ip.mapping[field];
    if (i === undefined || i === null || i === "") return "";
    return p.sample.slice(0, 3).map((r) => r[i]).filter((v) => v !== undefined && v !== "").map(esc).join(" &middot; ") || "<i>empty in the first rows</i>";
  };
  $("#wizard").innerHTML = `<div class="card">
    <div class="row"><h2>${isListings ? "Everything for sale" : "Our database"}: ${esc(p.filename)}</h2><span class="spacer"></span><button class="btn ghost small" id="cancel-imp">Cancel</button></div>
    <p class="sub">${p.row_count} rows found. <b>Step 1:</b> check each field points at the right column. The grey text shows what's in that column so you can see it's right.</p>
    <div class="mapgrid">
      <div class="hdr">Field</div><div class="hdr">Column in your file</div><div class="hdr">First values</div>
      ${p.fields.map((f) => `<div class="${f.required ? "req" : ""}"><b>${esc(f.label)}</b></div>
        <select class="input ${ip.mapping[f.key] === undefined ? "unset" : ""}" data-map="${f.key}">${colOptions(f.key)}</select>
        <div class="eg">${examples(f.key)}</div>`).join("")}
    </div>
    ${isListings ? `<p class="sub">You need either <b>Date listed</b> or <b>Days on market</b>. If both are there, Date listed is used.</p>` : `<p class="sub">If names are split into first and last name columns, choose those and leave Owner name empty.</p>`}
    <label class="row" style="margin-top:12px"><input type="checkbox" id="full" ${ip.full ? "checked" : ""} style="width:20px;height:20px">
      <span>${isListings ? "<b>This file is everything currently for sale.</b> Properties missing from it are marked sold or withdrawn." : "<b>This file is our whole database.</b> It replaces the contacts imported before."}</span></label>
    <div class="row" style="margin-top:14px"><button class="btn" id="check-imp">Step 2: Check the file</button></div>
    <div id="check-out"></div>
  </div>`;
  $("#cancel-imp").addEventListener("click", () => { importState.preview = null; viewImport(); });
  $("#wizard").querySelectorAll("[data-map]").forEach((sel) => sel.addEventListener("change", () => {
    const v = sel.value === "" ? undefined : +sel.value;
    // A column can only feed one field.
    if (v !== undefined) Object.keys(ip.mapping).forEach((k) => { if (ip.mapping[k] === v) delete ip.mapping[k]; });
    if (v === undefined) delete ip.mapping[sel.dataset.map]; else ip.mapping[sel.dataset.map] = v;
    ip.check = null;
    renderWizard();
  }));
  $("#full").addEventListener("change", (e) => { ip.full = e.target.checked; });
  $("#check-imp").addEventListener("click", checkImport);
  if (ip.check) showCheck();
}

async function checkImport() {
  try {
    importState.check = await api("/api/import/check", { json: { token: importState.preview.token, mapping: importState.mapping } });
    showCheck();
  } catch (e) {
    toast(e.message, true);
    if (e.message.includes("expired")) { importState.preview = null; viewImport(); }
  }
}

function showCheck() {
  const c = importState.check, isListings = importState.kind === "listings";
  const out = $("#check-out");
  if (c.missing.length) {
    out.innerHTML = `<div class="alertbox warn" style="margin-top:14px">Choose a column for: ${c.missing.map(esc).join(", ")}</div>`;
    return;
  }
  const cols = c.examples[0] ? Object.keys(c.examples[0]) : [];
  out.innerHTML = `<div style="margin-top:16px">
    <h3>Step 3: Does this look right?</h3>
    <p><span class="okline">${c.usable} rows can be used.</span> ${c.skipped ? `<span class="badline">${c.skipped} rows will be skipped.</span>` : ""}
    ${isListings ? `${c.over_threshold} have been listed ${threshold()}+ days. ${c.ours} are with our agency and will be left out.` : ""}</p>
    <p class="sub">Read the first few rows below as they will be saved. ${isListings ? "<b>Check the dates are right</b>: if 3 April shows as 4 March, change the date format in Settings first." : ""}</p>
    <div class="table-wrap"><table class="list" style="min-width:0"><thead><tr>${cols.map((k) => `<th>${esc(k)}</th>`).join("")}</tr></thead>
      <tbody>${c.examples.map((e) => `<tr>${cols.map((k) => `<td>${esc(e[k])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    ${c.skipped ? `<details style="margin-top:10px"><summary>Why rows will be skipped</summary><div class="problems"><table class="list" style="min-width:0"><tbody>${c.problems.map((p) => `<tr><td class="nowrap">Row ${p.row}</td><td>${esc(p.reason)}</td></tr>`).join("")}</tbody></table></div></details>` : ""}
    <div class="row" style="margin-top:14px"><button class="btn big" id="commit-imp">Import ${c.usable} rows</button></div></div>`;
  $("#commit-imp").addEventListener("click", commitImport);
}

async function commitImport() {
  const ip = importState;
  if (ip.full && ip.kind === "listings" && state.summary.counts.listings) {
    const ok = await confirmBox({ title: "Replace the for-sale list?", body: `<p>Any property in the current list that isn't in this file will be marked <b>sold or withdrawn</b>, and agents working one will be told to stop calling. Only continue if this file has everything currently for sale.</p>`, ok: "Yes, it's the full list" });
    if (!ok) return;
  }
  if (ip.full && ip.kind === "contacts" && state.summary.counts.contacts) {
    const ok = await confirmBox({ title: "Replace our database?", body: `<p>The ${state.summary.counts.contacts} contacts imported before will be replaced by this file. Match decisions and call history are kept.</p>`, ok: "Replace contacts" });
    if (!ok) return;
  }
  const r = await act(() => api("/api/import/commit", { json: { token: ip.preview.token, mapping: ip.mapping, full_snapshot: ip.full } }));
  if (!r) return;
  importState.preview = null;
  await refreshSummary();
  showModal(`<h2>Imported</h2><p>${r.used} rows saved${r.skipped ? `, ${r.skipped} skipped (see Past imports for why)` : ""}.</p>
    ${r.crossed ? `<p><b>${plural(r.crossed, "property", "properties")} just hit ${threshold()} days.</b></p>` : ""}
    <div class="row end"><button class="btn ghost" data-close>Stay here</button><a class="btn" href="#/ready" data-close>Go to Ready to assign</a></div>`);
  viewImport();
}

// ---------- Insights ----------
// Everything here is worked out from the listings already imported, so it
// changes with every new export. Small groups are left out of rankings.

const MIN_GROUP = 5;
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const pct = (n, d) => (d ? Math.round((100 * n) / d) : 0);

// "$850,000 - $900,000", "Offers over $1.2m", "Guide $995k" -> a number, or null.
function priceNum(text) {
  const t = String(text || "").toLowerCase().replace(/,/g, "");
  const nums = [...t.matchAll(/\$\s*(\d+(?:\.\d+)?)\s*(m|mil|million|k)?/g)].map((m) => {
    let v = parseFloat(m[1]);
    if (m[2] && m[2].startsWith("m")) v *= 1e6; else if (m[2] === "k") v *= 1e3;
    return v;
  }).filter((v) => v >= 50000 && v <= 50e6);
  if (!nums.length) return null;
  // A range whose ends are far apart is almost always a typo ("$1,3000,000").
  if (nums.length > 1 && Math.max(nums[0], nums[1]) / Math.min(nums[0], nums[1]) > 1.6) return null;
  return nums.length > 1 ? (nums[0] + nums[1]) / 2 : nums[0];
}
// Changes bigger than this between first and current price are treated as typos.
const MAX_PRICE_SWING = 0.35;
const typeGroup = (t) => {
  const s = String(t || "").toLowerCase();
  if (s.includes("townhouse") || s.includes("villa")) return "Townhouse / villa";
  if (s.startsWith("unit") || s.includes("apartment") || s.includes("flat")) return "Unit / apartment";
  if (s.startsWith("land") || s.includes("vacant")) return "Land";
  if (s.startsWith("house")) return "House";
  return s ? "Other" : "Not stated";
};
const BANDS = [[0, 29, "Under 30"], [30, 59, "30 to 59"], [60, 69, "60 to 69"], [70, 89, "70 to 89"], [90, 119, "90 to 119"], [120, 179, "120 to 179"], [180, 1e9, "180 or more"]];
const PRICE_BANDS = [[0, 700e3, "Under $700k"], [700e3, 1e6, "$700k to $1m"], [1e6, 1.5e6, "$1m to $1.5m"], [1.5e6, 2e6, "$1.5m to $2m"], [2e6, 1e12, "$2m or more"]];

function groupStats(list, keyFn, T) {
  const g = new Map();
  for (const l of list) { const k = keyFn(l); if (!k) continue; if (!g.has(k)) g.set(k, []); g.get(k).push(l); }
  return [...g.entries()].map(([key, ls]) => ({
    key, n: ls.length, over: ls.filter((l) => l.days >= T).length,
    share: pct(ls.filter((l) => l.days >= T).length, ls.length), median: median(ls.map((l) => l.days)),
    owned: ls.filter((l) => l.days >= T && l.match !== "none").length,
  }));
}

function computeInsights(all, todayIso, T) {
  const market = all.filter((l) => l.for_sale && !l.ours);
  const ours = all.filter((l) => l.for_sale && l.ours);
  const over = market.filter((l) => l.days >= T);
  const out = { T, n: market.length, ours: ours.length };
  out.medianDays = median(market.map((l) => l.days));
  out.over = over.length;
  out.overShare = pct(over.length, market.length);
  out.overOwned = over.filter((l) => l.match !== "none").length;
  out.bands = BANDS.map(([a, b, label]) => ({ label, from: a, n: market.filter((l) => l.days >= a && l.days <= b).length }));
  out.oldest = [...market].sort((a, b) => b.days - a.days).slice(0, 5);

  // Price changes: compare the first listed price with the current one.
  const priced = market.map((l) => ({ l, first: priceNum(l.extra?.first_price), now: priceNum(l.price) }))
    .filter((x) => x.first && x.now && Math.abs(x.now - x.first) / x.first <= MAX_PRICE_SWING);
  const changedText = market.filter((l) => l.extra?.first_price && l.price && l.extra.first_price.trim().toLowerCase() !== l.price.trim().toLowerCase());
  const drops = priced.filter((x) => x.now < x.first * 0.995);
  out.price = {
    withBoth: market.filter((l) => l.extra?.first_price).length, changed: changedText.length,
    comparable: priced.length, drops: drops.length, rises: priced.filter((x) => x.now > x.first * 1.005).length,
    medianDropPct: median(drops.map((x) => Math.round((1000 * (x.first - x.now)) / x.first) / 10)),
    medianDropDollars: median(drops.map((x) => Math.round(x.first - x.now))),
    dropsOver: drops.filter((x) => x.l.days >= T).length,
    medianDaysChanged: median(changedText.map((l) => l.days)),
    medianDaysSame: median(market.filter((l) => l.extra?.first_price && !changedText.includes(l)).map((l) => l.days)),
  };

  out.agencies = groupStats(market, (l) => l.agency, T).filter((g) => g.n >= MIN_GROUP).sort((a, b) => b.over - a.over || b.share - a.share).slice(0, 10);
  const suburbs = groupStats(market, (l) => l.suburb, T).filter((g) => g.n >= MIN_GROUP);
  out.slowSuburbs = [...suburbs].sort((a, b) => b.median - a.median || b.n - a.n).slice(0, 10);
  out.fastSuburbs = [...suburbs].sort((a, b) => a.median - b.median || b.n - a.n).slice(0, 5);
  out.suburbCount = suburbs.length;
  out.methods = groupStats(market, (l) => l.extra?.listing_type || "Not stated", T).filter((g) => g.n >= MIN_GROUP).sort((a, b) => b.n - a.n);
  out.owners = groupStats(market, (l) => l.extra?.owner_type || "Not stated", T).filter((g) => g.n >= MIN_GROUP).sort((a, b) => b.n - a.n);
  out.types = groupStats(market, (l) => typeGroup(l.property_type), T).filter((g) => g.n >= MIN_GROUP).sort((a, b) => b.n - a.n);
  out.prices = PRICE_BANDS.map(([a, b, label]) => {
    const ls = market.filter((l) => { const p = priceNum(l.price); return p && p >= a && p < b; });
    return { key: label, n: ls.length, over: ls.filter((l) => l.days >= T).length, share: pct(ls.filter((l) => l.days >= T).length, ls.length), median: median(ls.map((l) => l.days)) };
  }).filter((g) => g.n);
  out.pricedShare = pct(market.filter((l) => priceNum(l.price)).length, market.length);

  // The next eight weeks: how many reach the threshold each week.
  const weeks = [];
  for (let w = 0; w < 8; w++) {
    const start = addDays(todayIso, 7 * w + 1), end = addDays(todayIso, 7 * w + 7);
    const ls = market.filter((l) => !l.eligible && l.hits_on >= start && l.hits_on <= end);
    weeks.push({ start, end, n: ls.length, owned: ls.filter((l) => l.match !== "none").length });
  }
  out.weeks = weeks;
  out.ourMedian = median(ours.map((l) => l.days));
  out.ourOverShare = pct(ours.filter((l) => l.days >= T).length, ours.length);
  return out;
}

// One horizontal bar per row, scaled to the largest value in the set.
function barRows(rows, { value, label, max, unit = "", tip }) {
  const top = max ?? Math.max(1, ...rows.map(value));
  return rows.map((r) => `<div class="hbar" data-tip="${esc(tip ? tip(r) : "")}">
    <div class="hbar-label">${label(r)}</div>
    <div class="hbar-track"><span style="width:${Math.max(1, (100 * value(r)) / top)}%"></span></div>
    <div class="hbar-val">${esc(value(r))}${unit}</div></div>`).join("");
}

function groupTable(rows, T, firstCol) {
  if (!rows.length) return `<p class="muted">Not enough listings to compare (each group needs ${MIN_GROUP} or more).</p>`;
  const top = Math.max(...rows.map((r) => r.median || 0), 1);
  return `<table class="list ins-table"><thead><tr><th>${esc(firstCol)}</th><th class="ncol">Listings</th><th class="ncol">${T}+ days</th><th>Median days on market</th></tr></thead><tbody>
    ${rows.map((r) => `<tr data-tip="${esc(`${r.key}: ${r.n} listings, ${r.over} at ${T}+ days (${r.share}%), median ${r.median} days`)}">
      <td>${esc(r.key)}</td><td class="ncol">${r.n}</td><td class="ncol">${r.over} <span class="sub">(${r.share}%)</span></td>
      <td><div class="hbar inline"><div class="hbar-track"><span style="width:${Math.max(1, (100 * (r.median || 0)) / top)}%"></span></div><div class="hbar-val">${r.median}</div></div></td></tr>`).join("")}
  </tbody></table>`;
}

async function viewInsights() {
  const s = await refreshSummary();
  const all = await api("/api/leads?view=all");
  const T = threshold();
  if (!all.some((l) => l.for_sale && !l.ours)) {
    $("#view").innerHTML = `<h1>Insights</h1><div class="card empty"><b>No listings yet</b>Import everything for sale and this page fills in.</div>`;
    return;
  }
  const I = computeInsights(all, s.today, T);
  const hasCrm = s.counts.contacts > 0;
  const money = (v) => (v >= 1e6 ? `$${(v / 1e6).toFixed(2)}m` : `$${Math.round(v / 1000)}k`);
  const asOf = s.last_import.listings ? fmtDate(s.last_import.listings.imported_at) : "";
  const p = I.price;
  const bandTop = Math.max(...I.bands.map((b) => b.n), 1);
  const weekTop = Math.max(...I.weeks.map((w) => w.n), 1);
  const owners = I.owners.filter((o) => o.key !== "Not stated");
  const rented = owners.find((o) => /rent/i.test(o.key)), occ = owners.find((o) => /occupied/i.test(o.key));

  $("#view").innerHTML = `
    <h1>Insights</h1>
    <p class="lede">What the for-sale data says right now, across ${I.n} listings with other agencies${asOf ? ` (export of ${esc(asOf)})` : ""}. Your own ${I.ours} listings are left out except where they're compared. Groups with fewer than ${MIN_GROUP} listings aren't ranked.</p>

    <div class="stats">
      <div class="stat static"><div class="num">${I.medianDays}</div><div class="lbl">Median days on market</div><div class="sub">Half of all listings have been up longer than this</div></div>
      <div class="stat static"><div class="num">${I.overShare}%</div><div class="lbl">At ${T}+ days</div><div class="sub">${I.over} of ${I.n} listings</div></div>
      <div class="stat static"><div class="num">${pct(p.changed, p.withBoth)}%</div><div class="lbl">Price changed since listing</div><div class="sub">${p.changed} of ${p.withBoth} with a first price on record</div></div>
      ${hasCrm ? `<div class="stat static"><div class="num">${pct(I.overOwned, I.over)}%</div><div class="lbl">Of ${T}+ owners you can reach</div><div class="sub">${I.overOwned} of ${I.over} are in your CRM</div></div>`
        : `<div class="stat static"><div class="num" style="font-size:26px">Not loaded</div><div class="lbl">Owners you can reach</div><div class="sub">Import your CRM to see how many ${T}+ owners you know</div></div>`}
    </div>

    <div class="grid cols-2">
      <section class="card"><h2>How long listings have been up</h2>
        <p class="sub">Number of listings by days on market. Bars below the line are past ${T} days.</p>
        <div class="hist">${I.bands.map((b, i) => `${b.from === T ? `<div class="hist-line"><span>${T} days</span></div>` : ""}<div class="hbar" data-tip="${esc(`${b.label} days: ${b.n} listings (${pct(b.n, I.n)}%)`)}">
          <div class="hbar-label">${esc(b.label)}</div><div class="hbar-track"><span style="width:${Math.max(1, (100 * b.n) / bandTop)}%"></span></div><div class="hbar-val">${b.n}</div></div>`).join("")}</div>
      </section>

      <section class="card"><h2>Owners reaching ${T} days, next 8 weeks</h2>
        <p class="sub">How many listings cross the line each week, by the week starting on each date.</p>
        ${barRows(I.weeks, { value: (w) => w.n, max: weekTop, label: (w) => `${esc(fmtDate(w.start, false).replace(/ \d{4}$/, ""))}`,
          tip: (w) => `Week from ${fmtDate(w.start)}: ${w.n} reach ${T} days, ${w.owned} owner${w.owned === 1 ? "" : "s"} in your CRM` })}
        <p class="sub" style="margin-top:8px">${hasCrm ? "" : "Import your CRM to see how many of these owners you know. "}Total across these weeks: <b>${I.weeks.reduce((a, w) => a + w.n, 0)}</b>. Some will sell before they get there, so these are the most there could be.</p>
        <p class="sub" ${hasCrm ? "" : "hidden"}>Owners in your CRM across these weeks: <b>${I.weeks.reduce((a, w) => a + w.owned, 0)}</b> of ${I.weeks.reduce((a, w) => a + w.n, 0)}.</p>
      </section>
    </div>

    <section class="card" style="margin-top:16px"><h2>Price changes</h2>
      <div class="facts">
        <div><b>${p.changed}</b> of ${p.withBoth} listings (${pct(p.changed, p.withBoth)}%) show a different price now than when first listed.</div>
        ${p.comparable ? `<div>Of the ${p.comparable} with a readable dollar figure both times, <b>${p.drops}</b> came down${p.rises ? ` and ${p.rises} went up` : ""}.${p.drops ? ` The median cut is <b>${p.medianDropPct}%</b> (about ${money(p.medianDropDollars)}).` : ""}</div>` : ""}
        ${p.medianDaysChanged !== null && p.medianDaysSame !== null ? `<div>Listings with a price change have been up a median <b>${p.medianDaysChanged} days</b>, against <b>${p.medianDaysSame}</b> for those without one. Older listings have had more time to change, so this shows where cuts happen, not that cuts slow a sale.</div>` : ""}
        ${p.dropsOver ? `<div><b>${p.dropsOver}</b> of the listings at ${T}+ days have already cut their price: owners who have adjusted once may be open to a new approach.</div>` : ""}
      </div>
    </section>

    <section class="card" style="margin-top:16px"><h2>Agencies with the most listings past ${T} days</h2>
      <p class="sub">Agencies with ${MIN_GROUP} or more listings, ranked by how many are past ${T} days. These are where most of your calls will come from.</p>
      <div class="table-wrap flat">${groupTable(I.agencies, T, "Agency")}</div>
    </section>

    <div class="grid cols-2" style="margin-top:16px">
      <section class="card"><h2>Slowest suburbs</h2><p class="sub">Highest median days on market, of ${I.suburbCount} suburbs with ${MIN_GROUP}+ listings.</p>
        <div class="table-wrap flat">${groupTable(I.slowSuburbs, T, "Suburb")}</div></section>
      <section class="card"><h2>Fastest suburbs</h2><p class="sub">Lowest median days on market. Owners here who are still unsold stand out.</p>
        <div class="table-wrap flat">${groupTable(I.fastSuburbs, T, "Suburb")}</div></section>
    </div>

    <div class="grid cols-2" style="margin-top:16px">
      <section class="card"><h2>By sale method</h2><div class="table-wrap flat">${groupTable(I.methods, T, "Method")}</div></section>
      <section class="card"><h2>Owner-occupied or rented</h2><div class="table-wrap flat">${groupTable(I.owners, T, "Owner type")}</div>
        ${rented && occ ? `<p class="sub" style="margin-top:8px">${rented.share}% of rented properties are past ${T} days, against ${occ.share}% of owner-occupied ones.</p>` : ""}</section>
    </div>

    <div class="grid cols-2" style="margin-top:16px">
      <section class="card"><h2>By property type</h2><div class="table-wrap flat">${groupTable(I.types, T, "Type")}</div></section>
      <section class="card"><h2>By asking price</h2><div class="table-wrap flat">${groupTable(I.prices, T, "Asking price")}</div>
        <p class="sub" style="margin-top:8px">Uses the ${I.pricedShare}% of listings that show a dollar figure. "Contact agent" and similar are left out.</p></section>
    </div>

    <div class="grid cols-2" style="margin-top:16px">
      <section class="card"><h2>Longest on the market</h2>
        ${I.oldest.map((l) => `<div class="row" style="justify-content:space-between;padding:6px 0;border-bottom:.5px solid var(--line)"><span><b>${esc(l.address)}</b><br><span class="sub">${esc(l.agency)}</span></span><span class="days">${l.days}<small>days</small></span></div>`).join("")}</section>
      <section class="card"><h2>Your listings against the market</h2>
        ${I.ours ? `<div class="facts"><div>You have <b>${I.ours}</b> listings on the market. Their median is <b>${I.ourMedian} days</b>, against <b>${I.medianDays}</b> for other agencies.</div>
          <div><b>${I.ourOverShare}%</b> of yours are past ${T} days, against <b>${I.overShare}%</b> for other agencies.</div>
          <div class="sub">A small group, so treat the comparison as a rough guide.</div></div>`
        : `<p class="muted">Set your agency name in Settings to compare your listings with the market.</p>`}</section>
    </div>
    <p class="sub" style="margin-top:16px">Days on market count from the first listed date in the for-sale export. A median is the middle value, so one very old listing doesn't skew it.</p>`;
  bindTips($("#view"));
}

// A small hover label for bars and table rows.
function bindTips(root) {
  let tip = $("#tip");
  if (!tip) { tip = document.createElement("div"); tip.id = "tip"; tip.className = "tip"; tip.hidden = true; document.body.appendChild(tip); }
  root.querySelectorAll("[data-tip]").forEach((el) => {
    if (!el.dataset.tip) return;
    el.addEventListener("mousemove", (e) => {
      tip.textContent = el.dataset.tip; tip.hidden = false;
      const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
      tip.style.left = x + "px"; tip.style.top = (e.clientY + 16) + "px";
    });
    el.addEventListener("mouseleave", () => (tip.hidden = true));
  });
}

// ---------- Settings ----------

async function viewSettings() {
  const s = await refreshSummary();
  const st = s.settings;
  await loadAgents();
  $("#view").innerHTML = `
    <h1>Settings</h1>
    <div class="grid cols-2">
      <div class="card"><h2>Rules</h2>
        <div class="grid">
          <label class="field"><span>Office name</span><input class="input" id="office_name" value="${esc(st.office_name)}" placeholder="Shown at the top of every contact sheet"></label>
          <label class="field"><span>Our agency (one name per line)</span><textarea class="input" id="our_agencies" placeholder="Type your agency name as it appears in the for-sale data">${esc(st.our_agencies.join("\n"))}</textarea>
            <span class="hint">Any listing whose agency contains one of these is ours and never goes on a contact sheet. Add every brand or office name you trade under.</span></label>
          <label class="field"><span>Day threshold</span><input class="input" id="threshold_days" type="number" min="1" max="365" value="${st.threshold_days}" style="max-width:120px">
            <span class="hint">Listings this many days old or more go to Ready to assign.</span></label>
          <label class="field"><span>"Hitting soon" window, in days</span><input class="input" id="soon_days" type="number" min="1" max="60" value="${st.soon_days}" style="max-width:120px"></label>
          <label class="field"><span>Dates in your files are written</span><select class="input" id="date_order" style="max-width:320px">
            <option value="DMY" ${st.date_order === "DMY" ? "selected" : ""}>Day first: 03/04/2026 is 3 April</option>
            <option value="MDY" ${st.date_order === "MDY" ? "selected" : ""}>Month first: 03/04/2026 is 4 March</option></select></label>
          <label class="field"><span>Assumed agency agreement length (days)</span><input class="input" id="agreement_days" type="number" min="0" max="365" value="${st.agreement_days ?? 90}" style="max-width:120px">
            <span class="hint">Used only to print an estimated end date on contact sheets. Agents still check the real agreement. 0 hides it.</span></label>
          <label class="field"><span>Warn when for-sale data is older than (days)</span><input class="input" id="stale_after_days" type="number" min="1" max="60" value="${st.stale_after_days}" style="max-width:120px"></label>
          <label class="field"><span>Time zone</span><input class="input" id="timezone" value="${esc(st.timezone)}" style="max-width:320px"><span class="hint">Decides when a new day starts. For example Australia/Sydney, Australia/Brisbane, Australia/Perth.</span></label>
          <div><button class="btn" id="save-settings">Save settings</button></div>
        </div></div>
      <div class="grid" style="align-content:start">
        <div class="card"><h2>Agents</h2><p class="sub">The people contact sheets can be given to. They also appear in the <b>You are</b> list.</p>
          <table class="list" style="min-width:0"><tbody>${state.agents.map((a) => `<tr><td><b>${esc(a.name)}</b>${a.active ? "" : ` <span class="pill none">Inactive</span>`}</td>
            <td style="text-align:right"><button class="btn small ghost" data-rename="${a.id}">Rename</button> <button class="btn small ghost" data-toggle="${a.id}">${a.active ? "Deactivate" : "Reactivate"}</button></td></tr>`).join("") || `<tr><td class="muted">No agents yet.</td></tr>`}</tbody></table>
          <div class="row" style="margin-top:12px"><input class="input" id="new-agent" placeholder="Full name" style="flex:1"><button class="btn" id="add-agent">Add agent</button></div></div>
        <div class="card"><h2>Alerts on this computer</h2>
          <p class="sub">Keep Listing Watch open in a browser tab and it checks every few minutes. Turn this on to get a pop-up when a property hits ${st.threshold_days} days.</p>
          ${"Notification" in window ? (Notification.permission === "granted" ? `<p class="okline">On for this browser.</p>` : `<button class="btn ghost" id="allow-notify2">Turn on pop-up alerts</button>`) : `<p class="muted">This browser can't show pop-ups.</p>`}
          <p class="sub">Email alerts can be set up too. See the README.</p></div>
        <div class="card"><h2>Backup and export</h2><p class="sub">All data lives in one file, <code>data/listing-watch.sqlite3</code>, next to the app. Copy it somewhere safe to back up.</p>
          <a class="btn ghost small" href="/export/leads.csv?view=all">Download every property as a spreadsheet</a></div>
      </div>
    </div>`;
  $("#save-settings").addEventListener("click", async () => {
    const body = Object.fromEntries(["office_name", "our_agencies", "threshold_days", "soon_days", "date_order", "agreement_days", "stale_after_days", "timezone"].map((k) => [k, $("#" + k).value]));
    if (+body.threshold_days !== st.threshold_days && !(await confirmBox({ title: `Change the threshold to ${body.threshold_days} days?`, body: "<p>Every listing is re-sorted straight away. Properties already assigned stay with their agents.</p>", ok: "Change it" }))) return;
    if (await act(() => api("/api/settings", { json: body }), "Settings saved.")) viewSettings();
  });
  $("#add-agent").addEventListener("click", async () => {
    const name = $("#new-agent").value.trim();
    if (await act(() => api("/api/agents", { json: { name } }), `${name} added.`)) viewSettings();
  });
  $("#new-agent").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#add-agent").click(); });
  $("#view").querySelectorAll("[data-rename]").forEach((b) => b.addEventListener("click", async () => {
    const a = state.agents.find((x) => String(x.id) === b.dataset.rename);
    const name = await askText({ title: `Rename ${a.name}`, label: "New name", value: a.name, ok: "Rename" });
    if (name && name !== a.name && (await act(() => api("/api/agents", { json: { id: a.id, name, phone: a.phone, active: !!a.active } }), "Renamed."))) viewSettings();
  }));
  $("#view").querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", async () => {
    const a = state.agents.find((x) => String(x.id) === b.dataset.toggle);
    if (await act(() => api("/api/agents", { json: { id: a.id, name: a.name, phone: a.phone, active: !a.active } }), a.active ? `${a.name} deactivated.` : `${a.name} reactivated.`)) viewSettings();
  }));
  $("#allow-notify2")?.addEventListener("click", async () => { await Notification.requestPermission(); viewSettings(); });
}

// ---------- start ----------

(async function start() {
  try {
    state.meta = await api("/api/meta");
    await loadAgents();
    await render();
  } catch (e) {
    $("#view").innerHTML = `<div class="card"><h2>Can't reach Listing Watch</h2><p>Make sure the program is running on the office computer, then reload this page.</p><p class="sub">${esc(e.message)}</p></div>`;
  }
  // Check for new notifications every 2 minutes while the tab is open.
  setInterval(() => refreshSummary().catch(() => {}), 120000);
})();
