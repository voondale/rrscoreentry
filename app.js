
const ADMIN_PASSWORD='doubletrouble';
const STORAGE_SCHEDULE_KEY='sched_v4';
const STORAGE_RESULTS_KEY='results_v4';

let schedule=[];
let results=JSON.parse(localStorage.getItem(STORAGE_RESULTS_KEY)||'{}');
let standings={};

window.onload=()=>{
 document.querySelector('#adminLoginBtn').onclick=adminLogin;
 document.querySelector('#uploadScheduleBtn').onclick=uploadSchedule;
 document.querySelector('#resetScheduleBtn').onclick=()=>{localStorage.removeItem(STORAGE_SCHEDULE_KEY);loadSchedule();};
 document.querySelector('#saveScore').onclick=saveScore;
 document.querySelector('#deleteResultBtn').onclick=deleteResult;

 // Collapsible
 const enterSection=document.getElementById('enter');
 enterSection.querySelector('.collapsible-header').onclick=()=>{
   enterSection.classList.toggle('open');
 };

 loadSchedule();
};

async function loadSchedule(){
 const custom=localStorage.getItem(STORAGE_SCHEDULE_KEY);
 if(custom) schedule=JSON.parse(custom);
 else{
   try{ const r=await fetch('schedule.json'); schedule=await r.json(); }
   catch{ schedule=[]; }
 }
 populateMatchList(); renderMatchesTable(); recomputeStandings(); renderStandings();
}

function populateMatchList(){
 const sel=document.getElementById('matchSelect'); sel.innerHTML='<option value="">— Select a match —</option>';
 schedule.forEach((m,i)=>{
   let o=document.createElement('option'); o.value=i;
   o.textContent=`Round ${m.round}: ${m.team1} vs ${m.team2}`;
   sel.appendChild(o);
 });
 sel.onchange=onSelectMatch;
}

function onSelectMatch(){
 const idx=document.getElementById('matchSelect').value;
 const enter=document.getElementById('enter'); enter.classList.add('open');
 const inputs=document.getElementById('scoreInputs');
 if(idx===''){ inputs.classList.add('hidden'); return; }

 const m=schedule[idx];
 document.getElementById('team1Label').textContent=m.team1;
 document.getElementById('team2Label').textContent=m.team2;
 inputs.classList.remove('hidden');

 const prev=document.getElementById('previousResult');
 const existing=results[idx];
 if(existing){
   prev.innerHTML=`Previously entered: <strong>${existing.set.team1}-${existing.set.team2}</strong>`;
   document.getElementById('team1Score').value=existing.set.team1;
   document.getElementById('team2Score').value=existing.set.team2;
 } else {
   prev.innerHTML='';
   document.getElementById('team1Score').value='';
   document.getElementById('team2Score').value='';
 }
}

function saveScore(){
 const idx=document.getElementById('matchSelect').value;
 if(idx==='')return alert('Select match');

 const s1=Number(document.getElementById('team1Score').value);
 const s2=Number(document.getElementById('team2Score').value);
 if(s1===s2) return alert('Scores cannot tie.');

 const winner=s1>s2?'team1':'team2';
 results[idx]={ set:{team1:s1,team2:s2}, winnerTeam:winner };
 localStorage.setItem(STORAGE_RESULTS_KEY,JSON.stringify(results));

 renderMatchesTable(); recomputeStandings(); renderStandings(); onSelectMatch();
 alert('Saved');
}

function deleteResult(){
 const idx=document.getElementById('matchSelect').value;
 if(!results[idx]) return alert('No result to delete');
 delete results[idx];
 localStorage.setItem(STORAGE_RESULTS_KEY,JSON.stringify(results));
 renderMatchesTable(); recomputeStandings(); renderStandings(); onSelectMatch();
}

function renderMatchesTable(){
 const tbody=document.querySelector('#matchesTable tbody'); tbody.innerHTML='';
 schedule.forEach((m,i)=>{
   const r=results[i];
   const done=!!r;
   const setText=done?`${r.set.team1}-${r.set.team2}`:'-';
   const status=done?`<span class="badge-success">Completed</span>`:`<span class="badge-muted">Not Played</span>`;

   const tr=document.createElement('tr');
   tr.innerHTML=`
     <td>${m.round}</td>
     <td>${m.team1} vs ${m.team2}</td>
     <td>${setText}</td>
     <td>${status}</td>
     <td><button data-action="edit" data-idx="${i}">Edit</button>
         <button class="danger" data-action="clear" data-idx="${i}">Delete</button></td>`;
   tbody.appendChild(tr);
 });

 tbody.querySelectorAll('button').forEach(btn=>{
   btn.onclick=()=>{
     const idx=btn.getAttribute('data-idx');
     document.getElementById('matchSelect').value=idx;
     onSelectMatch();
     if(btn.getAttribute('data-action')==='clear' && results[idx]){
       delete results[idx]; localStorage.setItem(STORAGE_RESULTS_KEY,JSON.stringify(results));
       renderMatchesTable(); recomputeStandings(); renderStandings();
     }
   };
 });
}

function recomputeStandings(){
 const s={};
 function ensure(p){ if(!s[p]) s[p]={Player:p,Pts:0,MP:0,W:0,L:0}; }

 schedule.forEach(m=>{
   m.team1.split('&').map(x=>x.trim()).forEach(ensure);
   m.team2.split('&').map(x=>x.trim()).forEach(ensure);
 });

 Object.entries(results).forEach(([idx,r])=>{
   const m=schedule[idx]; if(!m)return;
   const t1=m.team1.split('&').map(x=>x.trim());
   const t2=m.team2.split('&').map(x=>x.trim());

   [...t1,...t2].forEach(p=>s[p].MP+=1);

   const winners=r.winnerTeam==='team1'?t1:t2;
   const losers=r.winnerTeam==='team1'?t2:t1;
   winners.forEach(p=>{s[p].W+=1; s[p].Pts+=1;});
   losers.forEach(p=>s[p].L+=1);
 });

 standings=s;
}

function renderStandings(){
 const rows=Object.values(standings).sort((a,b)=>b.Pts-b.Pts||b.W-b.W||a.Player.localeCompare(b.Player));
 const tbody=document.querySelector('#standingsTable tbody'); tbody.innerHTML='';
 rows.forEach((r,i)=>{
   const tr=document.createElement('tr');
   tr.innerHTML=`<td>${i+1}</td><td style='text-align:left'>${r.Player}</td><td>${r.Pts}</td><td>${r.MP}</td><td>${r.W}</td><td>${r.L}</td>`;
   tbody.appendChild(tr);
 });
}

function adminLogin(){
 let p=prompt('Enter admin password:');
 if(p===ADMIN_PASSWORD) document.getElementById('adminPanel').style.display='block';
 else alert('Incorrect');
}

function uploadSchedule(){
 const f=document.getElementById('scheduleUpload').files[0]; if(!f) return alert('Choose file');
 const r=new FileReader();
 r.onload=()=>{
   try{
     const j=JSON.parse(r.result);
     localStorage.setItem(STORAGE_SCHEDULE_KEY,JSON.stringify(j));
     schedule=j; renderMatchesTable(); populateMatchList(); recomputeStandings(); renderStandings();
     alert('Uploaded');
   }catch{ alert('Invalid JSON'); }
 };
 r.readAsText(f);
}
