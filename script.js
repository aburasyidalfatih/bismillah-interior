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

const whatsappNumber = "6281234567890";
let lastFocusedElement = null;

const setHeaderState = () => {
  header.classList.toggle("is-scrolled", window.scrollY > 24);
};

setHeaderState();
window.addEventListener("scroll", setHeaderState, { passive: true });

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
  const name = String(formData.get("name") || "").trim();
  const phone = String(formData.get("phone") || "").trim();
  const selectedSpaces = formData.getAll("spaces").map((space) => String(space).trim()).filter(Boolean);
  const otherSpace = String(formData.get("otherSpace") || "").trim();
  const message = String(formData.get("message") || "").trim();
  const spaces = otherSpace ? [...selectedSpaces, otherSpace] : selectedSpaces;

  if (!spaces.length) {
    formNote.textContent = "Pilih minimal satu jenis ruang atau isi pilihan lain terlebih dahulu.";
    contactForm.querySelector("[data-space-options]")?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  const text = [
    "Halo Bismillah Interior, saya ingin konsultasi desain interior.",
    "",
    `Nama: ${name}`,
    `WhatsApp: ${phone}`,
    `Jenis ruang: ${spaces.join(", ")}`,
    `Kebutuhan: ${message}`,
  ].join("\n");

  formNote.textContent = "Membuka WhatsApp untuk mengirim pesan konsultasi...";
  window.open(`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
});

if (window.lucide) {
  window.lucide.createIcons({
    attrs: {
      "stroke-width": 2,
    },
  });
}
