/* PairUp — Firebase-backed shared todo app.
   Requires Firebase Authentication and Cloud Firestore. Profile images use public URLs; Firebase Storage is not used. */
const auth = firebase.auth();
const db = firebase.firestore();

const $ = (id) => document.getElementById(id);
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
const avatarFallback = (name='U') => `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=eeeaff&color=6c5ce7&bold=true`;
const pairKey = (a,b) => [a,b].sort().join('_');
let currentUser = null, profile = null, allUsers = [], ownTasks = [], friendTasks = [];
let friends = [], incomingRequests = [], outgoingRequests = [], selectedFriend = '';
let taskFilter = 'all', calendarDate = new Date(), peopleSearchTerm = '';
let selectedDayKey = todayKey(), viewedMember = null, viewedMemberTasks = [];
let unsubscribers = [], friendTasksUnsub = null, friendTasksLoading = false;

function toast(message, type='') {
  const el = $('toast'); el.textContent = message; el.className = `toast show ${type}`;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.className='toast', 2800);
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
$('logoutBtn').addEventListener('click',()=>auth.signOut());
auth.onAuthStateChanged(async user => {
  stopListeners(); currentUser=user;
  if(!user){profile=null;showAuth();return;}
  showApp();
  try {
    const ref=db.collection('users').doc(user.uid);
    let snap=await ref.get();
    if(!snap.exists){
      await ref.set({uid:user.uid,displayName:user.displayName||user.email.split('@')[0],email:user.email,photoURL:'',createdAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});
      snap=await ref.get();
    }
    profile={uid:user.uid,...snap.data()};
    $('welcomeTitle').textContent=`Let's make today count, ${profile.displayName.split(' ')[0]}.`;
    $('todayLabel').textContent=new Date().toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
    selectedDayKey=todayKey(); calendarDate=new Date();
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
    ownTasks=snap.docs.map(d=>({id:d.id,...d.data()})); renderTasks(); renderStats(); renderCalendar(); renderSelectedDayInfo(); renderComparison(); renderTopStreak();
  },'your tasks');
  listen(db.collection('friendships').where('users','array-contains',currentUser.uid),async snap=>{
    const ids=snap.docs.map(d=>(d.data().users||[]).find(id=>id!==currentUser.uid)).filter(Boolean);
    friends=await Promise.all(ids.map(async uid=>{
      const s=await db.collection('users').doc(uid).get(); return s.exists?{uid,...s.data()}:null;
    }));
    friends=friends.filter(Boolean); renderFriendSelect(); renderPeople(); renderComparison();
    if(selectedFriend&&!friends.some(f=>f.uid===selectedFriend)){selectedFriend='';$('friendSelect').value='';}
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
  const today=todayKey();
  const newTask={
    ownerUid:currentUser.uid,
    title,
    frequency,
    date:today,
    startDate:frequency==='daily'?today:null,
    completed:false,
    completedDates:{},
    createdAt:firebase.firestore.FieldValue.serverTimestamp(),
    completedAt:null
  };
  try{
    await db.collection('tasks').add(newTask);
    $('taskTitle').value='';
    toast(frequency==='daily'?'Daily task added. It will appear every day.':'Task added for today.');
  }catch(err){console.error(err);toast('Could not add task. Check Firestore rules.','error');}
  finally{setBusy(btn,false);}
});
async function toggleTask(task,completed){
  try{
    const ref=db.collection('tasks').doc(task.id);
    if(task.frequency==='daily'){
      const field=`completedDates.${todayKey()}`;
      await ref.update({[field]:completed?true:firebase.firestore.FieldValue.delete()});
    } else {
      await ref.update({completed,completedAt:completed?firebase.firestore.FieldValue.serverTimestamp():null});
    }
  }catch(err){console.error(err);toast('Could not update task.','error');}
}
async function deleteTask(task){
  if(!confirm(`Delete "${task.title}"${task.frequency==='daily'?' from your daily routine':''}?`))return;
  try{await db.collection('tasks').doc(task.id).delete();toast('Task deleted.');}
  catch(err){console.error(err);toast('Could not delete task.','error');}
}
function renderTasks(){
  const date=todayKey();
  const selected=getTasksForDate(date);
  const visible=selected.filter(t=>{
    const done=isTaskCompletedOn(t,date);
    return taskFilter==='all'||(taskFilter==='active'?!done:done);
  });
  $('taskCount').textContent=`${selected.length} ${selected.length===1?'task':'tasks'}`;
  $('taskList').innerHTML='';
  if(!visible.length){$('taskList').innerHTML=`<div class="empty-state">${selected.length?'Nothing in this filter.':'No tasks for today. Add a task or create a daily routine.'}</div>`;return;}
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
    const dateLabel=document.createElement('span');dateLabel.className='task-date';dateLabel.textContent=task.frequency==='daily'?'Every day':'Today';
    const del=document.createElement('button');del.className='delete-task';del.type='button';del.textContent='×';del.title='Delete task';del.setAttribute('aria-label',`Delete ${task.title}`);del.addEventListener('click',()=>deleteTask(task));
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
  const date=todayKey();
  const todays=getTasksForDate(date);
  const done=todays.filter(t=>isTaskCompletedOn(t,date)).length;
  const rate=todays.length?Math.round(done/todays.length*100):0;
  const streak=currentStreak(ownTasks);
  $('completedStat').textContent=done;$('totalStat').textContent=`of ${todays.length} tasks`;$('streakStat').textContent=`${streak} ${streak===1?'day':'days'}`;$('rateStat').textContent=`${rate}%`;
  $('streakMessage').textContent=streak?`${streak}-day streak. Amazing!`:'Start your streak today';
  $('streakDetail').textContent=streak?'You are showing up consistently. Keep going!':'Complete at least one task each day.';
  renderTopStreak();
}
function renderTopStreak(){
  if(!$('topStreak'))return;
  const streak=currentStreak(ownTasks);
  $('topStreak').textContent=`${streak} ${streak===1?'day':'days'} streak`;
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
  const mine=getDayTotals(ownTasks,date);
  let text=`${formatLongDate(date)} · You: ${mine.done}/${mine.total} completed`;
  if(selectedFriend){
    const friend=friends.find(f=>f.uid===selectedFriend);
    if(friendTasksLoading) text+=` · ${friend?.displayName||'Friend'}: loading…`;
    else {
      const theirs=getDayTotals(friendTasks,date);
      text+=` · ${friend?.displayName||'Friend'}: ${theirs.done}/${theirs.total} completed`;
    }
  }
  $('selectedDayInfo').textContent=text;
  $('comparisonDateLabel').textContent=date===todayKey()?'Comparing today':`Comparing ${formatLongDate(date)}`;
  const dayList=$('selectedDayTasks');dayList.innerHTML='';
  const myTasks=getTasksForDate(date,ownTasks);
  if(!myTasks.length){dayList.innerHTML='<p class="history-empty">No personal tasks recorded for this date.</p>';return;}
  const heading=document.createElement('p');heading.className='history-list-heading';heading.textContent='Your tasks';dayList.append(heading);
  myTasks.forEach(task=>{
    const done=isTaskCompletedOn(task,date);
    const row=document.createElement('div');row.className=`history-task ${done?'done':'pending'}`;
    const mark=document.createElement('span');mark.textContent=done?'✓':'○';
    const title=document.createElement('span');title.textContent=task.title;
    row.append(mark,title);dayList.append(row);
  });
}
function renderCalendar(){
  const year=calendarDate.getFullYear(),month=calendarDate.getMonth();
  $('monthLabel').textContent=calendarDate.toLocaleDateString('en-IN',{month:'long',year:'numeric'});
  const first=new Date(year,month,1),offset=(first.getDay()+6)%7,days=new Date(year,month+1,0).getDate();
  const grid=$('calendarGrid');grid.innerHTML='';
  for(let i=0;i<offset;i++){const blank=document.createElement('span');blank.className='calendar-day empty';grid.append(blank);}
  for(let day=1;day<=days;day++){
    const key=`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const items=getTasksForDate(key);
    const completed=items.filter(task=>isTaskCompletedOn(task,key)).length;
    const cell=document.createElement('button');cell.type='button';cell.className='calendar-day';cell.textContent=day;
    if(key===todayKey())cell.classList.add('today');
    if(key===selectedDayKey)cell.classList.add('selected');
    if(items.length&&completed===items.length)cell.classList.add('has-done');
    else if(items.length&&completed<items.length&&key<=todayKey())cell.classList.add('has-missed');
    cell.title=items.length?`${completed}/${items.length} completed`:'No tasks';
    cell.setAttribute('aria-label',`${formatLongDate(key)}${items.length?`, ${completed} of ${items.length} completed`:', no tasks'}`);
    cell.addEventListener('click',()=>{
      selectedDayKey=key;
      renderCalendar();renderSelectedDayInfo();renderComparison();
      if(viewedMember)renderMemberProfileActivity();
    });
    grid.append(cell);
  }
  renderSelectedDayInfo();
}
function shiftCalendarMonth(offset){
  const next=new Date(calendarDate.getFullYear(),calendarDate.getMonth()+offset,1);
  const wantedDay=Number(selectedDayKey.slice(8,10))||1;
  const maxDay=new Date(next.getFullYear(),next.getMonth()+1,0).getDate();
  calendarDate=next;
  selectedDayKey=`${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}-${String(Math.min(wantedDay,maxDay)).padStart(2,'0')}`;
  renderCalendar();renderComparison();
  if(viewedMember)renderMemberProfileActivity();
}
$('prevMonth').addEventListener('click',()=>shiftCalendarMonth(-1));
$('nextMonth').addEventListener('click',()=>shiftCalendarMonth(1));
$('todayCalendarBtn').addEventListener('click',()=>{
  selectedDayKey=todayKey();calendarDate=new Date();renderCalendar();renderComparison();
  if(viewedMember)renderMemberProfileActivity();
});

function renderFriendSelect(){
  const select=$('friendSelect'),previous=selectedFriend;select.innerHTML='<option value="">Choose a friend</option>';
  friends.forEach(f=>{const o=document.createElement('option');o.value=f.uid;o.textContent=f.displayName;select.append(o);});
  if(friends.some(f=>f.uid===previous))select.value=previous;
  else if(friends.length&&!selectedFriend){selectedFriend=friends[0].uid;select.value=selectedFriend;}
}
$('friendSelect').addEventListener('change',()=>{selectedFriend=$('friendSelect').value;loadFriendTasks();});
function createCompareCard(user,tasks,isFriend,dateKey=selectedDayKey){
  const dayTasks=getTasksForDate(dateKey,tasks);
  const done=dayTasks.filter(t=>isTaskCompletedOn(t,dateKey)).length;
  const pct=dayTasks.length?Math.round(done/dayTasks.length*100):0;
  const streak=currentStreak(tasks);
  const card=document.createElement('div');card.className=`compare-user ${isFriend?'friend':'me'}`;
  const head=document.createElement('div');head.className='compare-head';
  const img=document.createElement('img');setProfileImage(img,user?.photoURL,user?.displayName||'User');img.alt='';
  const name=document.createElement('b');name.textContent=(user?.displayName||'User')+(isFriend?'':' (you)');
  const streakTag=document.createElement('span');streakTag.className='streak-badge';streakTag.textContent=`🔥 ${streak}d`;
  head.append(img,name,streakTag);
  const score=document.createElement('div');score.className='compare-score';score.textContent=`${pct}%`;
  const sub=document.createElement('p');sub.className='compare-sub';sub.textContent=`${done} of ${dayTasks.length} completed · ${safeDateLabel(dateKey)}`;
  const progress=document.createElement('div');progress.className='mini-progress';const fill=document.createElement('span');fill.style.width=`${pct}%`;progress.append(fill);
  const list=document.createElement('div');list.className='compare-tasks';
  dayTasks.forEach(task=>{
    const completed=isTaskCompletedOn(task,dateKey);
    const item=document.createElement('div');item.className=`compare-task ${completed?'done':'pending'}`;
    item.textContent=`${completed?'✓':'○'} ${task.title}`;list.append(item);
  });
  if(!dayTasks.length){const empty=document.createElement('small');empty.className='muted';empty.textContent='No tasks planned for this day.';list.append(empty);}
  card.append(head,score,sub,progress,list);
  return {card,pct,done,total:dayTasks.length,streak};
}
function renderComparison(){
  const el=$('comparison'),status=$('challengeStatus');el.innerHTML='';status.className='challenge-status hidden';status.textContent='';
  renderSelectedDayInfo();
  if(!selectedFriend){el.innerHTML='<div class="empty-state" style="grid-column:1/-1">Add a friend, then select them here to compare progress.</div>';return;}
  const friend=friends.find(f=>f.uid===selectedFriend);
  if(!friend){el.innerHTML='<div class="empty-state" style="grid-column:1/-1">Choose a friend to compare progress.</div>';return;}
  if(friendTasksLoading){el.innerHTML='<div class="empty-state" style="grid-column:1/-1">Loading your friend’s progress…</div>';return;}
  const mine=createCompareCard(profile,ownTasks,false,selectedDayKey);
  const theirs=createCompareCard(friend,friendTasks,true,selectedDayKey);
  el.append(mine.card,theirs.card);
  status.classList.remove('hidden');
  const dayWord=selectedDayKey===todayKey()?'today':`on ${safeDateLabel(selectedDayKey)}`;
  if(!mine.total&&!theirs.total){status.classList.add('neutral');status.textContent=`Neither of you had tasks planned ${dayWord}. Choose another date or add a task.`;}
  else if(!mine.total&&theirs.total){status.classList.add('behind');status.textContent=`${friend.displayName} had ${theirs.total} task${theirs.total===1?'':'s'} planned ${dayWord}. You had no tasks scheduled for this date.`;}
  else if(theirs.pct>mine.pct){
    status.classList.add('behind');
    const gap=theirs.pct-mine.pct;
    const needed=Math.max(0,Math.ceil((theirs.pct/100)*mine.total)-mine.done);
    status.textContent=`${friend.displayName} is ahead by ${gap} percentage points (${theirs.done}/${theirs.total} completed). You left ${mine.total-mine.done} task${mine.total-mine.done===1?'':'s'} unfinished ${dayWord}${needed?` — ${needed} more completion${needed===1?'':'s'} would have matched their percentage`:''}.`;
  } else if(mine.pct>theirs.pct){
    status.classList.add('ahead');status.textContent=`You were ahead by ${mine.pct-theirs.pct} percentage points ${dayWord}. ${friend.displayName} completed ${theirs.done} of ${theirs.total} tasks.`;
  } else {
    status.classList.add('neutral');status.textContent=`You were tied at ${mine.pct}% ${dayWord}.`;
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
    $('welcomeTitle').textContent=`Let's make today count, ${name.split(' ')[0]}.`;
    $('profileDialog').close();toast('Profile updated.');
  }catch(err){console.error(err);$('profileError').textContent='Could not save your profile. Check your Firestore rules and image link.';}
  finally{setBusy(btn,false);}
});
