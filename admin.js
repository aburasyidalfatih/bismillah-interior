const DEFAULT_FORM_NAME = "bismillah-interior-contact";
const CONFIG_KEY = "bismillah-admin-config";
const SESSION_CONFIG_KEY = "bismillah-admin-session-config";
const META_KEY = "bismillah-admin-lead-meta";

const statusLabels = {
  new: "Belum dihubungi",
  contacted: "Sudah dihubungi",
  survey: "Survey",
  design: "Desain",
  won: "Deal",
  lost: "Tidak lanjut",
};

const setupView = document.querySelector("[data-setup-view]");
const dashboardView = document.querySelector("[data-dashboard-view]");
const configForm = document.querySelector("[data-config-form]");
const inlineConfigForm = document.querySelector("[data-inline-config-form]");
const configPanel = document.querySelector("[data-config-panel]");
const openConfigButton = document.querySelector("[data-open-config]");
const clearConfigButton = document.querySelector("[data-clear-config]");
const refreshButton = document.querySelector("[data-refresh]");
const exportButton = document.querySelector("[data-export]");
const statusLine = document.querySelector("[data-status-line]");
const leadList = document.querySelector("[data-lead-list]");
const leadDetail = document.querySelector("[data-lead-detail]");
const searchInput = document.querySelector("[data-search]");
const stateFilter = document.querySelector("[data-state-filter]");
const statusFilter = document.querySelector("[data-status-filter]");

const appState = {
  config: null,
  meta: loadJson(META_KEY, {}),
  submissions: [],
  forms: [],
  selectedId: null,
  loading: false,
};

function loadJson(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function loadConfig() {
  const sessionValue = sessionStorage.getItem(SESSION_CONFIG_KEY);
  if (sessionValue) {
    try {
      return JSON.parse(sessionValue);
    } catch {
      sessionStorage.removeItem(SESSION_CONFIG_KEY);
    }
  }

  return loadJson(CONFIG_KEY, null);
}

function saveConfig(config) {
  const payload = {
    siteId: config.siteId.trim(),
    token: config.token.trim(),
    formName: (config.formName || DEFAULT_FORM_NAME).trim(),
    remember: Boolean(config.remember),
  };

  if (payload.remember) {
    saveJson(CONFIG_KEY, payload);
    sessionStorage.removeItem(SESSION_CONFIG_KEY);
  } else {
    sessionStorage.setItem(SESSION_CONFIG_KEY, JSON.stringify(payload));
    localStorage.removeItem(CONFIG_KEY);
  }

  appState.config = payload;
}

function clearConfig() {
  localStorage.removeItem(CONFIG_KEY);
  sessionStorage.removeItem(SESSION_CONFIG_KEY);
  appState.config = null;
  appState.submissions = [];
  appState.selectedId = null;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function asText(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value ?? "").trim();
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

function getLeadMeta(id) {
  return appState.meta[id] || { status: "new", note: "" };
}

function updateLeadMeta(id, patch) {
  appState.meta[id] = {
    ...getLeadMeta(id),
    ...patch,
  };
  saveJson(META_KEY, appState.meta);
}

function formToConfig(form) {
  const data = new FormData(form);
  return {
    siteId: String(data.get("siteId") || ""),
    token: String(data.get("token") || ""),
    formName: String(data.get("formName") || DEFAULT_FORM_NAME),
    remember: data.get("remember") === "on",
  };
}

function fillConfigForm(form) {
  if (!form || !appState.config) return;
  form.elements.siteId.value = appState.config.siteId || "";
  form.elements.token.value = appState.config.token || "";
  form.elements.formName.value = appState.config.formName || DEFAULT_FORM_NAME;
  form.elements.remember.checked = appState.config.remember !== false;
}

function showSetup() {
  setupView.hidden = false;
  dashboardView.hidden = true;
  fillConfigForm(configForm);
}

function showDashboard() {
  setupView.hidden = true;
  dashboardView.hidden = false;
  fillConfigForm(inlineConfigForm);
}

function setStatus(message, isError = false) {
  statusLine.textContent = message;
  statusLine.classList.toggle("is-error", isError);
}

async function fetchAdminData() {
  if (!appState.config?.siteId || !appState.config?.token) {
    showSetup();
    return;
  }

  appState.loading = true;
  setStatus("Mengambil data Netlify Forms...");

  const params = new URLSearchParams({
    state: stateFilter.value,
    formName: appState.config.formName || DEFAULT_FORM_NAME,
  });

  try {
    const response = await fetch(`/api/admin-submissions?${params.toString()}`, {
      headers: {
        "x-netlify-site-id": appState.config.siteId,
        "x-netlify-auth-token": appState.config.token,
      },
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.message || "Gagal mengambil data Netlify Forms.");
    }

    appState.forms = result.forms || [];
    appState.submissions = result.submissions || [];

    if (!appState.submissions.some((item) => item.id === appState.selectedId)) {
      appState.selectedId = appState.submissions[0]?.id || null;
    }

    render();
    setStatus(`Terakhir diperbarui ${formatDate(new Date().toISOString())}. Form: ${result.activeForm?.name || appState.config.formName}.`);
  } catch (error) {
    render();
    setStatus(error.message, true);
  } finally {
    appState.loading = false;
  }
}

function getLead(item) {
  return item.lead || {};
}

function getSearchText(item) {
  const lead = getLead(item);
  const raw = item.data || {};
  return [
    lead.name,
    lead.phone,
    lead.address,
    lead.spaces,
    lead.message,
    raw.otherSpace,
    raw.selectedSpaces,
    raw.spaces,
  ]
    .map(asText)
    .join(" ")
    .toLowerCase();
}

function getVisibleSubmissions() {
  const query = searchInput.value.trim().toLowerCase();
  const selectedStatus = statusFilter.value;

  return appState.submissions.filter((item) => {
    const meta = getLeadMeta(item.id);
    const matchesStatus = selectedStatus === "all" || meta.status === selectedStatus;
    const matchesSearch = !query || getSearchText(item).includes(query);
    return matchesStatus && matchesSearch;
  });
}

function renderStats() {
  const now = Date.now();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

  const today = appState.submissions.filter((item) => new Date(item.createdAt).getTime() >= dayStart.getTime()).length;
  const week = appState.submissions.filter((item) => new Date(item.createdAt).getTime() >= weekAgo).length;
  const fresh = appState.submissions.filter((item) => getLeadMeta(item.id).status === "new").length;

  document.querySelector("[data-stat-total]").textContent = appState.submissions.length;
  document.querySelector("[data-stat-today]").textContent = today;
  document.querySelector("[data-stat-week]").textContent = week;
  document.querySelector("[data-stat-new]").textContent = fresh;
}

function renderLeadList() {
  const submissions = getVisibleSubmissions();

  if (!submissions.length) {
    leadList.innerHTML = `<div class="empty-list">Belum ada data yang cocok dengan filter.</div>`;
    return;
  }

  leadList.innerHTML = submissions
    .map((item) => {
      const lead = getLead(item);
      const meta = getLeadMeta(item.id);
      const title = lead.name || item.title || "Tanpa nama";
      const spaces = asText(lead.spaces || "Custom furniture");
      const phone = lead.phone || "-";
      const isActive = item.id === appState.selectedId ? " is-active" : "";

      return `
        <button class="lead-row${isActive}" type="button" data-select-lead="${escapeHtml(item.id)}">
          <div class="lead-main">
            <div class="lead-title">
              <strong>${escapeHtml(title)}</strong>
              <span class="pill">${escapeHtml(statusLabels[meta.status] || statusLabels.new)}</span>
              ${item.state === "spam" ? `<span class="pill muted">Spam</span>` : ""}
            </div>
            <p>${escapeHtml(spaces)}</p>
            <div class="lead-meta">
              <span>${escapeHtml(phone)}</span>
              <span>${escapeHtml(lead.address || "Alamat belum diisi")}</span>
            </div>
          </div>
          <time class="lead-date">${escapeHtml(formatDate(item.createdAt))}</time>
        </button>
      `;
    })
    .join("");
}

function renderLeadDetail() {
  const item = appState.submissions.find((submission) => submission.id === appState.selectedId);
  if (!item) {
    leadDetail.innerHTML = `
      <div class="empty-detail">
        <p>Pilih salah satu lead untuk melihat detail.</p>
      </div>
    `;
    return;
  }

  const lead = getLead(item);
  const meta = getLeadMeta(item.id);
  const rawData = item.data || {};
  const phone = normalizePhone(lead.phone);
  const whatsappMessage = [
    `Halo ${lead.name || "Bapak/Ibu"}, kami dari Bismillah Interior.`,
    "Terima kasih sudah mengisi formulir konsultasi.",
    "Boleh kami lanjutkan diskusi kebutuhan interiornya?",
  ].join("\n");
  const whatsappUrl = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(whatsappMessage)}` : "#";

  const fieldRows = Object.entries(rawData)
    .filter(([key]) => !["form-name", "bot-field"].includes(key))
    .map(
      ([key, value]) => `
        <div>
          <span>${escapeHtml(key)}</span>
          <strong>${escapeHtml(asText(value) || "-")}</strong>
        </div>
      `,
    )
    .join("");

  leadDetail.innerHTML = `
    <div class="detail-head">
      <div>
        <h2>${escapeHtml(lead.name || item.title || "Tanpa nama")}</h2>
        <p>${escapeHtml(formatDate(item.createdAt))}</p>
      </div>
      <span class="pill">${escapeHtml(statusLabels[meta.status] || statusLabels.new)}</span>
    </div>

    <div class="detail-actions">
      <a class="primary-action" href="${escapeHtml(whatsappUrl)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>
      <button class="ghost-action" type="button" data-copy-lead="${escapeHtml(item.id)}">Salin Detail</button>
    </div>

    <div class="detail-block">
      <h3>Status</h3>
      <label>
        Tahap follow-up
        <select data-status-input="${escapeHtml(item.id)}">
          ${Object.entries(statusLabels)
            .map(([value, label]) => `<option value="${value}"${meta.status === value ? " selected" : ""}>${label}</option>`)
            .join("")}
        </select>
      </label>
    </div>

    <div class="detail-block">
      <h3>Catatan</h3>
      <textarea data-note-input="${escapeHtml(item.id)}" placeholder="Catatan follow-up, ukuran, budget, jadwal survey...">${escapeHtml(meta.note || "")}</textarea>
    </div>

    <div class="detail-block">
      <h3>Kebutuhan</h3>
      <p>${escapeHtml(lead.message || "-")}</p>
    </div>

    <div class="detail-block">
      <h3>Data Customer</h3>
      <div class="field-grid">
        <div><span>WhatsApp</span><strong>${escapeHtml(lead.phone || "-")}</strong></div>
        <div><span>Alamat</span><strong>${escapeHtml(lead.address || "-")}</strong></div>
        <div><span>Produk</span><strong>${escapeHtml(asText(lead.spaces) || "-")}</strong></div>
      </div>
    </div>

    <div class="detail-block">
      <h3>Field Form</h3>
      <div class="field-grid">${fieldRows || "<p>Tidak ada field tambahan.</p>"}</div>
    </div>
  `;
}

function render() {
  renderStats();
  renderLeadList();
  renderLeadDetail();
}

function getLeadSummary(item) {
  const lead = getLead(item);
  const meta = getLeadMeta(item.id);

  return [
    `Nama: ${lead.name || "-"}`,
    `WhatsApp: ${lead.phone || "-"}`,
    `Alamat: ${lead.address || "-"}`,
    `Produk: ${asText(lead.spaces) || "-"}`,
    `Kebutuhan: ${lead.message || "-"}`,
    `Status: ${statusLabels[meta.status] || statusLabels.new}`,
    `Catatan: ${meta.note || "-"}`,
  ].join("\n");
}

function exportCsv() {
  const rows = getVisibleSubmissions();
  const headers = ["tanggal", "nama", "whatsapp", "alamat", "produk", "kebutuhan", "status", "catatan", "state"];
  const csvRows = rows.map((item) => {
    const lead = getLead(item);
    const meta = getLeadMeta(item.id);
    return [
      formatDate(item.createdAt),
      lead.name,
      lead.phone,
      lead.address,
      asText(lead.spaces),
      lead.message,
      statusLabels[meta.status] || statusLabels.new,
      meta.note,
      item.state,
    ].map(toCsvCell);
  });

  const csv = [headers.map(toCsvCell), ...csvRows].map((row) => row.join(",")).join("\r\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `leads-bismillah-interior-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function toCsvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

configForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveConfig(formToConfig(configForm));
  showDashboard();
  fetchAdminData();
});

inlineConfigForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveConfig(formToConfig(inlineConfigForm));
  configPanel.hidden = true;
  fetchAdminData();
});

openConfigButton.addEventListener("click", () => {
  configPanel.hidden = !configPanel.hidden;
  fillConfigForm(inlineConfigForm);
});

clearConfigButton.addEventListener("click", () => {
  clearConfig();
  showSetup();
  setStatus("Konfigurasi dihapus.");
});

refreshButton.addEventListener("click", fetchAdminData);
exportButton.addEventListener("click", exportCsv);

searchInput.addEventListener("input", render);
statusFilter.addEventListener("change", render);
stateFilter.addEventListener("change", fetchAdminData);

leadList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-select-lead]");
  if (!button) return;

  appState.selectedId = button.dataset.selectLead;
  render();
});

leadDetail.addEventListener("change", (event) => {
  const statusInput = event.target.closest("[data-status-input]");
  if (!statusInput) return;

  updateLeadMeta(statusInput.dataset.statusInput, { status: statusInput.value });
  render();
});

leadDetail.addEventListener("input", (event) => {
  const noteInput = event.target.closest("[data-note-input]");
  if (!noteInput) return;

  updateLeadMeta(noteInput.dataset.noteInput, { note: noteInput.value });
});

leadDetail.addEventListener("click", async (event) => {
  const copyButton = event.target.closest("[data-copy-lead]");
  if (!copyButton) return;

  const item = appState.submissions.find((submission) => submission.id === copyButton.dataset.copyLead);
  if (!item) return;

  await navigator.clipboard.writeText(getLeadSummary(item));
  copyButton.textContent = "Tersalin";
  setTimeout(() => {
    copyButton.textContent = "Salin Detail";
  }, 1200);
});

appState.config = loadConfig();

if (appState.config) {
  showDashboard();
  fetchAdminData();
} else {
  showSetup();
}
