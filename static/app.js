const $ = (id) => document.getElementById(id);
const state = { room: "general" };

const myName = () => ($("username").value.trim() || "guest");

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
  const me = myName().toLowerCase();
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
  const res = await fetch("/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: myName(), room: state.room, text }),
  });
  if (!res.ok) {
    const err = await res.json();
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

$("username").addEventListener("change", () => {
  localStorage.setItem("pulsechat-name", myName());
  loadMessages();
});

function applyTheme(dark) {
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  $("themeBtn").setAttribute("aria-checked", String(dark));
  localStorage.setItem("pulsechat-dark", dark ? "1" : "0");
}

$("themeBtn").onclick = () => {
  applyTheme(document.documentElement.getAttribute("data-theme") !== "dark");
};

$("username").value = localStorage.getItem("pulsechat-name") || "";
applyTheme(localStorage.getItem("pulsechat-dark") === "1");

loadVersion();
loadRooms();
loadMessages();
setInterval(loadMessages, 2500);