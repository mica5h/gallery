// Public gallery page — fetch content and render.

const $ = (id) => document.getElementById(id);

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

async function load() {
  const res = await fetch("/api/gallery");
  const g = await res.json();

  // Header / hero
  document.title = g.title || "Gallery";
  $("navBrand").textContent = g.title || "Gallery";
  $("galleryTitle").textContent = g.title || "Gallery";
  $("galleryIntro").textContent = g.intro || "";

  // Words
  $("niceWords").textContent = g.niceWords || "";

  // Contact / footer
  const c = g.contact || {};
  $("contactNote").textContent = c.note || "";
  const details = [];
  if (c.name) details.push(escapeHtml(c.name));
  if (c.email) details.push(`<a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a>`);
  $("contactDetails").innerHTML = details.join(" · ");
  $("footerName").textContent = c.name || "";
  $("year").textContent = new Date().getFullYear();

  // Items
  const grid = $("grid");
  const empty = $("emptyState");
  grid.querySelectorAll(".card").forEach((el) => el.remove());

  if (!g.items || g.items.length === 0) {
    empty.hidden = false;
  } else {
    empty.hidden = true;
    for (const item of g.items) {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <img src="/uploads/${encodeURIComponent(item.filename)}" alt="${escapeHtml(item.title)}" loading="lazy" />
        <div class="card__body">
          <p class="card__title">${escapeHtml(item.title) || "Untitled"}</p>
          ${item.description ? `<p class="card__desc">${escapeHtml(item.description)}</p>` : ""}
        </div>`;
      card.addEventListener("click", () =>
        openLightbox(`/uploads/${encodeURIComponent(item.filename)}`, item.title, item.description)
      );
      grid.appendChild(card);
    }
  }
}

// Lightbox
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

load();
