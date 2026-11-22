
const $ = (id) => document.getElementById(id);
let token = localStorage.getItem("nyxaris_token");

async function api(path, options = {}) {
  const response = await fetch("/api" + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401) logout();
    throw new Error(data.error || "Request failed");
  }

  return data;
}

function notify(message) {
  const el = $("notice");
  if (el) el.textContent = message;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  })[c]);
}

function showDashboard() {
  $("loginView").hidden = true;
  $("appView").hidden = false;
  loadDashboard();
}

function logout() {
  token = null;
  localStorage.removeItem("nyxaris_token");
  $("appView").hidden = true;
  $("loginView").hidden = false;
}

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const button = $("loginForm").querySelector("button");
  const error = $("loginError");

  button.disabled = true;
  button.textContent = "Signing in...";
  error.textContent = "";

  try {
    const result = await api("/admin/login", {
      method: "POST",
      body: JSON.stringify({
        username: $("username").value.trim(),
        password: $("password").value
      })
    });

    if (!result.token) throw new Error("No login token received");

    token = result.token;
    localStorage.setItem("nyxaris_token", token);
    $("password").value = "";
    showDashboard();
  } catch (err) {
    error.textContent = err.message;
  } finally {
    button.disabled = false;
    button.innerHTML = 'Sign in <span>→</span>';
  }
});

$("logout").addEventListener("click", logout);
$("refresh").addEventListener("click", loadDashboard);

async function loadDashboard() {
  try {
    const [overview, projects, users, keys] = await Promise.all([
      api("/admin/overview"),
      api("/admin/projects"),
      api("/admin/users"),
      api("/admin/keys")
    ]);

    $("sProjects").textContent = overview.projects;
    $("sUsers").textContent = overview.users;
    $("sActive").textContent = overview.activeLicenses;
    $("sUnused").textContent = overview.unusedKeys;

    $("projects").innerHTML = projects.map(p => `
      <div class="rowItem">
        <strong>${escapeHTML(p.name)}</strong>
        <small>${escapeHTML(p.description || p.id)}</small>
      </div>
    `).join("") || "<p>No projects yet.</p>";

    $("keyProject").innerHTML = projects.map(p => `
      <option value="${escapeHTML(p.id)}">${escapeHTML(p.name)}</option>
    `).join("");

    $("users").innerHTML = users.map(u => `
      <tr>
        <td>${escapeHTML(u.username)}</td>
        <td>${escapeHTML(u.project_name)}</td>
        <td>${escapeHTML(u.status)}</td>
        <td>${escapeHTML(u.hwid_hash)}</td>
        <td>
          <button data-action="${u.status === "active" ? "revoke" : "unrevoke"}"
            data-id="${escapeHTML(u.id)}">
            ${u.status === "active" ? "Revoke" : "Restore"}
          </button>
          <button data-action="reset-hwid" data-id="${escapeHTML(u.id)}">
            Reset HWID
          </button>
        </td>
      </tr>
    `).join("");

    $("keys").innerHTML = keys.map(k => `
      <tr>
        <td>${escapeHTML(k.project_name)}</td>
        <td>${escapeHTML(k.username || "Unused")}</td>
        <td>${escapeHTML(k.status)}</td>
        <td>${escapeHTML(k.expires_at || "Lifetime")}</td>
        <td>${k.status !== "revoked" ? `
          <button data-action="revoke-key" data-id="${escapeHTML(k.id)}">
            Revoke
          </button>` : "Revoked"}
        </td>
      </tr>
    `).join("");

    notify("Dashboard updated.");
  } catch (err) {
    notify(err.message);
  }
}

$("projectForm").addEventListener("submit", async event => {
  event.preventDefault();

  try {
    await api("/admin/projects", {
      method: "POST",
      body: JSON.stringify({
        name: $("projectName").value,
        description: $("projectDesc").value
      })
    });

    $("projectForm").reset();
    await loadDashboard();
    notify("Project created.");
  } catch (err) {
    notify(err.message);
  }
});

$("keyForm").addEventListener("submit", async event => {
  event.preventDefault();

  try {
    const result = await api("/admin/keys", {
      method: "POST",
      body: JSON.stringify({
        projectId: $("keyProject").value,
        count: Number($("keyCount").value),
        days: Number($("keyDays").value)
      })
    });

    $("newKeys").hidden = false;
    $("newKeys").textContent = result.keys.map(k => k.key).join("\n");
    notify("Keys generated. Copy and save them now.");
    await loadDashboard();
  } catch (err) {
    notify(err.message);
  }
});

document.addEventListener("click", async event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const action = button.dataset.action;
  const id = encodeURIComponent(button.dataset.id);

  const routes = {
    revoke: `/admin/users/${id}/revoke`,
    unrevoke: `/admin/users/${id}/unrevoke`,
    "reset-hwid": `/admin/users/${id}/reset-hwid`,
    "revoke-key": `/admin/keys/${id}/revoke`
  };

  if (!routes[action]) return;
  if (!confirm("Are you sure?")) return;

  try {
    await api(routes[action], { method: "POST" });
    await loadDashboard();
    notify("Action completed.");
  } catch (err) {
    notify(err.message);
  }
});

if (token) {
  showDashboard();
} else {
  $("loginView").hidden = false;
  $("appView").hidden = true;
}
