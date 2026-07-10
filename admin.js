const statusLabels = {
  new: "Belum dihubungi",
  contacted: "Sudah dihubungi",
  survey: "Survei",
  design: "Desain",
  won: "Deal",
  lost: "Tidak lanjut",
};

const loginView = document.querySelector("[data-login-view]");
const dashboardView = document.querySelector("[data-dashboard-view]");
const loginForm = document.querySelector("[data-login-form]");
const loginStatus = document.querySelector("[data-login-status]");
const refreshButton = document.querySelector("[data-refresh]");
const exportButton = document.querySelector("[data-export]");
const logoutButton = document.querySelector("[data-logout]");
const statusLine = document.querySelector("[data-status-line]");
const leadList = document.querySelector("[data-lead-list]");
const leadDetail = document.querySelector("[data-lead-detail]");
const searchInput = document.querySelector("[data-search]");
const statusFilter = document.querySelector("[data-status-filter]");

const appState = {
  submissions: [],
  stats: { total: 0, today: 0, week: 0, new: 0 },
  selectedId: null,
  loading: false,
};

function createIcons() {
  window.lucide?.createIcons({ attrs: { "stroke-width": 2 } });
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

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      "X-Requested-With": "BismillahInteriorAdmin",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(result.message || "Permintaan tidak dapat diproses.");
    error.status = response.status;
    throw error;
  }

  return result;
}

function showLogin(message = "") {
  loginView.hidden = false;
  dashboardView.hidden = true;
  loginStatus.textContent = message;
  loginStatus.classList.toggle("is-error", Boolean(message));
  loginForm.elements.password.value = "";
  loginForm.elements.username.focus();
  createIcons();
}

function showDashboard() {
  loginView.hidden = true;
  dashboardView.hidden = false;
  createIcons();
}

function setStatus(message, isError = false) {
  statusLine.textContent = message;
  statusLine.classList.toggle("is-error", isError);
}

async function checkSession() {
  try {
    await api("/api/admin/session");
    showDashboard();
    await fetchAdminData();
  } catch {
    showLogin();
  }
}

async function fetchAdminData() {
  if (appState.loading) return;
  appState.loading = true;
  refreshButton.disabled = true;
  setStatus("Mengambil data customer dari SQLite...");

  const params = new URLSearchParams({
    status: statusFilter.value,
    search: searchInput.value.trim(),
  });

  try {
    const result = await api(`/api/admin/submissions?${params.toString()}`);
    appState.submissions = result.submissions || [];
    appState.stats = result.stats || appState.stats;

    if (!appState.submissions.some((item) => item.id === appState.selectedId)) {
      appState.selectedId = appState.submissions[0]?.id || null;
    }

    render();
    setStatus(`Data diperbarui ${formatDate(result.generatedAt)}. ${appState.submissions.length} lead ditampilkan.`);
  } catch (error) {
    if (error.status === 401) {
      showLogin("Sesi admin berakhir. Silakan masuk kembali.");
      return;
    }
    setStatus(error.message, true);
  } finally {
    appState.loading = false;
    refreshButton.disabled = false;
  }
}

function renderStats() {
  document.querySelector("[data-stat-total]").textContent = appState.stats.total || 0;
  document.querySelector("[data-stat-today]").textContent = appState.stats.today || 0;
  document.querySelector("[data-stat-week]").textContent = appState.stats.week || 0;
  document.querySelector("[data-stat-new]").textContent = appState.stats.new || 0;
}

function renderLeadList() {
  if (!appState.submissions.length) {
    leadList.innerHTML = '<div class="empty-list">Belum ada data yang cocok dengan filter.</div>';
    return;
  }

  leadList.innerHTML = appState.submissions
    .map((item) => {
      const lead = item.lead || {};
      const isActive = item.id === appState.selectedId ? " is-active" : "";

      return `
        <button class="lead-row${isActive}" type="button" data-select-lead="${escapeHtml(item.id)}">
          <div class="lead-main">
            <div class="lead-title">
              <strong>${escapeHtml(lead.name || "Tanpa nama")}</strong>
              <span class="pill">${escapeHtml(statusLabels[item.status] || statusLabels.new)}</span>
            </div>
            <p>${escapeHtml(asText(lead.spaces) || "Furnitur custom")}</p>
            <div class="lead-meta">
              <span>${escapeHtml(lead.phone || "-")}</span>
              <span>${escapeHtml(lead.address || "Kota belum diisi")}</span>
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
    leadDetail.innerHTML = '<div class="empty-detail"><p>Pilih salah satu lead untuk melihat detail.</p></div>';
    return;
  }

  const lead = item.lead || {};
  const phone = normalizePhone(lead.phone);
  const whatsappMessage = [
    `Halo ${lead.name || "Bapak/Ibu"}, kami dari Bismillah Interior.`,
    "Terima kasih sudah mengisi formulir konsultasi.",
    "Boleh kami lanjutkan diskusi kebutuhan interiornya?",
  ].join("\n");
  const whatsappUrl = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(whatsappMessage)}` : "#";

  leadDetail.innerHTML = `
    <div class="detail-head">
      <div>
        <h2>${escapeHtml(lead.name || "Tanpa nama")}</h2>
        <p>${escapeHtml(formatDate(item.createdAt))}</p>
      </div>
      <span class="pill">${escapeHtml(statusLabels[item.status] || statusLabels.new)}</span>
    </div>

    <div class="detail-actions">
      <a class="primary-action" href="${escapeHtml(whatsappUrl)}" target="_blank" rel="noopener noreferrer">
        <i data-lucide="message-circle"></i><span>WhatsApp</span>
      </a>
      <button class="ghost-action" type="button" data-copy-lead="${escapeHtml(item.id)}">
        <i data-lucide="copy"></i><span>Salin Detail</span>
      </button>
    </div>

    <div class="detail-block">
      <h3>Follow-up</h3>
      <label>
        Tahap customer
        <select data-status-input>
          ${Object.entries(statusLabels)
            .map(([value, label]) => `<option value="${value}"${item.status === value ? " selected" : ""}>${label}</option>`)
            .join("")}
        </select>
      </label>
    </div>

    <div class="detail-block">
      <h3>Catatan Admin</h3>
      <textarea data-note-input placeholder="Catatan kebutuhan, ukuran, anggaran, atau jadwal survei...">${escapeHtml(item.note || "")}</textarea>
      <button class="primary-action detail-save" type="button" data-save-lead="${escapeHtml(item.id)}">
        <i data-lucide="save"></i><span>Simpan Follow-up</span>
      </button>
    </div>

    <div class="detail-block">
      <h3>Kebutuhan Customer</h3>
      <p>${escapeHtml(lead.message || "Belum ada catatan tambahan.")}</p>
    </div>

    <div class="detail-block">
      <h3>Data Customer</h3>
      <div class="field-grid">
        <div><span>WhatsApp</span><strong>${escapeHtml(lead.phone || "-")}</strong></div>
        <div><span>Kota / Kecamatan</span><strong>${escapeHtml(lead.address || "-")}</strong></div>
        <div><span>Produk</span><strong>${escapeHtml(asText(lead.spaces) || "-")}</strong></div>
      </div>
    </div>
  `;

  createIcons();
}

function render() {
  renderStats();
  renderLeadList();
  renderLeadDetail();
}

function getLeadSummary(item) {
  const lead = item.lead || {};
  return [
    `Nama: ${lead.name || "-"}`,
    `WhatsApp: ${lead.phone || "-"}`,
    `Kota/Kecamatan: ${lead.address || "-"}`,
    `Produk: ${asText(lead.spaces) || "-"}`,
    `Kebutuhan: ${lead.message || "-"}`,
    `Status: ${statusLabels[item.status] || statusLabels.new}`,
    `Catatan: ${item.note || "-"}`,
  ].join("\n");
}

async function saveLead(itemId) {
  const item = appState.submissions.find((submission) => submission.id === itemId);
  if (!item) return;

  const status = leadDetail.querySelector("[data-status-input]").value;
  const note = leadDetail.querySelector("[data-note-input]").value.trim();
  const saveButton = leadDetail.querySelector("[data-save-lead]");
  saveButton.disabled = true;

  try {
    const result = await api(`/api/admin/submissions/${encodeURIComponent(itemId)}`, {
      method: "PATCH",
      body: JSON.stringify({ status, note }),
    });
    const index = appState.submissions.findIndex((submission) => submission.id === itemId);
    const previousStatus = appState.submissions[index].status;
    appState.submissions[index] = result.submission;

    if (previousStatus === "new" && result.submission.status !== "new") {
      appState.stats.new = Math.max(0, appState.stats.new - 1);
    } else if (previousStatus !== "new" && result.submission.status === "new") {
      appState.stats.new += 1;
    }

    render();
    setStatus(`Follow-up ${result.submission.lead.name} berhasil disimpan.`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    saveButton.disabled = false;
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitButton = loginForm.querySelector("button[type='submit']");
  const formData = new FormData(loginForm);
  submitButton.disabled = true;
  loginStatus.textContent = "Memeriksa akses...";
  loginStatus.classList.remove("is-error");

  try {
    await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({
        username: String(formData.get("username") || ""),
        password: String(formData.get("password") || ""),
      }),
    });
    loginForm.reset();
    showDashboard();
    await fetchAdminData();
  } catch (error) {
    loginStatus.textContent = error.message;
    loginStatus.classList.add("is-error");
  } finally {
    submitButton.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  try {
    await api("/api/admin/logout", { method: "POST" });
  } finally {
    appState.submissions = [];
    appState.selectedId = null;
    showLogin();
  }
});

refreshButton.addEventListener("click", fetchAdminData);

exportButton.addEventListener("click", () => {
  const params = new URLSearchParams({
    status: statusFilter.value,
    search: searchInput.value.trim(),
  });
  window.location.assign(`/api/admin/export.csv?${params.toString()}`);
});

let searchTimer = null;
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(fetchAdminData, 350);
});

statusFilter.addEventListener("change", fetchAdminData);

leadList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-select-lead]");
  if (!button) return;
  appState.selectedId = button.dataset.selectLead;
  render();
});

leadDetail.addEventListener("click", async (event) => {
  const saveButton = event.target.closest("[data-save-lead]");
  if (saveButton) {
    await saveLead(saveButton.dataset.saveLead);
    return;
  }

  const copyButton = event.target.closest("[data-copy-lead]");
  if (!copyButton) return;
  const item = appState.submissions.find((submission) => submission.id === copyButton.dataset.copyLead);
  if (!item) return;

  await navigator.clipboard.writeText(getLeadSummary(item));
  copyButton.querySelector("span").textContent = "Tersalin";
  setTimeout(() => {
    copyButton.querySelector("span").textContent = "Salin Detail";
  }, 1200);
});

createIcons();
checkSession();
