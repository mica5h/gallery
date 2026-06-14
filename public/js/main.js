// Public artist page — expandable menu, work rendering, lightbox.

const $ = (id) => document.getElementById(id);

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// Bilingual value: accepts { en, cz } objects or a plain string (same for both).
function pair(val) {
  if (val && typeof val === "object") {
    return { en: val.en || val.cz || "", cz: val.cz || val.en || "" };
  }
  const s = String(val ?? "");
  return { en: s, cz: s };
}

// Media URL: stored full URL (Supabase) or legacy local /uploads path.
function imgSrc(item) {
  return item.url || `/uploads/${encodeURIComponent(item.filename || "")}`;
}

// A work is a video if explicitly typed or its URL has a known video extension.
function isVideo(item) {
  return (
    item.type === "video" || /\.(mp4|webm|mov|m4v)$/i.test(item.url || "")
  );
}

// ---- Expandable menu -------------------------------------------------------

const menuToggle = $("menuToggle");
const menuPanel = $("menuPanel");

function setMenu(open) {
  menuPanel.hidden = !open;
  menuToggle.setAttribute("aria-expanded", String(open));
}
menuToggle.addEventListener("click", () =>
  setMenu(menuToggle.getAttribute("aria-expanded") !== "true")
);
menuPanel.addEventListener("click", (e) => {
  if (e.target.closest("a")) setMenu(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") setMenu(false);
});

// Accordion — each item reveals only its own QR / contact, one open at a time.
const menuItemBtns = document.querySelectorAll(".menu-item__btn");
menuItemBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const open = btn.getAttribute("aria-expanded") === "true";
    menuItemBtns.forEach((b) => {
      b.setAttribute("aria-expanded", "false");
      const p = b.nextElementSibling;
      if (p) p.hidden = true;
    });
    if (!open) {
      btn.setAttribute("aria-expanded", "true");
      if (btn.nextElementSibling) btn.nextElementSibling.hidden = false;
    }
  });
});

// ---- Scroll reveal ---------------------------------------------------------

const prefersReduced =
  window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const revealIO =
  !prefersReduced && "IntersectionObserver" in window
    ? new IntersectionObserver(
        (entries, obs) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              e.target.classList.add("is-visible");
              obs.unobserve(e.target);
            }
          }
        },
        { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
      )
    : null;

// Mark an element for reveal. `delay` (ms) staggers grouped items.
function reveal(el, delay = 0) {
  if (!el) return;
  if (!revealIO) return; // reduced motion: leave fully visible
  el.classList.add("reveal");
  if (delay) el.style.transitionDelay = `${delay}ms`;
  revealIO.observe(el);
}

// Reveal each child of a container with a stagger.
function revealGroup(selector, step = 90) {
  document.querySelectorAll(selector).forEach((el, i) => reveal(el, i * step));
}

function setupStaticReveals() {
  [
    ".intro__eyebrow",
    ".intro__title",
    ".intro__lead",
    ".work .section-label",
    ".practice__mark",
    ".practice__text",
    ".recognition .section-label",
    ".contact__name",
    ".contact__details",
    ".contact__links",
  ].forEach((sel) => reveal(document.querySelector(sel)));

  revealGroup(".pillar", 110);
  revealGroup(".stat", 90);
  revealGroup(".rec-col", 120);
}

// ---- Load content ----------------------------------------------------------

// Placeholder Drive link — used until a real link is configured.
const DRIVE_PLACEHOLDER = "https://drive.google.com/drive/folders/PLACEHOLDER";

// Per-category QR targets. Set the real URLs here; empty values fall back to the
// configured Google Drive link (admin "Google Drive link").
const MENU_LINKS = {
  artworks: "",
  exhibitions: "",
  publications: "",
  technique: "",
};

async function load() {
  const g = await (await fetch("/api/gallery")).json();
  renderWorks(g.items || []);
  renderMenuQrs(g.driveUrl);
}

function renderMenuQrs(driveUrl) {
  const fallback = driveUrl || DRIVE_PLACEHOLDER;
  document.querySelectorAll(".menu-qr").forEach((el) => {
    const link = MENU_LINKS[el.dataset.link] || fallback;
    try {
      const qr = qrcode(0, "M");
      qr.addData(link);
      qr.make();
      el.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0 });
    } catch {
      el.textContent = "QR";
    }
  });
}

function renderWorks(items) {
  const wrap = $("works");
  const empty = $("emptyState");
  wrap.querySelectorAll(".work-piece").forEach((el) => el.remove());

  if (!items.length) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  items.forEach((item, i) => {
    const src = imgSrc(item);
    const video = isVideo(item);
    const title = pair(item.title);
    const desc = pair(item.description);
    const idx = String(i + 1).padStart(2, "0");

    const media = video
      ? `<video src="${escapeHtml(src)}"${
          item.poster ? ` poster="${escapeHtml(item.poster)}"` : ""
        } controls playsinline preload="metadata" loop muted></video>`
      : `<img src="${escapeHtml(src)}" alt="${escapeHtml(title.en || title.cz)}" loading="lazy" />`;

    const piece = document.createElement("article");
    piece.className = "work-piece";
    piece.innerHTML = `
      <figure class="work-piece__media${video ? " work-piece__media--video" : ""}">
        ${media}
      </figure>
      <div class="work-piece__caption">
        <p class="work-piece__index">${idx}</p>
        <h2 class="work-piece__title">
          <span class="en">${escapeHtml(title.en) || "Untitled"}</span><span class="cz">${escapeHtml(title.cz) || "Bez názvu"}</span>
        </h2>
        ${
          desc.en || desc.cz
            ? `<p class="work-piece__desc"><span class="en">${escapeHtml(desc.en)}</span><span class="cz">${escapeHtml(desc.cz)}</span></p>`
            : ""
        }
      </div>`;

    // Images open in the lightbox on click; videos play inline with their own controls.
    if (!video) {
      piece.querySelector(".work-piece__media").addEventListener("click", () => {
        const lang = document.body.classList.contains("lang-cz") ? "cz" : "en";
        openLightbox(src, title[lang], desc[lang]);
      });
    }
    wrap.appendChild(piece);
    reveal(piece);
  });
}

// ---- Lightbox --------------------------------------------------------------

function openLightbox(src, title, desc) {
  $("lightboxImg").src = src;
  $("lightboxImg").alt = title || "";
  $("lightboxCaption").textContent = [title, desc].filter(Boolean).join(" — ");
  $("lightbox").hidden = false;
}
function closeLightbox() {
  $("lightbox").hidden = true;
  $("lightboxImg").src = "";
}
$("lightboxClose").addEventListener("click", closeLightbox);
$("lightbox").addEventListener("click", (e) => {
  if (e.target.id === "lightbox") closeLightbox();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeLightbox();
});

$("year").textContent = new Date().getFullYear();

setupStaticReveals();
load();
