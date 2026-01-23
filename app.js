// v5.1.1 – Raw = total games won by each player (sum of their team's games in each recorded set)
const ADMIN_PASSWORD = 'doubletrouble';
const db = firebase.firestore();
const auth = firebase.auth();
const MATCHES_COL = 'matches';
const RESULTS_COL = 'results';
let schedule = [];
let results = {};
let unsubMatches = null, unsubResults = null;

window.addEventListener('DOMContentLoaded', () => {
  const enterSection = document.getElementById('enter');
  enterSection.querySelector('.collapsible-header').onclick = () => {
    enterSection.classList.toggle('open');
  };
  document.getElementById('adminLoginBtn').onclick = adminLogin;
  document.getElementById('uploadScheduleBtn').onclick = uploadScheduleToFirestore;
  document.getElementById('resetScheduleBtn').onclick = deleteAllResults;
  document.getElementById('saveScore').onclick = saveScore;
  document.getElementById('deleteResultBtn').onclick = deleteCurrentResult;
  auth.onAuthStateChanged(() => { startRealtime(); });
});

function startRealtime(){
  if (unsubMatches) unsubMatches();
  if (unsubResults) unsubResults();
  unsubMatches = db.collection(MATCHES_COL).orderBy('round').onSnapshot(snap => {
    schedule = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    populateMatchList();
    renderMatchesTable();
    recomputeStandings();
    renderStandings();
  });
  unsubResults = db.collection(RESULTS_COL).onSnapshot(snap => {
    results = {};
    snap.forEach(doc => { results[doc.id] = doc.data(); });
    renderMatchesTable();
    recomputeStandings();
    renderStandings();
    const idx = document.getElementById('matchSelect').value;
    if(idx) onSelectMatch();
  });
}

function populateMatchList(){
  const select = document.getElementById('matchSelect');
  select.innerHTML = '<option value="">— Select a match —</option>';
  schedule.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = `Round ${m.round ?? ''}: ${m.team1} vs ${m.team2}`;
    select.appendChild(opt);
  });
  select.onchange = onSelectMatch;
}

function onSelectMatch(){
  const matchId = document.getElementById('matchSelect').value;
  const inputs = document.getElementById('scoreInputs');
  const enter = document.getElementById('enter');
  enter.classList.add('open');
  if(!matchId){ inputs.classList.add('hidden'); document.getElementById('previousResult').innerHTML=''; return; }
  const m = schedule.find(x => x.id === matchId);
  if(!m) return;
  document.getElementById('team1Label').textContent = m.team1;
  document.getElementById('team2Label').textContent = m.team2;
  inputs.classList.remove('hidden');
  const prev = document.getElementById('previousResult');
  const existing = results[matchId];
  if(existing){
    prev.innerHTML = `Previously entered: <strong>${existing.set.team1}-${existing.set.team2}</strong>`;
    document.getElementById('team1Score').value = existing.set.team1;
    document.getElementById('team2Score').value = existing.set.team2;
  } else {
    prev.innerHTML = '';
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
  await db.collection(RESULTS_COL).doc(matchId).set({
    set: { team1: s1, team2: s2 },
    winnerTeam,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  alert('Match saved');
}

async function deleteCurrentResult(){
  const matchId = document.getElementById('matchSelect').value;
  if(!matchId) return alert('Select a match');
  const exists = results[matchId];
  if(!exists) return alert('No result to delete');
  if(!confirm('Delete this match result?')) return;
  await db.collection(RESULTS_COL).doc(matchId).delete();
}

function renderMatchesTable(){
  const tbody = document.querySelector('#matchesTable tbody');
  tbody.innerHTML = '';
  schedule.forEach(m => {
    const r = results[m.id];
    const isDone = !!r;
    const setText = isDone ? `${r.set.team1}-${r.set.team2}` : '-';
    const statusHTML = isDone
      ? `<span class="badge badge-success"><span class="dot"></span>Completed</span>`
      : `<span class="badge badge-muted"><span class="dot"></span>Not played</span>`;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${m.round ?? ''}</td>
      <td>${m.team1} <span class="vs">vs</span> ${m.team2}</td>
      <td><strong>${setText}</strong></td>
      <td>${statusHTML}</td>
      <td>
        <button data-action="edit" data-id="${m.id}">Edit</button>
        <button class="danger" data-action="clear" data-id="${m.id}">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
  tbody.querySelectorAll('button').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-id');
      document.getElementById('matchSelect').value = id;
      onSelectMatch();
      if(btn.getAttribute('data-action')==='clear' && results[id]){
        if(confirm('Delete this match result?')){
          await db.collection(RESULTS_COL).doc(id).delete();
        }
      }
    };
  });
}

// Standings: Raw = per-player total games won (sum of their team's games each recorded set)
function recomputeStandings(){
  const s = {};
  function ensure(p){ if(!s[p]) s[p] = { Player:p, Pts:0, MP:0, W:0, Raw:0, L:0 }; }

  // Ensure all players from schedule exist
  schedule.forEach(m => {
    const t1 = m.team1.split('&').map(x=>x.trim());
    const t2 = m.team2.split('&').map(x=>x.trim());
    [...t1, ...t2].forEach(ensure);
  });

  // Apply results
  Object.entries(results).forEach(([id, r]) => {
    const m = schedule.find(x => x.id === id);
    if(!m) return;
    const t1 = m.team1.split('&').map(x=>x.trim());
    const t2 = m.team2.split('&').map(x=>x.trim());

    // Everyone who played increments MP by 1
    [...t1, ...t2].forEach(p => s[p].MP += 1);

    // Wins/Losses and Points as before
    const winners = r.winnerTeam==='team1' ? t1 : t2;
    const losers  = r.winnerTeam==='team1' ? t2 : t1;
    winners.forEach(p => { s[p].W += 1; s[p].Pts += 1; });
    losers.forEach(p  => { s[p].L += 1; });

    // NEW: Raw accumulates GAMES won by the player's team
    const gamesT1 = Number(r.set?.team1 || 0);
    const gamesT2 = Number(r.set?.team2 || 0);
    t1.forEach(p => { s[p].Raw += gamesT1; });
    t2.forEach(p => { s[p].Raw += gamesT2; });
  });

  window.__standings = s;
}

function renderStandings(){
  const s = window.__standings || {};
  const rows = Object.values(s).sort((a,b)=>
    b.Pts - a.Pts ||
    b.W - a.W ||
    a.Player.localeCompare(b.Player)
  );
  const tbody = document.querySelector('#standingsTable tbody');
  tbody.innerHTML = '';
  rows.forEach((r,i)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i+1}</td>
      <td style="text-align:left">${r.Player}</td>
      <td><strong>${r.Pts}</strong></td>
      <td>${r.MP}</td>
      <td>${r.W}</td>
      <td>${r.Raw}</td>
      <td>${r.L}</td>
    `;
    tbody.appendChild(tr);
  });
}

function adminLogin(){
  const pwd = prompt('Enter admin password:');
  if(pwd === ADMIN_PASSWORD){
    document.getElementById('adminPanel').style.display = 'block';
    alert('Admin mode enabled');
  } else {
    alert('Incorrect password');
  }
}

async function uploadScheduleToFirestore(){
  const file = document.getElementById('scheduleUpload').files[0];
  if(!file) return alert('Choose a schedule .json file');
  const text = await file.text();
  let arr;
  try{ arr = JSON.parse(text); } catch{ return alert('Invalid JSON'); }
  if(!Array.isArray(arr)) return alert('Invalid format: expected an array');
  if(!confirm('This will overwrite the current matches collection and clear all results. Continue?')) return;
  const batchSize = 400;
  async function clearCollection(col){
    const snap = await db.collection(col).get();
    const chunks = [];
    let cur = [];
    snap.forEach(d=>{ cur.push(d); if(cur.length>=batchSize){ chunks.push(cur); cur=[]; } });
    if(cur.length) chunks.push(cur);
    for(const group of chunks){
      const batch = db.batch();
      group.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
    }
  }
  await clearCollection(MATCHES_COL);
  await clearCollection(RESULTS_COL);
  const batch = db.batch();
  arr.forEach((m, idx) => {
    const id = String(idx);
    const ref = db.collection(MATCHES_COL).doc(id);
    batch.set(ref, { round: m.round, team1: m.team1, team2: m.team2 });
  });
  await batch.commit();
  alert('Schedule uploaded to Firestore');
}

async function deleteAllResults(){
  if(!confirm('Delete ALL results from Firestore?')) return;
  const snap = await db.collection(RESULTS_COL).get();
  const batch = db.batch();
  snap.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
  alert('All results deleted');
}
