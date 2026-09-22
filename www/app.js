'use strict';
const appEl = document.getElementById('app'), modalRoot = document.getElementById('modalRoot');
const native = window.ChildrenAndroid;
const KEY = 'children-check-in-v2';
let store, currentView = 'hub', kids = [], checkins = [], checkinSearch = '', rosterSearch = '';
let selectedKids = new Set();
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
let historyFilter = {from: today(), to: today(), status: '', search: '', mode: 'arrived'};
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
const dateTime = value => value ? new Date(value).toLocaleString([], {year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : 'Still checked in';
const button = (id, fn) => document.getElementById(id)?.addEventListener('click', fn);
function toast(message) { const e = document.getElementById('toast'); e.textContent = message; e.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => e.classList.remove('show'), 4500); }
function unpack(json) { const result = JSON.parse(json); if (!result.ok) throw new Error(result.error || 'Could not save on this tablet.'); return result.data; }
function refresh() { kids = store.kids(); checkins = store.active(); }
function groups() {
  const map = new Map();
  for (const c of checkins) { if (!map.has(c.groupId)) map.set(c.groupId, {id:c.groupId, number:c.beeperNumber, parent:c.pickupParent, records:[]}); map.get(c.groupId).records.push(c); }
  return [...map.values()];
}
function navigate(view) { currentView = view; modalRoot.innerHTML = ''; render(); }
function render() {
  refresh();
  appEl.classList.toggle('hub-view', currentView === 'hub');
  document.querySelectorAll('.nav-btn').forEach(b => { b.classList.toggle('active', b.dataset.view === currentView); b.setAttribute('aria-current', b.dataset.view === currentView ? 'page' : 'false'); });
  ({hub:renderHub,checkin:renderCheckin,roster:renderRoster,history:renderHistory})[currentView]();
}
document.querySelectorAll('.nav-btn').forEach(b => b.addEventListener('click', () => { if (store) navigate(b.dataset.view); }));
function confirmAction(title, message, action, label = 'Confirm') {
  modalRoot.innerHTML = `<div class="modal-overlay"><section class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h2>${esc(title)}</h2><p class="confirmation-text">${esc(message)}</p><div id="confirmError" class="error-msg" role="alert"></div><div class="modal-actions"><button class="btn-secondary" id="cancelConfirm">Cancel</button><button class="btn-primary" id="acceptConfirm">${esc(label)}</button></div></section></div>`;
  button('cancelConfirm', () => modalRoot.innerHTML = '');
  button('acceptConfirm', () => { const b = document.getElementById('acceptConfirm'); b.disabled = true; try { action(); modalRoot.innerHTML = ''; render(); } catch(e) { document.getElementById('confirmError').textContent = e.message; b.disabled = false; } });
}
function renderHub() {
  const grouped = groups();
  const flags = checkins.flatMap(c => (kids.find(k => k.id === c.kidId)?.notes || c.notes).filter(n => n.flagged).map(n => ({...c, note:n.text})));
  appEl.innerHTML = `<div class="section-heading"><div><h1>Checked-In Kids <span class="count">${checkins.length}</span></h1><p class="subtitle">${grouped.length} of 30 beepers in use</p></div><button class="icon-btn" id="printHub" ${!checkins.length?'disabled':''}>Print current list</button></div>
    ${flags.length ? `<div class="alert-banner"><div class="alert-banner-title">⚠ Needs Attention</div>${flags.map(c => `<div class="alert-item"><strong>${esc(c.childName)}</strong><span class="what">${esc(c.note)}</span><span class="beeper-chip">#${c.beeperNumber}</span></div>`).join('')}</div>`:''}
    ${!checkins.length ? '<div class="empty-state">No kids are checked in. Tap Check In to get started.</div>' : `<div class="hub-grid">${checkins.map(c => {
      const k = kids.find(k => k.id === c.kidId), notes = k ? k.notes : c.notes;
      const g = grouped.find(g => g.id === c.groupId);
      return `<article class="kid-card ${notes.some(n=>n.flagged)?'flagged':''}"><div class="kid-card-top"><div class="grow"><div class="kid-name">${esc(k?.child_name || c.childName)}</div><div class="kid-parent">Parent: ${esc(k?.parent_name || c.parentName)}</div></div><span class="beeper-chip">#${c.beeperNumber}</span></div>${notes.map(n=>`<div class="${n.flagged?'kid-flag-note':'kid-parent'}">${n.flagged?'⚠ ':''}${esc(n.text)}</div>`).join('')}<div class="card-actions"><button class="checkout-btn" data-checkout="${esc(c.checkinId)}">Check Out</button>${g.records.length>1?`<button class="checkout-btn group-checkout" data-group-out="${esc(g.id)}" aria-label="Check out group #${g.number}" title="Check out every child on beeper #${g.number}">Group</button>`:''}</div></article>`;
    }).join('')}</div>`}`;
  button('printHub', () => printReport(checkins, 'Currently checked in', 'Current attendance as of ' + dateTime(new Date().toISOString())));
  appEl.querySelectorAll('[data-checkout]').forEach(b => b.addEventListener('click', () => {
    const c = checkins.find(c => c.checkinId === b.dataset.checkout);
    const count = checkins.filter(v => v.groupId === c.groupId).length;
    confirmAction('Check out child', `${c.childName} · Beeper #${c.beeperNumber}\nVerify the pickup parent: ${c.pickupParent}.\n${count>1?'The other children will remain checked in on this beeper.':'This will free the beeper for the next family.'}`, () => store.checkOut([c.checkinId]), 'Check Out');
  }));
  appEl.querySelectorAll('[data-group-out]').forEach(b => b.addEventListener('click', () => {
    const g = grouped.find(g => g.id === b.dataset.groupOut);
    confirmAction('Check out group', `Beeper #${g.number} · Pickup parent: ${g.parent}\n${g.records.map(c=>c.childName).join('\n')}\nConfirm all of these children are leaving.`, () => store.checkOut(g.records.map(c=>c.checkinId)), 'Check Out Group');
  }));
}
function bindSearch(id, update, paint) {
  const e = document.getElementById(id);
  e.addEventListener('input', () => { const start = e.selectionStart, end = e.selectionEnd; update(e.value); paint(); const fresh = document.getElementById(id); fresh.focus(); fresh.setSelectionRange(start,end); });
}
function renderCheckin() {
  const active = new Set(checkins.map(c=>c.kidId));
  selectedKids = new Set([...selectedKids].filter(id=>kids.some(k=>k.id===id) && !active.has(id)));
  const selected = kids.filter(k=>selectedKids.has(k.id));
  const q = checkinSearch.trim().toLowerCase();
  const matches = kids.filter(k=>[k.child_name,k.parent_name,k.parent_phone].join(' ').toLowerCase().includes(q));
  appEl.innerHTML = `<h1>Check In</h1><p class="subtitle">Select one child or several children for the same parent and beeper.</p>
    <div class="selection-bar"><div class="grow"><strong>${selected.length} selected</strong><div class="selected-names">${esc(selected.map(k=>k.child_name).join(', ') || 'Choose the kids below')}</div></div><button class="icon-btn" id="clearSelection" ${!selected.length?'disabled':''}>Clear</button><button class="checkin-btn" id="checkSelected" ${!selected.length?'disabled':''}>Check In${selected.length?' ('+selected.length+')':''}</button></div>
    <input type="search" class="search-box" id="checkinSearchBox" aria-label="Search kids" placeholder="Search child, parent, or phone…" value="${esc(checkinSearch)}">
    <div class="kid-select-list">${matches.length?matches.map(k=>{
      const c=checkins.find(c=>c.kidId===k.id);
      return `<label class="kid-select-row ${selectedKids.has(k.id)?'selected':''}"><input type="checkbox" data-select="${esc(k.id)}" ${selectedKids.has(k.id)?'checked':''} ${c?'disabled':''} aria-label="Select ${esc(k.child_name)}"><span class="info grow"><span class="kid-name">${esc(k.child_name)}</span><span class="kid-parent">Parent: ${esc(k.parent_name)}</span></span>${c?`<span class="status-pill">Checked in #${c.beeperNumber}</span>`:''}</label>`;
    }).join(''):'<div class="empty-state">'+(kids.length?'No matching kids.':'No saved kids yet. Add your first child below.')+'</div>'}</div>
    <button class="add-new-cta" id="addNewKidBtn">+ Add New Kid</button>`;
  bindSearch('checkinSearchBox',v=>checkinSearch=v,renderCheckin);
  appEl.querySelectorAll('[data-select]').forEach(b=>b.addEventListener('change',()=>{if(b.checked)selectedKids.add(b.dataset.select);else selectedKids.delete(b.dataset.select);renderCheckin();}));
  button('clearSelection',()=>{selectedKids.clear();renderCheckin();});
  button('checkSelected',()=>checkInSelected(selected));
  button('addNewKidBtn',()=>openKidForm(null,{andCheckIn:true}));
}
function checkInSelected(selected) {
  const b=document.getElementById('checkSelected');b.disabled=true;
  try {
    const pickupParent=[...new Set(selected.map(k=>k.parent_name))].join(' / ');
    const result=store.checkIn(selected.map(k=>k.id),{pickupParent});
    selectedKids.clear();checkinSearch='';refresh();renderCheckin();showBeeperResult(result);
  } catch(e) {toast(e.message);b.disabled=false;}
}
function showBeeperResult(result) {
  modalRoot.innerHTML=`<div class="modal-overlay"><section class="modal beeper-result" role="dialog" aria-modal="true" aria-label="Check-in complete"><h2>Checked in!</h2><div class="kid-name">${result.records.map(c=>esc(c.childName)).join('<br>')}</div><div class="big-number">#${result.beeperNumber}</div><div class="instructions">Give this beeper to ${esc(result.pickupParent)}.</div><div class="modal-actions"><button class="btn-primary" id="beeperDoneBtn">Done</button></div></section></div>`;
  button('beeperDoneBtn',()=>{modalRoot.innerHTML='';render();});
}
function renderRoster() {
  const q=rosterSearch.trim().toLowerCase(),matches=kids.filter(k=>[k.child_name,k.parent_name,k.parent_phone].join(' ').toLowerCase().includes(q));
  appEl.innerHTML=`<div class="section-heading"><h1>Manage Kids <span class="count">${kids.length}</span></h1><button class="checkin-btn" id="addRosterKid">+ Add Kid</button></div><input type="search" class="search-box" id="rosterSearchBox" aria-label="Search saved kids" placeholder="Search child, parent, or phone…" value="${esc(rosterSearch)}"><div class="roster-list">${matches.map(k=>`<div class="roster-row"><div class="info grow"><div class="kid-name">${esc(k.child_name)}</div><div class="kid-parent">Parent: ${esc(k.parent_name)}</div></div><div class="roster-actions"><button class="icon-btn" data-edit="${esc(k.id)}">Edit</button><button class="icon-btn danger" data-delete="${esc(k.id)}">Delete</button></div></div>`).join('')||'<div class="empty-state">No kids found.</div>'}</div><section class="backup-panel"><h2>Backup & Restore</h2><p>Keep a copy of your saved kids and attendance. Make a backup before uninstalling or clearing app data.</p><div class="toolbar"><button class="icon-btn" id="backupBtn">Save backup</button><button class="icon-btn" id="restoreBtn">Restore backup</button></div><input type="file" id="restoreFile" accept=".json,application/json" hidden></section>`;
  bindSearch('rosterSearchBox',v=>rosterSearch=v,renderRoster);
  button('addRosterKid',()=>openKidForm(null));
  appEl.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click',()=>openKidForm(kids.find(k=>k.id===b.dataset.edit))));
  appEl.querySelectorAll('[data-delete]').forEach(b=>b.addEventListener('click',()=>{const k=kids.find(k=>k.id===b.dataset.delete);confirmAction('Delete saved child',`Remove ${k.child_name} from Manage Kids? Their past attendance will remain in Check-In History.`,()=>store.deleteKid(k.id),'Delete');}));
  button('backupBtn',()=>saveFile('Children-Check-In-Backup-'+today()+'.json','application/json',JSON.stringify(store.snapshot(),null,2)));
  button('restoreBtn',()=>{if(native)native.openBackup();else document.getElementById('restoreFile').click();});
  document.getElementById('restoreFile').addEventListener('change',async e=>{const f=e.target.files[0];if(f){if(f.size>20000000){toast('Backup is too large (20 MB maximum).');return;}window.receiveBackup(await f.text());}});
}
window.receiveBackup=function(raw){
  try {const data=CheckInStore.validate(JSON.parse(raw));confirmAction('Restore backup',`Replace this tablet’s current data with ${data.kids.length} saved kids and ${data.checkins.length} attendance records from this backup? Save a backup of your current records first if you need to keep them.`,()=>{store.restore(data);selectedKids.clear();toast('Backup restored.');},'Restore');}
  catch(e){toast('Could not restore: '+e.message);}
};
window.nativeMessage=toast;
function renderHistory(){
  let rows=[],error='';try{rows=store.history(historyFilter);}catch(e){error=e.message;}
  appEl.innerHTML=`<div class="section-heading"><h1>Check-In History</h1><div class="toolbar"><button class="icon-btn" id="historyToday">Today</button><button class="icon-btn" id="historyAll">All history</button></div></div><div class="history-filters"><label>From<input type="date" id="historyFrom" value="${esc(historyFilter.from)}"></label><label>Through<input type="date" id="historyTo" value="${esc(historyFilter.to)}"></label><label>Show<select id="historyMode"><option value="arrived" ${historyFilter.mode==='arrived'?'selected':''}>Checked in during dates</option><option value="present" ${historyFilter.mode==='present'?'selected':''}>Present during dates</option></select></label><label>Status now<select id="historyStatus"><option value="">Everyone</option><option value="active" ${historyFilter.status==='active'?'selected':''}>Still checked in</option><option value="done" ${historyFilter.status==='done'?'selected':''}>Checked out</option></select></label></div><input type="search" class="search-box" id="historySearch" placeholder="Search child, parent, session, or #beeper…" aria-label="Search attendance history" value="${esc(historyFilter.search)}"><div class="error-msg" role="alert">${esc(error)}</div><div class="report-summary"><strong>${rows.length} visits · ${new Set(rows.map(c=>c.kidId)).size} children</strong><div class="toolbar"><button class="checkin-btn" id="printHistory" ${!rows.length?'disabled':''}>Print / Save PDF</button><button class="icon-btn" id="exportCsv" ${!rows.length?'disabled':''}>Export CSV</button></div></div><div class="table-scroll">${attendanceTable(rows)}</div>${!rows.length?'<div class="empty-state">No attendance found for these filters.</div>':''}<p class="subtitle">Each check-in stays here after checkout. “Present during dates” also includes visits that started before the selected dates.</p>`;
  [['historyFrom','from'],['historyTo','to'],['historyMode','mode'],['historyStatus','status']].forEach(([id,key])=>document.getElementById(id).addEventListener('change',e=>{historyFilter[key]=e.target.value;renderHistory();}));
  bindSearch('historySearch',v=>historyFilter.search=v,renderHistory);
  button('historyToday',()=>{historyFilter={...historyFilter,from:today(),to:today()};renderHistory();});
  button('historyAll',()=>{historyFilter={from:'',to:'',status:'',search:'',mode:'arrived'};renderHistory();});
  button('printHistory',()=>printReport(rows,'Attendance history',filterDescription()));
  button('exportCsv',()=>exportCsv(rows));
}
function attendanceTable(rows){return `<table><thead><tr><th>Child</th><th>Parent / Pickup parent</th><th>Beeper</th><th>Session</th><th>Checked in</th><th>Checked out</th></tr></thead><tbody>${rows.map(c=>`<tr><td>${esc(c.childName)}</td><td>${esc(c.parentName)}${c.pickupParent!==c.parentName?'<br>Pickup: '+esc(c.pickupParent):''}</td><td>#${c.beeperNumber}</td><td>${esc(c.session||'—')}</td><td>${esc(dateTime(c.checkedInAt))}</td><td>${c.checkedOutAt?esc(dateTime(c.checkedOutAt)):'<span class="status-pill">Still checked in</span>'}</td></tr>`).join('')}</tbody></table>`;}
function filterDescription(){return `${historyFilter.mode==='present'?'Present':'Checked in'}: ${historyFilter.from||'Beginning'} through ${historyFilter.to||'Latest'} · Status now: ${historyFilter.status==='active'?'Still checked in':historyFilter.status==='done'?'Checked out':'Everyone'}${historyFilter.search?' · Search: '+historyFilter.search:''}`;}
function printReport(rows,title,description){
  const html=`<!doctype html><html><head><meta charset="UTF-8"><title>Children Check In — ${esc(title)}</title><style>@page{size:landscape;margin:12mm}body{font:12px Arial,sans-serif;color:#111}h1{font-size:23px;margin:0 0 6px}h2{font-size:16px}p{color:#444}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #bbb;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eee}thead{display:table-header-group}tr{break-inside:avoid}button{padding:12px;font-size:16px;margin-bottom:18px}@media print{button{display:none}}</style></head><body><h1>Children Check In</h1><h2>${esc(title)}</h2><p>${esc(description)}</p><p>${rows.length} visits · ${new Set(rows.map(c=>c.kidId)).size} children · Generated ${esc(dateTime(new Date().toISOString()))} · Times: ${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}</p>${attendanceTable(rows)}</body></html>`;
  try {if(native){native.printReport(html);return;}const w=window.open('','_blank');if(!w)throw new Error('Allow popups to open the print report.');let printed=false;const printOnce=()=>{if(!printed){printed=true;w.print();}};w.onload=printOnce;w.document.write(html);w.document.close();setTimeout(()=>{if(w.document.readyState==='complete')printOnce();},300);}catch(e){toast(e.message);}
}
function saveFile(filename,mime,content){
  try{if(native){native.exportFile(filename,mime,content);return;}const url=URL.createObjectURL(new Blob([content],{type:mime}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){toast(e.message);}
}
function exportCsv(rows){
  const cell=value=>{let s=String(value??'');if(/^[=+@\-\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  const data=[['Child','Parent','Pickup parent','Beeper','Session','Checked in (local)','Checked out (local)','Status','Checked in (UTC)','Checked out (UTC)'],...rows.map(c=>[c.childName,c.parentName,c.pickupParent,c.beeperNumber,c.session,dateTime(c.checkedInAt),c.checkedOutAt?dateTime(c.checkedOutAt):'',c.status,c.checkedInAt,c.checkedOutAt||''])];
  saveFile('Children-Check-In-Attendance-'+today()+'.csv','text/csv','\uFEFF'+data.map(row=>row.map(cell).join(',')).join('\r\n'));
}
window.handleBack=function(){if(modalRoot.children.length){modalRoot.innerHTML='';return true;}if(currentView!=='hub'){navigate('hub');return true;}return false;};
try{
  const adapter={read(){return native?unpack(native.readData()):JSON.parse(localStorage.getItem(KEY)||'null');},write(value,expected){if(native){unpack(native.saveData(JSON.stringify(value),expected));}else{const current=JSON.parse(localStorage.getItem(KEY)||'null');if((current?.revision||0)!==expected)throw new Error('Data changed in another window. Reopen the app before saving.');localStorage.setItem(KEY,JSON.stringify(value));}}};
  store=CheckInStore.create(adapter);render();
}catch(e){appEl.innerHTML=`<div class="error-msg"><h1>Could not open saved data</h1><p>${esc(e.message)}</p><p>Close and reopen the app. Your existing data has not been replaced.</p></div>`;}

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
      <div class="modal" role="dialog" aria-modal="true" aria-label="Child details">
        <h2>${isEdit ? 'Edit' : 'Add'} Kid</h2>
        <div class="error-msg" id="kidFormError" style="display:none;"></div>

        <div class="form-row">
          <label for="f_childName">Child's Name</label>
          <input type="text" id="f_childName" value="${isEdit ? esc(existingKid.child_name) : ''}" placeholder="Full name">
        </div>
        <div class="form-row">
          <label for="f_parentName">Parent's Name</label>
          <input type="text" id="f_parentName" value="${isEdit ? esc(existingKid.parent_name) : ''}" placeholder="Full name">
        </div>
        <div class="form-row">
          <label for="f_birthday">Birthday <span class="optional-tag">(optional)</span></label>
          <input type="date" id="f_birthday" value="${isEdit && existingKid.birthday ? esc(existingKid.birthday) : ''}">
        </div>
        <div class="form-row">
          <label for="f_phone">Parent's Phone <span class="optional-tag">(optional)</span></label>
          <input type="tel" id="f_phone" value="${isEdit && existingKid.parent_phone ? esc(existingKid.parent_phone) : ''}" placeholder="(555) 555-5555">
        </div>
        <div class="form-row">
          <label for="f_address">Address <span class="optional-tag">(optional)</span></label>
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
          <button class="btn-primary" id="kidFormSave">${opts.andCheckIn ? 'Save & Select' : 'Save'}</button>
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

    const saveButton = document.getElementById('kidFormSave');
    saveButton.disabled = true;
    try {
      const kid = store.saveKid(payload, isEdit ? existingKid.id : undefined);
      if (opts.andCheckIn) selectedKids.add(kid.id);
      modalRoot.innerHTML = '';
      render();
      if (opts.andCheckIn) toast('Child selected. Add any siblings, then tap Check In.');
    } catch (e) {
      errEl.textContent = e.message;
      errEl.style.display = 'block';
      saveButton.disabled = false;
    }
  });
}
