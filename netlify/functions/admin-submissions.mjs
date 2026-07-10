const API_BASE = "https://api.netlify.com/api/v1";
const DEFAULT_FORM_NAME = "bismillah-interior-contact";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders,
  });
}

function pick(data, keys) {
  for (const key of keys) {
    const value = data?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }

  return "";
}

function asText(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value ?? "").trim();
}

async function readBody(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function fetchNetlify(path, token) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      "user-agent": "BismillahInteriorAdmin/1.0",
    },
  });
  const body = await readBody(response);

  if (!response.ok) {
    const message = typeof body === "string" ? body : body?.message || body?.error || "Netlify API request failed.";
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return body;
}

function normalizeSubmission(submission, stateFallback = "verified") {
  const data = submission.data || {};
  const selectedSpaces = pick(data, ["selectedSpaces", "spaces"]);
  const spaces = selectedSpaces || [data.otherSpace].filter(Boolean).join(", ");

  return {
    id: submission.id,
    number: submission.number,
    title: submission.title || submission.name || "",
    state: submission.state || stateFallback,
    formId: submission.form_id,
    formName: submission.form_name,
    createdAt: submission.created_at || submission.createdAt,
    email: submission.email || data.email || "",
    data,
    lead: {
      name: asText(pick(data, ["name", "nama"]) || submission.name || submission.title),
      phone: asText(pick(data, ["phone", "whatsapp", "WhatsApp", "nomor"])),
      address: asText(pick(data, ["address", "alamat"])),
      spaces: asText(spaces),
      message: asText(pick(data, ["message", "kebutuhan"])),
    },
  };
}

async function getSubmissions({ formId, siteId, state, token }) {
  const params = new URLSearchParams({ per_page: "100" });
  if (state === "spam") params.set("state", "spam");

  const path = formId
    ? `/forms/${encodeURIComponent(formId)}/submissions?${params.toString()}`
    : `/sites/${encodeURIComponent(siteId)}/submissions?${params.toString()}`;

  const submissions = await fetchNetlify(path, token);
  return Array.isArray(submissions) ? submissions.map((item) => normalizeSubmission(item, state)) : [];
}

export default async function handler(request) {
  if (request.method !== "GET") {
    return jsonResponse({ message: "Method not allowed." }, 405);
  }

  const url = new URL(request.url);
  const requestedState = url.searchParams.get("state") || "verified";
  const formName = url.searchParams.get("formName") || process.env.NETLIFY_FORM_NAME || DEFAULT_FORM_NAME;
  const siteId = process.env.NETLIFY_SITE_ID || request.headers.get("x-netlify-site-id");
  const token = process.env.NETLIFY_AUTH_TOKEN || request.headers.get("x-netlify-auth-token");

  if (!siteId || !token) {
    return jsonResponse(
      {
        message: "Netlify Site ID dan Personal Access Token belum dikonfigurasi.",
      },
      400,
    );
  }

  if (!["verified", "spam", "all"].includes(requestedState)) {
    return jsonResponse({ message: "Filter state tidak valid." }, 400);
  }

  try {
    const forms = await fetchNetlify(`/sites/${encodeURIComponent(siteId)}/forms`, token);
    const activeForm = Array.isArray(forms)
      ? forms.find((form) => form.name === formName) || forms.find((form) => form.name?.toLowerCase() === formName.toLowerCase())
      : null;

    if (!activeForm) {
      return jsonResponse({
        forms: Array.isArray(forms) ? forms : [],
        activeForm: null,
        submissions: [],
        message: `Form "${formName}" belum ditemukan di Netlify.`,
      });
    }

    const submissions =
      requestedState === "all"
        ? [
            ...(await getSubmissions({ formId: activeForm.id, siteId, state: "verified", token })),
            ...(await getSubmissions({ formId: activeForm.id, siteId, state: "spam", token })),
          ]
        : await getSubmissions({ formId: activeForm.id, siteId, state: requestedState, token });

    submissions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return jsonResponse({
      forms,
      activeForm,
      submissions,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return jsonResponse(
      {
        message: error.message || "Gagal mengambil data dari Netlify API.",
      },
      error.status || 500,
    );
  }
}
