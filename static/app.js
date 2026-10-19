/* PulseChat — client.
   Nothing about the chat (rooms, messages, polling) happens until a session is
   verified: the auth view and the app view are mutually exclusive and the
   bootstrap gate below is the only way into the app view. */

const $ = (id) => document.getElementById(id);
const POLL_MS = 2500;
const GROUP_WINDOW_MS = 5 * 60 * 1000;
const STORE = { token: "pulsechat-token", user: "pulsechat-user", dark: "pulsechat-dark" };

const state = {
  room: "general",
  token: "",
  user: null,
  mode: "login",
  pollTimer: null,
  nodes: new Map(),
  following: true,
  sending: false,
};

/* ---------------------------------------------------------------- helpers */

function authHeaders() {
  return state.token ? { Authorization: "Bearer " + state.token } : {};
}

function fmtTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function plural(n) {
  return n + " message" + (n === 1 ? "" : "s");
}

function setStatus(online, text) {
  const dot = $("dot");
  dot.className = "dot " + (online ? "is-live" : "is-off");
  if (text !== undefined) $("statusText").textContent = text;
}

function toast(message, kind) {
  const el = document.createElement("div");
  el.className = "toast" + (kind === "error" ? " is-error" : "");
  el.textContent = message;
  $("toasts").appendChild(el);
  setTimeout(() => {
    el.classList.add("is-out");
    el.addEventListener("animationend", () => el.remove(), { once: true });
  }, 3200);
}

/* ------------------------------------------------------------------ views */

function showAuth() {
  $("appView").hidden = true;
  $("authView").hidden = false;
  stopPolling();
}

function showApp() {
  $("authView").hidden = true;
  $("appView").hidden = false;
  $("text").focus();
}

/* --------------------------------------------------------------- session */

function persistSession() {
  if (state.token && state.user) {
    localStorage.setItem(STORE.token, state.token);
    localStorage.setItem(STORE.user, state.user.username);
  } else {
    localStorage.removeItem(STORE.token);
    localStorage.removeItem(STORE.user);
  }
}

function setSession(token, user) {
  state.token = token || "";
  state.user = user || null;
  persistSession();
  $("authUser").value = state.user ? state.user.username : "";
  if (state.user) {
    $("accountName").textContent = state.user.username;
    $("avatar").textContent = state.user.username.charAt(0).toUpperCase();
  }
}

async function fetchMe() {
  if (!state.token) return false;
  try {
    const res = await fetch("/api/auth/me", { headers: authHeaders() });
    if (!res.ok) throw new Error();
    const data = await res.json();
    setSession(state.token, data.user);
    return true;
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------- auth (screen) */

function setBusy(on) {
  const btn = $("authSubmit");
  btn.classList.toggle("is-busy", on);
  btn.disabled = on;
}

function clearAuthError() {
  $("authError").hidden = true;
  $("authError").textContent = "";
}

function authFail(message) {
  const box = $("authError");
  const form = $("authForm");
  box.textContent = message;
  box.hidden = false;
  form.classList.remove("is-invalid");
  void form.offsetWidth; // restart the shake
  form.classList.add("is-invalid");
}

function setMode(mode) {
  state.mode = mode;
  const registering = mode === "register";
  $("segmented").dataset.mode = mode;
  $("segLogin").setAttribute("aria-selected", String(!registering));
  $("segRegister").setAttribute("aria-selected", String(registering));
  $("authSubmit").querySelector(".btn-label").textContent = registering ? "Create account" : "Sign in";
  $("authPass").setAttribute("autocomplete", registering ? "new-password" : "current-password");
  $("authHint").innerHTML = registering
    ? "Username: 3&ndash;30 characters &mdash; letters, numbers, <code>_</code>, <code>.</code>, <code>-</code>. Password: at least 8 characters."
    : "Username: 3&ndash;30 characters &mdash; letters, numbers, <code>_</code>, <code>.</code>, <code>-</code>";
  clearAuthError();
}

async function submitAuth(path) {
  const username = $("authUser").value.trim();
  const password = $("authPass").value;
  if (!username || !password) {
    authFail("Enter both username and password.");
    return;
  }
  clearAuthError();
  setBusy(true);
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      authFail(data.error || "Authentication failed.");
      return;
    }
    $("authPass").value = "";
    setSession(data.token, data.user);
    enterApp();
  } catch {
    authFail("Could not reach the server.");
  } finally {
    setBusy(false);
  }
}

/* ------------------------------------------------------------- app startup */

async function enterApp() {
  showApp();
  closeDrawer();
  $("roomTitle").textContent = state.room;
  setStatus(false, "Connecting");
  await loadVersion();
  await loadRooms();
  loadMessages();
  startPolling();
}

async function loadVersion() {
  try {
    const res = await fetch("/api/version");
    const data = await res.json();
    $("verBadge").textContent = data.version;
  } catch {
    /* keep the server-rendered value */
  }
}

function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(() => {
    if (document.visibilityState === "visible") loadMessages();
  }, POLL_MS);
}

function stopPolling() {
  if (state.pollTimer !== null) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

/* ----------------------------------------------------------------- rooms */

async function loadRooms() {
  try {
    const res = await fetch("/api/rooms");
    const data = await res.json();
    const list = [...new Set([...data.rooms, state.room])];
    const box = $("rooms");
    box.textContent = "";
    list.forEach((room) => {
      const li = document.createElement("li");
      li.className = "room" + (room === state.room ? " is-active" : "");
      li.setAttribute("role", "listitem");

      const hash = document.createElement("span");
      hash.className = "hash";
      hash.textContent = "#";
      const name = document.createElement("span");
      name.textContent = room;

      li.append(hash, name);
      li.onclick = () => selectRoom(room);
      box.appendChild(li);
    });
  } catch {
    setStatus(false, "Offline");
  }
}

function selectRoom(room) {
  if (room === state.room) {
    closeDrawer();
    return;
  }
  state.room = room;
  state.nodes.clear();
  $("messages").textContent = "";
  $("jumpBtn").hidden = true;
  state.following = true;
  $("roomTitle").textContent = room;
  closeDrawer();
  loadRooms();
  loadMessages();
}

/* -------------------------------------------------------------- messages */

function emptyState() {
  const wrap = document.createElement("div");
  wrap.className = "empty";
  const strong = document.createElement("strong");
  strong.textContent = "No messages yet";
  const sub = document.createElement("span");
  sub.textContent = "Start the conversation in #" + state.room;
  wrap.append(strong, sub);
  return wrap;
}

function buildMessage(msg, grouped) {
  const card = document.createElement("div");
  card.className = "msg" + (isOwn(msg) ? " is-own" : "") + (grouped ? " is-grouped" : "");
  card.dataset.id = String(msg.id);
  card.dataset.username = msg.username.toLowerCase();
  card.dataset.createdAt = msg.created_at;

  const meta = document.createElement("div");
  meta.className = "meta";
  const who = document.createElement("span");
  who.className = "who";
  who.textContent = msg.username;
  const when = document.createElement("span");
  when.className = "time";
  when.textContent = fmtTime(msg.created_at);
  meta.append(who, when);

  const body = document.createElement("div");
  body.className = "text";
  body.textContent = msg.text;

  card.append(meta, body);
  return card;
}

function isOwn(msg) {
  return !!state.user && msg.username.toLowerCase() === state.user.username.toLowerCase();
}

/* Diff by id: the poller runs every 2.5s and must not rebuild the DOM. Only
   genuinely new messages are created (and only those animate in). */
function render(messages) {
  const box = $("messages");

  if (!messages.length) {
    state.nodes.clear();
    $("jumpBtn").hidden = true;
    if (!box.querySelector(".empty")) {
      box.textContent = "";
      box.appendChild(emptyState());
    }
    return;
  }

  const placeholder = box.querySelector(".empty");
  if (placeholder) placeholder.remove();

  const firstKnown = state.nodes.size ? Math.min(...state.nodes.keys()) : Infinity;
  if (messages[0].id > firstKnown) {
    // The window slid past messages we had on screen — rebuild from scratch.
    state.nodes.clear();
    box.textContent = "";
  }

  let previous = null;
  let appended = 0;
  messages.forEach((msg) => {
    if (state.nodes.has(msg.id)) {
      previous = state.nodes.get(msg.id);
      return;
    }
    const grouped = isGrouped(previous, msg);
    const card = buildMessage(msg, grouped);
    box.appendChild(card);
    state.nodes.set(msg.id, card);
    if (grouped && previous) previous.classList.add("is-grouped");
    previous = card;
    appended++;
  });

  if (appended && state.following) box.scrollTop = box.scrollHeight;
  else if (appended) $("jumpBtn").hidden = false;
}

function isGrouped(previous, msg) {
  if (!previous || previous.dataset.username !== msg.username.toLowerCase()) return false;
  const gap = new Date(msg.created_at) - new Date(previous.dataset.createdAt);
  return gap >= 0 && gap < GROUP_WINDOW_MS;
}

async function loadMessages() {
  if (!state.token) return;
  try {
    const res = await fetch(`/api/messages?room=${encodeURIComponent(state.room)}&limit=50`);
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    render(data.messages);
    setStatus(true, plural(data.messages.length));
  } catch {
    setStatus(false, "Offline");
  }
}

async function send(text) {
  const res = await fetch("/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ room: state.room, text }),
  });
  if (res.status === 401) {
    setSession("", null);
    showAuth();
    clearAuthError();
    authFail("Your session expired. Sign in again.");
    return false;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    toast(err.error || "Message could not be sent.", "error");
    return false;
  }
  return true;
}

/* ------------------------------------------------------------------ theme */

function applyTheme(dark) {
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  $("themeBtn").setAttribute("aria-checked", String(dark));
  localStorage.setItem(STORE.dark, dark ? "1" : "0");
}

/* ----------------------------------------------------------------- drawer */

function openDrawer() {
  $("window").classList.add("is-drawer-open");
  $("scrim").hidden = false;
  $("menuBtn").setAttribute("aria-expanded", "true");
}

function closeDrawer() {
  const w = $("window");
  if (!w.classList.contains("is-drawer-open")) return;
  w.classList.remove("is-drawer-open");
  $("scrim").hidden = true;
  $("menuBtn").setAttribute("aria-expanded", "false");
}

/* ------------------------------------------------------------------ wiring */

$("authForm").addEventListener("submit", (event) => {
  event.preventDefault();
  submitAuth(state.mode === "register" ? "/api/auth/register" : "/api/auth/login");
});

$("segmented").addEventListener("click", (event) => {
  const btn = event.target.closest(".seg");
  if (btn) setMode(btn.dataset.mode);
});

$("revealBtn").addEventListener("click", () => {
  const input = $("authPass");
  const shown = input.type === "text";
  input.type = shown ? "password" : "text";
  $("revealBtn").textContent = shown ? "Show" : "Hide";
  $("revealBtn").setAttribute("aria-pressed", String(!shown));
  $("revealBtn").setAttribute("aria-label", shown ? "Show password" : "Hide password");
  input.focus();
});

$("authUser").addEventListener("input", clearAuthError);

$("logoutBtn").addEventListener("click", async () => {
  stopPolling();
  if (state.token) {
    try {
      await fetch("/api/auth/logout", { method: "POST", headers: authHeaders() });
    } catch {
      /* the token is going away either way */
    }
  }
  setSession("", null);
  state.nodes.clear();
  $("messages").textContent = "";
  $("rooms").textContent = "";
  $("jumpBtn").hidden = true;
  setMode("login");
  showAuth();
  $("authPass").value = "";
  clearAuthError();
  $("authUser").focus();
});

$("newRoomForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const room = $("newRoom").value.trim().toLowerCase().replace(/\s+/g, "-");
  if (!room) return;
  $("newRoom").value = "";
  if (room === state.room) {
    loadRooms();
    return;
  }
  selectRoom(room);
});

$("sendForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("text");
  const text = input.value.trim();
  if (!text || state.sending) return;
  state.sending = true;
  try {
    if (await send(text)) {
      input.value = "";
      updateComposer();
      input.focus();
      loadMessages();
    }
  } catch {
    toast("Could not reach the server.", "error");
  } finally {
    state.sending = false;
  }
});

$("text").addEventListener("input", updateComposer);
$("text").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $("sendForm").requestSubmit();
  }
});

function updateComposer() {
  const len = $("text").value.length;
  const count = $("charCount");
  count.textContent = 500 - len;
  count.classList.toggle("is-shown", len >= 400);
  count.classList.toggle("is-over", len > 480);
  $("sendBtn").disabled = len === 0;
}

$("messages").addEventListener("scroll", () => {
  const box = $("messages");
  state.following = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  if (state.following) $("jumpBtn").hidden = true;
});

$("jumpBtn").addEventListener("click", () => {
  const box = $("messages");
  state.following = true;
  $("jumpBtn").hidden = true;
  box.scrollTop = box.scrollHeight;
});

$("themeBtn").addEventListener("click", () => {
  applyTheme(document.documentElement.getAttribute("data-theme") !== "dark");
});

$("menuBtn").addEventListener("click", () => {
  if ($("window").classList.contains("is-drawer-open")) closeDrawer();
  else openDrawer();
});
$("drawerClose").addEventListener("click", closeDrawer);
$("scrim").addEventListener("click", closeDrawer);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeDrawer();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.token) loadMessages();
});

/* --------------------------------------------------------------- bootstrap */

applyTheme(localStorage.getItem(STORE.dark) === "1");
setMode("login");
updateComposer();
setStatus(false, "Connecting");
loadVersion();
$("authUser").focus();

const savedToken = localStorage.getItem(STORE.token) || "";
const savedUser = localStorage.getItem(STORE.user) || "";
if (savedToken && savedUser) {
  setSession(savedToken, { username: savedUser });
  // Show the sign-in card until the stored token is actually verified.
  fetchMe().then((ok) => {
    if (ok) enterApp();
    else setSession("", null);
  });
}
