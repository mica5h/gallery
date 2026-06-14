// Public artist page — language toggle, expandable menu, work rendering, lightbox.

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

// Image URL: stored full URL (Supabase) or legacy local /uploads path.
function imgSrc(item) {
  return item.url || `/uploads/${encodeURIComponent(item.filename || "")}`;
}

// ---- Language --------------------------------------------------------------

function setLang(lang) {
  const l = lang === "cz" ? "cz" : "en";
  document.body.classList.toggle("lang-en", l === "en");
  document.body.classList.toggle("lang-cz", l === "cz");
  document.documentElement.lang = l === "cz" ? "cs" : "en";
  document.querySelectorAll(".lang__btn").forEach((b) =>
    b.classList.toggle("is-active", b.dataset.lang === l)
  );
  try { localStorage.setItem("nr-lang", l); } catch {}
}

document.querySelectorAll(".lang__btn").forEach((b) =>
  b.addEventListener("click", () => setLang(b.dataset.lang))
);

(function initLang() {
  let saved = null;
  try { saved = localStorage.getItem("nr-lang"); } catch {}
  setLang(saved || "en");
})();

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

// Placeholder Drive link — replace via the admin panel ("Google Drive link").
const DRIVE_PLACEHOLDER = "https://drive.google.com/drive/folders/PLACEHOLDER";

async function load() {
  const g = await (await fetch("/api/gallery")).json();
  renderWorks(g.items || []);
  renderDrive(g.driveUrl);
}

function renderDrive(url) {
  const link = url || DRIVE_PLACEHOLDER;
  const block = $("menuDrive");
  const menuLink = $("driveLinkMenu");

  $("driveLink").href = link;
  menuLink.href = link;
  menuLink.hidden = false;
  block.hidden = false;

  const target = $("driveQr");
  try {
    const qr = qrcode(0, "M");
    qr.addData(link);
    qr.make();
    target.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0 });
  } catch {
    target.textContent = "QR";
  }
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
    const title = pair(item.title);
    const desc = pair(item.description);
    const idx = String(i + 1).padStart(2, "0");

    const piece = document.createElement("article");
    piece.className = "work-piece";
    piece.innerHTML = `
      <figure class="work-piece__media">
        <img src="${escapeHtml(src)}" alt="${escapeHtml(title.en || title.cz)}" loading="lazy" />
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

    piece.querySelector(".work-piece__media").addEventListener("click", () => {
      const lang = document.body.classList.contains("lang-cz") ? "cz" : "en";
      openLightbox(src, title[lang], desc[lang]);
    });
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
