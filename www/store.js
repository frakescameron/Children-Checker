(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CheckInStore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const empty = () => ({version: 2, revision: 0, kids: [], checkins: []});
  const text = value => String(value || '').trim();
  const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  function validate(data) {
    if (!data || data.version !== 2 || !Number.isSafeInteger(data.revision) || data.revision < 0 || !Array.isArray(data.kids) || !Array.isArray(data.checkins)) throw new Error('This is not a Children Check In backup.');
    const kidIds = new Set(), visitIds = new Set(), activeKids = new Set(), groups = new Map(), numbers = new Map();
    const notesValid = notes => Array.isArray(notes) && notes.every(n => n && typeof n.text === 'string' && typeof n.flagged === 'boolean');
    for (const k of data.kids) {
      if (typeof k.id !== 'string' || !k.id || kidIds.has(k.id) || typeof k.child_name !== 'string' || typeof k.parent_name !== 'string' || !text(k.child_name) || !text(k.parent_name) || !notesValid(k.notes) || ['birthday','parent_phone','address'].some(key => k[key] != null && typeof k[key] !== 'string')) throw new Error('The backup contains an invalid child record.');
      kidIds.add(k.id);
    }
    for (const c of data.checkins) {
      if (!c || typeof c.checkinId !== 'string' || !c.checkinId || visitIds.has(c.checkinId) || typeof c.kidId !== 'string' || !text(c.childName) || !text(c.parentName) || !text(c.pickupParent) || typeof c.groupId !== 'string' || !c.groupId || !Number.isInteger(c.beeperNumber) || c.beeperNumber < 1 || c.beeperNumber > 30 || !validDate(c.checkedInAt) || !notesValid(c.notes) || !['active', 'done'].includes(c.status) || (c.status === 'done' && (!validDate(c.checkedOutAt) || Date.parse(c.checkedOutAt) < Date.parse(c.checkedInAt))) || (c.status === 'active' && c.checkedOutAt !== null)) throw new Error('The backup contains an invalid attendance record.');
      if (['childName','parentName','pickupParent'].some(key => typeof c[key] !== 'string') || (c.session != null && typeof c.session !== 'string')) throw new Error('The backup contains invalid attendance details.');
      visitIds.add(c.checkinId);
      if (c.status === 'active') {
        if (!kidIds.has(c.kidId) || activeKids.has(c.kidId)) throw new Error('The backup contains duplicate or missing active children.');
        if (numbers.has(c.beeperNumber) && numbers.get(c.beeperNumber) !== c.groupId) throw new Error('Two active groups share the same beeper.');
        if (groups.has(c.groupId) && (groups.get(c.groupId).beeperNumber !== c.beeperNumber || groups.get(c.groupId).pickupParent !== c.pickupParent)) throw new Error('The backup contains an inconsistent group.');
        activeKids.add(c.kidId); numbers.set(c.beeperNumber, c.groupId); groups.set(c.groupId, c);
      }
    }
    return clone(data);
  }
  function create(adapter, clock = () => new Date().toISOString(), id = () => 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)) {
    let state = validate(adapter.read() || empty());
    function commit(change) {
      const next = clone(state);
      const result = change(next);
      next.revision = state.revision + 1;
      validate(next);
      adapter.write(next, state.revision); // A failed save must never appear successful in the UI.
      state = next;
      return clone(result === undefined ? true : result);
    }
    return {
      snapshot: () => clone(state),
      kids: () => clone(state.kids).sort((a,b) => a.child_name.localeCompare(b.child_name)),
      active: () => clone(state.checkins.filter(c => c.status === 'active')).sort((a,b) => a.beeperNumber - b.beeperNumber),
      saveKid(payload, kidId) {
        return commit(s => {
          const existing = kidId ? s.kids.find(k => k.id === kidId) : null;
          if (kidId && !existing) throw new Error('Child not found.');
          if (!text(payload.childName) || !text(payload.parentName)) throw new Error("Child's name and parent's name are required.");
          const kid = {...existing, id: existing ? existing.id : id(), child_name: text(payload.childName), parent_name: text(payload.parentName), birthday: text(payload.birthday), parent_phone: text(payload.parentPhone), address: text(payload.address), notes: (payload.notes || []).filter(n => text(n.text)).map(n => ({text: text(n.text), flagged: !!n.flagged})), created_at: existing ? existing.created_at : clock(), updated_at: clock()};
          if (existing) s.kids[s.kids.indexOf(existing)] = kid; else s.kids.push(kid);
          return kid;
        });
      },
      deleteKid(kidId) {
        return commit(s => {
          if (s.checkins.some(c => c.kidId === kidId && c.status === 'active')) throw new Error('Check this child out before deleting their saved profile.');
          s.kids = s.kids.filter(k => k.id !== kidId);
          // Visit snapshots are deliberately retained when a saved profile is deleted.
        });
      },
      checkIn(kidIds, options = {}) {
        return commit(s => {
          if (!Array.isArray(kidIds) || !kidIds.length || new Set(kidIds).size !== kidIds.length) throw new Error('Select the children to check in.');
          const selected = kidIds.map(kidId => {
            const k = s.kids.find(k => k.id === kidId);
            if (!k) throw new Error('A selected child was not found.');
            if (s.checkins.some(c => c.kidId === kidId && c.status === 'active')) throw new Error(k.child_name + ' is already checked in.');
            return k;
          });
          const active = s.checkins.filter(c => c.status === 'active');
          const existing = options.groupId ? active.find(c => c.groupId === options.groupId) : null;
          if (options.groupId && !existing) throw new Error('That group has already checked out. Choose a new beeper.');
          const used = new Set(active.map(c => c.beeperNumber));
          let beeperNumber = existing ? existing.beeperNumber : 1;
          if (!existing) while (used.has(beeperNumber) && beeperNumber <= 30) beeperNumber++;
          if (beeperNumber > 30) throw new Error('All 30 beepers are in use. You can still add kids to an existing group.');
          const pickupParent = existing ? existing.pickupParent : text(options.pickupParent);
          if (!pickupParent) throw new Error('Enter the name of the parent collecting this group.');
          const groupId = existing ? existing.groupId : id(), now = clock();
          const records = selected.map(k => ({checkinId: id(), kidId: k.id, groupId, beeperNumber, pickupParent, childName: k.child_name, parentName: k.parent_name, parentPhone: k.parent_phone, birthday: k.birthday, address: k.address, notes: clone(k.notes), session: existing ? existing.session : text(options.session), status: 'active', checkedInAt: now, checkedOutAt: null}));
          s.checkins.push(...records);
          return {beeperNumber, pickupParent, records};
        });
      },
      checkOut(visitIds) {
        return commit(s => {
          if (!visitIds.length) throw new Error('No active children were selected.');
          const now = clock();
          for (const visitId of visitIds) {
            const c = s.checkins.find(c => c.checkinId === visitId && c.status === 'active');
            if (!c) throw new Error('This child has already checked out.');
            if (Date.parse(now) < Date.parse(c.checkedInAt)) throw new Error('The tablet clock is earlier than this check-in. Correct the tablet date and time first.');
            c.status = 'done'; c.checkedOutAt = now;
          }
        });
      },
      history(filter = {}) {
        const from = filter.from ? new Date(filter.from + 'T00:00:00').getTime() : -Infinity;
        const end = filter.to ? new Date(filter.to + 'T00:00:00') : null;
        if (end) end.setDate(end.getDate() + 1);
        const until = end ? end.getTime() : Infinity;
        if (from >= until) throw new Error('The end date must be on or after the start date.');
        const q = text(filter.search).toLowerCase();
        return clone(state.checkins.filter(c => {
          const arrive = Date.parse(c.checkedInAt), leave = c.checkedOutAt ? Date.parse(c.checkedOutAt) : Infinity;
          const inRange = filter.mode === 'present' ? arrive < until && leave > from : arrive >= from && arrive < until;
          return inRange && (!filter.status || c.status === filter.status) && (!q || [c.childName,c.parentName,c.pickupParent,c.session,'#'+c.beeperNumber].join(' ').toLowerCase().includes(q));
        })).sort((a,b) => Date.parse(b.checkedInAt) - Date.parse(a.checkedInAt) || a.childName.localeCompare(b.childName));
      },
      restore(data) {
        const checked = validate(data);
        return commit(s => { s.kids = checked.kids; s.checkins = checked.checkins; });
      }
    };
  }
  return {create, validate, empty};
});
