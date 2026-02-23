// v5.3.5 – Restores status badge styles; logic same as v5.3.4 (subs get no stats)
const ADMIN_PASSWORD = 'doubletrouble';
const db = firebase.firestore();
const auth = firebase.auth();

const MATCHES_COL = 'matches';
const RESULTS_COL = 'results';
const PLAYERS_COL = 'players';
const SUBS_COL = 'substitutions';

let schedule = [];
let results = {};
let playersMap = {};
let subsByMatch = {};

let unsubMatches = null, unsubResults = null, unsubPlayers = null, unsubSubs = null;
let isAdmin = false;

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('adminLoginBtn').onclick = adminLogin;
  document.getElementById('uploadScheduleBtn').onclick = uploadScheduleToFirestore;
  document.getElementById('resetScheduleBtn').onclick = deleteAllResults;
  document.getElementById('saveScore').onclick = saveScore;
  document.getElementById('deleteResultBtn').onclick = deleteCurrentResult;
  document.querySelector('#standingsTable tbody').addEventListener('click', onStandingsClick);
  document.querySelector('#standingsTable tbody').addEventListener('click', onStandingsPhoneClick);
  const exportBtn = document.getElementById('exportPhonesBtn'); if (exportBtn) exportBtn.onclick = exportPhonesCsv;
  const subsMatchSelect = document.getElementById('subsMatchSelect'); if (subsMatchSelect) subsMatchSelect.onchange = onSubsMatchChange;
  const addSubBtn = document.getElementById('addSubBtn'); if (addSubBtn) addSubBtn.onclick = addSubstitution;
  auth.onAuthStateChanged(() => { startRealtime(); });
});

function adminLogin(){
  const pwd = prompt('Enter admin password:');
  if(pwd === ADMIN_PASSWORD){
    isAdmin = true;
    document.getElementById('adminPanel').style.display = 'block';
    document.getElementById('subsPanel').style.display = 'block';
    alert('Admin mode enabled. Substitutes receive no stats; substituted players are zeroed for that round.');
  } else {
    alert('Incorrect password');
  }
}

function startRealtime(){
  if (unsubMatches) unsubMatches();
  if (unsubResults) unsubResults();
  if (unsubPlayers) unsubPlayers();
  if (unsubSubs) unsubSubs();

  unsubMatches = db.collection(MATCHES_COL).orderBy('round').onSnapshot(snap => {
    schedule = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    populateMatchList();
    populateSubsMatchList();
    renderMatchesTable();
    recomputeStandings();
    renderStandings();
  });

  unsubResults = db.collection(RESULTS_COL).onSnapshot(snap => {
    results = {}; snap.forEach(doc => { results[doc.id] = doc.data(); });
    renderMatchesTable(); recomputeStandings(); renderStandings();
  });

  unsubPlayers = db.collection(PLAYERS_COL).onSnapshot(snap => {
    playersMap = {}; snap.forEach(doc => { playersMap[doc.id] = doc.data(); });
    renderStandings();
  });

  unsubSubs = db.collection(SUBS_COL).onSnapshot(snap => {
    subsByMatch = {}; snap.forEach(doc => { const d = doc.data() || {}; if (!subsByMatch[d.matchId]) subsByMatch[d.matchId] = {}; subsByMatch[d.matchId][d.original] = d.substitute; });
    renderSubsTable(); recomputeStandings(); renderStandings();
  });
}

// ---- Helpers ----
function splitTeam(teamStr) { return (teamStr || '').split('&').map(x => x.trim()).filter(Boolean); }
function populateMatchList(){
  const select = document.getElementById('matchSelect'); if (!select) return;
  select.innerHTML = '<option value="">— Select a match —</option>';
  schedule.forEach((m) => { const opt = document.createElement('option'); opt.value = m.id; opt.textContent = `Round ${m.round ?? ''}: ${m.team1} vs ${m.team2}`; select.appendChild(opt); });
  select.onchange = onSelectMatch;
}
function onSelectMatch(){
  const matchId = document.getElementById('matchSelect').value;
  const inputs = document.getElementById('scoreInputs');
  if(!matchId){ inputs.classList.add('hidden'); document.getElementById('previousResult').innerHTML=''; return; }
  const m = schedule.find(x => x.id === matchId); if(!m) return;
  document.getElementById('team1Label').textContent = m.team1;
  document.getElementById('team2Label').textContent = m.team2;
  inputs.classList.remove('hidden');
  const existing = results[matchId];
  if(existing){
    document.getElementById('previousResult').innerHTML = `Previously entered: <strong>${existing.set.team1}-${existing.set.team2}</strong>`;
    document.getElementById('team1Score').value = existing.set.team1;
    document.getElementById('team2Score').value = existing.set.team2;
  } else {
    document.getElementById('previousResult').innerHTML = '';
    document.getElementById('team1Score').value = '';
    document.getElementById('team2Score').value = '';
  }
}

async function saveScore(){
  const matchId = document.getElementById('matchSelect').value;
  if(!matchId) return alert('Select a match');
  const s1 = Number(document.getElementById('team1Score').value);
  const s2 = Number(document.getElementById('team2Score').value);
  if(!Number.isFinite(s1) || !Number.isFinite(s2)) return alert('Enter valid numbers');
  if(s1 === s2) return alert('Scores cannot be tied');
  const winnerTeam = s1 > s2 ? 'team1' : 'team2';
  await db.collection(RESULTS_COL).doc(matchId).set({ set: { team1: s1, team2: s2 }, winnerTeam, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
  alert('Match saved');
}
async function deleteCurrentResult(){
  const matchId = document.getElementById('matchSelect').value; if(!matchId) return alert('Select a match');
  if(!results[matchId]) return alert('No result to delete');
  if(!confirm('Delete this match result?')) return; await db.collection(RESULTS_COL).doc(matchId).delete();
}

function renderMatchesTable(){
  const tbody = document.querySelector('#matchesTable tbody'); if (!tbody) return; tbody.innerHTML = '';
  schedule.forEach(m => {
    const r = results[m.id]; const isDone = !!r; const setText = isDone ? `${r.set.team1}-${r.set.team2}` : '-';
    const statusHTML = isDone ? `<span class=\"badge badge-success\"><span class=\"dot\"></span>Completed</span>` : `<span class=\"badge badge-muted\"><span class=\"dot\"></span>Not played</span>`;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${m.round ?? ''}</td><td>${m.team1} <span class=\"vs\">vs</span> ${m.team2}</td><td><strong>${setText}</strong></td><td>${statusHTML}</td><td><button data-action=\"edit\" data-id=\"${m.id}\">Edit</button><button class=\"danger\" data-action=\"clear\" data-id=\"${m.id}\">Delete</button></td>`;
    tbody.appendChild(tr);
  });
}

// ---------- Standings logic (subs do NOT get stats) ----------
function recomputeStandings(){
  const s = {}; function ensure(p){ if(!s[p]) s[p] = { Player:p, Pts:0, MP:0, W:0, Raw:0, L:0 }; }
  schedule.forEach(m => { splitTeam(m.team1).forEach(ensure); splitTeam(m.team2).forEach(ensure); });
  Object.keys(playersMap||{}).forEach(ensure);

  Object.entries(results).forEach(([id, r]) => {
    const m = schedule.find(x => x.id === id); if(!m) return;
    const t1 = splitTeam(m.team1); const t2 = splitTeam(m.team2);
    const map = subsByMatch[id] || {}; // { original: substitute }

    // EFFECTIVE participants: remove originals who were substituted; DO NOT add substitutes
    const t1Eff = t1.filter(p => !(p in map));
    const t2Eff = t2.filter(p => !(p in map));

    [...t1Eff, ...t2Eff].forEach(ensure);
    [...t1Eff, ...t2Eff].forEach(p => s[p].MP += 1);

    const winners = r.winnerTeam==='team1' ? t1Eff : t2Eff;
    const losers  = r.winnerTeam==='team1' ? t2Eff : t1Eff;
    winners.forEach(p => { s[p].W += 1; s[p].Pts += 1; });
    losers.forEach(p  => { s[p].L += 1; });

    const gamesT1 = Number(r.set?.team1 || 0); const gamesT2 = Number(r.set?.team2 || 0);
    t1Eff.forEach(p => { s[p].Raw += gamesT1; });
    t2Eff.forEach(p => { s[p].Raw += gamesT2; });
  });

  window.___standings = s;
}

function renderStandings(){
  const s = window.___standings || {};
  const rows = Object.values(s).sort((a,b) =>
  (b.Pts - a.Pts) ||
  (b.Raw - a.Raw) ||
  a.Player.localeCompare(b.Player)
)=> (b.Pts - a.Pts) || (b.W - a.W) || a.Player.localeCompare(b.Player));
  const tbody = document.querySelector('#standingsTable tbody'); if (!tbody) return; tbody.innerHTML = '';

  rows.forEach((r,i)=>{
    const phoneRaw = playersMap[r.Player]?.phone || '';
    const digits = (phoneRaw.match(/\d+/g) || []).join('');
    const waLink = digits ? `https://wa.me/${digits}` : '';
    const phoneHTML = digits
      ? `<a href=\"${waLink}\" target=\"_blank\" class=\"wa-icon\" aria-label=\"Chat on WhatsApp\" title=\"Chat on WhatsApp\"><svg viewBox=\"0 0 32 32\" class=\"wa-svg\" role=\"img\" aria-hidden=\"true\"><path fill=\"currentColor\" d=\"M16 3C9.38 3 4 8.38 4 15c0 2.31.66 4.47 1.8 6.3L4 29l7.9-1.8A11.9 11.9 0 0 0 16 27c6.62 0 12-5.38 12-12S22.62 3 16 3zm0 22.4c-1.7 0-3.3-.44-4.72-1.22l-.34-.19-4.04.92.86-3.94-.2-.33A9.37 9.37 0 0 1 6.6 15c0-5.19 4.21-9.4 9.4-9.4s9.4 4.21 9.4 9.4-4.21 9.4-9.4 9.4zm5.14-6.93c-.28-.14-1.66-.82-1.92-.91-.26-.1-.45-.14-.65.14-.2.29-.74.91-.91 1.1-.17.2-.34.22-.63.08-.28-.14-1.18-.43-2.25-1.39-.83-.74-1.39-1.66-1.55-1.94-.17-.29-.02-.45.12-.59.13-.13.29-.34.43-.51.14-.17.17-.29.26-.48.08-.2.04-.36-.02-.51-.06-.14-.65-1.6-.89-2.19-.23-.56-.47-.48-.65-.49l-.55-.01c-.2 0-.51.08-
.78.36-.26.29-1 1-1 2.43s1.03 2.82 1.18 3.01c.14.2 2.03 3.1 4.92 4.35.69.3 1.22.48 1.64.61.69.22 1.31.19 1.8.12.55-.08 1.66-.68 1.9-1.34.23-.66.23-1.22.16-1.34-.06-.12-.25-.19-.53-.33z\"/></svg></a>`
      : (isAdmin ? `<button class=\"add-phone\" data-player=\"${r.Player}\">+ add</button>` : '');
    const substitutedCount = playersMap[r.Player]?.substitutedCount || 0;
    const subbingCount = playersMap[r.Player]?.subbingCount || 0;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td class=\"player-cell\" data-orig=\"${r.Player}\" title=\"${isAdmin ? 'Click to rename' : ''}\" style=\"text-align:left; cursor:${isAdmin ? 'pointer' : 'default'}\">${r.Player}</td>
      <td class=\"phone-cell\" data-player=\"${r.Player}\" style=\"text-align:left\">${phoneHTML}</td>
      <td>${substitutedCount}</td>
      <td>${subbingCount}</td>
      <td><strong>${r.Pts}</strong></td>
      <td>${r.MP}</td>
      <td>${r.W}</td>
      <td>${r.Raw}</td>
      <td>${r.L}</td>
    `;
    tbody.appendChild(tr);
  });
}

function onStandingsClick(e){
  if(!isAdmin) return; const td = e.target.closest('td.player-cell'); if(!td) return;
  const original = (td.getAttribute('data-orig') || '').trim(); if(!original) return;
  const proposed = prompt(`Rename player \"${original}\" to:`, ''); if (proposed == null) return;
  const newName = proposed.trim(); if(!newName || newName === original) return; renamePlayerAcrossMatches(original, newName);
}
function onStandingsPhoneClick(e){
  if(!isAdmin) return; const addBtn = e.target.closest('button.add-phone'); if (addBtn) { const player = addBtn.getAttribute('data-player'); return setOrEditPhone(player); }
  const td = e.target.closest('td.phone-cell'); if (td && e.target.tagName !== 'A') { const player = td.getAttribute('data-player'); if (player) return setOrEditPhone(player); }
}

async function setOrEditPhone(playerName){
  const current = playersMap[playerName]?.phone || '';
  const input = prompt(`Enter ${playerName}'s phone (digits only, E.164 without +).\nLeave empty to remove.`, current);
  if (input == null) return; const digits = (input.match(/\d+/g) || []).join(''); const ref = db.collection(PLAYERS_COL).doc(playerName);
  if (!digits) { if (current && confirm(`Clear phone for ${playerName}?`)) await ref.delete(); return; }
  await ref.set({ phone: digits, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
}

async function renamePlayerAcrossMatches(originalName, newName) {
  const affected = [];
  for (const m of schedule) {
    const t1 = splitTeam(m.team1); const t2 = splitTeam(m.team2);
    const hasInT1 = t1.includes(originalName); const hasInT2 = t2.includes(originalName);
    if (!hasInT1 && !hasInT2) continue;
    const newTeam1 = hasInT1 ? m.team1.replace(originalName, newName) : m.team1;
    const newTeam2 = hasInT2 ? m.team2.replace(originalName, newName) : m.team2;
    affected.push({ id: m.id, newTeam1, newTeam2 });
  }
  if (affected.length === 0) { alert(`No matches found with player \"${originalName}\".`); return; }
  if (!confirm(`Update ${affected.length} match(es) to rename \"${originalName}\" -> \"${newName}\"?`)) return;
  const CHUNK = 400; try {
    for (let i = 0; i < affected.length; i += CHUNK) {
      const batch = db.batch(); const slice = affected.slice(i, i + CHUNK);
      slice.forEach(({ id, newTeam1, newTeam2 }) => { const ref = db.collection(MATCHES_COL).doc(String(id)); batch.update(ref, { team1: newTeam1, team2: newTeam2 }); });
      await batch.commit();
    }
  } catch (err) { console.error(err); alert('Failed to rename: ' + (err && err.message ? err.message : err)); }
}

function exportPhonesCsv() {
  if (!isAdmin) { alert('Admin only'); return; }
  const entries = Object.keys(playersMap).sort((a,b)=>a.localeCompare(b)).map(name => ({ Player: name, Phone: playersMap[name]?.phone || '', SubbedOut: playersMap[name]?.substitutedCount||0, SubbedIn: playersMap[name]?.subbingCount||0 }));
  if (entries.length === 0) { alert('No phone numbers to export.'); return; }
  const header = ['Player','Phone','SubbedOut','SubbedIn'];
  const lines = [header.join(',')];
  entries.forEach(row => { const player = '"' + String(row.Player).replace(/"/g,'""') + '"'; const phone  = '"' + String(row.Phone).replace(/"/g,'""') + '"'; lines.push([player, phone, row.SubbedOut, row.SubbedIn].join(',')); });
  const csv = lines.join('\r\n'); const dt = new Date(); const y=dt.getFullYear(); const m=String(dt.getMonth()+1).padStart(2,'0'); const d=String(dt.getDate()).padStart(2,'0');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8;'})); a.download = `phones-${y}${m}${d}.csv`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(a.href);
}

// -------- Substitutions UI --------
function uniquePlayersAcrossSchedule(){ const set=new Set(); schedule.forEach(m=>{ splitTeam(m.team1).forEach(p=>set.add(p)); splitTeam(m.team2).forEach(p=>set.add(p)); }); Object.keys(playersMap||{}).forEach(p=>set.add(p)); return Array.from(set).sort((a,b)=>a.localeCompare(b)); }
function playersInMatch(matchId){ const m = schedule.find(x=>x.id===matchId); if(!m) return []; return [...splitTeam(m.team1), ...splitTeam(m.team2)]; }
function populateSubsMatchList(){ const sel=document.getElementById('subsMatchSelect'); if(!sel) return; sel.innerHTML='<option value="">— Select a match —</option>'; schedule.forEach(m=>{ const opt=document.createElement('option'); opt.value=m.id; opt.textContent=`Round ${m.round ?? ''}: ${m.team1} vs ${m.team2}`; sel.appendChild(opt); }); }
function onSubsMatchChange(){ const matchId=document.getElementById('subsMatchSelect').value; const form=document.getElementById('subsForm'); if(!form) return; if(!matchId){ form.classList.add('hidden'); renderSubsTable(); return; } form.classList.remove('hidden'); const originalSel=document.getElementById('subsOriginal'); originalSel.innerHTML=''; playersInMatch(matchId).forEach(p=>{ const opt=document.createElement('option'); opt.value=p; opt.textContent=p; originalSel.appendChild(opt); }); const list=document.getElementById('allPlayersList'); list.innerHTML=''; uniquePlayersAcrossSchedule().forEach(p=>{ const opt=document.createElement('option'); opt.value=p; list.appendChild(opt); }); renderSubsTable(); }

async function addSubstitution(){
  if(!isAdmin) return alert('Admin only');
  const matchId=document.getElementById('subsMatchSelect').value; if(!matchId) return alert('Select a match');
  const m=schedule.find(x=>x.id===matchId); if(!m) return alert('Invalid match');
  const original=(document.getElementById('subsOriginal').value||'').trim(); if(!original) return alert('Choose the original player');
  const substitute=(document.getElementById('subsSubstitute').value||'').trim(); if(!substitute) return alert('Enter the substitute player');
  const inMatch=playersInMatch(matchId); if(!inMatch.includes(original)) return alert(`\"${original}\" is not scheduled in this match`);
  if(original===substitute) return alert('Original and substitute cannot be the same person');
  const id=`${matchId}__${original}`; const docRef=db.collection(SUBS_COL).doc(id); const snap=await docRef.get();
  const batch=db.batch();
  if(snap.exists){
    const prev=snap.data()||{}; if(prev.substitute===substitute) { alert('This substitution already exists.'); return; }
    if(!confirm(`Update substitution: ${original} -> ${prev.substitute}  to  ${original} -> ${substitute}?`)) return;
    batch.set(docRef,{matchId,round:m.round??null,original,substitute,updatedAt:firebase.firestore.FieldValue.serverTimestamp(),updatedBy:(firebase.auth().currentUser?.uid)||'admin'}, {merge:true});
    const oldSubRef=db.collection(PLAYERS_COL).doc(prev.substitute); batch.set(oldSubRef,{ subbingCount: firebase.firestore.FieldValue.increment(-1), updatedAt: firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
    const newSubRef=db.collection(PLAYERS_COL).doc(substitute); batch.set(newSubRef,{ subbingCount: firebase.firestore.FieldValue.increment(1), updatedAt: firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
  } else {
    batch.set(docRef,{matchId,round:m.round??null,original,substitute,createdAt:firebase.firestore.FieldValue.serverTimestamp(),createdBy:(firebase.auth().currentUser?.uid)||'admin'}, {merge:true});
    const subRef=db.collection(PLAYERS_COL).doc(substitute); batch.set(subRef,{ subbingCount: firebase.firestore.FieldValue.increment(1), updatedAt: firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
    const origRef=db.collection(PLAYERS_COL).doc(original); batch.set(origRef,{ substitutedCount: firebase.firestore.FieldValue.increment(1), updatedAt: firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
  }
  await batch.commit(); document.getElementById('subsSubstitute').value=''; renderSubsTable();
}
async function deleteSubstitution(id, original, substitute){ if(!isAdmin) return; if(!confirm('Remove this substitution?')) return; const batch=db.batch(); batch.delete(db.collection(SUBS_COL).doc(id)); const subRef=db.collection(PLAYERS_COL).doc(substitute); batch.set(subRef,{ subbingCount: firebase.firestore.FieldValue.increment(-1), updatedAt: firebase.firestore.FieldValue.serverTimestamp() },{merge:true}); const origRef=db.collection(PLAYERS_COL).doc(original); batch.set(origRef,{ substitutedCount: firebase.firestore.FieldValue.increment(-1), updatedAt: firebase.firestore.FieldValue.serverTimestamp() },{merge:true}); await batch.commit(); renderSubsTable(); }
function renderSubsTable(){ const tbody=document.querySelector('#subsTable tbody'); if(!tbody) return; const matchId=(document.getElementById('subsMatchSelect')?.value)||''; tbody.innerHTML=''; if(!matchId) return; const m=schedule.find(x=>x.id===matchId); const mapping=subsByMatch[matchId]||{}; Object.keys(mapping).sort((a,b)=>a.localeCompare(b)).forEach(original=>{ const substitute=mapping[original]; const id=`${matchId}__${original}`; const tr=document.createElement('tr'); tr.innerHTML=`<td>${m?.round ?? ''}</td><td>${original}</td><td>${substitute}</td><td><button class=\"danger\" data-id=\"${id}\" data-original=\"${original}\" data-sub=\"${substitute}\">Delete</button></td>`; tbody.appendChild(tr); }); tbody.querySelectorAll('button.danger').forEach(btn=>{ btn.onclick=()=>{ const id=btn.getAttribute('data-id'); const orig=btn.getAttribute('data-original'); const sub=btn.getAttribute('data-sub'); deleteSubstitution(id,orig,sub); }; }); }

// Upload/Reset
async function uploadScheduleToFirestore(){ const file=document.getElementById('scheduleUpload').files[0]; if(!file) return alert('Choose a schedule .json file'); const text=await file.text(); let arr; try{ arr=JSON.parse(text);}catch{ return alert('Invalid JSON'); } if(!Array.isArray(arr)) return alert('Invalid format: expected an array'); if(!confirm('This will overwrite the current matches collection and clear all results. Continue?')) return; const batchSize=400; async function clearCollection(col){ const snap=await db.collection(col).get(); const chunks=[]; let cur=[]; snap.forEach(d=>{ cur.push(d); if(cur.length>=batchSize){ chunks.push(cur); cur=[]; } }); if(cur.length) chunks.push(cur); for(const group of chunks){ const batch=db.batch(); group.forEach(doc=>batch.delete(doc.ref)); await batch.commit(); } } await clearCollection(MATCHES_COL); await clearCollection(RESULTS_COL); const batch=db.batch(); arr.forEach((m,idx)=>{ const id=String(idx); const ref=db.collection(MATCHES_COL).doc(id); batch.set(ref,{ round:m.round, team1:m.team1, team2:m.team2 }); }); await batch.commit(); alert('Schedule uploaded to Firestore'); }
async function deleteAllResults(){ if(!confirm('Delete ALL results from Firestore?')) return; const snap=await db.collection(RESULTS_COL).get(); const batch=db.batch(); snap.forEach(doc=>batch.delete(doc.ref)); await batch.commit(); alert('All results deleted'); }
