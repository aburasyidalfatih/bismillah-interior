const header = document.querySelector("[data-header]");
const nav = document.querySelector("[data-nav]");
const navToggle = document.querySelector("[data-nav-toggle]");
const contactForm = document.querySelector("[data-contact-form]");
const formNote = document.querySelector("[data-form-note]");
const lightbox = document.querySelector("[data-image-lightbox]");
const lightboxImage = document.querySelector("[data-lightbox-image]");
const lightboxCaption = document.querySelector("[data-lightbox-caption]");
const lightboxCloseButtons = document.querySelectorAll("[data-lightbox-close]");
const productImages = document.querySelectorAll(".product-card img");
const productCards = document.querySelectorAll(".product-card");
const productFilterButtons = document.querySelectorAll("[data-product-filter]");
const productCount = document.querySelector("[data-product-count]");
const spaceToggle = document.querySelector("[data-space-toggle]");
const spaceToggleLabel = document.querySelector("[data-space-toggle-label]");
const extendedSpaceOptions = document.querySelector("[data-extended-space-options]");
const spaceInputs = document.querySelectorAll('input[name="spaces"]');
const otherSpaceInput = document.querySelector('input[name="otherSpace"]');
const spaceCount = document.querySelector("[data-space-count]");
const packageButtons = document.querySelectorAll("[data-package-choice]");
const messageInput = contactForm?.querySelector('textarea[name="message"]');

const whatsappNumber = "628114517212";
let lastFocusedElement = null;

const submitLead = (payload) =>
  fetch("/api/submissions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "BismillahInterior",
    },
    body: JSON.stringify(payload),
  });

const setHeaderState = () => {
  header.classList.toggle("is-scrolled", window.scrollY > 24);
};

setHeaderState();
window.addEventListener("scroll", setHeaderState, { passive: true });

const updateProductFilter = (filter) => {
  let visibleCount = 0;

  productCards.forEach((card) => {
    const categories = (card.dataset.category || "").split(" ").filter(Boolean);
    const isVisible = filter === "all" || categories.includes(filter);

    card.hidden = !isVisible;
    if (isVisible) visibleCount += 1;
  });

  productFilterButtons.forEach((button) => {
    const isActive = button.dataset.productFilter === filter;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });

  if (productCount) {
    productCount.innerHTML = `<strong>${visibleCount}</strong> pilihan furnitur custom`;
  }
};

productFilterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    updateProductFilter(button.dataset.productFilter || "all");
  });
});

updateProductFilter("all");

const updateSpaceCount = () => {
  if (!spaceCount) return;

  const checkedCount = Array.from(spaceInputs).filter((input) => input.checked).length;
  const hasOther = Boolean(otherSpaceInput?.value.trim());
  const total = checkedCount + (hasOther ? 1 : 0);

  spaceCount.textContent = total ? `${total} pilihan` : "Belum ada pilihan";
};

const collapseExtendedSpaces = () => {
  if (!spaceToggle || !spaceToggleLabel || !extendedSpaceOptions) return;

  extendedSpaceOptions.hidden = true;
  spaceToggle.setAttribute("aria-expanded", "false");
  spaceToggleLabel.textContent = "Lihat 13 pilihan lainnya";
};

spaceToggle?.addEventListener("click", () => {
  if (!spaceToggleLabel || !extendedSpaceOptions) return;

  const willOpen = extendedSpaceOptions.hidden;
  extendedSpaceOptions.hidden = !willOpen;
  spaceToggle.setAttribute("aria-expanded", String(willOpen));
  spaceToggleLabel.textContent = willOpen ? "Sembunyikan pilihan tambahan" : "Lihat 13 pilihan lainnya";
});

spaceInputs.forEach((input) => input.addEventListener("change", updateSpaceCount));
otherSpaceInput?.addEventListener("input", updateSpaceCount);
updateSpaceCount();

packageButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const packageChoice = button.dataset.packageChoice;
    if (!packageChoice || !messageInput) return;

    const packageMessage = `Saya tertarik dengan ${packageChoice}.`;
    if (!messageInput.value.trim()) {
      messageInput.value = packageMessage;
    }
  });
});

navToggle.addEventListener("click", () => {
  const isOpen = nav.classList.toggle("is-open");
  navToggle.setAttribute("aria-expanded", String(isOpen));
  navToggle.setAttribute("aria-label", isOpen ? "Tutup menu" : "Buka menu");
});

nav.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    nav.classList.remove("is-open");
    navToggle.setAttribute("aria-expanded", "false");
    navToggle.setAttribute("aria-label", "Buka menu");
  });
});

const closeLightbox = () => {
  if (!lightbox || lightbox.hidden) return;

  lightbox.hidden = true;
  lightbox.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-lightbox-open");
  lightboxImage.removeAttribute("src");
  lightboxImage.alt = "";
  lightboxCaption.textContent = "";

  if (lastFocusedElement) {
    lastFocusedElement.focus({ preventScroll: true });
  }
};

const openLightbox = (image) => {
  if (!lightbox || !lightboxImage || !lightboxCaption) return;

  const cardTitle = image.closest(".product-card")?.querySelector("h3")?.textContent?.trim() || "";
  const imageAlt = image.getAttribute("alt") || cardTitle || "Gambar produk";

  lastFocusedElement = document.activeElement;
  lightboxImage.src = image.currentSrc || image.src;
  lightboxImage.alt = imageAlt;
  lightboxCaption.textContent = cardTitle;
  lightbox.hidden = false;
  lightbox.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-lightbox-open");
  lightbox.querySelector(".image-lightbox__close")?.focus({ preventScroll: true });
};

productImages.forEach((image) => {
  const cardTitle = image.closest(".product-card")?.querySelector("h3")?.textContent?.trim() || "";

  image.tabIndex = 0;
  image.setAttribute("role", "button");
  image.setAttribute("aria-label", `Lihat gambar ${cardTitle || "produk"} ukuran penuh`);

  image.addEventListener("click", () => openLightbox(image));
  image.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openLightbox(image);
    }
  });
});

lightboxCloseButtons.forEach((button) => {
  button.addEventListener("click", closeLightbox);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeLightbox();
  }
});

contactForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const formData = new FormData(contactForm);
  const submitButton = contactForm.querySelector(".form-submit");
  const name = String(formData.get("name") || "").trim();
  const phone = String(formData.get("phone") || "").trim();
  const address = String(formData.get("address") || "").trim();
  const selectedSpaces = formData.getAll("spaces").map((space) => String(space).trim()).filter(Boolean);
  const otherSpace = String(formData.get("otherSpace") || "").trim();
  const message = String(formData.get("message") || "").trim();
  const spaces = otherSpace ? [...selectedSpaces, otherSpace] : selectedSpaces;

  if (!spaces.length) {
    formNote.textContent = "Pilih minimal satu jenis ruang atau isi pilihan lain terlebih dahulu.";
    contactForm.querySelector("[data-space-options]")?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  formData.set("selectedSpaces", spaces.join(", "));

  const leadPayload = {
    name,
    phone,
    address,
    spaces,
    otherSpace,
    message,
    "bot-field": String(formData.get("bot-field") || ""),
  };

  const textLines = [
    "Halo Bismillah Interior, saya ingin konsultasi desain interior.",
    "",
    `Nama: ${name}`,
    `WhatsApp: ${phone}`,
    `Kota/Kecamatan: ${address}`,
    `Jenis ruang: ${spaces.join(", ")}`,
  ];

  if (message) {
    textLines.push(`Catatan kebutuhan: ${message}`);
  }

  const text = textLines.join("\n");

  const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(text)}`;

  formNote.textContent = "Menyimpan data konsultasi dan membuka WhatsApp...";
  submitButton.disabled = true;
  submitButton.setAttribute("aria-busy", "true");
  window.open(whatsappUrl, "_blank", "noopener,noreferrer");

  submitLead(leadPayload)
    .then(async (response) => {
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.message || "Data konsultasi belum dapat disimpan.");
      }

      formNote.textContent = "Data konsultasi tersimpan. WhatsApp sudah dibuka untuk mengirim pesan.";
      contactForm.reset();
      updateSpaceCount();
      collapseExtendedSpaces();
    })
    .catch((error) => {
      formNote.textContent = `WhatsApp sudah dibuka, tetapi data belum tersimpan. ${error.message}`;
    })
    .finally(() => {
      submitButton.disabled = false;
      submitButton.removeAttribute("aria-busy");
    });
});

if (window.lucide) {
  window.lucide.createIcons({
    attrs: {
      "stroke-width": 2,
    },
  });
}
