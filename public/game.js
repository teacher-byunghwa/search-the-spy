const socket=io();
const MAP={w:3200,h:2000},SPEED=240;
let mode=null,roomCode='',meId=null,myRole=null,teammates=[],players={},npcs=[],started=false,timeLeft=0,totalTime=1,currentPhase='lobby';
let selectedTeacherFloor=1,keys={},angle=0,boostUntil=0,swingT=0,last=performance.now(),cam={x:0,y:0},joy={pointerId:null,touchId:null,dx:0,dy:0};
let latestScores=[],pendingJoin=null,revealCountdown=null,feed=[],teacherZoom=1,teacherPan={x:0,y:0},teacherDrag=null,localPortalCooldown=0;
let fishItems=[],fishExpireAt=0,fishPickupPending=false;
const $=id=>document.getElementById(id),gameCanvas=$('gameCanvas'),g=gameCanvas.getContext('2d'),teacherCanvas=$('teacherCanvas'),tg=teacherCanvas.getContext('2d');
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const SESSION_KEY='spySchoolStudentSessionV12';

function resize(){gameCanvas.width=innerWidth;gameCanvas.height=innerHeight;teacherCanvas.width=innerWidth;teacherCanvas.height=innerHeight}
addEventListener('resize',resize);resize();
function saveSession(d){localStorage.setItem(SESSION_KEY,JSON.stringify(d))}
function loadSession(){try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{return null}}
function clearSession(){localStorage.removeItem(SESSION_KEY)}
function fmt(t){t=Math.max(0,t||0);return `${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`}
function buildJoinUrl(c){return `${location.origin}/?room=${encodeURIComponent(c)}`}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

function audioCtx(){if(!window._ac)window._ac=new (window.AudioContext||window.webkitAudioContext)();try{window._ac.resume()}catch{}return window._ac}
function tone(freq=440,dur=.12,type='sine',gain=.05,delay=0){try{const ac=audioCtx(),o=ac.createOscillator(),v=ac.createGain(),t=ac.currentTime+delay;o.type=type;o.frequency.setValueAtTime(freq,t);v.gain.setValueAtTime(gain,t);v.gain.exponentialRampToValueAtTime(.001,t+dur);o.connect(v).connect(ac.destination);o.start(t);o.stop(t+dur+.02)}catch{}}
function sceneSound(k='move'){if(k==='start'){tone(480,.1,'sine',.06);tone(680,.12,'sine',.06,.1);tone(920,.18,'sine',.06,.22)}else if(k==='floor'){tone(560,.08,'sine',.05);tone(780,.1,'sine',.05,.07)}else if(k==='end'){tone(660,.16,'triangle',.06);tone(520,.18,'triangle',.06,.16)}else tone(430,.07,'sine',.035)}

function fanfareSound(){
 try{
  const notes=[
    [523.25,.00,.15],[659.25,.00,.15],[783.99,.00,.15],
    [659.25,.18,.14],[783.99,.18,.14],[1046.50,.18,.22],
    [783.99,.40,.15],[987.77,.40,.15],[1174.66,.40,.15],
    [1046.50,.62,.20],[1318.51,.62,.20],[1567.98,.62,.32]
  ];
  notes.forEach(([f,durStart,dur])=>tone(f,dur,'triangle',.055,durStart));
  tone(261.63,.55,'sine',.035,.00);
  tone(392.00,.55,'sine',.035,.18);
  tone(523.25,.75,'sine',.035,.40);
 }catch{}
}

function whoosh(){try{const ac=audioCtx(),o=ac.createOscillator(),v=ac.createGain();o.type='sawtooth';o.frequency.setValueAtTime(650,ac.currentTime);o.frequency.exponentialRampToValueAtTime(120,ac.currentTime+.12);v.gain.setValueAtTime(.07,ac.currentTime);v.gain.exponentialRampToValueAtTime(.001,ac.currentTime+.13);o.connect(v).connect(ac.destination);o.start();o.stop(ac.currentTime+.14)}catch{}}
function thump(){tone(105,.11,'square',.11)}

function showScreen(id,quiet=false){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));$(id).classList.add('active');if(!quiet)sceneSound()}
window.showScreen=showScreen;
function toast(t){$('toast').textContent=t;$('toast').style.opacity=1;clearTimeout(toast.t);toast.t=setTimeout(()=>$('toast').style.opacity=0,1400)}
function setPlayerGameVisible(on){$('playerGame').style.display=on?'block':'none'}
function setTeacherGameVisible(on){$('teacherGame').style.display=on?'block':'none'}

function myScore(){const p=players[meId];if(p&&Number.isFinite(p.score))return p.score;return latestScores.find(x=>x.id===meId)?.score||0}
function renderScores(id){const el=$(id);if(!el)return;el.innerHTML=(latestScores||[]).map((p,i)=>`<div class="scoreRow"><span>${i+1}</span><b>${escapeHtml(p.nick)}</b><b>⭐ ${p.score}</b></div>`).join('')}
function updateScoreUI(){$('scoreHud').textContent=`⭐ ${myScore()}`;renderScores('teacherScoreBoard');renderScores('lobbyScores');renderScores('endScores')}
function renderFeedLists(){
 const html=feed.map(x=>{
  if(x.kind==='chat')return `<div class="feedItem chat"><b>${escapeHtml(x.nick)}</b>: ${escapeHtml(x.text)}</div>`;
  if(x.kind==='teacher')return `<div class="feedItem teacher">📣 <b>교사</b>: ${escapeHtml(x.text)}</div>`;
  return `<div class="feedItem death">☠ ${escapeHtml(x.nick)} · ${escapeHtml(x.text)}</div>`;
 }).join('');
 $('feedList').innerHTML=html;
 const tf=$('teacherFeedList');if(tf)tf.innerHTML=html;
}
function addFeed(item){
 feed.push(item);
 if(feed.length>8)feed.shift();
 renderFeedLists();
}

function applyState(s){
 const prevPhase=currentPhase;
 currentPhase=s.phase??currentPhase;timeLeft=s.timeLeft??timeLeft;totalTime=s.total??s.minutes*60??totalTime;
 if(Array.isArray(s.fishItems))fishItems=s.fishItems.map(f=>({...f}));fishExpireAt=s.fishExpireAt||0;
 if(Array.isArray(s.npcs))npcs=s.npcs.map(n=>{const old=npcs.find(x=>x.id===n.id)||{};return{...old,...n,rx:old.rx??n.x,ry:old.ry??n.y}});
 (s.players||[]).forEach(p=>{
  const old=players[p.id]||{};
  players[p.id]={...old,...p,rx:old.rx??p.x,ry:old.ry??p.y};
 });
 // 이벤트 하나를 놓친 태블릿도 서버의 현재 phase를 기준으로 자동 복구
 if(currentPhase==='playing'&&prevPhase!=='playing'&&mode==='student'){started=true;hideRevealAndGo();$('lobbyNotice').style.display='none'}
 if(currentPhase==='lobby'&&mode==='student'){$('lobbyNotice').style.display='block';started=true}
}
function applyRoleUI(role,mates=[]){myRole=role;teammates=mates||[]}

function openPlayerWorld(){
 document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));setTeacherGameVisible(false);setPlayerGameVisible(true);started=true;if(!['lobby','reveal','playing'].includes(currentPhase))currentPhase='lobby';socket.emit('requestNPCs');
 $('lobbyNotice').style.display=currentPhase==='lobby'?'block':'none';
}
function openTeacherWorld(){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));setPlayerGameVisible(false);setTeacherGameVisible(true);started=true}

function showTeamReveal(seconds=10){
 clearInterval(revealCountdown);
 $('teamRevealOverlay').classList.add('open');
 $('revealRoleTitle').textContent=myRole==='spy'?'🕵️ 스파이팀':'🚔 경찰팀';
 const list=(teammates||[]).map(x=>`<span class="teamMember">${escapeHtml(x.nick)}${x.id===meId?' (나)':''}</span>`).join('');
 $('revealTeamList').innerHTML=list||'<span class="teamMember">나</span>';
 let n=seconds;$('revealSeconds').textContent=n;tone(650,.08,'square',.03);
 revealCountdown=setInterval(()=>{n--;$('revealSeconds').textContent=Math.max(0,n);if(n>0)tone(650,.05,'square',.02);else clearInterval(revealCountdown)},1000);
}
function showTeacherReveal(seconds=10){
 $('teamRevealOverlay').classList.add('open');$('revealRoleTitle').textContent='학생들이 팀원을 확인 중입니다';$('revealTeamList').innerHTML='<span class="teamMember">잠시 후 게임이 시작됩니다.</span>';
 let n=seconds;$('revealSeconds').textContent=n;clearInterval(revealCountdown);revealCountdown=setInterval(()=>{n--;$('revealSeconds').textContent=Math.max(0,n);if(n<=0)clearInterval(revealCountdown)},1000)
}
function hideRevealAndGo(){
 $('teamRevealOverlay').classList.remove('open');$('goOverlay').classList.add('open');sceneSound('start');
 setTimeout(()=>$('goOverlay').classList.remove('open'),900);
}

$('createRoom').onclick=()=>{mode='teacher';audioCtx();socket.emit('createRoom',{spies:+$('spies').value,minutes:+$('mins').value},r=>{if(!r.ok)return alert(r.error);roomCode=r.code;$('roomCode').textContent=r.code;const u=buildJoinUrl(r.code);$('joinQr').src=`/api/qr?room=${r.code}`;$('joinUrlText').textContent=u;$('qrModalImage').src=`/api/qr?room=${r.code}`;$('qrModalUrl').textContent=u;showScreen('teacherLobby')})};
$('joinRoom').onclick=()=>{audioCtx();const code=$('joinCode').value.trim(),nick=$('nickname').value.trim();if(!code||!nick){$('joinMessage').textContent='방 코드와 닉네임을 입력하세요.';return}pendingJoin={code,nick};$('characterModal').classList.add('open')};
document.querySelectorAll('.characterChoice').forEach(b=>b.onclick=()=>{const gender=b.dataset.gender;$('characterModal').classList.remove('open');const{code,nick}=pendingJoin||{};if(!code||!nick)return;mode='student';socket.emit('joinRoom',{code,nick,gender},r=>{if(!r.ok){$('joinMessage').textContent=r.error;return}meId=r.id;roomCode=code;saveSession({code,playerId:r.id,reconnectToken:r.reconnectToken,nick});
currentPhase=r.state?.phase||'lobby';
if(r.state)applyState(r.state);
started=true;joy.dx=joy.dy=0;keys={};
openPlayerWorld();updateScoreUI();toast('입장 완료! 친구들을 기다려 보세요.')})});
$('cancelCharacter').onclick=()=>$('characterModal').classList.remove('open');
$('startGame').onclick=()=>{feed=[];renderFeedLists();socket.emit('startGame',{code:roomCode},r=>{if(!r.ok)alert(r.error)})};
$('restartGameBtn').onclick=()=>{feed=[];renderFeedLists();socket.emit('restartGame',{code:roomCode},r=>{if(!r.ok)alert(r.error)})};
$('copyJoinLink').onclick=async()=>{try{await navigator.clipboard.writeText(buildJoinUrl(roomCode));toast('참가 링크를 복사했어요!')}catch{prompt('복사하세요',buildJoinUrl(roomCode))}};
function openQrModal(){$('qrModalImage').src=`/api/qr?room=${roomCode}`;$('qrModalUrl').textContent=buildJoinUrl(roomCode);$('qrModal').classList.add('open')}
$('showQrInGame').onclick=openQrModal;

function sendTeacherChat(){
 const input=$('teacherChatInput');
 const text=String(input?.value||'').trim().slice(0,40);
 if(!text)return;
 socket.emit('teacherChat',{code:roomCode,text});
 input.value='';
}
$('teacherChatSend').onclick=sendTeacherChat;
$('teacherChatInput').addEventListener('keydown',e=>{
 if(e.key==='Enter'){e.preventDefault();sendTeacherChat()}
});


$('forceEndGameBtn').onclick=()=>{
 if(!confirm('현재 게임을 강제로 종료할까요?\n강제 종료 시 어느 팀에도 점수가 추가되지 않습니다.'))return;
 socket.emit('forceEndGame',{code:roomCode},r=>{
   if(!r?.ok)alert(r?.error||'게임 종료에 실패했습니다.');
 });
};
$('endQrBtn').onclick=openQrModal;$('closeQrModal').onclick=()=>$('qrModal').classList.remove('open');

socket.on('lobby',r=>{if(mode==='teacher'){$('joinCount').textContent=`참가 ${r.players.length}명`;$('joinList').innerHTML=r.players.map(p=>`<span class="chip">${escapeHtml(p.nick)}${p.connected?'':' (연결끊김)'}</span>`).join('')}});

socket.on('scoreBoard',s=>{latestScores=s||[];(s||[]).forEach(x=>{if(players[x.id])players[x.id].score=x.score});updateScoreUI()});
socket.on('state',applyState);
socket.on('clock',c=>{timeLeft=c.timeLeft;totalTime=c.total});
socket.on('thirtySecondWarning',e=>{toast('⏰ 게임 30초 남았습니다!');tone(860,.12,'square',.055);tone(660,.15,'square',.045,.12)});
socket.on('playerMoved',p=>{const old=players[p.id]||{};players[p.id]={...old,...p,rx:old.rx??p.x,ry:old.ry??p.y}});
socket.on('npcState',arr=>{npcs=arr.map(n=>{const old=npcs.find(x=>x.id===n.id)||{};return{...old,...n,rx:old.rx??n.x,ry:old.ry??n.y}})});
socket.on('playerJumped',e=>{if(players[e.id]){players[e.id].jumpStart=e.jumpStart;players[e.id].jumpUntil=e.jumpUntil}});
socket.on('playerBubble',e=>{if(players[e.id]){players[e.id].bubble=e.text;players[e.id].bubbleUntil=e.bubbleUntil}});
socket.on('chatFeed',addFeed);

socket.on('clearFeed',()=>{
 feed=[];fishItems=[];fishExpireAt=0;fishPickupPending=false;
 renderFeedLists();
});


socket.on('role',r=>{applyRoleUI(r.role,r.teammates||[])});
socket.on('teamRevealStarted',e=>{
 currentPhase='reveal';$('lobbyNotice').style.display='none';
 if(mode==='student'){openPlayerWorld();showTeamReveal(e.seconds||10)}else if(mode==='teacher'){openTeacherWorld();showTeacherReveal(e.seconds||10)}
});
socket.on('teacherGameStarted',s=>{if(mode!=='teacher')return;applyState(s);npcs=s.npcs||[];openTeacherWorld();socket.emit('teacherRequestState',{code:roomCode})});
socket.on('teacherState',s=>{if(mode==='teacher'){applyState(s);npcs=s.npcs||[]}});
socket.on('gameStarted',()=>{currentPhase='playing';started=true;hideRevealAndGo();$('lobbyNotice').style.display='none'});
socket.on('swingResult',r=>{whoosh();if(r.kind==='hit')setTimeout(thump,35)});
socket.on('wrongHit',e=>{const t=e.type==='npc'?npcs.find(n=>n.id===e.targetId):players[e.targetId];if(t){t.bubble=e.text;t.bubbleUntil=Date.now()+1800}if(e.by===meId){
 if(players[meId])players[meId].miss=e.miss;
 $('roleHud').textContent=`🚔 ${'❤️'.repeat(Math.max(0,3-e.miss))}${'🖤'.repeat(Math.min(3,e.miss))}`;
 toast(`❌ 오인 공격 ${e.miss}/3`);
}});
socket.on('spyCaught',e=>{if(players[e.spyId]){players[e.spyId].alive=false;players[e.spyId].ghost=true;players[e.spyId].revealed=true}if(e.by===meId){players[meId].miss=0;toast('🎯 스파이 검거! ❤️❤️❤️ 완전 회복!')}});
socket.on('lifeReset',()=>{if(players[meId])players[meId].miss=0});
socket.on('policeOut',e=>{if(players[e.id]){players[e.id].alive=false;players[e.id].ghost=true}});

socket.on('spiesRevealed',e=>{
 (e.ids||[]).forEach(id=>{if(players[id])players[id].revealed=true});
 toast(e.message||'이제 스파이들의 정체가 드러났어요!');
 tone(880,.10,'square',.045);tone(1175,.12,'square',.045,.09);
});
socket.on('policeLifeUpdated',e=>{
 if(players[meId])players[meId].miss=e.miss;
 if(myRole==='police'){
   const miss=e.miss||0;
   $('roleHud').textContent=`🚔 ${'❤️'.repeat(Math.max(0,3-miss))}${'🖤'.repeat(Math.min(3,miss))}`;
 }
});
socket.on('fishSpawned',e=>{
 fishItems=(e.items||[]).map(f=>({...f}));fishExpireAt=e.expireAt||0;fishPickupPending=false;
 toast('🐟 붕어빵이 나타났어요! 20초 동안 먹을 수 있어요!');
});
socket.on('fishTaken',e=>{
 const f=fishItems.find(x=>x.id===e.fishId);if(f)f.active=false;
 if(players[e.playerId]){
   players[e.playerId].boostCharges=e.charges??players[e.playerId].boostCharges??0;
   players[e.playerId].bubble=e.text||players[e.playerId].bubble;
   players[e.playerId].bubbleUntil=e.bubbleUntil||players[e.playerId].bubbleUntil;
 }
 if(e.playerId===meId){
   fishPickupPending=false;
   toast(`🐟 붕어빵 획득! 부스터 ${e.charges||1}회 보유`);
 }
});
socket.on('fishExpired',()=>{fishItems=[];fishExpireAt=0;fishPickupPending=false});
socket.on('boosted',e=>{
 if(players[e.id]){
   players[e.id].boostUntil=e.until;
   players[e.id].boostCharges=e.charges??players[e.id].boostCharges??0;
   players[e.id].bubble=e.text;players[e.id].bubbleUntil=e.bubbleUntil;
 }
 if(e.id===meId){boostUntil=e.until;toast(`🚀 부스터 10초! 남은 횟수 ${e.charges||0}회`)}
});
socket.on('boostUnavailable',e=>toast(e?.reason||'지금은 부스터를 사용할 수 없습니다.'));
socket.on('gameEnded',e=>showEnd(e));

socket.on('gameForceEnded',e=>{
 started=false;currentPhase='ended';
 setPlayerGameVisible(false);setTeacherGameVisible(false);
 if(e?.scores){
   latestScores=e.scores;
   e.scores.forEach(s=>{if(players[s.id])players[s.id].score=s.score});
 }
 $('endTitle').textContent='⛔ 게임 종료';
 $('endText').textContent=e?.reason||'교사가 게임을 종료했습니다.';
 $('myEndScore').textContent=mode==='student'?`내 누적 점수: ⭐ ${myScore()}점`:'';
 $('teacherEndActions').style.display=mode==='teacher'?'flex':'none';
 $('studentEndWait').style.display=mode==='student'?'block':'none';
 updateScoreUI();showScreen('endScreen',true);fanfareSound();
});

socket.on('roomClosed',()=>{alert('교사가 방을 종료했습니다.');clearSession();location.reload()});

function showEnd(e){
 started=false;setPlayerGameVisible(false);setTeacherGameVisible(false);currentPhase='ended';
 if(e?.scores){latestScores=e.scores;e.scores.forEach(s=>{if(players[s.id])players[s.id].score=s.score})}
 $('endTitle').textContent=e.winner==='spy'?'🕵️ 스파이팀 승리!':'🚔 경찰팀 승리!';$('endText').textContent=e.reason;
 $('myEndScore').textContent=mode==='student'?`내 누적 점수: ⭐ ${myScore()}점`:'';
 $('teacherEndActions').style.display=mode==='teacher'?'flex':'none';$('studentEndWait').style.display=mode==='student'?'block':'none';updateScoreUI();showScreen('endScreen',true);sceneSound('end');
}

function bindActionButton(el,fn){
 // Touch Events are used directly on tablets so a second finger does not
 // steal/cancel the joystick pointer. Pointer Events remain for mouse/pen.
 el.addEventListener('touchstart',e=>{
   e.preventDefault();e.stopPropagation();fn();
 },{passive:false});
 el.addEventListener('pointerdown',e=>{
   if(e.pointerType==='touch')return;
   e.preventDefault();fn();
 });
}
bindActionButton($('attackBtn'),attack);
function attack(){if(currentPhase!=='playing'||myRole!=='police'||!players[meId]?.alive)return;swingT=.22;socket.emit('hitAttempt')}
bindActionButton($('jumpBtn'),jump);
function jump(){if(!['lobby','playing'].includes(currentPhase)||!players[meId])return;const p=players[meId],now=Date.now();if((p.jumpUntil||0)>now)return;p.jumpStart=now;p.jumpUntil=now+650;socket.emit('jump')}
bindActionButton($('boostBtn'),useStoredBoost);
function useStoredBoost(){
 const p=players[meId];
 if(currentPhase!=='playing'||!p?.alive||(p.boostCharges||0)<=0)return;
 if(Date.now()<(p.boostUntil||0)){toast('🚀 부스터가 이미 사용 중입니다.');return}
 socket.emit('useFishBoost');
}

$('chatToggle').onclick=()=>$('chatMenu').classList.toggle('open');
document.querySelectorAll('#chatMenu [data-msg]').forEach(b=>b.onclick=()=>{sendChat(b.dataset.msg);$('chatMenu').classList.remove('open')});
$('chatSend').onclick=()=>{sendChat($('chatInput').value);$('chatInput').value='';$('chatMenu').classList.remove('open')};
function sendChat(t){t=String(t||'').trim().slice(0,24);if(t)socket.emit('playerChat',{text:t})}

addEventListener('keydown',e=>{if(document.activeElement===$('chatInput'))return;keys[e.key.toLowerCase()]=true;if(e.code==='Space'){e.preventDefault();attack()}if(e.key.toLowerCase()==='f')jump()});
addEventListener('keyup',e=>keys[e.key.toLowerCase()]=false);

(function setupJoystick(){
 const base=$('joystickBase'),knob=$('joystickKnob');

 function setXY(clientX,clientY){
   const r=base.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;
   let dx=clientX-cx,dy=clientY-cy,d=Math.hypot(dx,dy),max=r.width*.35;
   if(d>max){dx=dx/d*max;dy=dy/d*max}
   joy.dx=dx/max;joy.dy=dy/max;knob.style.transform=`translate(${dx}px,${dy}px)`;
 }
 function resetJoy(){
   joy.pointerId=null;joy.touchId=null;joy.dx=joy.dy=0;knob.style.transform='translate(0,0)';
 }

 // Tablets/phones: bind the joystick to ONE touch identifier only.
 // Other fingers remain free for jump, attack and boost.
 base.addEventListener('touchstart',e=>{
   e.preventDefault();e.stopPropagation();
   if(joy.touchId!==null)return;
   const t=e.changedTouches[0];if(!t)return;
   joy.touchId=t.identifier;setXY(t.clientX,t.clientY);
 },{passive:false});

 base.addEventListener('touchmove',e=>{
   if(joy.touchId===null)return;
   const t=[...e.touches].find(t=>t.identifier===joy.touchId);
   if(!t)return;
   e.preventDefault();setXY(t.clientX,t.clientY);
 },{passive:false});

 function endTouch(e){
   if(joy.touchId===null)return;
   const ended=[...e.changedTouches].some(t=>t.identifier===joy.touchId);
   if(ended){e.preventDefault();resetJoy()}
 }
 base.addEventListener('touchend',endTouch,{passive:false});
 base.addEventListener('touchcancel',endTouch,{passive:false});

 // Mouse/pen fallback.
 base.addEventListener('pointerdown',e=>{
   if(e.pointerType==='touch')return;
   e.preventDefault();if(joy.pointerId!==null)return;
   joy.pointerId=e.pointerId;base.setPointerCapture(e.pointerId);setXY(e.clientX,e.clientY);
 });
 base.addEventListener('pointermove',e=>{
   if(e.pointerType==='touch'||e.pointerId!==joy.pointerId)return;
   e.preventDefault();setXY(e.clientX,e.clientY)
 });
 function endPointer(e){
   if(e.pointerType==='touch'||e.pointerId!==joy.pointerId)return;
   e.preventDefault();resetJoy()
 }
 base.addEventListener('pointerup',endPointer);
 base.addEventListener('pointercancel',endPointer);
})();


(function preventGameplayPinchZoom(){
 const pg=$('playerGame');
 const mapOpen=()=>Boolean($('studentMapModal')?.classList.contains('open'));

 // Prevent page scrolling/pinch while playing. Individual controls still
 // receive their own touchstart first, so simultaneous jump/joystick works.
 pg.addEventListener('touchmove',e=>{
   if(!mapOpen())e.preventDefault();
 },{passive:false});
 pg.addEventListener('touchstart',e=>{
   if(!mapOpen()&&e.touches.length>1)e.preventDefault();
 },{passive:false});

 // Safari-specific pinch gesture events.
 ['gesturestart','gesturechange','gestureend'].forEach(type=>{
   document.addEventListener(type,e=>{
     if(mode==='student'&&$('playerGame')?.style.display!=='none'&&!mapOpen())e.preventDefault();
   },{passive:false});
 });
})();

function jumpOffset(o){const now=Date.now(),s=o?.jumpStart||0,e=o?.jumpUntil||0;if(now<s||now>e||e<=s)return 0;return Math.sin(Math.PI*((now-s)/(e-s)))*40}
const EXIT_PORTALS=[
 {name:'왼쪽 출입구',x1:520,x2:820},
 {name:'가운데 출입구',x1:1450,x2:1750},
 {name:'오른쪽 출입구',x1:2380,x2:2680}
];
const ROOM_WALLS=(()=>{
 const a=[],xs=[130,1110,2090],topY=90,bottomY=1370,w=820,h=360,t=18,door=100;
 for(const x of xs){
  a.push({x,y:topY,w,h:t},{x,y:topY,w:t,h},{x:x+w-t,y:topY,w:t,h});
  let dg=x+w/2-door/2;a.push({x,y:topY+h-t,w:dg-x,h:t},{x:dg+door,y:topY+h-t,w:x+w-(dg+door),h:t});
  a.push({x,y:bottomY,w,h:t},{x,y:bottomY,w:t,h},{x:x+w-t,y:bottomY,w:t,h});
  dg=x+w/2-door/2;a.push({x,y:bottomY,w:dg-x,h:t},{x:dg+door,y:bottomY,w:x+w-(dg+door),h:t});
 }return a;
})();
const SCHOOL_YARD_WALLS=[
 {x:360,y:120,w:160,h:220},
 {x:820,y:120,w:630,h:220},
 {x:1750,y:120,w:630,h:220},
 {x:2680,y:120,w:160,h:220}
];
const FENCES=[
 {x:160,y:1120,w:920,h:14},{x:160,y:1820,w:920,h:14},
 {x:160,y:1120,w:14,h:714},{x:1066,y:1120,w:14,h:714}
];
const PLAYGROUND_SOLIDS=[
 {x:270,y:420,w:120,h:36},{x:500,y:420,w:22,h:150},
 {x:760,y:420,w:22,h:150},{x:470,y:555,w:340,h:24}
];
function hitRect(r,x,y,rad=18){return x+rad>r.x&&x-rad<r.x+r.w&&y+rad>r.y&&y-rad<r.y+r.h}
function blockedLocal(p,x,y){
 if(x<28||x>MAP.w-28||y<28||y>MAP.h-28)return true;
 const jumping=Date.now()<(p.jumpUntil||0);
 if(p.floor>0)return ROOM_WALLS.some(r=>hitRect(r,x,y,17));
 if(SCHOOL_YARD_WALLS.some(r=>hitRect(r,x,y,17)))return true;
 if(PLAYGROUND_SOLIDS.some(r=>hitRect(r,x,y,17)))return true;
 if(!jumping&&FENCES.some(r=>hitRect(r,x,y,17)))return true;
 return false;
}
function resolveMoveLocal(p,nx,ny){
 // 축별로 처리: 모서리를 비스듬히 만났을 때 선에 갇히지 않고 벽을 따라 미끄러진다.
 if(!blockedLocal(p,nx,p.y))p.x=nx;
 if(!blockedLocal(p,p.x,ny))p.y=ny;
}
function entranceAtX(x){return EXIT_PORTALS.find(e=>x>=e.x1&&x<=e.x2)}
function touchesRect(px,py,r,rect){
 return px+r>=rect.x1&&px-r<=rect.x2&&py+r>=rect.y1&&py-r<=rect.y2;
}
function checkPortalLocal(p){
 if(currentPhase!=='playing'||Date.now()<localPortalCooldown)return;

 const gate=entranceAtX(p.x);
 if(p.floor===1&&gate&&p.y>=1940){
   p.floor=0;p.y=370;transitionLocal(p,`운동장 · ${gate.name}`);return;
 }
 if(p.floor===0&&gate&&p.y<=340){
   p.floor=1;p.y=1910;transitionLocal(p,`1층 · ${gate.name}`);return;
 }
}
function transitionLocal(p,label){localPortalCooldown=Date.now()+750;sceneSound('floor');toast(`📍 ${label}`);socket.emit('portalTransition',{floor:p.floor,x:p.x,y:p.y,label})}

function lerpEntities(dt){
 const f=Math.min(1,dt*14);
 for(const p of Object.values(players)){if(p.id===meId){p.rx=p.x;p.ry=p.y}else{p.rx=(p.rx??p.x)+(p.x-(p.rx??p.x))*f;p.ry=(p.ry??p.y)+(p.y-(p.ry??p.y))*f}}
 for(const n of npcs){n.rx=(n.rx??n.x)+(n.x-(n.rx??n.x))*f;n.ry=(n.ry??n.y)+(n.y-(n.ry??n.y))*f}
}
function pos(o){return{x:o.rx??o.x,y:o.ry??o.y}}

function roundedPath(ctx,x,y,w,h,r){
 r=Math.max(0,Math.min(r,Math.abs(w)/2,Math.abs(h)/2));
 ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);
 ctx.quadraticCurveTo(x+w,y,x+w,y+r);ctx.lineTo(x+w,y+h-r);
 ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);ctx.lineTo(x+r,y+h);
 ctx.quadraticCurveTo(x,y+h,x,y+h-r);ctx.lineTo(x,y+r);
 ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();
}
function rounded(ctx,x,y,w,h,r,fill,stroke){roundedPath(ctx,x,y,w,h,r);if(fill){ctx.fillStyle=fill;ctx.fill()}if(stroke){ctx.strokeStyle=stroke;ctx.stroke()}}
function drawEyes(ctx,x,y){ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(x-4,y-19,3.5,0,Math.PI*2);ctx.arc(x+4,y-19,3.5,0,Math.PI*2);ctx.fill();ctx.fillStyle='#121a20';ctx.beginPath();ctx.arc(x-4,y-19,1.7,0,Math.PI*2);ctx.arc(x+4,y-19,1.7,0,Math.PI*2);ctx.fill()}
function drawHair(ctx,x,y,a){ctx.fillStyle=a?.hairColor||'#2d241e';const h=a?.hair||'short';if(h==='bob'||h==='long'){ctx.beginPath();ctx.arc(x,y-24,13,Math.PI,Math.PI*2);ctx.fill();ctx.fillRect(x-12,y-24,5,h==='long'?27:18);ctx.fillRect(x+7,y-24,5,h==='long'?27:18)}else if(h==='ponytail'){ctx.beginPath();ctx.arc(x,y-24,12,Math.PI,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(x+14,y-20,6,0,Math.PI*2);ctx.fill()}else if(h==='spiky'){for(let i=-2;i<=2;i++){ctx.beginPath();ctx.moveTo(x+i*5-4,y-21);ctx.lineTo(x+i*5,y-37);ctx.lineTo(x+i*5+4,y-21);ctx.fill()}}else{ctx.beginPath();ctx.arc(x,y-24,12,Math.PI,Math.PI*2);ctx.fill();if(h==='cap')ctx.fillRect(x,y-27,15,5)}}
function drawShadow(ctx,x,y,j){ctx.save();ctx.globalAlpha=.22*(1-j/70);ctx.fillStyle='#111';ctx.beginPath();ctx.ellipse(x,y+42,18,6,0,0,Math.PI*2);ctx.fill();ctx.restore()}
function drawStudent(ctx,x,y,a,j,ghost=false){const ap=a||{skin:'#efbd98',shirt:'#3f78a9',pants:'#24313d',bag:'#7a4f33',hair:'short',hairColor:'#251c18'};drawShadow(ctx,x,y,j);y-=j;ctx.save();ctx.globalAlpha=ghost?.38:1;rounded(ctx,x-15,y-4,30,24,6,ap.bag);ctx.fillStyle=ap.skin;ctx.beginPath();ctx.arc(x,y-20,12,0,Math.PI*2);ctx.fill();drawHair(ctx,x,y,ap);drawEyes(ctx,x,y);rounded(ctx,x-12,y-7,24,31,4,ap.shirt);ctx.fillStyle=ap.pants;ctx.fillRect(x-11,y+24,8,20);ctx.fillRect(x+3,y+24,8,20);ctx.strokeStyle=ap.skin;ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(x-11,y);ctx.lineTo(x-19,y+14);ctx.moveTo(x+11,y);ctx.lineTo(x+19,y+14);ctx.stroke();if(ghost){ctx.globalAlpha=.9;ctx.font='21px sans-serif';ctx.fillText('👻',x-11,y-46)}ctx.restore()}
function drawPolice(ctx,x,y,j,ghost=false){drawShadow(ctx,x,y,j);y-=j;ctx.save();ctx.globalAlpha=ghost?.38:1;ctx.fillStyle='#efbd98';ctx.beginPath();ctx.arc(x,y-20,12,0,Math.PI*2);ctx.fill();ctx.fillStyle='#263b50';ctx.beginPath();ctx.arc(x,y-26,11,Math.PI,Math.PI*2);ctx.fill();drawEyes(ctx,x,y);rounded(ctx,x-12,y-7,24,31,4,'#244b78');ctx.fillStyle='#1f2d38';ctx.fillRect(x-11,y+24,8,20);ctx.fillRect(x+3,y+24,8,20);ctx.fillStyle='#f4d03f';ctx.fillRect(x-5,y-33,10,5);if(ghost){ctx.globalAlpha=.9;ctx.font='21px sans-serif';ctx.fillText('👻',x-11,y-46)}ctx.restore()}
function drawSpy(ctx,x,y,j,ghost=false){drawShadow(ctx,x,y,j);y-=j;ctx.save();ctx.globalAlpha=ghost?.38:1;ctx.fillStyle='#292929';ctx.beginPath();ctx.arc(x,y-20,12,0,Math.PI*2);ctx.fill();drawEyes(ctx,x,y);rounded(ctx,x-12,y-7,24,31,4,'#661f1f');ctx.fillStyle='#222';ctx.fillRect(x-11,y+24,8,20);ctx.fillRect(x+3,y+24,8,20);ctx.fillStyle='#e22';ctx.font='bold 11px sans-serif';ctx.fillText('SPY',x-12,y+10);if(ghost){ctx.globalAlpha=.9;ctx.font='21px sans-serif';ctx.fillText('👻',x-11,y-46)}ctx.restore()}
function drawBoost(ctx,x,y,p){
 if(Date.now()>+(p.boostUntil||0))return;
 ctx.save();const t=Date.now()/120;ctx.globalAlpha=.8;ctx.font='18px sans-serif';
 for(let i=0;i<3;i++){const ox=-24-i*13-Math.sin(t+i)*5,oy=10+(i-1)*10;ctx.fillText(i%2?'⚡':'💨',x+ox,y+oy)}ctx.restore()
}
function drawPerson(ctx,o,opt={}){
 const{x,y}=pos(o),j=jumpOffset(o);
 if(opt.police)drawPolice(ctx,x,y,j,o.ghost);
 else if(opt.revealed)drawSpy(ctx,x,y,j,o.ghost);
 else drawStudent(ctx,x,y,o.appearance,j,o.ghost);
 drawBoost(ctx,x,y,o);
 if(opt.name){
  ctx.save();ctx.fillStyle='#172228';ctx.font='bold 13px sans-serif';ctx.textAlign='center';
  ctx.fillText(opt.name,x,y-j-50);ctx.restore();
 }
}
function bubble(ctx,o){if(!o?.bubble||o.bubbleUntil<Date.now())return;const{x,y}=pos(o),j=jumpOffset(o),yy=y-j;ctx.font='bold 13px sans-serif';const w=ctx.measureText(o.bubble).width+18;ctx.fillStyle='#fff';ctx.strokeStyle='#26343d';ctx.lineWidth=2;roundedPath(ctx,x-w/2,yy-80,w,30,8);ctx.fill();ctx.stroke();ctx.fillStyle='#222';ctx.fillText(o.bubble,x-w/2+9,yy-59)}

function drawClassroom(ctx,x,y,w,h,label,doorSide){
 // 2.5D room body and shadow
 ctx.fillStyle='rgba(0,0,0,.18)';ctx.fillRect(x+14,y+18,w,h);
 ctx.fillStyle='#fffaf0';ctx.fillRect(x,y,w,h);

 const wall=18,door=100,doorX=x+w/2-door/2;
 ctx.lineCap='butt';

 // side walls + opposite wall
 ctx.strokeStyle='#53666a';ctx.lineWidth=wall;
 ctx.beginPath();
 ctx.moveTo(x,y);ctx.lineTo(x+w,y);
 ctx.moveTo(x,y);ctx.lineTo(x,y+h);
 ctx.moveTo(x+w,y);ctx.lineTo(x+w,y+h);
 ctx.stroke();

 // Door-side wall is drawn as TWO solid segments, leaving a real visible opening
 ctx.beginPath();
 if(doorSide==='bottom'){
   ctx.moveTo(x,y+h);ctx.lineTo(doorX,y+h);
   ctx.moveTo(doorX+door,y+h);ctx.lineTo(x+w,y+h);
 }else{
   // erase/redraw top wall as separated segments so the top doorway is visibly open
   ctx.save();
   ctx.globalCompositeOperation='destination-out';
   ctx.lineWidth=wall+4;ctx.beginPath();ctx.moveTo(doorX,y);ctx.lineTo(doorX+door,y);ctx.stroke();
   ctx.restore();
   ctx.strokeStyle='#53666a';ctx.lineWidth=wall;
   ctx.moveTo(x,y);ctx.lineTo(doorX,y);
   ctx.moveTo(doorX+door,y);ctx.lineTo(x+w,y);
 }
 ctx.stroke();

 // Highlight the doorway floor so students can immediately see the passage
 ctx.fillStyle='#d9c09b';
 const doorY=doorSide==='bottom'?y+h-8:y-8;
 ctx.fillRect(doorX,doorY,door,16);
 ctx.fillStyle='#fff4d7';
 ctx.fillRect(doorX+10,doorY+3,door-20,10);

 // header
 ctx.fillStyle='#47605c';ctx.fillRect(x+wall/2,y+wall/2,w-wall,42);
 ctx.fillStyle='#fff';ctx.font='bold 21px sans-serif';ctx.fillText(label,x+22,y+35);

 // windows
 for(let k=0;k<5;k++){
   ctx.fillStyle='#aed8e9';ctx.fillRect(x+390+k*70,y+72,56,68);
   ctx.fillStyle='#ffffff88';ctx.fillRect(x+395+k*70,y+77,12,58);
 }

 // furniture
 for(let r=0;r<2;r++)for(let c=0;c<4;c++){
   rounded(ctx,x+70+c*145,y+145+r*88,78,36,5,'#d5a05f','#8b633f');
 }
}
function drawSchool(ctx,floor){
 const bg=ctx.createLinearGradient(0,0,0,MAP.h);
 bg.addColorStop(0,'#eef7f9');bg.addColorStop(1,'#d8e3dd');
 ctx.fillStyle=bg;ctx.fillRect(0,0,MAP.w,MAP.h);

 // 넓은 중앙 복도
 ctx.fillStyle='#b8cbd5';ctx.fillRect(0,520,MAP.w,820);
 for(let y=540;y<1340;y+=60)for(let x=0;x<MAP.w;x+=90){
  ctx.strokeStyle='rgba(255,255,255,.24)';ctx.strokeRect(x,y,90,60);
 }

 const labels=['1-1 교실','1-2 교실','행정실','급식실','도서관','보건실'];
 const xs=[130,1110,2090];let i=0;
 for(const x of xs)drawClassroom(ctx,x,90,820,360,labels[i++],'bottom');
 for(const x of xs)drawClassroom(ctx,x,1370,820,360,labels[i++],'top');

 // 출구 쪽에 충분한 공간을 둔 전용 가로 복도
 ctx.fillStyle='#a7bdc8';ctx.fillRect(80,1745,3040,205);
 for(let x=90;x<3110;x+=100){
  ctx.strokeStyle='rgba(255,255,255,.22)';
  ctx.strokeRect(x,1745,100,68);
  ctx.strokeRect(x,1813,100,68);
  ctx.strokeRect(x,1881,100,68);
 }
 ctx.fillStyle='#344e5a';ctx.font='bold 22px sans-serif';
 ctx.fillText('출구 연결 복도',1460,1780);

 // 딱 3개의 출입구만 표시
 for(const gate of EXIT_PORTALS){
  const w=gate.x2-gate.x1;
  ctx.fillStyle='#315b75';ctx.fillRect(gate.x1,1850,w,120);
  ctx.fillStyle='#d9eff8';ctx.fillRect(gate.x1+25,1870,w-50,90);
  ctx.fillStyle='#ffffff';ctx.font='bold 18px sans-serif';ctx.textAlign='center';
  ctx.fillText(gate.name,gate.x1+w/2,1838);
  ctx.textAlign='left';
 }

 // 사물함 / 게시판 / 벤치
 for(let i=0;i<14;i++){
  ctx.fillStyle=i%2?'#91b7c8':'#80a5b6';ctx.fillRect(560+i*32,650,29,78);
  ctx.strokeStyle='#52707c';ctx.strokeRect(560+i*32,650,29,78);
 }
 rounded(ctx,1200,635,800,105,12,'#f7e3a0','#a98d48');
 ctx.fillStyle='#654';ctx.font='bold 22px sans-serif';
 ctx.fillText('🏫 오늘도 즐겁고 안전한 학교생활!',1390,695);
 rounded(ctx,950,1225,330,34,7,'#9f7046','#6e4a2f');
 rounded(ctx,1940,1225,330,34,7,'#9f7046','#6e4a2f');

 ctx.fillStyle='#415b60';ctx.font='bold 36px sans-serif';
 ctx.fillText('1층 중앙 복도',1400,945);
}

function drawFenceRect(ctx,r){
 // 충돌 좌표와 같은 두께의 실제 울타리 표현
 ctx.fillStyle='#6e7e87';ctx.fillRect(r.x,r.y,r.w,r.h);
 ctx.fillStyle='#dfe7eb';
 if(r.w>r.h){for(let x=r.x;x<r.x+r.w;x+=48)ctx.fillRect(x,r.y-8,5,r.h+16)}
 else{for(let y=r.y;y<r.y+r.h;y+=48)ctx.fillRect(r.x-8,y,r.w+16,5)}
}
function drawGoal(ctx,x,y,flip=1){
 ctx.save();ctx.translate(x,y);ctx.scale(flip,1);ctx.strokeStyle='#fff';ctx.lineWidth=9;ctx.strokeRect(0,0,120,160);ctx.strokeStyle='rgba(255,255,255,.55)';ctx.lineWidth=2;for(let i=20;i<120;i+=20){ctx.beginPath();ctx.moveTo(i,0);ctx.lineTo(i,160);ctx.stroke()}for(let j=20;j<160;j+=20){ctx.beginPath();ctx.moveTo(0,j);ctx.lineTo(120,j);ctx.stroke()}ctx.restore();
}
function drawPlayground(ctx){
 // 왼쪽 출입구 통로(x 520~820)는 비워 두고, 놀이터는 그 왼쪽 아래로 이동
 rounded(ctx,70,650,420,360,24,'#e7c88b','#b5965e');
 ctx.fillStyle='#5c8eb5';ctx.font='bold 24px sans-serif';ctx.fillText('놀이터',100,690);
 ctx.fillStyle='#e85f55';ctx.fillRect(120,730,100,34);ctx.strokeStyle='#3978a1';ctx.lineWidth=9;ctx.beginPath();ctx.moveTo(145,730);ctx.lineTo(95,845);ctx.stroke();ctx.fillStyle='#ffd34d';ctx.fillRect(132,695,75,40);
 ctx.strokeStyle='#3e6f8a';ctx.lineWidth=10;ctx.beginPath();ctx.moveTo(260,850);ctx.lineTo(280,690);ctx.lineTo(405,690);ctx.lineTo(430,850);ctx.stroke();
 ctx.strokeStyle='#444';ctx.lineWidth=4;for(const sx of [310,365]){ctx.beginPath();ctx.moveTo(sx,700);ctx.lineTo(sx,805);ctx.moveTo(sx+28,700);ctx.lineTo(sx+28,805);ctx.stroke();ctx.fillStyle='#d65b55';ctx.fillRect(sx-3,800,35,12)}
 ctx.strokeStyle='#9a7d50';ctx.lineWidth=9;ctx.strokeRect(105,880,350,22);
}
function drawYard(ctx){
 const sky=ctx.createLinearGradient(0,0,0,MAP.h);sky.addColorStop(0,'#ccebf7');sky.addColorStop(.22,'#e9f5e7');sky.addColorStop(.23,'#78ad65');sky.addColorStop(1,'#5e984c');ctx.fillStyle=sky;ctx.fillRect(0,0,MAP.w,MAP.h);

 // 학교 외벽: 왼쪽 / 가운데 / 오른쪽 3개 입구만 실제로 열려 있음.
 ctx.fillStyle='rgba(0,0,0,.18)';ctx.fillRect(360,140,2480,220);
 for(const r of SCHOOL_YARD_WALLS){
  ctx.fillStyle='#f1e3c8';ctx.fillRect(r.x,r.y,r.w,r.h);
  ctx.fillStyle='#a95247';ctx.fillRect(r.x,r.y,r.w,34);
 }
 for(const gate of EXIT_PORTALS){
  const w=gate.x2-gate.x1;
  rounded(ctx,gate.x1,245,w,95,12,'#315b75','#23445a');
  ctx.fillStyle='#dff3fb';ctx.fillRect(gate.x1+25,260,w-50,62);
  ctx.fillStyle='#173b4d';ctx.font='bold 15px sans-serif';ctx.textAlign='center';
  ctx.fillText(gate.name,gate.x1+w/2,230);
  ctx.textAlign='left';
 }
 ctx.fillStyle='#fff';ctx.font='bold 25px sans-serif';ctx.fillText('우리 학교',1520,82);
 // 세 출입구 앞은 구조물이 없는 넓은 이동 통로
 for(const gate of EXIT_PORTALS){
  ctx.fillStyle='rgba(231,220,187,.62)';ctx.fillRect(gate.x1-55,340,(gate.x2-gate.x1)+110,440);
  ctx.strokeStyle='rgba(111,92,63,.32)';ctx.lineWidth=3;ctx.strokeRect(gate.x1-55,340,(gate.x2-gate.x1)+110,440);
 }
 drawPlayground(ctx);

 // 넓은 육상 트랙/축구장
 ctx.fillStyle='#b96d54';ctx.beginPath();ctx.ellipse(2140,1180,900,500,0,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#f4e8df';ctx.lineWidth=8;for(let i=0;i<4;i++){ctx.beginPath();ctx.ellipse(2140,1180,840-i*52,440-i*36,0,0,Math.PI*2);ctx.stroke()}
 ctx.fillStyle='#70a85d';ctx.beginPath();ctx.ellipse(2140,1180,590,300,0,0,Math.PI*2);ctx.fill();
 ctx.strokeStyle='#fff';ctx.lineWidth=6;ctx.beginPath();ctx.moveTo(2140,880);ctx.lineTo(2140,1480);ctx.stroke();ctx.beginPath();ctx.arc(2140,1180,85,0,Math.PI*2);ctx.stroke();
 drawGoal(ctx,1580,1090,1);drawGoal(ctx,2700,1090,-1);

 // 농구장: 울타리는 점프로만 넘을 수 있음
 ctx.fillStyle='#c9a86a';ctx.fillRect(160,1120,920,714);ctx.strokeStyle='#fff';ctx.lineWidth=6;ctx.strokeRect(185,1145,870,664);ctx.beginPath();ctx.arc(620,1477,120,0,Math.PI*2);ctx.stroke();
 for(const r of FENCES)drawFenceRect(ctx,r);
 ctx.fillStyle='#fff';ctx.font='bold 22px sans-serif';ctx.fillText('농구장 · 울타리는 점프로 넘을 수 있어요',250,1090);

 // 나무와 벤치
 for(let i=0;i<9;i++){const x=180+i*340;ctx.fillStyle='#7d5637';ctx.fillRect(x,760,24,82);ctx.fillStyle='#397f48';ctx.beginPath();ctx.arc(x+12,730,58,0,Math.PI*2);ctx.fill()}
 rounded(ctx,180,900,330,36,7,'#956b42','#694a30');rounded(ctx,560,900,330,36,7,'#956b42','#694a30');
 ctx.fillStyle='#fff';ctx.font='bold 40px sans-serif';ctx.fillText('운동장',1440,570);
}

function drawArea(ctx,floor){floor===0?drawYard(ctx):drawSchool(ctx,floor)}

let renderErrorShown=false;
function loop(t){
 const dt=Math.min(.035,(t-last)/1000);last=t;
 try{lerpEntities(dt);
 if(started&&mode==='student'&&players[meId]){
  const p=players[meId];let dx=0,dy=0;
  if(keys.w||keys.arrowup)dy--;if(keys.s||keys.arrowdown)dy++;if(keys.a||keys.arrowleft)dx--;if(keys.d||keys.arrowright)dx++;
  if(Math.abs(joy.dx)+Math.abs(joy.dy)>.05){dx=joy.dx;dy=joy.dy}
  if(['lobby','playing'].includes(currentPhase)&&(dx||dy)){
   const l=Math.hypot(dx,dy);dx/=l;dy/=l;angle=Math.atan2(dy,dx);
   const sp=(Date.now()<(p.boostUntil||boostUntil)?1.8:1)*SPEED;
   const nx=clamp(p.x+dx*sp*dt,20,MAP.w-20),ny=clamp(p.y+dy*sp*dt,20,MAP.h-20);
   resolveMoveLocal(p,nx,ny);p.angle=angle;checkPortalLocal(p);socket.emit('move',{x:p.x,y:p.y,angle:p.angle,floor:p.floor});
  }
  tryPickupNearbyFish();if(swingT>0)swingT-=dt;drawPlayerView();if($('studentMapModal')?.classList.contains('open'))drawStudentOverviewMap();
 }
 if(started&&mode==='teacher')drawTeacherView();
 }catch(err){
  console.error('render loop error',err);
  if(!renderErrorShown){renderErrorShown=true;toast('화면을 다시 불러오는 중입니다…')}
 }
 requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function drawFishItems(ctx,floor){
 if(!fishItems.length||!fishExpireAt||Date.now()>fishExpireAt)return;
 const pulse=1+Math.sin(Date.now()/150)*.08;
 for(const f of fishItems){
  if(!f.active||f.floor!==floor)continue;
  ctx.save();ctx.translate(f.x,f.y);ctx.scale(pulse,pulse);
  ctx.fillStyle='rgba(255,205,70,.28)';ctx.beginPath();ctx.arc(0,0,46,0,Math.PI*2);ctx.fill();
  ctx.font='46px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('🐟',0,0);ctx.restore();
 }
}
function tryPickupNearbyFish(){
 const p=players[meId];
 if(!p||!['spy','police'].includes(p.role)||!p.alive||fishPickupPending||!fishExpireAt||Date.now()>fishExpireAt)return;
 const f=fishItems.find(x=>x.active&&x.floor===p.floor&&Math.hypot(x.x-p.x,x.y-p.y)<=75);
 if(f){fishPickupPending=true;socket.emit('pickupFish',{fishId:f.id});setTimeout(()=>fishPickupPending=false,350)}
}

function drawPlayerView(){
 const p=players[meId];if(!p)return;
 cam.x=clamp(p.x-gameCanvas.width/2,0,Math.max(0,MAP.w-gameCanvas.width));cam.y=clamp(p.y-gameCanvas.height/2,0,Math.max(0,MAP.h-gameCanvas.height));
 g.clearRect(0,0,gameCanvas.width,gameCanvas.height);g.save();g.translate(-cam.x,-cam.y);drawArea(g,p.floor);drawFishItems(g,p.floor);
 for(const n of npcs.filter(n=>n.floor===p.floor)){drawPerson(g,n);bubble(g,n)}
 for(const q of Object.values(players).filter(q=>q.floor===p.floor)){
  drawPerson(g,q,{police:q.role==='police',revealed:q.revealed,name:myRole&&q.role===myRole&&currentPhase==='reveal'?q.nick:(myRole==='spy'&&q.role==='spy'&&q.alive?q.nick:'')});bubble(g,q)
 }
 if(myRole==='police'&&p.alive&&currentPhase==='playing'){const j=jumpOffset(p);g.save();g.translate(p.x,p.y-j);let a=p.angle||angle;if(swingT>0){const prog=1-swingT/.22;a+=-1.05+prog*2}g.rotate(a);
  g.fillStyle='#111820';g.fillRect(10,-6,23,12);
  g.fillStyle='#2c3440';g.fillRect(31,-5,58,10);
  g.fillStyle='#0f141a';g.fillRect(84,-7,10,14);
  g.fillStyle='#69727d';g.fillRect(34,-2,46,3);
  g.restore()}
 g.restore();

 $('floorHud').textContent=p.floor===0?'운동장':`${p.floor}층`;
 $('scoreHud').textContent=`⭐ ${myScore()}`;
 if(currentPhase==='lobby'){$('roleHud').textContent='대기 중';$('timerHud').textContent='친구 기다리는 중';$('spyHud').textContent='';$('attackBtn').style.display='none';$('boostBtn').style.display='none';$('jumpBtn').style.display='block'}
 else if(currentPhase==='playing'){
  $('timerHud').textContent=fmt(timeLeft);$('spyHud').textContent=`스파이 ${Object.values(players).filter(x=>x.role==='spy'&&x.alive).length}`;
  if(myRole==='police'){$('roleHud').textContent=`🚔 ${'❤️'.repeat(Math.max(0,3-(p.miss||0)))}${'🖤'.repeat(Math.min(3,p.miss||0))}`;$('attackBtn').style.display='block'}
  else{$('roleHud').textContent=p.ghost?'🕵️👻 유령':'🕵️ 스파이';$('attackBtn').style.display='none'}

  const charges=p.boostCharges||0,activeBoost=Date.now()<(p.boostUntil||0);
  if(p.alive&&charges>0){
    $('boostBtn').style.display='block';
    $('boostBtn').disabled=activeBoost;
    $('boostBtn').innerHTML=activeBoost?`🚀<small>사용 중 · ×${charges}</small>`:`🚀<small>부스터 ×${charges}</small>`;
  }else{
    $('boostBtn').style.display='none';$('boostBtn').disabled=false;
  }
 }
}


let studentMapZoom=1,studentMapPan={x:0,y:0};
const studentMapPointers=new Map();
let studentMapGestureStart=null;

function clampStudentMapTransform(){
 const c=$('studentMapCanvas'),vp=$('studentMapViewport');
 if(!c||!vp)return;
 const rect=vp.getBoundingClientRect();
 const minScale=1,maxScale=4;
 studentMapZoom=Math.max(minScale,Math.min(maxScale,studentMapZoom));

 // keep at least a useful portion of the map visible while panning
 const drawnW=rect.width*studentMapZoom, drawnH=(rect.width*(620/1000))*studentMapZoom;
 const maxX=Math.max(0,(drawnW-rect.width)/2)+rect.width*.18;
 const maxY=Math.max(0,(drawnH-rect.height)/2)+rect.height*.18;
 studentMapPan.x=Math.max(-maxX,Math.min(maxX,studentMapPan.x));
 studentMapPan.y=Math.max(-maxY,Math.min(maxY,studentMapPan.y));
}

function drawStudentOverviewMap(){
 const c=$('studentMapCanvas'),vp=$('studentMapViewport'),p=players[meId];
 if(!c||!vp||!p)return;

 const cssW=Math.max(320,vp.clientWidth||900);
 const cssH=Math.min(680,Math.max(360,cssW*.62));
 const dpr=Math.min(2,window.devicePixelRatio||1);
 c.width=Math.round(cssW*dpr);c.height=Math.round(cssH*dpr);
 c.style.width=cssW+'px';c.style.height=cssH+'px';
 vp.style.height=cssH+'px';

 const ctx=c.getContext('2d');
 ctx.setTransform(dpr,0,0,dpr,0,0);
 ctx.clearRect(0,0,cssW,cssH);

 clampStudentMapTransform();

 ctx.save();
 ctx.translate(cssW/2+studentMapPan.x,cssH/2+studentMapPan.y);
 ctx.scale(studentMapZoom,studentMapZoom);
 ctx.translate(-cssW/2,-cssH/2);

 const W=cssW,H=cssH,margin=18,gap=18,panelW=(W-margin*2-gap)/2,panelH=H-36;
 const panels=[
  {floor:0,x:margin,y:18,w:panelW,h:panelH,title:'운동장'},
  {floor:1,x:margin+panelW+gap,y:18,w:panelW,h:panelH,title:'1층'}
 ];

 for(const pn of panels){
  ctx.save();
  ctx.fillStyle=pn.floor===0?'#dcebd1':'#edf2f4';
  ctx.fillRect(pn.x,pn.y,pn.w,pn.h);
  ctx.strokeStyle='#607983';ctx.lineWidth=2/studentMapZoom;ctx.strokeRect(pn.x,pn.y,pn.w,pn.h);

  const pad=10;
  const scale=Math.min((pn.w-pad*2)/MAP.w,(pn.h-pad*2)/MAP.h);
  const ox=pn.x+(pn.w-MAP.w*scale)/2;
  const oy=pn.y+(pn.h-MAP.h*scale)/2;
  ctx.translate(ox,oy);ctx.scale(scale,scale);
  drawArea(ctx,pn.floor);

  if(p.floor===pn.floor){
   ctx.fillStyle='#1877d2';ctx.strokeStyle='#fff';ctx.lineWidth=14;
   ctx.beginPath();ctx.arc(p.x,p.y,60,0,Math.PI*2);ctx.stroke();ctx.fill();
   ctx.fillStyle='#fff';ctx.font='bold 72px sans-serif';ctx.textAlign='center';
   ctx.fillText('나',p.x,p.y+25);ctx.textAlign='left';
  }
  ctx.restore();

  ctx.fillStyle='#173b4d';ctx.font=`bold ${Math.max(15,20/studentMapZoom)}px sans-serif`;
  ctx.fillText(pn.title,pn.x+10,pn.y+24);
 }
 ctx.restore();

 $('studentMapPlace').textContent=`현재 위치: ${p.floor===0?'운동장':'1층'}`;
}
function openStudentMap(){
 studentMapZoom=1;studentMapPan={x:0,y:0};
 $('studentMapModal').classList.add('open');
 requestAnimationFrame(drawStudentOverviewMap);
}
function closeStudentMap(){$('studentMapModal').classList.remove('open')}
$('studentMapBtn').onclick=openStudentMap;
$('studentMapClose').onclick=closeStudentMap;
$('studentMapModal').addEventListener('click',e=>{if(e.target===$('studentMapModal'))closeStudentMap()});

const smv=$('studentMapViewport');
function studentMapDist(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function studentMapMid(a,b){return {x:(a.x+b.x)/2,y:(a.y+b.y)/2}}

smv.addEventListener('pointerdown',e=>{
 e.preventDefault();
 smv.setPointerCapture(e.pointerId);
 studentMapPointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
 if(studentMapPointers.size===1){
   const a=[...studentMapPointers.values()][0];
   studentMapGestureStart={type:'pan',point:{...a},pan:{...studentMapPan}};
 }else if(studentMapPointers.size===2){
   const [a,b]=[...studentMapPointers.values()];
   studentMapGestureStart={
     type:'pinch',dist:studentMapDist(a,b),mid:studentMapMid(a,b),
     zoom:studentMapZoom,pan:{...studentMapPan}
   };
 }
},{passive:false});

smv.addEventListener('pointermove',e=>{
 if(!studentMapPointers.has(e.pointerId))return;
 e.preventDefault();
 studentMapPointers.set(e.pointerId,{x:e.clientX,y:e.clientY});

 if(studentMapPointers.size===1&&studentMapGestureStart?.type==='pan'){
   const a=[...studentMapPointers.values()][0],s=studentMapGestureStart;
   studentMapPan.x=s.pan.x+(a.x-s.point.x);
   studentMapPan.y=s.pan.y+(a.y-s.point.y);
   clampStudentMapTransform();drawStudentOverviewMap();
 }else if(studentMapPointers.size===2){
   const [a,b]=[...studentMapPointers.values()];
   if(studentMapGestureStart?.type!=='pinch'){
     studentMapGestureStart={type:'pinch',dist:studentMapDist(a,b),mid:studentMapMid(a,b),zoom:studentMapZoom,pan:{...studentMapPan}};
   }
   const s=studentMapGestureStart,dist=studentMapDist(a,b),mid=studentMapMid(a,b);
   const ratio=s.dist>0?dist/s.dist:1;
   const newZoom=Math.max(1,Math.min(4,s.zoom*ratio));

   // Zoom around the fingers' midpoint rather than only the canvas center.
   const rect=smv.getBoundingClientRect();
   const cx=rect.left+rect.width/2,cy=rect.top+rect.height/2;
   const vx=s.mid.x-cx-s.pan.x,vy=s.mid.y-cy-s.pan.y;
   studentMapZoom=newZoom;
   studentMapPan.x=(mid.x-cx)-vx*(newZoom/s.zoom);
   studentMapPan.y=(mid.y-cy)-vy*(newZoom/s.zoom);
   clampStudentMapTransform();drawStudentOverviewMap();
 }
},{passive:false});

function endStudentMapPointer(e){
 if(studentMapPointers.has(e.pointerId))studentMapPointers.delete(e.pointerId);
 if(studentMapPointers.size===1){
   const a=[...studentMapPointers.values()][0];
   studentMapGestureStart={type:'pan',point:{...a},pan:{...studentMapPan}};
 }else if(studentMapPointers.size===0){
   studentMapGestureStart=null;
 }
}
smv.addEventListener('pointerup',endStudentMapPointer);
smv.addEventListener('pointercancel',endStudentMapPointer);

// Mouse wheel support also works on laptops/desktops.
smv.addEventListener('wheel',e=>{
 e.preventDefault();
 const rect=smv.getBoundingClientRect(),cx=rect.left+rect.width/2,cy=rect.top+rect.height/2;
 const px=e.clientX-cx,py=e.clientY-cy;
 const old=studentMapZoom;
 const factor=e.deltaY<0?1.15:1/1.15;
 const next=Math.max(1,Math.min(4,old*factor));
 const vx=px-studentMapPan.x,vy=py-studentMapPan.y;
 studentMapZoom=next;
 studentMapPan.x=px-vx*(next/old);
 studentMapPan.y=py-vy*(next/old);
 clampStudentMapTransform();drawStudentOverviewMap();
},{passive:false});

window.addEventListener('resize',()=>{
 if($('studentMapModal')?.classList.contains('open'))drawStudentOverviewMap();
});

function drawTeacherRoleTag(ctx,p){
 const {x,y}=pos(p),j=jumpOffset(p);
 const text=p.role==='spy'?'스파이':'경찰';
 const fill=p.role==='spy'?'#b4232d':'#2467a6';
 ctx.save();
 ctx.font='bold 14px sans-serif';
 const w=ctx.measureText(text).width+16;
 ctx.fillStyle=fill;
 roundedPath(ctx,x-w/2,y-j-76,w,22,9);ctx.fill();
 ctx.fillStyle='#fff';ctx.textAlign='center';ctx.fillText(text,x,y-j-60);
 ctx.restore();
}

function drawTeacherView(){
 tg.clearRect(0,0,teacherCanvas.width,teacherCanvas.height);
 const fit=Math.min(teacherCanvas.width/MAP.w,teacherCanvas.height/MAP.h)*.90,scale=fit*teacherZoom;
 const ox=teacherCanvas.width/2-MAP.w*scale/2+teacherPan.x,oy=teacherCanvas.height/2-MAP.h*scale/2+teacherPan.y;
 tg.save();tg.translate(ox,oy);tg.scale(scale,scale);drawArea(tg,selectedTeacherFloor);drawFishItems(tg,selectedTeacherFloor);
 for(const n of npcs.filter(n=>n.floor===selectedTeacherFloor))drawPerson(tg,n);
 for(const p of Object.values(players).filter(p=>p.floor===selectedTeacherFloor)){
  drawPerson(tg,p,{police:p.role==='police',revealed:p.role==='spy',name:p.nick});
  if(currentPhase==='reveal'||currentPhase==='playing'||currentPhase==='ended')drawTeacherRoleTag(tg,p);
 }
 tg.restore();
 $('teacherTimer').textContent=currentPhase==='playing'?fmt(timeLeft):(currentPhase==='reveal'?'팀 확인 10초':'대기');
 $('teacherStats').textContent=`경찰 ${Object.values(players).filter(p=>p.role==='police'&&p.alive).length}명 · 스파이 ${Object.values(players).filter(p=>p.role==='spy'&&p.alive).length}명 · 학생 ${npcs.length}명`;

}

document.querySelectorAll('#floorTabs button').forEach(b=>b.onclick=()=>{selectedTeacherFloor=Math.min(1,+b.dataset.floor);teacherPan={x:0,y:0};sceneSound('floor')});
// 버튼 없이 마우스 휠로 확대/축소, 드래그로 이동
teacherCanvas.addEventListener('wheel',e=>{if(mode!=='teacher')return;e.preventDefault();teacherZoom=clamp(teacherZoom*(e.deltaY<0?1.12:.89),.7,3.2)},{passive:false});
teacherCanvas.addEventListener('pointerdown',e=>{if(mode!=='teacher')return;teacherDrag={id:e.pointerId,x:e.clientX,y:e.clientY,px:teacherPan.x,py:teacherPan.y};teacherCanvas.setPointerCapture(e.pointerId)});
teacherCanvas.addEventListener('pointermove',e=>{if(!teacherDrag||e.pointerId!==teacherDrag.id)return;teacherPan.x=teacherDrag.px+(e.clientX-teacherDrag.x);teacherPan.y=teacherDrag.py+(e.clientY-teacherDrag.y)});
teacherCanvas.addEventListener('pointerup',e=>{if(teacherDrag&&e.pointerId===teacherDrag.id)teacherDrag=null});
teacherCanvas.addEventListener('pointercancel',()=>teacherDrag=null);





function requestFreshState(){
 if(mode==='student'&&roomCode&&socket.connected)socket.emit('requestState');
}
setInterval(requestFreshState,2000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(requestFreshState,100)});
window.addEventListener('focus',()=>setTimeout(requestFreshState,100));

function resumeSavedSession(){
 const s=loadSession();if(!s||mode==='teacher')return;
 socket.emit('resumeSession',s,r=>{if(!r?.ok)return;mode='student';roomCode=s.code;meId=r.id;if(r.state)applyState(r.state);applyRoleUI(r.role,r.teammates||[]);openPlayerWorld();if(r.phase==='reveal')showTeamReveal(10);if(r.phase==='ended'){}toast('다시 연결되었습니다!')});
}
(function initUrl(){const q=new URLSearchParams(location.search),r=q.get('room');if(r){$('joinCode').value=r.replace(/\D/g,'').slice(0,4);mode='student';showScreen('studentJoin',true)}})();
socket.on('connect',()=>setTimeout(resumeSavedSession,120));
