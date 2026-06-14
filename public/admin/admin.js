// Admin panel logic.

const $ = (id) => document.getElementById(id);

function show(view) {
  $("loginView").hidden = view !== "login";
  $("dashView").hidden = view !== "dash";
  $("logoutWrap").hidden = view !== "dash";
}

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// Bilingual value: { en, cz } object or a plain string (used for both languages).
function pair(val) {
  if (val && typeof val === "object") return { en: val.en || "", cz: val.cz || "" };
  const s = String(val ?? "");
  return { en: s, cz: s };
}

// Image URL: stored full URL (Supabase) or legacy local /uploads path.
function imgSrc(item) {
  return item.url || `/uploads/${encodeURIComponent(item.filename || "")}`;
}

async function checkAuth() {
  const res = await fetch("/api/me");
  const { user } = await res.json();
  if (user) {
    show("dash");
    await loadGallery();
  } else {
    show("login");
  }
}

// ---- Login -----------------------------------------------------------------

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("loginError").hidden = true;
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: $("username").value, password: $("password").value }),
  });
  if (res.ok) {
    show("dash");
    await loadGallery();
  } else {
    const { error } = await res.json().catch(() => ({}));
    $("loginError").textContent = error || "Login failed";
    $("loginError").hidden = false;
  }
});

$("logoutBtn").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
  show("login");
});

// ---- Gallery info ----------------------------------------------------------

async function loadGallery() {
  const g = await (await fetch("/api/gallery")).json();
  const intro = pair(g.intro), words = pair(g.niceWords), note = pair(g.contact?.note);
  $("infoTitle").value = g.title || "";
  $("infoIntroEn").value = intro.en;
  $("infoIntroCz").value = intro.cz;
  $("infoWordsEn").value = words.en;
  $("infoWordsCz").value = words.cz;
  $("infoDrive").value = g.driveUrl || "";
  $("contactName").value = g.contact?.name || "";
  $("contactEmail").value = g.contact?.email || "";
  $("contactNoteEn").value = note.en;
  $("contactNoteCz").value = note.cz;
  renderItems(g.items || []);
}

$("infoForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = {
    title: $("infoTitle").value,
    intro: { en: $("infoIntroEn").value, cz: $("infoIntroCz").value },
    niceWords: { en: $("infoWordsEn").value, cz: $("infoWordsCz").value },
    driveUrl: $("infoDrive").value,
    contact: {
      name: $("contactName").value,
      email: $("contactEmail").value,
      note: { en: $("contactNoteEn").value, cz: $("contactNoteCz").value },
    },
  };
  const res = await fetch("/api/info", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    $("infoSaved").hidden = false;
    setTimeout(() => ($("infoSaved").hidden = true), 1800);
  }
});

// ---- Change password -------------------------------------------------------

$("passwordForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("passwordError").hidden = true;
  $("passwordSaved").hidden = true;
  const newPassword = $("newPassword").value;
  if (newPassword !== $("confirmPassword").value) {
    $("passwordError").textContent = "New passwords do not match.";
    $("passwordError").hidden = false;
    return;
  }
  const res = await fetch("/api/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      currentPassword: $("currentPassword").value,
      newPassword,
    }),
  });
  if (res.ok) {
    $("passwordForm").reset();
    $("passwordSaved").hidden = false;
    setTimeout(() => ($("passwordSaved").hidden = true), 2500);
  } else {
    const { error } = await res.json().catch(() => ({}));
    $("passwordError").textContent = error || "Could not change password.";
    $("passwordError").hidden = false;
  }
});

// ---- Upload ----------------------------------------------------------------

$("uploadForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("uploadError").hidden = true;
  const file = $("imageFile").files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append("image", file);
  fd.append("titleEn", $("itemTitleEn").value);
  fd.append("titleCz", $("itemTitleCz").value);
  fd.append("descEn", $("itemDescEn").value);
  fd.append("descCz", $("itemDescCz").value);
  const res = await fetch("/api/items", { method: "POST", body: fd });
  if (res.ok) {
    $("uploadForm").reset();
    await loadGallery();
  } else {
    const { error } = await res.json().catch(() => ({}));
    $("uploadError").textContent = error || "Upload failed";
    $("uploadError").hidden = false;
  }
});

// ---- Items -----------------------------------------------------------------

function renderItems(items) {
  const list = $("itemList");
  list.innerHTML = "";
  if (items.length === 0) {
    list.innerHTML = '<p class="muted">No pictures yet.</p>';
    return;
  }
  for (const item of items) {
    const t = pair(item.title), d = pair(item.description);
    const row = document.createElement("div");
    row.className = "item";
    row.innerHTML = `
      <img src="${escapeHtml(imgSrc(item))}" alt="" />
      <div class="item__fields">
        <input type="text" value="${escapeHtml(t.en)}" data-field="titleEn" placeholder="Title — EN" />
        <input type="text" value="${escapeHtml(t.cz)}" data-field="titleCz" placeholder="Title — CZ" />
        <textarea data-field="descEn" rows="2" placeholder="Description — EN">${escapeHtml(d.en)}</textarea>
        <textarea data-field="descCz" rows="2" placeholder="Description — CZ">${escapeHtml(d.cz)}</textarea>
      </div>
      <div class="item__actions">
        <button class="btn-sm" data-action="save">Save</button>
        <button class="btn-sm btn-danger" data-action="delete">Delete</button>
      </div>`;

    row.querySelector('[data-action="save"]').addEventListener("click", async () => {
      const body = {
        title: {
          en: row.querySelector('[data-field="titleEn"]').value,
          cz: row.querySelector('[data-field="titleCz"]').value,
        },
        description: {
          en: row.querySelector('[data-field="descEn"]').value,
          cz: row.querySelector('[data-field="descCz"]').value,
        },
      };
      await fetch(`/api/items/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      await loadGallery();
    });

    row.querySelector('[data-action="delete"]').addEventListener("click", async () => {
      if (!confirm("Delete this picture?")) return;
      await fetch(`/api/items/${item.id}`, { method: "DELETE" });
      await loadGallery();
    });

    list.appendChild(row);
  }
}

checkAuth();
