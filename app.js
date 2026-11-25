/* PairUp — Firebase-backed shared todo app.
   Requires Firebase Authentication and Cloud Firestore. Profile images use public URLs; Firebase Storage is not used. */
const auth = firebase.auth();
const db = firebase.firestore();

const $ = (id) => document.getElementById(id);
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
const greet = (name='') => {
  const h = new Date().getHours();
  const p = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 21 ? 'Good evening' : 'Good night';
  return `${p}, ${name.split(' ')[0]}`;
};
const setTodayLabel = () => { $('todayLabel').textContent = new Date().toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'}); };
const avatarFallback = (name='U') => `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=eeeaff&color=6c5ce7&bold=true`;
const pairKey = (a,b) => [a,b].sort().join('_');
let currentUser = null, profile = null, allUsers = [], ownTasks = [], friendTasks = [];
let friends = [], incomingRequests = [], outgoingRequests = [], selectedFriend = '';
let taskFilter = 'all', peopleSearchTerm = '';
let selectedDayKey = todayKey(), viewedMember = null, viewedMemberTasks = [];
let unsubscribers = [], friendTasksUnsub = null, friendTasksLoading = false;

function toast(message, type='', action) {
  const el = $('toast'); el.textContent = message;
  if (action) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'toast-action'; b.textContent = action.label;
    b.addEventListener('click', () => { el.className = 'toast'; action.fn(); });
    el.append(b);
  }
  el.className = `toast show ${type}`;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.className='toast', action ? 6000 : 2800);
}
function setBusy(button, busy, text) {
  if (!button) return;
  if (busy) { button.dataset.original = button.textContent; button.disabled = true; button.textContent = text || 'Please wait…'; }
  else { button.disabled = false; button.textContent = button.dataset.original || button.textContent; }
}
function safeDateLabel(key) {
  if (!key) return '';
  return new Date(`${key}T00:00:00`).toLocaleDateString('en-IN',{day:'numeric',month:'short'});
}
function stopListeners(){ unsubscribers.forEach(fn=>fn()); unsubscribers=[]; if(friendTasksUnsub){friendTasksUnsub();friendTasksUnsub=null;} }
function listen(query, callback, label) {
  const unsub = query.onSnapshot(callback, err => {
    console.error(label, err); toast(`Could not load ${label}. Check Firestore rules.`, 'error');
  });
  unsubscribers.push(unsub);
}
function showAuth(){ $('authView').classList.remove('hidden'); $('appView').classList.add('hidden'); }
function showApp(){ $('authView').classList.add('hidden'); $('appView').classList.remove('hidden'); }

document.querySelectorAll('.switch-btn').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.switch-btn').forEach(b=>b.classList.toggle('active',b===btn));
  const register = btn.dataset.mode === 'register';
  $('nameField').classList.toggle('hidden',!register);
  $('forgotRow').classList.toggle('hidden',register);
  $('authHeading').textContent = register ? 'Create your account' : 'Welcome back';
  $('authSubheading').textContent = register ? 'Start building better habits with a friend.' : 'Sign in and pick up where you left off.';
  $('authSubmit').textContent = register ? 'Create account' : 'Sign in';
  $('password').autocomplete = register ? 'new-password' : 'current-password';
  $('email').autocomplete = 'username';
  $('authForm').autocomplete = 'on';
  $('authError').textContent='';
}));
$('authForm').autocomplete = 'on';
$('email').name = 'username';
$('email').autocomplete = 'username';
$('password').name = 'password';
$('authForm').addEventListener('submit', async e => {
  e.preventDefault(); $('authError').textContent='';
  const email=$('email').value.trim().toLowerCase(), password=$('password').value;
  const register=!$('nameField').classList.contains('hidden');
  const btn=$('authSubmit'); setBusy(btn,true,register?'Creating…':'Signing in…');
  try {
    if(register){
      const name=$('displayName').value.trim();
      if(!name) throw new Error('Please enter your name.');
      const cred=await auth.createUserWithEmailAndPassword(email,password);
      await cred.user.updateProfile({displayName:name});
      await db.collection('users').doc(cred.user.uid).set({
        uid:cred.user.uid, displayName:name, email, photoURL:'', createdAt:firebase.firestore.FieldValue.serverTimestamp()
      });
    } else await auth.signInWithEmailAndPassword(email,password);
  } catch(err){ $('authError').textContent=friendlyAuthError(err); }
  finally { setBusy(btn,false); }
});
function friendlyAuthError(err){
  const map={'auth/email-already-in-use':'This email is already registered.','auth/invalid-email':'Enter a valid email address.','auth/weak-password':'Password must contain at least 6 characters.','auth/user-not-found':'No account found for this email.','auth/wrong-password':'Incorrect password.','auth/invalid-credential':'Email or password is incorrect.','auth/too-many-requests':'Too many attempts. Try again later.'};
  return map[err.code] || err.message || 'Something went wrong.';
}
function closeAllDialogs(){document.querySelectorAll('dialog[open]').forEach(d=>d.close());}
$('logoutBtn').addEventListener('click',()=>{closeAllDialogs();auth.signOut();});
$('togglePw').addEventListener('click',()=>{
  const input=$('password'),show=input.type==='password';
  input.type=show?'text':'password';
  $('togglePw').textContent=show?'Hide':'Show';
  $('togglePw').setAttribute('aria-label',show?'Hide password':'Show password');
});
$('forgotBtn').addEventListener('click',async()=>{
  const email=$('email').value.trim().toLowerCase();
  if(!email){$('authError').textContent='Enter your email first, then tap Forgot password.';return;}
  try{await auth.sendPasswordResetEmail(email);$('authError').textContent='';toast('Reset link sent. Check your inbox.');}
  catch(err){$('authError').textContent=friendlyAuthError(err);}
});
auth.onAuthStateChanged(async user => {
  stopListeners(); currentUser=user;
  if(!user){
    profile=null;closeAllDialogs();
    selectedFriend='';friends=[];allUsers=[];ownTasks=[];friendTasks=[];incomingRequests=[];outgoingRequests=[];viewedMember=null;viewedMemberTasks=[];
    showAuth();return;
  }
  showApp();
  try {
    const ref=db.collection('users').doc(user.uid);
    let snap=await ref.get();
    if(!snap.exists){
      await ref.set({uid:user.uid,displayName:user.displayName||user.email.split('@')[0],email:user.email,photoURL:'',createdAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
      snap=await ref.get();
    }
    profile={uid:user.uid,...snap.data()};
    $('welcomeTitle').textContent=greet(profile.displayName);
    setTodayLabel();
    selectedDayKey=todayKey();
    renderProfile();
    startListeners();
  } catch(err){console.error(err);toast('Could not load your profile. Check Firebase setup.','error');}
});

function setProfileImage(img, url, name) {
  img.onerror = () => { img.onerror = null; img.src = avatarFallback(name); };
  img.src = url || avatarFallback(name);
}
function renderProfile(){
  const src=profile?.photoURL||'';
  setProfileImage($('topAvatar'),src,profile?.displayName||'You');
  setProfileImage($('profilePreview'),src,profile?.displayName||'You');
  $('topName').textContent=profile?.displayName||'You';
  $('profileName').value=profile?.displayName||'';
  $('profilePhotoUrl').value=src;
}

function startListeners(){
  listen(db.collection('users').orderBy('displayName'),snap=>{
    allUsers=snap.docs.map(d=>({uid:d.id,...d.data()}));
    renderPeople();
  },'users');
  listen(db.collection('tasks').where('ownerUid','==',currentUser.uid),snap=>{
    ownTasks=snap.docs.map(d=>({id:d.id,...d.data()})); renderTasks(); renderStats(); renderWeekStrip(); renderSelectedDayInfo(); renderComparison(); renderTopStreak();
  },'your tasks');
  listen(db.collection('friendships').where('users','array-contains',currentUser.uid),async snap=>{
    const ids=snap.docs.map(d=>(d.data().users||[]).find(id=>id!==currentUser.uid)).filter(Boolean);
    friends=await Promise.all(ids.map(async uid=>{
      const s=await db.collection('users').doc(uid).get(); return s.exists?{uid,...s.data()}:null;
    }));
    friends=friends.filter(Boolean);
    if(selectedFriend&&!friends.some(f=>f.uid===selectedFriend)){selectedFriend='';}
    renderFriendSelect(); renderPeople(); renderComparison();
    loadFriendTasks();
  },'friends');
  listen(db.collection('friendRequests').where('toUid','==',currentUser.uid).where('status','==','pending'),snap=>{
    incomingRequests=snap.docs.map(d=>({id:d.id,...d.data()})); renderRequests();
  },'friend requests');
  listen(db.collection('friendRequests').where('fromUid','==',currentUser.uid).where('status','==','pending'),snap=>{
    outgoingRequests=snap.docs.map(d=>({id:d.id,...d.data()})); renderPeople();
  },'sent requests');
}
function loadFriendTasks(){
  if(friendTasksUnsub){friendTasksUnsub();friendTasksUnsub=null;}
  friendTasks=[];
  if(!selectedFriend){friendTasksLoading=false;renderComparison();return;}
  const friendUid=selectedFriend;
  friendTasksLoading=true;renderComparison();
  friendTasksUnsub=db.collection('tasks').where('ownerUid','==',friendUid).onSnapshot(snap=>{
    if(selectedFriend!==friendUid)return;
    friendTasks=snap.docs.map(d=>({id:d.id,...d.data()}));friendTasksLoading=false;renderComparison();renderSelectedDayInfo();if(viewedMember?.uid===friendUid)renderMemberProfileActivity();
  },err=>{friendTasksLoading=false;console.error('friend tasks',err);toast('Could not load friend tasks. Check Firestore rules.','error');renderComparison();});
}
function getTasksForDate(date, tasks=ownTasks){
  return tasks.filter(task => {
    if(task.frequency === 'daily') return (task.startDate || task.date || '') <= date;
    return task.date === date; // also supports tasks created before recurring tasks were added
  });
}
function isTaskCompletedOn(task, date){
  if(task.frequency === 'daily') return Boolean(task.completedDates && task.completedDates[date]);
  return Boolean(task.completed);
}
$('taskForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const title=$('taskTitle').value.trim();
  const frequency=$('taskFrequency').value;
  if(!title)return;
  const btn=e.submitter;setBusy(btn,true,'Adding…');
  const day=selectedDayKey;
  const newTask={
    ownerUid:currentUser.uid,
    title,
    frequency,
    date:day,
    startDate:frequency==='daily'?day:null,
    completed:false,
    completedDates:{},
    createdAt:firebase.firestore.FieldValue.serverTimestamp(),
    completedAt:null
  };
  try{
    await db.collection('tasks').add(newTask);
    $('taskTitle').value='';
    const when=day===todayKey()?'today':safeDateLabel(day);
    toast(frequency==='daily'?`Daily task added. It repeats every day from ${when}.`:`Task added for ${when}.`);
  }catch(err){console.error(err);toast('Could not add task. Check Firestore rules.','error');}
  finally{setBusy(btn,false);}
});
async function toggleTask(task,completed){
  try{
    const ref=db.collection('tasks').doc(task.id);
    if(task.frequency==='daily'){
      const field=`completedDates.${selectedDayKey}`;
      await ref.update({[field]:completed?true:firebase.firestore.FieldValue.delete()});
    } else {
      await ref.update({completed,completedAt:completed?firebase.firestore.FieldValue.serverTimestamp():null});
    }
  if(completed){
      const date=selectedDayKey;
      const left=getTasksForDate(date).filter(t=>t.id!==task.id&&!isTaskCompletedOn(t,date)).length;
      if(!left){confetti();toast(date===todayKey()?'All done for today! 🎉':`All done for ${safeDateLabel(date)}! 🎉`);}
    }
  }catch(err){console.error(err);toast('Could not update task.','error');}
}
async function deleteTask(task){
  const {id,...data}=task;
  try{
    await db.collection('tasks').doc(id).delete();
    toast('Task deleted.','',{label:'Undo',fn:async()=>{
      try{await db.collection('tasks').doc(id).set(data);toast('Task restored.');}
      catch(err){console.error(err);toast('Could not restore the task.','error');}
    }});
  }catch(err){console.error(err);toast('Could not delete task.','error');}
}
function renderTasks(){
  const date=selectedDayKey;
  const isToday=date===todayKey();
  $('taskHeading').textContent=isToday?"Today's tasks":`Tasks · ${safeDateLabel(date)}`;
  const selected=getTasksForDate(date);
  const visible=selected.filter(t=>{
    const done=isTaskCompletedOn(t,date);
    return taskFilter==='all'||(taskFilter==='active'?!done:done);
  });
  $('taskCount').textContent=`${selected.length} ${selected.length===1?'task':'tasks'}`;
  $('taskList').innerHTML='';
  if(!visible.length){$('taskList').innerHTML=`<div class="empty-state">${selected.length?'Nothing in this filter.':(isToday?'Nothing here yet. Add your first task above.':'No tasks on this day. Add one above to plan it.')}</div>`;return;}
  visible.sort((a,b)=>{
    const ad=isTaskCompletedOn(a,date),bd=isTaskCompletedOn(b,date);
    if(ad!==bd)return ad?1:-1;
    return (a.createdAt?.seconds||0)-(b.createdAt?.seconds||0);
  });
  visible.forEach(task=>{
    const done=isTaskCompletedOn(task,date);
    const row=document.createElement('div');row.className=`task-item ${done?'done':''}`;
    const check=document.createElement('input');check.type='checkbox';check.className='task-check';check.checked=done;check.setAttribute('aria-label',`Mark ${task.title} completed`);check.addEventListener('change',()=>toggleTask(task,check.checked));
    const title=document.createElement('span');title.className='task-title';title.textContent=task.title;
    const dateLabel=document.createElement('span');dateLabel.className='task-date';dateLabel.textContent=task.frequency==='daily'?'Every day':'One-time';
    const del=document.createElement('button');del.className='delete-task';del.type='button';del.textContent='×';del.title='Delete task';del.setAttribute('aria-label',`Delete ${task.title}`);del.addEventListener('click',()=>deleteTask(task));
    row.addEventListener('click',e=>{if(e.target===check||e.target===del)return;check.click();});
    row.append(check,title,dateLabel,del);$('taskList').append(row);
  });
}
document.querySelectorAll('.filter-btn').forEach(btn=>btn.addEventListener('click',()=>{
  taskFilter=btn.dataset.filter;document.querySelectorAll('.filter-btn').forEach(b=>b.classList.toggle('active',b===btn));renderTasks();
}));
function completedDates(tasks){
  const dates=new Set();
  tasks.forEach(task=>{
    if(task.frequency==='daily'){
      Object.entries(task.completedDates||{}).forEach(([date,done])=>{if(done)dates.add(date);});
    } else if(task.completed&&task.date) dates.add(task.date);
  });
  return dates;
}
function currentStreak(tasks){
  const dates=completedDates(tasks);let d=new Date();let key=todayKey();
  if(!dates.has(key)){d.setDate(d.getDate()-1);key=keyFor(d);}
  let count=0;
  while(dates.has(key)){count++;d.setDate(d.getDate()-1);key=keyFor(d);}
  return count;
}
function keyFor(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function renderStats(){
  const date=selectedDayKey;
  $('doneLabel').textContent=date===todayKey()?'Done today':`Done · ${safeDateLabel(date)}`;
  const todays=getTasksForDate(date);
  const done=todays.filter(t=>isTaskCompletedOn(t,date)).length;
  const rate=todays.length?Math.round(done/todays.length*100):0;
  const streak=currentStreak(ownTasks);
  $('completedStat').textContent=`${done}/${todays.length}`;
  $('streakStat').textContent=`${streak} ${streak===1?'day':'days'}`;
  $('rateStat').textContent=`${rate}%`;
  $('progressFill').style.width=`${rate}%`;document.querySelector('.day-progress').setAttribute('aria-valuenow',String(rate));
  renderTopStreak();
}
function renderTopStreak(){
  if(!$('topStreak'))return;
  const streak=currentStreak(ownTasks);
  $('topStreak').textContent=`${streak}-day streak`;
}
function formatLongDate(key){
  return new Date(`${key}T00:00:00`).toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
}
function getDayTotals(tasks,date){
  const dayTasks=getTasksForDate(date,tasks);
  const done=dayTasks.filter(t=>isTaskCompletedOn(t,date)).length;
  return {total:dayTasks.length,done,pct:dayTasks.length?Math.round(done/dayTasks.length*100):0};
}
function renderSelectedDayInfo(){
  const date=selectedDayKey;
  const isToday=date===todayKey();
  $('comparisonDateLabel').textContent=isToday?'Today':safeDateLabel(date);
  const long=new Date(`${date}T00:00:00`).toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'short'});
  $('dayLabel').textContent=isToday?`Today · ${long}`:long;
  $('dayPicker').value=date;
  $('todayBtn').classList.toggle('hidden',isToday);
}
function renderWeekStrip(){
  const strip=$('weekStrip');strip.innerHTML='';
  const sel=new Date(`${selectedDayKey}T00:00:00`);
  const start=new Date(sel);start.setDate(sel.getDate()-((sel.getDay()+6)%7));
  const today=todayKey();
  for(let i=0;i<7;i++){
    const d=new Date(start);d.setDate(start.getDate()+i);
    const key=keyFor(d);
    const items=getTasksForDate(key);
    const done=items.filter(t=>isTaskCompletedOn(t,key)).length;
    const btn=document.createElement('button');btn.type='button';btn.className='week-day';
    if(key===selectedDayKey)btn.classList.add('selected');
    if(key===today)btn.classList.add('today');
    if(items.length&&done===items.length)btn.classList.add('all-done');
    else if(items.length&&key<today)btn.classList.add('missed');
    btn.setAttribute('aria-pressed',String(key===selectedDayKey));
    btn.setAttribute('aria-label',`${formatLongDate(key)}${items.length?`, ${done} of ${items.length} completed`:', no tasks'}`);
    btn.title=items.length?`${done}/${items.length} completed`:'No tasks';
    const wd=document.createElement('small');wd.textContent=d.toLocaleDateString('en-IN',{weekday:'short'});
    const num=document.createElement('b');num.textContent=d.getDate();
    const dot=document.createElement('i');dot.className='week-dot';
    btn.append(wd,num,dot);
    btn.addEventListener('click',()=>setSelectedDay(key));
    strip.append(btn);
  }
}
function setSelectedDay(key){
  if(!key)return;
  selectedDayKey=key;
  renderTasks();renderStats();renderWeekStrip();renderSelectedDayInfo();renderComparison();
  if(viewedMember)renderMemberProfileActivity();
}
function shiftDay(offset){
  const d=new Date(`${selectedDayKey}T00:00:00`);d.setDate(d.getDate()+offset);setSelectedDay(keyFor(d));
}
$('prevDay').addEventListener('click',()=>shiftDay(-1));
$('nextDay').addEventListener('click',()=>shiftDay(1));
$('todayBtn').addEventListener('click',()=>setSelectedDay(todayKey()));
$('dayPicker').addEventListener('change',()=>setSelectedDay($('dayPicker').value));
$('dayPicker').addEventListener('click',()=>{try{$('dayPicker').showPicker&&$('dayPicker').showPicker();}catch(_){}});

function renderFriendSelect(){
  const select=$('friendSelect'),previous=selectedFriend;select.innerHTML='<option value="">Choose a friend</option>';
  friends.forEach(f=>{const o=document.createElement('option');o.value=f.uid;o.textContent=f.displayName;select.append(o);});
  if(friends.some(f=>f.uid===previous))select.value=previous;
  else if(friends.length&&!selectedFriend){selectedFriend=friends[0].uid;select.value=selectedFriend;}
  select.classList.toggle('hidden',friends.length<2);
}
$('friendSelect').addEventListener('change',()=>{selectedFriend=$('friendSelect').value;loadFriendTasks();});
function createCompareCard(user,tasks,isFriend,dateKey=selectedDayKey){
  const dayTasks=getTasksForDate(dateKey,tasks);
  const done=dayTasks.filter(t=>isTaskCompletedOn(t,dateKey)).length;
  const pct=dayTasks.length?Math.round(done/dayTasks.length*100):0;
  const streak=currentStreak(tasks);
  const card=document.createElement('div');card.className=`vs-side ${isFriend?'friend':'me'}`;card.style.setProperty('--p',pct);
  const ring=document.createElement('div');ring.className='vs-ring';
  const img=document.createElement('img');setProfileImage(img,user?.photoURL,user?.displayName||'User');img.alt='';ring.append(img);
  const name=document.createElement('b');name.className='vs-name';name.textContent=isFriend?(user?.displayName||'Friend'):'You';
  const score=document.createElement('div');score.className='vs-score';score.innerHTML=`${pct}<span>%</span>`;
  const meta=document.createElement('div');meta.className='vs-meta';
  const count=document.createElement('span');count.textContent=`${done}/${dayTasks.length} done`;
  const streakTag=document.createElement('span');streakTag.className='streak-badge';streakTag.textContent=`🔥 ${streak}`;
  meta.append(count,streakTag);
  const list=document.createElement('div');list.className='vs-tasks';
  const LIMIT=4;let expanded=false;
  const paint=()=>{
    list.innerHTML='';
    if(!dayTasks.length){const e=document.createElement('p');e.className='vs-empty';e.textContent='No tasks';list.append(e);return;}
    (expanded?dayTasks:dayTasks.slice(0,LIMIT)).forEach(task=>{
      const completed=isTaskCompletedOn(task,dateKey);
      const item=document.createElement('div');item.className=`vs-task ${completed?'done':''}`;
      const mark=document.createElement('span');mark.textContent=completed?'✓':'○';
      const title=document.createElement('span');title.textContent=task.title;
      item.append(mark,title);list.append(item);
    });
    if(dayTasks.length>LIMIT){
      const more=document.createElement('button');more.type='button';more.className='vs-more';
      more.textContent=expanded?'Show less':`+${dayTasks.length-LIMIT} more`;
      more.addEventListener('click',()=>{expanded=!expanded;paint();});
      list.append(more);
    }
  };
  paint();
  card.append(ring,name,score,meta,list);
  return {card,pct,done,total:dayTasks.length,streak};
}
let prevLead=null,prevLeadCtx='';
function confetti(){
  if(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const box=document.createElement('div');box.className='confetti';box.setAttribute('aria-hidden','true');
  const colors=['#6c5ce7','#16875d','#f39b42','#d94b59','#4cc9f0','#ffd166'];
  for(let i=0;i<46;i++){
    const p=document.createElement('i');
    p.style.cssText=`left:${Math.random()*100}%;background:${colors[i%colors.length]};animation-delay:${Math.random()*.35}s;animation-duration:${1.4+Math.random()*1.1}s;--dx:${(Math.random()*160-80).toFixed(0)}px;--rot:${(Math.random()*720-360).toFixed(0)}deg`;
    box.append(p);
  }
  document.body.append(box);setTimeout(()=>box.remove(),3000);
}
function renderComparison(){
  const el=$('comparison'),status=$('challengeStatus');el.innerHTML='';status.className='challenge-status hidden';status.textContent='';
  renderSelectedDayInfo();
  if(!selectedFriend){
    el.innerHTML=`<div class="empty-state onboarding" style="grid-column:1/-1"><div class="empty-icon">🤝</div><h3>Better together</h3><p>Invite a friend to compare progress side by side.</p><button class="btn btn-primary" type="button" id="emptyFindFriends">＋ Find friends</button></div>`;
    $('emptyFindFriends').addEventListener('click',()=>{$('peopleDialog').showModal();renderPeople();});
    return;
  }
  const friend=friends.find(f=>f.uid===selectedFriend);
  if(!friend){el.innerHTML='<div class="empty-state" style="grid-column:1/-1">Choose a friend.</div>';return;}
  if(friendTasksLoading){el.innerHTML='<div class="skeleton" style="grid-column:1/-1;height:230px"></div>';return;}
  const mine=createCompareCard(profile,ownTasks,false,selectedDayKey);
  const theirs=createCompareCard(friend,friendTasks,true,selectedDayKey);
  const badge=document.createElement('div');badge.className='vs-badge';badge.textContent='VS';badge.setAttribute('aria-hidden','true');
  el.append(mine.card,badge,theirs.card);
  if(mine.total||theirs.total){
    if(mine.pct>theirs.pct)mine.card.classList.add('lead');
    else if(theirs.pct>mine.pct)theirs.card.classList.add('lead');
  }
  const leadNow=!(mine.total||theirs.total)?'none':mine.pct>theirs.pct?'me':theirs.pct>mine.pct?'friend':'tie';
  const ctx=`${selectedFriend}|${selectedDayKey}`;
  if(ctx===prevLeadCtx&&prevLead&&prevLead!=='me'&&leadNow==='me'){confetti();toast('🏆 You took the lead!');}
  prevLead=leadNow;prevLeadCtx=ctx;
  status.classList.remove('hidden');
  const fname=(friend.displayName||'Friend').split(' ')[0];
  const isToday=selectedDayKey===todayKey();
  if(!mine.total&&!theirs.total){status.classList.add('neutral');status.textContent='No tasks planned for this day';}
  else if(!mine.total){status.classList.add('behind');status.textContent=`${fname} has ${theirs.total} task${theirs.total===1?'':'s'}. You have none.`;}
  else if(theirs.pct>mine.pct){
    status.classList.add('behind');
    const needed=Math.max(0,Math.ceil((theirs.pct/100)*mine.total)-mine.done);
    status.textContent=`⚡ ${fname} leads by ${theirs.pct-mine.pct} pts${isToday&&needed?` · ${needed} more to catch up`:''}`;
  } else if(mine.pct>theirs.pct){
    status.classList.add('ahead');status.textContent=`🏆 You lead by ${mine.pct-theirs.pct} pts`;
  } else {
    status.classList.add('neutral');status.textContent=`🤝 Tied at ${mine.pct}%`;
  }
}

function renderPeople(){
  if(!$('peopleDialog').open)return;
  const term=peopleSearchTerm.toLowerCase();
  const rows=allUsers.filter(u=>u.uid!==currentUser?.uid&&(!term||`${u.displayName} ${u.email}`.toLowerCase().includes(term)));
  const list=$('peopleList');list.innerHTML='';
  if(!rows.length){list.innerHTML='<p class="empty-state">No users found. Invite a friend to join PairUp.</p>';return;}
  rows.forEach(person=>{
    const isFriend=friends.some(f=>f.uid===person.uid),sent=outgoingRequests.some(r=>r.toUid===person.uid),received=incomingRequests.some(r=>r.fromUid===person.uid);
    const row=document.createElement('div');row.className='person-row';
    const img=document.createElement('img');setProfileImage(img,person.photoURL,person.displayName);img.alt='';
    const info=document.createElement('div');info.className='person-info';const name=document.createElement('b');name.textContent=person.displayName;const email=document.createElement('small');email.textContent=person.email||'';info.append(name,email);
    const actions=document.createElement('div');actions.className='person-row-actions';
    const view=document.createElement('button');view.className='mini-btn view-profile-btn';view.type='button';view.textContent='View';view.addEventListener('click',()=>{ $('peopleDialog').close(); showMemberProfile(person); });
    const action=document.createElement('button');action.className='btn btn-soft';action.type='button';
    if(isFriend){action.textContent='Friends';action.disabled=true;}else if(sent){action.textContent='Requested';action.disabled=true;}else if(received){action.textContent='Respond below';action.disabled=true;}else{action.textContent='＋ Add';action.addEventListener('click',()=>sendRequest(person));}
    actions.append(view,action);row.append(img,info,actions);list.append(row);
  });
}

async function sendRequest(person){
  try{
    const id=`${currentUser.uid}_${person.uid}`;
    await db.collection('friendRequests').doc(id).set({fromUid:currentUser.uid,toUid:person.uid,status:'pending',createdAt:firebase.firestore.FieldValue.serverTimestamp()});
    toast(`Friend request sent to ${person.displayName}.`);renderPeople();
    if(viewedMember?.uid===person.uid){$('publicProfileFriendState').textContent='Friend request sent';$('publicProfileAddBtn').textContent='Request sent';$('publicProfileAddBtn').disabled=true;}
  }catch(err){console.error(err);toast('Could not send request.','error');}
}
function renderRequests(){
  $('requestCount').textContent=incomingRequests.length;
  document.querySelector('.requests-panel').classList.toggle('hidden',!incomingRequests.length);
  const list=$('requestList');list.innerHTML='';
  if(!incomingRequests.length){list.innerHTML='<p class="muted small">No pending requests.</p>';return;}
  incomingRequests.forEach(async req=>{
    const user=allUsers.find(u=>u.uid===req.fromUid)||(await db.collection('users').doc(req.fromUid).get()).data();
    if(!user)return;
    const row=document.createElement('div');row.className='request-row';
    const img=document.createElement('img');img.src=user.photoURL||avatarFallback(user.displayName);img.alt='';
    const info=document.createElement('div');info.className='person-info';const name=document.createElement('b');name.textContent=user.displayName;const sub=document.createElement('small');sub.textContent='Wants to connect';info.append(name,sub);
    const actions=document.createElement('div');actions.className='request-actions';
    const accept=document.createElement('button');accept.className='mini-btn';accept.textContent='Accept';accept.addEventListener('click',()=>respondRequest(req,true));
    const reject=document.createElement('button');reject.className='mini-btn reject';reject.textContent='×';reject.title='Decline';reject.addEventListener('click',()=>respondRequest(req,false));
    actions.append(accept,reject);row.append(img,info,actions);list.append(row);
  });
}
function showMemberProfile(person){
  viewedMember=person;viewedMemberTasks=[];
  setProfileImage($('publicProfileAvatar'),person.photoURL,person.displayName);
  $('publicProfileName').textContent=person.displayName||'PairUp member';
  $('publicProfileEmail').textContent=person.email||'';
  const isFriend=friends.some(f=>f.uid===person.uid);
  const sent=outgoingRequests.some(r=>r.toUid===person.uid);
  const received=incomingRequests.some(r=>r.fromUid===person.uid);
  $('publicProfileFriendState').textContent=isFriend?'Your friend':sent?'Friend request sent':received?'They sent you a request':'Not connected yet';
  const add=$('publicProfileAddBtn');
  add.classList.remove('hidden');add.disabled=isFriend||sent||received;
  add.textContent=isFriend?'You are friends':sent?'Request sent':received?'Respond to their request':'＋ Add friend';
  add.onclick=()=>sendRequest(person);
  const rm=$('publicProfileRemoveBtn');
  rm.classList.toggle('hidden',!isFriend);
  add.classList.toggle('hidden',isFriend);
  rm.onclick=()=>removeFriend(person);
  $('publicProfileStats').innerHTML='';
  $('publicProfileTasks').innerHTML='<p class="muted small">Loading profile activity…</p>';
  $('publicProfileDateLabel').textContent=safeDateLabel(selectedDayKey);
  $('publicProfileStreak').textContent='';
  $('publicProfileDialog').showModal();
  if(!isFriend){
    $('publicProfileStats').innerHTML='<div class="profile-private-note">Connect as friends to see this member’s streak and task history.</div>';
    $('publicProfileTasks').innerHTML='<p class="muted small">Daily activity is visible to accepted friends.</p>';
    return;
  }
  const loadTasks=selectedFriend===person.uid&&!friendTasksLoading
    ? Promise.resolve(friendTasks)
    : db.collection('tasks').where('ownerUid','==',person.uid).get().then(snap=>snap.docs.map(d=>({id:d.id,...d.data()})));
  loadTasks.then(tasks=>{
    if(!viewedMember||viewedMember.uid!==person.uid)return;
    viewedMemberTasks=tasks;renderMemberProfileActivity();
  }).catch(err=>{
    console.error('member profile activity',err);
    $('publicProfileTasks').innerHTML='<p class="error-text">Could not load this friend’s activity.</p>';
  });
}
function renderMemberProfileActivity(){
  if(!viewedMember||!$('publicProfileDialog').open)return;
  const isFriend=friends.some(f=>f.uid===viewedMember.uid);
  if(!isFriend)return;
  const totals=getDayTotals(viewedMemberTasks,selectedDayKey);
  const streak=currentStreak(viewedMemberTasks);
  $('publicProfileDateLabel').textContent=safeDateLabel(selectedDayKey);
  $('publicProfileStreak').textContent=`🔥 ${streak}-day streak`;
  $('publicProfileStats').innerHTML=`<div class="profile-stat"><strong>${streak}</strong><span>Day streak</span></div><div class="profile-stat"><strong>${totals.done}/${totals.total}</strong><span>Completed on selected day</span></div><div class="profile-stat"><strong>${totals.pct}%</strong><span>Daily completion</span></div>`;
  const tasks=getTasksForDate(selectedDayKey,viewedMemberTasks);
  const list=$('publicProfileTasks');list.innerHTML='';
  if(!tasks.length){list.innerHTML='<p class="muted small">No tasks for this date.</p>';return;}
  tasks.forEach(task=>{
    const done=isTaskCompletedOn(task,selectedDayKey);
    const item=document.createElement('div');item.className=`profile-task ${done?'done':'pending'}`;
    const state=document.createElement('span');state.textContent=done?'✓':'○';
    const title=document.createElement('span');title.textContent=task.title;
    item.append(state,title);list.append(item);
  });
}

async function removeFriend(person){
  if(!confirm(`Remove ${person.displayName||'this friend'} from your friends? You will stop seeing each other's progress.`))return;
  try{
    await db.collection('friendships').doc(pairKey(currentUser.uid,person.uid)).delete();
    // best-effort cleanup so you can send a fresh request later
    await Promise.all([`${currentUser.uid}_${person.uid}`,`${person.uid}_${currentUser.uid}`].map(id=>db.collection('friendRequests').doc(id).delete().catch(()=>{})));
    if(viewedMember?.uid===person.uid){viewedMember=null;viewedMemberTasks=[];}
    $('publicProfileDialog').close();
    toast(`${person.displayName||'Friend'} removed.`);
  }catch(err){console.error(err);toast('Could not remove friend. Check Firestore rules allow deleting friendships.','error');}
}
async function respondRequest(req,accept){
  try{
    if(accept){
      const users=[req.fromUid,req.toUid].sort();
      const batch=db.batch();
      batch.set(db.collection('friendships').doc(pairKey(...users)),{users,createdAt:firebase.firestore.FieldValue.serverTimestamp()});
      batch.update(db.collection('friendRequests').doc(req.id),{status:'accepted'});
      await batch.commit();toast('You are friends now!');
    }else{await db.collection('friendRequests').doc(req.id).update({status:'declined'});toast('Request declined.');}
  }catch(err){console.error(err);toast('Could not update request.','error');}
}
$('peopleBtn').addEventListener('click',()=>{$('peopleDialog').showModal();renderPeople();});
$('profileButton').addEventListener('click',()=>$('profileDialog').showModal());
document.querySelectorAll('.close-dialog').forEach(btn=>btn.addEventListener('click',()=>btn.closest('dialog').close()));
$('peopleSearch').addEventListener('input',e=>{peopleSearchTerm=e.target.value;renderPeople();});
$('profilePhotoUrl').addEventListener('input',()=>{
  const raw=$('profilePhotoUrl').value.trim();
  if(!raw){setProfileImage($('profilePreview'),'',$('profileName').value||'You');return;}
  try{
    const url=new URL(raw);
    if(url.protocol!=='https:')return;
    setProfileImage($('profilePreview'),url.href,$('profileName').value||'You');
  }catch(_){/* Wait until a complete URL has been entered. */}
});
$('profileForm').addEventListener('submit',async e=>{
  e.preventDefault();$('profileError').textContent='';
  const name=$('profileName').value.trim(),rawPhotoURL=$('profilePhotoUrl').value.trim();if(!name)return;
  let photoURL='';
  if(rawPhotoURL){
    try{
      const parsed=new URL(rawPhotoURL);
      if(parsed.protocol!=='https:')throw new Error('Use a secure HTTPS image URL.');
      photoURL=parsed.href;
    }catch(err){$('profileError').textContent=err.message==='Use a secure HTTPS image URL.'?err.message:'Enter a valid public image URL.';return;}
  }
  const btn=e.submitter;setBusy(btn,true,'Saving…');
  try{
    await db.collection('users').doc(currentUser.uid).update({displayName:name,photoURL});
    await currentUser.updateProfile({displayName:name,photoURL});
    profile={...profile,displayName:name,photoURL};renderProfile();
    $('welcomeTitle').textContent=greet(name);
    $('profileDialog').close();toast('Profile updated.');
  }catch(err){console.error(err);$('profileError').textContent='Could not save your profile. Check your Firestore rules and image link.';}
  finally{setBusy(btn,false);}
});

/* Close a dialog when the dark backdrop is clicked */
document.querySelectorAll('dialog.modal').forEach(d=>d.addEventListener('click',e=>{
  if(e.target!==d)return;
  const r=d.getBoundingClientRect();
  if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();
}));

/* Date pill jumps back to today; refresh the page state when the day changes (e.g. tab left open overnight) */
$('comparisonDateLabel').addEventListener('click',()=>setSelectedDay(todayKey()));
let lastToday=todayKey();
function refreshDay(){
  const t=todayKey();
  if(t===lastToday||!currentUser)return;
  if(selectedDayKey===lastToday){selectedDayKey=t;}
  lastToday=t;setTodayLabel();
  if(profile)$('welcomeTitle').textContent=greet(profile.displayName);
  renderTasks();renderStats();renderWeekStrip();renderSelectedDayInfo();renderComparison();
}
setInterval(refreshDay,60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshDay();});

/* Phones: tap "Tasks" in the comparison box to show/hide both task lists */
$('cmpToggle').addEventListener('click',()=>{
  const panel=document.querySelector('.featured-compare');
  const open=panel.classList.toggle('cmp-open');
  $('cmpToggle').setAttribute('aria-expanded',String(open));
});
