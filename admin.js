const leadStatusLabels = {
  new: "Belum dihubungi",
  contacted: "Sudah dihubungi",
  survey: "Survei",
  design: "Desain",
  won: "Deal",
  lost: "Tidak lanjut",
};

const projectStages = [
  ["follow_up", "Follow-up"],
  ["consultation", "Konsultasi selesai"],
  ["survey", "Survey selesai"],
  ["design_quote", "Penawaran desain"],
  ["design", "Desain berjalan"],
  ["awaiting_dp", "Menunggu DP"],
  ["dp_received", "DP diterima"],
  ["production", "Produksi"],
  ["installation", "Pemasangan"],
  ["completed", "Selesai"],
  ["on_hold", "Ditunda"],
  ["lost", "Tidak jadi"],
];

const projectStatusLabels = Object.fromEntries(projectStages);
const itemStatusLabels = {
  planning: "Perencanaan",
  approved: "Disetujui",
  production: "Produksi",
  ready: "Siap pasang",
  installed: "Terpasang",
};
const paymentTypeLabels = {
  design_fee: "Biaya desain",
  dp: "DP",
  installment: "Termin",
  final: "Pelunasan",
  other: "Pembayaran lain",
};
const eventTypeLabels = {
  project_created: "Project dibuat",
  status_changed: "Tahap diperbarui",
  project_updated: "Detail diperbarui",
  item_added: "Item ditambahkan",
  item_updated: "Item diperbarui",
  item_deleted: "Item dihapus",
  payment_added: "Pembayaran masuk",
  payment_deleted: "Pembayaran dihapus",
  note_added: "Catatan aktivitas",
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
const projectBoard = document.querySelector("[data-project-board]");
const projectDetail = document.querySelector("[data-project-detail]");
const leadSearch = document.querySelector("[data-lead-search]");
const leadStatusFilter = document.querySelector("[data-lead-status-filter]");
const projectSearch = document.querySelector("[data-project-search]");
const projectStatusFilter = document.querySelector("[data-project-status-filter]");
const viewTabs = [...document.querySelectorAll("[data-view-tab]")];
const viewPanels = [...document.querySelectorAll("[data-view-panel]")];

const appState = {
  activeView: "projects",
  leads: [],
  projects: [],
  leadStats: { total: 0, today: 0, week: 0, new: 0 },
  projectStats: { total: 0, active: 0, production: 0, installation: 0, completed: 0, outstanding: 0 },
  selectedLeadId: null,
  selectedProjectId: null,
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

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(date);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("62")) return digits;
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

function todayValue() {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
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

function setActiveView(view) {
  appState.activeView = view;
  viewTabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.viewTab === view));
  viewPanels.forEach((panel) => {
    panel.hidden = panel.dataset.viewPanel !== view;
  });
  renderStats();
  createIcons();
}

async function checkSession() {
  try {
    await api("/api/admin/session");
    showDashboard();
    await fetchDashboardData();
  } catch {
    showLogin();
  }
}

async function fetchDashboardData() {
  if (appState.loading) return;
  appState.loading = true;
  refreshButton.disabled = true;
  setStatus("Mengambil leads dan project dari SQLite...");

  const leadParams = new URLSearchParams({
    status: leadStatusFilter.value,
    search: leadSearch.value.trim(),
  });
  const projectParams = new URLSearchParams({
    status: projectStatusFilter.value,
    search: projectSearch.value.trim(),
  });

  try {
    const [leadResult, projectResult] = await Promise.all([
      api(`/api/admin/submissions?${leadParams}`),
      api(`/api/admin/projects?${projectParams}`),
    ]);
    appState.leads = leadResult.submissions || [];
    appState.projects = projectResult.projects || [];
    appState.leadStats = leadResult.stats || appState.leadStats;
    appState.projectStats = projectResult.stats || appState.projectStats;

    if (!appState.leads.some((item) => item.id === appState.selectedLeadId)) {
      appState.selectedLeadId = appState.leads[0]?.id || null;
    }
    if (!appState.projects.some((item) => item.id === appState.selectedProjectId)) {
      appState.selectedProjectId = appState.projects[0]?.id || null;
    }

    render();
    setStatus(
      `Diperbarui ${formatDateTime(projectResult.generatedAt)}. ${appState.leads.length} lead dan ${appState.projects.length} project ditampilkan.`,
    );
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
  document.querySelector("[data-stat-leads]").textContent = appState.leadStats.total || 0;
  document.querySelector("[data-stat-new]").textContent = appState.leadStats.new || 0;
  document.querySelector("[data-stat-active]").textContent = appState.projectStats.active || 0;
  document.querySelector("[data-stat-production]").textContent =
    (appState.projectStats.production || 0) + (appState.projectStats.installation || 0);
  document.querySelector("[data-stat-outstanding]").textContent = formatCurrency(appState.projectStats.outstanding);
  document.querySelector("[data-tab-lead-count]").textContent = appState.leadStats.total || 0;
  document.querySelector("[data-tab-project-count]").textContent = appState.projectStats.total || 0;
}

function renderLeadList() {
  if (!appState.leads.length) {
    leadList.innerHTML = '<div class="empty-list">Belum ada lead yang cocok dengan filter.</div>';
    return;
  }

  leadList.innerHTML = appState.leads
    .map((item) => {
      const lead = item.lead || {};
      const activeClass = item.id === appState.selectedLeadId ? " is-active" : "";
      return `
        <button class="lead-row${activeClass}" type="button" data-select-lead="${escapeHtml(item.id)}">
          <div class="lead-main">
            <div class="lead-title">
              <strong>${escapeHtml(lead.name || "Tanpa nama")}</strong>
              <span class="pill">${escapeHtml(leadStatusLabels[item.status] || leadStatusLabels.new)}</span>
              ${item.project ? `<span class="pill muted">${escapeHtml(item.project.code)}</span>` : ""}
            </div>
            <p>${escapeHtml(asText(lead.spaces) || "Furniture custom")}</p>
            <div class="lead-meta">
              <span>${escapeHtml(lead.phone || "-")}</span>
              <span>${escapeHtml(lead.address || "Kota belum diisi")}</span>
            </div>
          </div>
          <time class="lead-date">${escapeHtml(formatDateTime(item.createdAt))}</time>
        </button>`;
    })
    .join("");
}

function renderLeadDetail() {
  const item = appState.leads.find((lead) => lead.id === appState.selectedLeadId);
  if (!item) {
    leadDetail.innerHTML = '<div class="empty-detail"><p>Pilih salah satu lead untuk melihat detail.</p></div>';
    return;
  }

  const lead = item.lead || {};
  const phone = normalizePhone(lead.phone);
  const message = [
    `Halo ${lead.name || "Bapak/Ibu"}, kami dari Bismillah Interior.`,
    "Terima kasih sudah mengisi formulir konsultasi.",
    "Boleh kami lanjutkan diskusi kebutuhan interiornya?",
  ].join("\n");
  const whatsappUrl = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : "#";

  leadDetail.innerHTML = `
    <div class="detail-head">
      <div><h2>${escapeHtml(lead.name || "Tanpa nama")}</h2><p>${escapeHtml(formatDateTime(item.createdAt))}</p></div>
      <span class="pill">${escapeHtml(leadStatusLabels[item.status] || leadStatusLabels.new)}</span>
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
      <label>Tahap customer
        <select data-lead-status-input>
          ${Object.entries(leadStatusLabels)
            .map(([value, label]) => `<option value="${value}"${item.status === value ? " selected" : ""}>${label}</option>`)
            .join("")}
        </select>
      </label>
      <label>Catatan admin
        <textarea data-lead-note-input placeholder="Kebutuhan, ukuran, anggaran, atau jadwal survey...">${escapeHtml(item.note || "")}</textarea>
      </label>
      <button class="primary-action detail-save" type="button" data-save-lead="${escapeHtml(item.id)}">
        <i data-lucide="save"></i><span>Simpan Follow-up</span>
      </button>
    </div>
    <div class="detail-block conversion-block">
      <h3>Project</h3>
      ${
        item.project
          ? `<p>Lead sudah menjadi project <strong>${escapeHtml(item.project.code)}</strong>.</p>
             <button class="primary-action detail-save" type="button" data-open-project="${escapeHtml(item.project.id)}">
               <i data-lucide="folder-kanban"></i><span>Buka Project</span>
             </button>`
          : `<p>Buat project untuk mulai mencatat jadwal, pembayaran, produksi, dan pemasangan.</p>
             <button class="primary-action detail-save" type="button" data-convert-lead="${escapeHtml(item.id)}">
               <i data-lucide="folder-plus"></i><span>Jadikan Project</span>
             </button>`
      }
    </div>
    <div class="detail-block"><h3>Kebutuhan Customer</h3><p>${escapeHtml(lead.message || "Belum ada catatan tambahan.")}</p></div>
    <div class="detail-block">
      <h3>Data Customer</h3>
      <div class="field-grid">
        <div><span>WhatsApp</span><strong>${escapeHtml(lead.phone || "-")}</strong></div>
        <div><span>Kota / Kecamatan</span><strong>${escapeHtml(lead.address || "-")}</strong></div>
        <div><span>Produk</span><strong>${escapeHtml(asText(lead.spaces) || "-")}</strong></div>
      </div>
    </div>`;
  createIcons();
}

function projectCard(project) {
  const financial = project.financial || {};
  const schedule = project.schedule || {};
  return `
    <button class="project-card${project.id === appState.selectedProjectId ? " is-active" : ""}" type="button"
      draggable="true" data-project-id="${escapeHtml(project.id)}">
      <span class="project-code">${escapeHtml(project.code)}</span>
      <strong>${escapeHtml(project.customer?.name || "Tanpa nama")}</strong>
      <p>${escapeHtml(project.title)}</p>
      <div class="project-card-meta">
        <span>${escapeHtml(formatCurrency(financial.projectValue))}</span>
        <span>${schedule.targetCompletionDate ? escapeHtml(formatDate(schedule.targetCompletionDate)) : "Belum dijadwalkan"}</span>
      </div>
    </button>`;
}

function renderProjectBoard() {
  const stages = projectStatusFilter.value === "all"
    ? projectStages
    : projectStages.filter(([status]) => status === projectStatusFilter.value);

  projectBoard.innerHTML = stages
    .map(([status, label]) => {
      const projects = appState.projects.filter((project) => project.status === status);
      return `
        <section class="kanban-column" data-drop-status="${status}">
          <header><span>${escapeHtml(label)}</span><strong>${projects.length}</strong></header>
          <div class="kanban-cards">
            ${projects.length ? projects.map(projectCard).join("") : '<p class="kanban-empty">Belum ada project</p>'}
          </div>
        </section>`;
    })
    .join("");

  const selectedCard = projectBoard.querySelector(".project-card.is-active");
  const selectedColumn = selectedCard?.closest(".kanban-column");
  const shell = projectBoard.closest(".kanban-shell");
  if (selectedColumn && shell) {
    shell.scrollLeft = Math.max(selectedColumn.offsetLeft - 10, 0);
  }
}

function statusOptions(selected) {
  return projectStages
    .map(([value, label]) => `<option value="${value}"${selected === value ? " selected" : ""}>${label}</option>`)
    .join("");
}

function itemStatusOptions(selected) {
  return Object.entries(itemStatusLabels)
    .map(([value, label]) => `<option value="${value}"${selected === value ? " selected" : ""}>${label}</option>`)
    .join("");
}

function paymentTypeOptions(selected = "dp") {
  return Object.entries(paymentTypeLabels)
    .map(([value, label]) => `<option value="${value}"${selected === value ? " selected" : ""}>${label}</option>`)
    .join("");
}

function renderItems(project) {
  const items = project.items || [];
  const rows = items.length
    ? items
        .map(
          (item) => `
          <form class="item-editor" data-item-form data-item-id="${escapeHtml(item.id)}">
            <div class="item-editor-head">
              <input name="name" value="${escapeHtml(item.name)}" aria-label="Nama item" required />
              <div class="icon-actions">
                <button class="icon-action" type="submit" title="Simpan item"><i data-lucide="save"></i></button>
                <button class="icon-action danger" type="button" data-delete-item="${escapeHtml(item.id)}" title="Hapus item"><i data-lucide="trash-2"></i></button>
              </div>
            </div>
            <div class="compact-grid">
              <label>Jumlah<input name="quantity" type="number" min="1" value="${escapeHtml(item.quantity)}" required /></label>
              <label>Status<select name="status">${itemStatusOptions(item.status)}</select></label>
              <label>Ukuran<input name="dimensions" value="${escapeHtml(item.dimensions)}" placeholder="Contoh 300 x 60 cm" /></label>
              <label>Material<input name="material" value="${escapeHtml(item.material)}" placeholder="HPL motif kayu" /></label>
              <label class="span-two">Harga<input name="price" type="number" min="0" value="${escapeHtml(item.price)}" /></label>
            </div>
          </form>`,
        )
        .join("")
    : '<p class="empty-inline">Belum ada item furniture.</p>';

  return `${rows}
    <details class="add-panel">
      <summary><i data-lucide="plus"></i> Tambah item furniture</summary>
      <form class="stack-form" data-add-item-form>
        <label>Nama item<input name="name" placeholder="Contoh: Kitchen set HPL" required /></label>
        <div class="compact-grid">
          <label>Jumlah<input name="quantity" type="number" min="1" value="1" required /></label>
          <label>Status<select name="status">${itemStatusOptions("planning")}</select></label>
          <label>Ukuran<input name="dimensions" placeholder="Panjang x lebar x tinggi" /></label>
          <label>Material<input name="material" placeholder="Jenis HPL dan material" /></label>
          <label class="span-two">Harga<input name="price" type="number" min="0" value="0" /></label>
        </div>
        <button class="primary-action" type="submit"><i data-lucide="plus"></i><span>Tambahkan Item</span></button>
      </form>
    </details>`;
}

function renderPayments(project) {
  const payments = project.payments || [];
  const rows = payments.length
    ? payments
        .map(
          (payment) => `
          <div class="payment-row">
            <div>
              <strong>${escapeHtml(paymentTypeLabels[payment.type] || "Pembayaran")}</strong>
              <span>${escapeHtml(formatDate(payment.paidAt))}${payment.method ? ` - ${escapeHtml(payment.method)}` : ""}</span>
              ${payment.note ? `<p>${escapeHtml(payment.note)}</p>` : ""}
            </div>
            <div class="payment-amount">
              <strong>${escapeHtml(formatCurrency(payment.amount))}</strong>
              <button class="icon-action danger" type="button" data-delete-payment="${escapeHtml(payment.id)}" title="Hapus pembayaran"><i data-lucide="trash-2"></i></button>
            </div>
          </div>`,
        )
        .join("")
    : '<p class="empty-inline">Belum ada pembayaran tercatat.</p>';

  return `${rows}
    <details class="add-panel">
      <summary><i data-lucide="wallet-cards"></i> Catat pembayaran</summary>
      <form class="stack-form" data-payment-form>
        <div class="compact-grid">
          <label>Jenis<select name="type">${paymentTypeOptions()}</select></label>
          <label>Tanggal<input name="paidAt" type="date" value="${todayValue()}" required /></label>
          <label class="span-two">Nominal<input name="amount" type="number" min="1" placeholder="5000000" required /></label>
          <label>Metode<input name="method" placeholder="Transfer / Tunai" /></label>
          <label>Catatan<input name="note" placeholder="Referensi pembayaran" /></label>
        </div>
        <button class="primary-action" type="submit"><i data-lucide="circle-dollar-sign"></i><span>Simpan Pembayaran</span></button>
      </form>
    </details>`;
}

function eventDescription(event) {
  if (event.type === "status_changed") {
    const from = projectStatusLabels[event.fromStatus] || event.fromStatus || "awal";
    const to = projectStatusLabels[event.toStatus] || event.toStatus || "baru";
    return `${from} -> ${to}${event.note ? ` - ${event.note}` : ""}`;
  }
  return event.note || eventTypeLabels[event.type] || "Aktivitas project";
}

function renderTimeline(project) {
  const events = project.events || [];
  const rows = events.length
    ? events
        .map(
          (event) => `
          <div class="timeline-row">
            <span></span>
            <div>
              <strong>${escapeHtml(eventTypeLabels[event.type] || "Aktivitas")}</strong>
              <p>${escapeHtml(eventDescription(event))}</p>
              <time>${escapeHtml(formatDateTime(event.createdAt))} - ${escapeHtml(event.actor || "admin")}</time>
            </div>
          </div>`,
        )
        .join("")
    : '<p class="empty-inline">Belum ada aktivitas.</p>';

  return `${rows}
    <form class="note-form" data-note-form>
      <input name="note" placeholder="Tambahkan catatan aktivitas..." required />
      <button class="icon-action" type="submit" title="Tambah catatan"><i data-lucide="send"></i></button>
    </form>`;
}

function renderProjectDetail() {
  const project = appState.projects.find((item) => item.id === appState.selectedProjectId);
  if (!project) {
    projectDetail.innerHTML = '<div class="empty-detail"><i data-lucide="folder-kanban"></i><p>Pilih project untuk melihat detail.</p></div>';
    createIcons();
    return;
  }

  const customer = project.customer || {};
  const financial = project.financial || {};
  const schedule = project.schedule || {};
  const phone = normalizePhone(customer.phone);
  const message = `Halo ${customer.name || "Bapak/Ibu"}, berikut pembaruan project ${project.code} dari Bismillah Interior.`;
  const whatsappUrl = phone ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : "#";

  projectDetail.innerHTML = `
    <div class="detail-head project-detail-head">
      <div><span class="project-code">${escapeHtml(project.code)}</span><h2>${escapeHtml(customer.name || "Tanpa nama")}</h2><p>${escapeHtml(customer.address || "Alamat belum tersedia")}</p></div>
      <span class="pill status-${escapeHtml(project.status)}">${escapeHtml(projectStatusLabels[project.status] || project.status)}</span>
    </div>
    <div class="detail-actions">
      <a class="primary-action" href="${escapeHtml(whatsappUrl)}" target="_blank" rel="noopener noreferrer"><i data-lucide="message-circle"></i><span>WhatsApp</span></a>
      <button class="ghost-action" type="button" data-copy-project><i data-lucide="copy"></i><span>Salin Ringkasan</span></button>
    </div>
    <div class="finance-strip">
      <div><span>Nilai project</span><strong>${escapeHtml(formatCurrency(financial.projectValue))}</strong></div>
      <div><span>Sudah dibayar</span><strong>${escapeHtml(formatCurrency(financial.paid))}</strong></div>
      <div class="balance"><span>Sisa tagihan</span><strong>${escapeHtml(formatCurrency(financial.balance))}</strong></div>
    </div>
    <form class="detail-block project-form" data-project-form>
      <h3>Informasi Project</h3>
      <label>Nama project<input name="title" value="${escapeHtml(project.title)}" required /></label>
      <div class="compact-grid">
        <label>Tahap<select name="status">${statusOptions(project.status)}</select></label>
        <label>Biaya desain<input name="designFee" type="number" min="0" value="${escapeHtml(financial.designFee)}" /></label>
        <label class="span-two">Nilai project<input name="projectValue" type="number" min="0" value="${escapeHtml(financial.projectValue)}" /></label>
      </div>
      <h4>Jadwal</h4>
      <div class="compact-grid date-grid">
        <label>Konsultasi<input name="consultationDate" type="date" value="${escapeHtml(schedule.consultationDate || "")}" /></label>
        <label>Survey<input name="surveyDate" type="date" value="${escapeHtml(schedule.surveyDate || "")}" /></label>
        <label>Mulai produksi<input name="productionStartDate" type="date" value="${escapeHtml(schedule.productionStartDate || "")}" /></label>
        <label>Pemasangan<input name="installationDate" type="date" value="${escapeHtml(schedule.installationDate || "")}" /></label>
        <label class="span-two">Target selesai<input name="targetCompletionDate" type="date" value="${escapeHtml(schedule.targetCompletionDate || "")}" /></label>
      </div>
      <label>Catatan internal<textarea name="notes" placeholder="Keputusan desain, kendala, atau kebutuhan khusus...">${escapeHtml(project.notes || "")}</textarea></label>
      <button class="primary-action detail-save" type="submit"><i data-lucide="save"></i><span>Simpan Project</span></button>
    </form>
    <div class="detail-block"><h3>Item Furniture</h3>${renderItems(project)}</div>
    <div class="detail-block"><h3>Pembayaran</h3>${renderPayments(project)}</div>
    <div class="detail-block"><h3>Timeline Aktivitas</h3><div class="timeline">${renderTimeline(project)}</div></div>
    <div class="detail-block"><h3>Customer</h3><div class="field-grid">
      <div><span>WhatsApp</span><strong>${escapeHtml(customer.phone || "-")}</strong></div>
      <div><span>Alamat</span><strong>${escapeHtml(customer.address || "-")}</strong></div>
      <div><span>Kebutuhan awal</span><strong>${escapeHtml(asText(customer.spaces) || "-")}</strong></div>
    </div></div>`;
  createIcons();
}

function render() {
  renderStats();
  renderLeadList();
  renderLeadDetail();
  renderProjectBoard();
  renderProjectDetail();
  setActiveView(appState.activeView);
}

function replaceProject(project) {
  const index = appState.projects.findIndex((item) => item.id === project.id);
  if (index >= 0) appState.projects[index] = project;
  else appState.projects.unshift(project);
  const lead = appState.leads.find((item) => item.id === project.submissionId);
  if (lead) lead.project = { id: project.id, code: project.code, status: project.status };
  appState.selectedProjectId = project.id;
}

function leadSummary(item) {
  const lead = item.lead || {};
  return [
    `Nama: ${lead.name || "-"}`,
    `WhatsApp: ${lead.phone || "-"}`,
    `Kota/Kecamatan: ${lead.address || "-"}`,
    `Produk: ${asText(lead.spaces) || "-"}`,
    `Kebutuhan: ${lead.message || "-"}`,
    `Status: ${leadStatusLabels[item.status] || leadStatusLabels.new}`,
    `Catatan: ${item.note || "-"}`,
  ].join("\n");
}

function projectSummary(project) {
  return [
    `${project.code} - ${project.title}`,
    `Customer: ${project.customer?.name || "-"}`,
    `WhatsApp: ${project.customer?.phone || "-"}`,
    `Tahap: ${projectStatusLabels[project.status] || project.status}`,
    `Nilai: ${formatCurrency(project.financial?.projectValue)}`,
    `Dibayar: ${formatCurrency(project.financial?.paid)}`,
    `Sisa: ${formatCurrency(project.financial?.balance)}`,
    `Target selesai: ${formatDate(project.schedule?.targetCompletionDate)}`,
  ].join("\n");
}

async function saveLead(itemId) {
  const item = appState.leads.find((lead) => lead.id === itemId);
  if (!item) return;
  const status = leadDetail.querySelector("[data-lead-status-input]").value;
  const note = leadDetail.querySelector("[data-lead-note-input]").value.trim();
  const button = leadDetail.querySelector("[data-save-lead]");
  button.disabled = true;
  try {
    const result = await api(`/api/admin/submissions/${encodeURIComponent(itemId)}`, {
      method: "PATCH",
      body: JSON.stringify({ status, note }),
    });
    const index = appState.leads.findIndex((lead) => lead.id === itemId);
    appState.leads[index] = result.submission;
    await fetchDashboardData();
    setStatus(`Follow-up ${result.submission.lead.name} berhasil disimpan.`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function convertLead(itemId) {
  const button = leadDetail.querySelector("[data-convert-lead]");
  if (button) button.disabled = true;
  try {
    const result = await api("/api/admin/projects", {
      method: "POST",
      body: JSON.stringify({ submissionId: itemId }),
    });
    projectStatusFilter.value = "all";
    replaceProject(result.project);
    appState.activeView = "projects";
    await fetchDashboardData();
    appState.selectedProjectId = result.project.id;
    render();
    setStatus(`${result.project.code} berhasil dibuat dan masuk ke pipeline.`);
  } catch (error) {
    setStatus(error.message, true);
    if (button) button.disabled = false;
  }
}

async function updateProject(projectId, payload, message) {
  try {
    const result = await api(`/api/admin/projects/${encodeURIComponent(projectId)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    replaceProject(result.project);
    render();
    setStatus(message || `${result.project.code} berhasil diperbarui.`);
    return result.project;
  } catch (error) {
    setStatus(error.message, true);
    return null;
  }
}

async function refreshProjectStats() {
  const params = new URLSearchParams({ status: projectStatusFilter.value, search: projectSearch.value.trim() });
  const result = await api(`/api/admin/projects?${params}`);
  appState.projects = result.projects || [];
  appState.projectStats = result.stats || appState.projectStats;
  if (!appState.projects.some((item) => item.id === appState.selectedProjectId)) {
    appState.selectedProjectId = appState.projects[0]?.id || null;
  }
  render();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = loginForm.querySelector("button[type='submit']");
  const formData = new FormData(loginForm);
  button.disabled = true;
  loginStatus.textContent = "Memeriksa akses...";
  loginStatus.classList.remove("is-error");
  try {
    await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ username: formData.get("username"), password: formData.get("password") }),
    });
    loginForm.reset();
    showDashboard();
    await fetchDashboardData();
  } catch (error) {
    loginStatus.textContent = error.message;
    loginStatus.classList.add("is-error");
  } finally {
    button.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  try {
    await api("/api/admin/logout", { method: "POST" });
  } finally {
    appState.leads = [];
    appState.projects = [];
    showLogin();
  }
});

refreshButton.addEventListener("click", fetchDashboardData);
exportButton.addEventListener("click", () => {
  const isProject = appState.activeView === "projects";
  const params = new URLSearchParams({
    status: isProject ? projectStatusFilter.value : leadStatusFilter.value,
    search: isProject ? projectSearch.value.trim() : leadSearch.value.trim(),
  });
  const endpoint = isProject ? "/api/admin/projects-export.csv" : "/api/admin/export.csv";
  window.location.assign(`${endpoint}?${params}`);
});

viewTabs.forEach((tab) => tab.addEventListener("click", () => setActiveView(tab.dataset.viewTab)));

let searchTimer = null;
function queueRefresh() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(fetchDashboardData, 350);
}
leadSearch.addEventListener("input", queueRefresh);
projectSearch.addEventListener("input", queueRefresh);
leadStatusFilter.addEventListener("change", fetchDashboardData);
projectStatusFilter.addEventListener("change", fetchDashboardData);

leadList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-select-lead]");
  if (!button) return;
  appState.selectedLeadId = button.dataset.selectLead;
  renderLeadList();
  renderLeadDetail();
});

leadDetail.addEventListener("click", async (event) => {
  const saveButton = event.target.closest("[data-save-lead]");
  if (saveButton) return saveLead(saveButton.dataset.saveLead);

  const convertButton = event.target.closest("[data-convert-lead]");
  if (convertButton) return convertLead(convertButton.dataset.convertLead);

  const openButton = event.target.closest("[data-open-project]");
  if (openButton) {
    projectStatusFilter.value = "all";
    appState.selectedProjectId = openButton.dataset.openProject;
    appState.activeView = "projects";
    await refreshProjectStats();
    return;
  }

  const copyButton = event.target.closest("[data-copy-lead]");
  if (!copyButton) return;
  const item = appState.leads.find((lead) => lead.id === copyButton.dataset.copyLead);
  if (!item) return;
  await navigator.clipboard.writeText(leadSummary(item));
  copyButton.querySelector("span").textContent = "Tersalin";
  setTimeout(() => (copyButton.querySelector("span").textContent = "Salin Detail"), 1200);
});

projectBoard.addEventListener("click", (event) => {
  const card = event.target.closest("[data-project-id]");
  if (!card) return;
  appState.selectedProjectId = card.dataset.projectId;
  renderProjectBoard();
  renderProjectDetail();
});

let draggedProjectId = null;
projectBoard.addEventListener("dragstart", (event) => {
  const card = event.target.closest("[data-project-id]");
  if (!card) return;
  draggedProjectId = card.dataset.projectId;
  card.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
});
projectBoard.addEventListener("dragend", (event) => {
  event.target.closest("[data-project-id]")?.classList.remove("is-dragging");
  draggedProjectId = null;
});
projectBoard.addEventListener("dragover", (event) => {
  const column = event.target.closest("[data-drop-status]");
  if (!column) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
});
projectBoard.addEventListener("drop", async (event) => {
  const column = event.target.closest("[data-drop-status]");
  if (!column || !draggedProjectId) return;
  event.preventDefault();
  const project = appState.projects.find((item) => item.id === draggedProjectId);
  if (!project || project.status === column.dataset.dropStatus) return;
  const movedId = draggedProjectId;
  draggedProjectId = null;
  await updateProject(movedId, { status: column.dataset.dropStatus, statusNote: "Dipindahkan melalui pipeline." });
  await refreshProjectStats();
});

projectDetail.addEventListener("submit", async (event) => {
  event.preventDefault();
  const project = appState.projects.find((item) => item.id === appState.selectedProjectId);
  if (!project) return;
  const form = event.target;
  const formData = new FormData(form);
  const submitButton = form.querySelector("button[type='submit']");
  if (submitButton) submitButton.disabled = true;

  try {
    if (form.matches("[data-project-form]")) {
      const updatedProject = await updateProject(project.id, {
        title: formData.get("title"),
        status: formData.get("status"),
        projectValue: Number(formData.get("projectValue")) || 0,
        designFee: Number(formData.get("designFee")) || 0,
        notes: formData.get("notes"),
        schedule: {
          consultationDate: formData.get("consultationDate"),
          surveyDate: formData.get("surveyDate"),
          productionStartDate: formData.get("productionStartDate"),
          installationDate: formData.get("installationDate"),
          targetCompletionDate: formData.get("targetCompletionDate"),
        },
      });
      if (updatedProject) await refreshProjectStats();
    } else if (form.matches("[data-add-item-form]")) {
      const result = await api(`/api/admin/projects/${project.id}/items`, {
        method: "POST",
        body: JSON.stringify({
          name: formData.get("name"),
          quantity: Number(formData.get("quantity")),
          status: formData.get("status"),
          dimensions: formData.get("dimensions"),
          material: formData.get("material"),
          price: Number(formData.get("price")) || 0,
        }),
      });
      replaceProject(result.project);
      render();
      setStatus("Item furniture berhasil ditambahkan.");
    } else if (form.matches("[data-item-form]")) {
      const result = await api(`/api/admin/projects/${project.id}/items/${form.dataset.itemId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: formData.get("name"),
          quantity: Number(formData.get("quantity")),
          status: formData.get("status"),
          dimensions: formData.get("dimensions"),
          material: formData.get("material"),
          price: Number(formData.get("price")) || 0,
        }),
      });
      replaceProject(result.project);
      render();
      setStatus("Item furniture berhasil diperbarui.");
    } else if (form.matches("[data-payment-form]")) {
      const result = await api(`/api/admin/projects/${project.id}/payments`, {
        method: "POST",
        body: JSON.stringify({
          type: formData.get("type"),
          amount: Number(formData.get("amount")),
          paidAt: formData.get("paidAt"),
          method: formData.get("method"),
          note: formData.get("note"),
        }),
      });
      replaceProject(result.project);
      await refreshProjectStats();
      setStatus("Pembayaran berhasil dicatat.");
    } else if (form.matches("[data-note-form]")) {
      const result = await api(`/api/admin/projects/${project.id}/events`, {
        method: "POST",
        body: JSON.stringify({ note: formData.get("note") }),
      });
      replaceProject(result.project);
      render();
      setStatus("Catatan aktivitas berhasil ditambahkan.");
    }
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    if (submitButton?.isConnected) submitButton.disabled = false;
  }
});

projectDetail.addEventListener("click", async (event) => {
  const project = appState.projects.find((item) => item.id === appState.selectedProjectId);
  if (!project) return;

  const copyButton = event.target.closest("[data-copy-project]");
  if (copyButton) {
    await navigator.clipboard.writeText(projectSummary(project));
    copyButton.querySelector("span").textContent = "Tersalin";
    setTimeout(() => (copyButton.querySelector("span").textContent = "Salin Ringkasan"), 1200);
    return;
  }

  const itemButton = event.target.closest("[data-delete-item]");
  if (itemButton && window.confirm("Hapus item furniture ini dari project?")) {
    try {
      const result = await api(`/api/admin/projects/${project.id}/items/${itemButton.dataset.deleteItem}`, { method: "DELETE" });
      replaceProject(result.project);
      render();
      setStatus("Item furniture dihapus.");
    } catch (error) {
      setStatus(error.message, true);
    }
    return;
  }

  const paymentButton = event.target.closest("[data-delete-payment]");
  if (paymentButton && window.confirm("Hapus catatan pembayaran ini?")) {
    try {
      const result = await api(`/api/admin/projects/${project.id}/payments/${paymentButton.dataset.deletePayment}`, { method: "DELETE" });
      replaceProject(result.project);
      await refreshProjectStats();
      setStatus("Catatan pembayaran dihapus.");
    } catch (error) {
      setStatus(error.message, true);
    }
  }
});

createIcons();
checkSession();
