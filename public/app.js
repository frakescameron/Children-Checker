const appEl = document.getElementById('app');
const modalRoot = document.getElementById('modalRoot');
const connStatus = document.getElementById('connStatus');
const offlineBanner = document.getElementById('offlineBanner');

let currentView = 'hub';
let kids = [];       // saved roster
let checkins = [];   // currently active check-ins
let isOffline = false;

function setOffline(offline) {
  const wasOffline = isOffline;
  isOffline = offline;
  connStatus.classList.toggle('online', !offline);
  offlineBanner.style.display = offline ? 'block' : 'none';
  // Coming back online: refresh everything and close any open modal
  // (it may be showing stale data or a stuck error from the drop).
  if (wasOffline && !offline) {
    modalRoot.innerHTML = '';
    Promise.all([loadKids(), loadCheckins()]).then(render).catch(() => {});
  }
}

// ---------- Socket.io: live sync between tablets ----------
const socket = io({ reconnectionDelay: 1000, reconnectionDelayMax: 3000 });
socket.on('connect', () => { setOffline(false); });
socket.on('disconnect', () => { setOffline(true); });
socket.on('connect_error', () => { setOffline(true); });
socket.on('checkins:changed', () => { loadCheckins().then(render).catch(() => {}); });
socket.on('kids:changed', () => { loadKids().then(render).catch(() => {}); });

// ---------- API helpers ----------
async function api(path, opts) {
  let res;
  try {
    res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
  } catch (networkErr) {
    // The host is unreachable (off, out of wifi range, etc).
    setOffline(true);
    throw new Error("Can't reach the host tablet right now. Make sure it's turned on and connected to wifi, then try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
async function loadKids() { kids = await api('/api/kids'); }
async function loadCheckins() { checkins = await api('/api/checkins'); }

// ---------- Nav ----------
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentView = btn.dataset.view;
    render();
  });
});

// ---------- Render dispatcher ----------
function render() {
  if (currentView === 'hub') renderHub();
  else if (currentView === 'checkin') renderCheckin();
  else if (currentView === 'roster') renderRoster();
}

// ================= HUB VIEW =================
function renderHub() {
  const flagged = [];
  checkins.forEach(c => {
    (c.notes || []).filter(n => n.flagged).forEach(n => {
      flagged.push({ childName: c.childName, beeperNumber: c.beeperNumber, text: n.text });
    });
  });

  let html = `<div class="section-title">Checked-In Kids (${checkins.length}/30)</div>`;

  if (flagged.length) {
    html += `<div class="alert-banner">
      <div class="alert-banner-title">⚠️ Needs Attention</div>
      ${flagged.map(f => `
        <div class="alert-item">
          <span class="who">${esc(f.childName)}</span>
          <span class="what">${esc(f.text)}</span>
          <span class="beeper-chip">#${f.beeperNumber}</span>
        </div>
      `).join('')}
    </div>`;
  }

  if (!checkins.length) {
    html += `<div class="empty-state">No kids checked in yet. Tap "Check In" above to get started.</div>`;
  } else {
    html += `<div class="hub-grid">`;
    checkins.forEach(c => {
      const hasFlag = (c.notes || []).some(n => n.flagged);
      const plainNotes = (c.notes || []).filter(n => !n.flagged);
      html += `
        <div class="kid-card ${hasFlag ? 'flagged' : ''}">
          <div class="kid-card-top">
            <div>
              <div class="kid-name">${esc(c.childName)}</div>
              <div class="kid-parent">Parent: ${esc(c.parentName)}</div>
            </div>
            <div class="beeper-chip">#${c.beeperNumber}</div>
          </div>
          ${hasFlag ? c.notes.filter(n => n.flagged).map(n => `<div class="kid-flag-note">⚠️ ${esc(n.text)}</div>`).join('') : ''}
          ${plainNotes.length ? `<div style="font-size:13px;color:#666;">${plainNotes.map(n => esc(n.text)).join(' • ')}</div>` : ''}
          <button class="checkout-btn" data-checkout="${c.checkinId}">Check Out</button>
        </div>
      `;
    });
    html += `</div>`;
  }

  appEl.innerHTML = html;

  appEl.querySelectorAll('[data-checkout]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const checkinId = btn.dataset.checkout;
      const card = checkins.find(c => String(c.checkinId) === String(checkinId));
      if (!confirm(`Check out ${card.childName} (beeper #${card.beeperNumber})?`)) return;
      btn.disabled = true;
      try {
        await api(`/api/checkins/${checkinId}/checkout`, { method: 'POST' });
        await loadCheckins();
        render();
      } catch (e) {
        alert(e.message);
        btn.disabled = false;
      }
    });
  });
}

// ================= CHECK-IN VIEW =================
let checkinSearch = '';

function renderCheckin() {
  const activeKidIds = new Set(checkins.map(c => c.kidId));
  const q = checkinSearch.trim().toLowerCase();
  const matches = kids.filter(k =>
    !q || k.child_name.toLowerCase().includes(q) || k.parent_name.toLowerCase().includes(q)
  );

  let html = `<div class="section-title">Check In a Child</div>
    <input class="search-box" id="checkinSearchBox" placeholder="Search by child or parent name..." value="${esc(checkinSearch)}">
    <div class="kid-select-list">`;

  if (!matches.length) {
    html += `<div class="empty-state">${kids.length ? 'No matches.' : 'No saved kids yet.'}</div>`;
  } else {
    matches.forEach(k => {
      const isIn = activeKidIds.has(k.id);
      const activeInfo = isIn ? checkins.find(c => c.kidId === k.id) : null;
      html += `
        <div class="kid-select-row">
          <div class="info">
            <div class="kid-name">${esc(k.child_name)}</div>
            <div class="kid-parent">Parent: ${esc(k.parent_name)}</div>
          </div>
          ${isIn
            ? `<button class="checkin-btn already" disabled>Checked In (#${activeInfo.beeperNumber})</button>`
            : `<button class="checkin-btn" data-checkin="${k.id}">Check In</button>`}
        </div>
      `;
    });
  }
  html += `</div>
    <button class="add-new-cta" id="addNewKidBtn">+ Add New Kid</button>`;

  appEl.innerHTML = html;

  const box = document.getElementById('checkinSearchBox');
  box.addEventListener('input', () => { checkinSearch = box.value; renderCheckin(); box.focus(); box.setSelectionRange(box.value.length, box.value.length); });

  appEl.querySelectorAll('[data-checkin]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const result = await api('/api/checkins', { method: 'POST', body: JSON.stringify({ kidId: Number(btn.dataset.checkin) }) });
        await loadCheckins();
        showBeeperResult(result);
      } catch (e) {
        alert(e.message);
        btn.disabled = false;
      }
    });
  });

  document.getElementById('addNewKidBtn').addEventListener('click', () => openKidForm(null, { andCheckIn: true }));
}

function showBeeperResult(result) {
  modalRoot.innerHTML = `
    <div class="modal-overlay" id="beeperOverlay">
      <div class="modal beeper-result">
        <div class="kid-name">${esc(result.childName)} is checked in!</div>
        <div class="big-number">#${result.beeperNumber}</div>
        <div class="instructions">Give this beeper number to the parent.<br>They'll need it to pick up their child.</div>
        <div class="modal-actions" style="margin-top:28px;">
          <button class="btn-primary" id="beeperDoneBtn">Done</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('beeperDoneBtn').addEventListener('click', () => {
    modalRoot.innerHTML = '';
    checkinSearch = '';
    render();
  });
}

// ================= ROSTER VIEW =================
let rosterSearch = '';

function renderRoster() {
  const q = rosterSearch.trim().toLowerCase();
  const matches = kids.filter(k =>
    !q || k.child_name.toLowerCase().includes(q) || k.parent_name.toLowerCase().includes(q)
  );

  let html = `<div class="section-title">Manage Saved Kids (${kids.length})</div>
    <input class="search-box" id="rosterSearchBox" placeholder="Search..." value="${esc(rosterSearch)}">
    <div class="roster-list">`;

  if (!matches.length) {
    html += `<div class="empty-state">No kids found.</div>`;
  } else {
    matches.forEach(k => {
      html += `
        <div class="roster-row">
          <div class="info">
            <div class="kid-name">${esc(k.child_name)}</div>
            <div class="kid-parent">Parent: ${esc(k.parent_name)}</div>
          </div>
          <div class="roster-actions">
            <button class="icon-btn" data-edit="${k.id}">Edit</button>
            <button class="icon-btn danger" data-delete="${k.id}">Delete</button>
          </div>
        </div>
      `;
    });
  }
  html += `</div><button class="fab" id="rosterAddFab">+</button>`;

  appEl.innerHTML = html;

  const box = document.getElementById('rosterSearchBox');
  box.addEventListener('input', () => { rosterSearch = box.value; renderRoster(); box.focus(); box.setSelectionRange(box.value.length, box.value.length); });

  appEl.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const kid = kids.find(k => k.id === Number(btn.dataset.edit));
      openKidForm(kid);
    });
  });
  appEl.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const kid = kids.find(k => k.id === Number(btn.dataset.delete));
      if (!confirm(`Delete ${kid.child_name} from the saved list? This can't be undone.`)) return;
      try {
        await api(`/api/kids/${kid.id}`, { method: 'DELETE' });
        await loadKids();
        render();
      } catch (e) {
        alert(e.message);
      }
    });
  });
  document.getElementById('rosterAddFab').addEventListener('click', () => openKidForm(null));
}

// ================= ADD / EDIT KID FORM (modal) =================
function openKidForm(existingKid, opts = {}) {
  const isEdit = !!existingKid;
  const notes = isEdit ? JSON.parse(JSON.stringify(existingKid.notes || [])) : [];

  function noteRowHtml(n, idx) {
    return `
      <div class="note-row" data-note-idx="${idx}">
        <input type="text" value="${esc(n.text)}" placeholder="e.g. Severe nut allergy" data-note-text>
        <label class="flag-toggle"><input type="checkbox" ${n.flagged ? 'checked' : ''} data-note-flag> Flag on Hub</label>
        <button class="remove-note-btn" data-note-remove type="button">✕</button>
      </div>
    `;
  }

  modalRoot.innerHTML = `
    <div class="modal-overlay" id="kidFormOverlay">
      <div class="modal">
        <h2>${isEdit ? 'Edit' : 'Add'} Kid</h2>
        <div class="error-msg" id="kidFormError" style="display:none;"></div>

        <div class="form-row">
          <label>Child's Name</label>
          <input type="text" id="f_childName" value="${isEdit ? esc(existingKid.child_name) : ''}" placeholder="Full name">
        </div>
        <div class="form-row">
          <label>Parent's Name</label>
          <input type="text" id="f_parentName" value="${isEdit ? esc(existingKid.parent_name) : ''}" placeholder="Full name">
        </div>
        <div class="form-row">
          <label>Birthday <span class="optional-tag">(optional)</span></label>
          <input type="date" id="f_birthday" value="${isEdit && existingKid.birthday ? existingKid.birthday : ''}">
        </div>
        <div class="form-row">
          <label>Parent's Phone <span class="optional-tag">(optional)</span></label>
          <input type="tel" id="f_phone" value="${isEdit && existingKid.parent_phone ? esc(existingKid.parent_phone) : ''}" placeholder="(555) 555-5555">
        </div>
        <div class="form-row">
          <label>Address <span class="optional-tag">(optional)</span></label>
          <input type="text" id="f_address" value="${isEdit && existingKid.address ? esc(existingKid.address) : ''}" placeholder="Street, City">
        </div>
        <div class="form-row">
          <label>Other Notes <span class="optional-tag">(allergies, medical info, etc. - optional)</span></label>
          <div class="notes-list" id="notesList">
            ${notes.map(noteRowHtml).join('')}
          </div>
          <button type="button" class="add-note-btn" id="addNoteBtn">+ Add Note</button>
        </div>

        <div class="modal-actions">
          <button class="btn-secondary" id="kidFormCancel">Cancel</button>
          <button class="btn-primary" id="kidFormSave">${opts.andCheckIn ? 'Save & Check In' : 'Save'}</button>
        </div>
      </div>
    </div>
  `;

  let noteCounter = notes.length;
  function addNoteRow(text = '', flagged = false) {
    const list = document.getElementById('notesList');
    const idx = noteCounter++;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = noteRowHtml({ text, flagged }, idx).trim();
    const row = wrapper.firstChild;
    list.appendChild(row);
    wireNoteRow(row);
    row.querySelector('[data-note-text]').focus();
  }
  function wireNoteRow(row) {
    row.querySelector('[data-note-remove]').addEventListener('click', () => row.remove());
  }
  document.querySelectorAll('.note-row').forEach(wireNoteRow);
  document.getElementById('addNoteBtn').addEventListener('click', () => addNoteRow());

  document.getElementById('kidFormCancel').addEventListener('click', () => { modalRoot.innerHTML = ''; });
  document.getElementById('kidFormOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'kidFormOverlay') modalRoot.innerHTML = '';
  });

  document.getElementById('kidFormSave').addEventListener('click', async () => {
    const childName = document.getElementById('f_childName').value.trim();
    const parentName = document.getElementById('f_parentName').value.trim();
    const errEl = document.getElementById('kidFormError');

    if (!childName || !parentName) {
      errEl.textContent = "Child's name and parent's name are required.";
      errEl.style.display = 'block';
      return;
    }

    const collectedNotes = Array.from(document.querySelectorAll('#notesList .note-row')).map(row => ({
      text: row.querySelector('[data-note-text]').value.trim(),
      flagged: row.querySelector('[data-note-flag]').checked,
    })).filter(n => n.text);

    const payload = {
      childName,
      parentName,
      birthday: document.getElementById('f_birthday').value || null,
      parentPhone: document.getElementById('f_phone').value.trim() || null,
      address: document.getElementById('f_address').value.trim() || null,
      notes: collectedNotes,
    };

    try {
      let kid;
      if (isEdit) {
        kid = await api(`/api/kids/${existingKid.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        kid = await api('/api/kids', { method: 'POST', body: JSON.stringify(payload) });
      }
      await loadKids();

      if (opts.andCheckIn) {
        const result = await api('/api/checkins', { method: 'POST', body: JSON.stringify({ kidId: kid.id }) });
        await loadCheckins();
        showBeeperResult(result);
      } else {
        modalRoot.innerHTML = '';
        render();
      }
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
    }
  });
}

// ---------- Utility ----------
function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, s => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[s]));
}

// ---------- Boot ----------
(async function init() {
  try {
    await Promise.all([loadKids(), loadCheckins()]);
    render();
  } catch (e) {
    setOffline(true);
    render(); // still draw the shell so the banner + nav are visible
  }
  // Fallback polling: catches missed socket events, and is also what
  // notices the host has come back if the socket takes a moment to reconnect.
  setInterval(async () => {
    try {
      await Promise.all([loadKids(), loadCheckins()]);
      if (isOffline) setOffline(false); else render();
    } catch (e) {
      setOffline(true);
    }
  }, 8000);
})();
