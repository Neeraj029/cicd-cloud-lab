const $ = (id) => document.getElementById(id);
const state = { room: "general", token: "", user: null };

function setStatus(online) {
  $("dot").className = online ? "dot" : "dot off";
  $("statusText").textContent = online ? "Connected" : "Offline";
}

function fmtTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function plural(n) {
  return n + " message" + (n === 1 ? "" : "s");
}

function authHeaders() {
  return state.token ? { Authorization: "Bearer " + state.token } : {};
}

function setAuthStatus(message) {
  $("authStatus").textContent = message;
}

function persistSession() {
  if (state.token && state.user) {
    localStorage.setItem("pulsechat-token", state.token);
    localStorage.setItem("pulsechat-user", state.user.username);
  } else {
    localStorage.removeItem("pulsechat-token");
    localStorage.removeItem("pulsechat-user");
  }
}

function setSession(token, user) {
  state.token = token || "";
  state.user = user || null;
  persistSession();
  $("authUser").value = state.user ? state.user.username : "";
  $("text").disabled = !state.user;
  $("sendForm").querySelector("button[type='submit']").disabled = !state.user;
  setAuthStatus(state.user ? `Signed in as ${state.user.username}` : "Not signed in");
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
    setSession("", null);
    return false;
  }
}

async function authAction(path) {
  const username = $("authUser").value.trim();
  const password = $("authPass").value;
  if (!username || !password) {
    window.alert("Enter username and password.");
    return false;
  }
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  if (!res.ok) {
    window.alert(data.error || "Authentication failed.");
    return false;
  }
  setSession(data.token, data.user);
  $("authPass").value = "";
  return true;
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

async function loadRooms() {
  try {
    const res = await fetch("/api/rooms");
    const data = await res.json();
    const list = [...new Set([...data.rooms, state.room])];
    const box = $("rooms");
    box.innerHTML = "";
    list.forEach((room) => {
      const li = document.createElement("li");
      li.textContent = room;
      if (room === state.room) li.className = "sel";
      li.onclick = () => {
        state.room = room;
        $("roomTitle").textContent = room;
        loadRooms();
        loadMessages();
      };
      box.appendChild(li);
    });
  } catch {
    setStatus(false);
  }
}

function render(messages) {
  const box = $("messages");
  box.innerHTML = "";
  if (!messages.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No messages in this room yet.";
    box.appendChild(empty);
    return;
  }
  const me = state.user ? state.user.username.toLowerCase() : "";
  messages.forEach((msg) => {
    const card = document.createElement("div");
    card.className = msg.username.toLowerCase() === me ? "msg own" : "msg";

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
    box.appendChild(card);
  });
  box.scrollTop = box.scrollHeight;
}

async function loadMessages() {
  try {
    const res = await fetch(`/api/messages?room=${encodeURIComponent(state.room)}&limit=50`);
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    render(data.messages);
    $("statusText").textContent = plural(data.messages.length);
    setStatus(true);
  } catch {
    setStatus(false);
  }
}

async function send(text) {
  if (!state.token) {
    window.alert("Login required.");
    return false;
  }
  const res = await fetch("/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ room: state.room, text }),
  });
  if (!res.ok) {
    const err = await res.json();
    if (res.status === 401) setSession("", null);
    window.alert(err.error || "Message could not be sent.");
  }
  return res.ok;
}

$("sendForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = $("text").value.trim();
  if (!text) return;
  if (await send(text)) {
    $("text").value = "";
    $("text").focus();
    loadMessages();
  }
});

$("text").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $("sendForm").requestSubmit();
  }
});

$("joinBtn").onclick = () => {
  const room = $("newRoom").value.trim().toLowerCase().replace(/\s+/g, "-");
  if (!room) return;
  state.room = room;
  $("roomTitle").textContent = room;
  $("newRoom").value = "";
  loadRooms();
  loadMessages();
};

$("registerBtn").onclick = async () => {
  if (await authAction("/api/auth/register")) loadMessages();
};

$("loginBtn").onclick = async () => {
  if (await authAction("/api/auth/login")) loadMessages();
};

$("logoutBtn").onclick = async () => {
  if (state.token) {
    await fetch("/api/auth/logout", { method: "POST", headers: authHeaders() });
  }
  setSession("", null);
};

function applyTheme(dark) {
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  $("themeBtn").setAttribute("aria-checked", String(dark));
  localStorage.setItem("pulsechat-dark", dark ? "1" : "0");
}

$("themeBtn").onclick = () => {
  applyTheme(document.documentElement.getAttribute("data-theme") !== "dark");
};

applyTheme(localStorage.getItem("pulsechat-dark") === "1");
state.token = localStorage.getItem("pulsechat-token") || "";
const savedUser = localStorage.getItem("pulsechat-user");
if (state.token && savedUser) {
  state.user = { username: savedUser };
  $("authUser").value = savedUser;
}
setSession(state.token, state.user);

loadVersion();
loadRooms();
fetchMe().then(loadMessages);
setInterval(loadMessages, 2500);