const socket=io();
const MAP={w:2500,h:1550};
let mode=null,roomCode='',meId=null,myRole=null,teammates=[],players={},npcs=[],started=false,timeLeft=0,totalTime=1,currentPhase='lobby';
let selectedTeacherFloor=1,keys={},angle=0,boostUntil=0,boostUsed=false,swingT=0,last=performance.now(),cam={x:0,y:0},joy={active:false,dx:0,dy:0};
let latestScores=[],pendingJoin=null,countdownTimer=null;

const $=id=>document.getElementById(id);
const gameCanvas=$('gameCanvas'),g=gameCanvas.getContext('2d'),teacherCanvas=$('teacherCanvas'),tg=teacherCanvas.getContext('2d');
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function resize(){gameCanvas.width=innerWidth;gameCanvas.height=innerHeight;teacherCanvas.width=innerWidth;teacherCanvas.height=innerHeight}
addEventListener('resize',resize);resize();

const SESSION_KEY='spySchoolStudentSessionV11';
function saveSession(data){localStorage.setItem(SESSION_KEY,JSON.stringify(data))}
function loadSession(){try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{return null}}
function clearSession(){localStorage.removeItem(SESSION_KEY)}
function buildJoinUrl(code){return `${location.origin}/?room=${encodeURIComponent(code)}`}
function fmt(t){t=Math.max(0,t||0);return `${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`}

function audioCtx(){
 if(!window._ac)window._ac=new (window.AudioContext||window.webkitAudioContext)();
 try{window._ac.resume()}catch{}
 return window._ac;
}
function tone(freq=440,dur=.12,type='sine',gain=.05,delay=0){
 try{
  const ac=audioCtx(),o=ac.createOscillator(),v=ac.createGain(),t=ac.currentTime+delay;
  o.type=type;o.frequency.setValueAtTime(freq,t);v.gain.setValueAtTime(gain,t);v.gain.exponentialRampToValueAtTime(.001,t+dur);
  o.connect(v).connect(ac.destination);o.start(t);o.stop(t+dur+.02);
 }catch{}
}
function sceneSound(kind='move'){
 if(kind==='start'){tone(440,.12,'sine',.06);tone(660,.15,'sine',.06,.13);tone(880,.2,'sine',.06,.28)}
 else if(kind==='end'){tone(660,.18,'triangle',.06);tone(520,.18,'triangle',.06,.18);tone(390,.28,'triangle',.06,.36)}
 else if(kind==='floor'){tone(520,.09,'sine',.045);tone(740,.12,'sine',.045,.08)}
 else if(kind==='count'){tone(750,.08,'square',.035)}
 else{tone(420,.08,'sine',.035);tone(560,.09,'sine',.035,.07)}
}
function whoosh(){try{const ac=audioCtx(),o=ac.createOscillator(),v=ac.createGain();o.type='sawtooth';o.frequency.setValueAtTime(650,ac.currentTime);o.frequency.exponentialRampToValueAtTime(120,ac.currentTime+.12);v.gain.setValueAtTime(.07,ac.currentTime);v.gain.exponentialRampToValueAtTime(.001,ac.currentTime+.13);o.connect(v).connect(ac.destination);o.start();o.stop(ac.currentTime+.14)}catch{}}
function thump(){try{const ac=audioCtx(),o=ac.createOscillator(),v=ac.createGain();o.type='square';o.frequency.setValueAtTime(110,ac.currentTime);o.frequency.exponentialRampToValueAtTime(45,ac.currentTime+.09);v.gain.setValueAtTime(.13,ac.currentTime);v.gain.exponentialRampToValueAtTime(.001,ac.currentTime+.12);o.connect(v).connect(ac.destination);o.start();o.stop(ac.currentTime+.13)}catch{}}

function showScreen(id,quiet=false){
 document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
 $(id).classList.add('active');
 if(!quiet)sceneSound('move');
}
window.showScreen=showScreen;
function toast(t){$('toast').textContent=t;$('toast').style.opacity=1;clearTimeout(toast.t);toast.t=setTimeout(()=>$('toast').style.opacity=0,1400)}

function setPlayerGameVisible(on){$('playerGame').style.display=on?'block':'none'}
function setTeacherGameVisible(on){$('teacherGame').style.display=on?'block':'none'}
function ensureJoystick(){
 const touch=('ontouchstart'in window)||navigator.maxTouchPoints>0||matchMedia('(pointer:coarse)').matches;
 if(touch)$('joystickBase').style.display='block';
}
function openPlayerGame(){
 document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));
 setTeacherGameVisible(false);setPlayerGameVisible(true);started=true;ensureJoystick();socket.emit('requestNPCs');
}
function openTeacherGame(){
 document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));
 setPlayerGameVisible(false);setTeacherGameVisible(true);started=true;
}

function applyRoleUI(role,mates=[]){
 myRole=role;teammates=mates||[];
 $('roleTitle').textContent=myRole==='spy'?'🕵️ 당신은 스파이!':'🚔 당신은 경찰!';
 $('roleText').textContent=myRole==='spy'
  ?`다른 학생들과 똑같은 모습입니다. 다른 스파이: ${teammates.map(x=>x.nick).join(', ')||'없음'} — 학생처럼 행동하면서 살아남으세요.`
  :'학생과 스파이는 외형으로 구분할 수 없습니다. 행동을 관찰하세요. 일반 학생 3회 오인 시 탈락하지만 스파이를 잡으면 ❤️❤️❤️ 완전 회복!';
}
function applyState(s){
 currentPhase=s.phase??currentPhase;timeLeft=s.timeLeft??timeLeft;totalTime=s.total??s.minutes*60??totalTime;
 (s.players||[]).forEach(p=>players[p.id]=p);
}
function renderScores(targetId,scores=latestScores){
 const el=$(targetId);if(!el)return;
 if(!scores?.length){el.innerHTML='';return}
 el.innerHTML=scores.map((p,i)=>`<div class="scoreRow"><span>${i+1}</span><b>${escapeHtml(p.nick)}</b><b>⭐ ${p.score}</b></div>`).join('');
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function myScore(){
 const p=players[meId];
 if(p&&Number.isFinite(p.score))return p.score;
 const s=latestScores.find(x=>x.id===meId);return s?.score||0;
}
function updateScoreUI(){
 $('scoreHud').textContent=`⭐ ${myScore()}`;
 $('waitScore').textContent=`⭐ ${myScore()}점`;
 renderScores('teacherScoreBoard');renderScores('lobbyScores');renderScores('endScores');
}

function showCountdown(seconds=5){
 clearInterval(countdownTimer);
 $('countdownOverlay').classList.add('open');
 let n=seconds;$('countdownNumber').textContent=n;sceneSound('count');
 countdownTimer=setInterval(()=>{
  n--;if(n>0){$('countdownNumber').textContent=n;sceneSound('count')}
  else{
   clearInterval(countdownTimer);$('countdownNumber').textContent='GO!';sceneSound('start');
   setTimeout(()=>$('countdownOverlay').classList.remove('open'),650);
   if(mode==='student')openPlayerGame();else if(mode==='teacher')openTeacherGame();
  }
 },1000);
}

function resumeSavedSession(){
 const sess=loadSession();if(!sess||mode==='teacher')return;
 socket.emit('resumeSession',sess,r=>{
  if(!r?.ok)return;
  mode='student';roomCode=sess.code;meId=r.id;
  if(r.state)applyState(r.state);
  applyRoleUI(r.role,r.teammates||[]);
  updateScoreUI();
  if(r.phase==='playing'){openPlayerGame();toast('다시 연결되었습니다!');sceneSound('floor')}
  else if(r.phase==='countdown'){showScreen('roleScreen',true);showCountdown(5)}
  else if(r.phase==='ended'){showEndScreen(null,true)}
  else{$('waitCode').textContent=roomCode;showScreen('studentWait',true)}
 });
}

$('createRoom').onclick=()=>{
 mode='teacher';audioCtx();
 socket.emit('createRoom',{spies:+$('spies').value,minutes:+$('mins').value},r=>{
  if(!r.ok)return alert(r.error||'방 생성 실패');
  roomCode=r.code;$('roomCode').textContent=r.code;
  const u=buildJoinUrl(r.code);$('joinQr').src=`/api/qr?room=${encodeURIComponent(r.code)}`;$('joinUrlText').textContent=u;
  $('qrModalImage').src=`/api/qr?room=${encodeURIComponent(r.code)}`;$('qrModalUrl').textContent=u;
  showScreen('teacherLobby');
 })
};

$('joinRoom').onclick=()=>{
 audioCtx();
 const code=$('joinCode').value.trim(),nick=$('nickname').value.trim();
 if(!code||!nick){$('joinMessage').textContent='방 코드와 닉네임을 입력하세요.';return}
 pendingJoin={code,nick};$('characterModal').classList.add('open');sceneSound('move');
};
document.querySelectorAll('.characterChoice').forEach(b=>b.onclick=()=>{
 const gender=b.dataset.gender;$('characterModal').classList.remove('open');
 const {code,nick}=pendingJoin||{};if(!code||!nick)return;
 mode='student';
 socket.emit('joinRoom',{code,nick,gender},r=>{
  if(!r.ok){$('joinMessage').textContent=r.error;return}
  meId=r.id;roomCode=code;
  saveSession({code,playerId:r.id,reconnectToken:r.reconnectToken,nick});
  $('waitCode').textContent=roomCode;players[meId]={id:meId,nick,score:r.score||0};
  updateScoreUI();showScreen('studentWait');
 })
});
$('cancelCharacter').onclick=()=>$('characterModal').classList.remove('open');

$('startGame').onclick=()=>{audioCtx();socket.emit('startGame',{code:roomCode},r=>{if(!r.ok)alert(r.error)})};
$('restartGameBtn').onclick=()=>{
 audioCtx();socket.emit('restartGame',{code:roomCode},r=>{if(!r.ok)alert(r.error)});
};
$('copyJoinLink').onclick=async()=>{try{await navigator.clipboard.writeText(buildJoinUrl(roomCode));$('copyJoinLink').textContent='복사됨!';setTimeout(()=>$('copyJoinLink').textContent='참가 링크 복사',1200)}catch{prompt('이 링크를 복사하세요.',buildJoinUrl(roomCode))}};

function openQrModal(){
 $('qrModalImage').src=`/api/qr?room=${encodeURIComponent(roomCode)}`;
 $('qrModalUrl').textContent=buildJoinUrl(roomCode);
 $('qrModal').classList.add('open');sceneSound('move');
}
$('showQrInGame').onclick=openQrModal;$('endQrBtn').onclick=openQrModal;$('closeQrModal').onclick=()=>$('qrModal').classList.remove('open');

socket.on('lobby',r=>{
 if(mode==='teacher'){
  $('joinCount').textContent=`참가 ${r.players.length}명`;
  $('joinList').innerHTML=r.players.map(p=>`<span class="chip">${escapeHtml(p.nick)} ${p.connected?'':'(연결끊김)'}</span>`).join('');
 }
});
socket.on('scoreBoard',scores=>{latestScores=scores||[];(scores||[]).forEach(s=>{if(players[s.id])players[s.id].score=s.score});updateScoreUI()});
socket.on('role',r=>{applyRoleUI(r.role,r.teammates||[]);if(mode==='student')showScreen('roleScreen',true)});
socket.on('countdownStarted',e=>{currentPhase='countdown';showCountdown(e.seconds||5)});
socket.on('gameStarted',()=>{currentPhase='playing';started=true});
socket.on('teacherGameStarted',s=>{if(mode!=='teacher')return;applyState(s);npcs=s.npcs||[];openTeacherGame();socket.emit('teacherRequestState',{code:roomCode})});
socket.on('teacherState',s=>{if(mode==='teacher'){applyState(s);npcs=s.npcs||[]}});
socket.on('state',applyState);
socket.on('clock',c=>{timeLeft=c.timeLeft;totalTime=c.total});
socket.on('playerMoved',p=>{players[p.id]={...(players[p.id]||{}),...p}});
socket.on('autoAreaChanged',e=>{
 if(players[meId])Object.assign(players[meId],{floor:e.floor,x:e.x,y:e.y});
 toast(`📍 ${e.label}`);sceneSound('floor');
});
socket.on('playerJumped',e=>{if(players[e.id]){players[e.id].jumpStart=e.jumpStart;players[e.id].jumpUntil=e.jumpUntil}});
socket.on('playerBubble',e=>{if(players[e.id]){players[e.id].bubble=e.text;players[e.id].bubbleUntil=e.bubbleUntil}});
socket.on('npcState',arr=>{npcs=arr.map(n=>({...npcs.find(x=>x.id===n.id),...n}))});
socket.on('swingResult',r=>{whoosh();if(r.kind==='hit')setTimeout(thump,35)});
socket.on('wrongHit',e=>{const target=e.type==='npc'?npcs.find(n=>n.id===e.targetId):players[e.targetId];if(target){target.bubble=e.text;target.bubbleUntil=Date.now()+1800}if(e.by===meId)toast(`❌ 오인 공격 ${e.miss}/3`)});
socket.on('spyCaught',e=>{if(players[e.spyId]){players[e.spyId].alive=false;players[e.spyId].ghost=true;players[e.spyId].revealed=true;players[e.spyId].bubble='정체가 들켰다!';players[e.spyId].bubbleUntil=Date.now()+1800}if(e.by===meId){players[meId].miss=0;toast('🎯 스파이 검거! ❤️❤️❤️ 완전 회복!')}});
socket.on('lifeReset',()=>{if(players[meId])players[meId].miss=0;toast('❤️❤️❤️ 생명 완전 회복!')});
socket.on('policeOut',e=>{if(players[e.id]){players[e.id].alive=false;players[e.id].ghost=true}});
socket.on('boosted',e=>{if(players[e.id]){players[e.id].bubble=e.text;players[e.id].bubbleUntil=e.bubbleUntil;players[e.id].boostUsed=true}if(e.id===meId){boostUntil=e.until;boostUsed=true;toast('🚀 부스터 10초 발동!')}});
socket.on('gameEnded',e=>showEndScreen(e,false));
socket.on('roomClosed',()=>{alert('교사가 방을 종료했습니다.');clearSession();location.reload()});

function showEndScreen(e,resumed=false){
 started=false;setPlayerGameVisible(false);setTeacherGameVisible(false);currentPhase='ended';
 if(e?.scores){latestScores=e.scores;e.scores.forEach(s=>{if(players[s.id])players[s.id].score=s.score})}
 $('endTitle').textContent=e?(e.winner==='spy'?'🕵️ 스파이팀 승리!':'🚔 경찰팀 승리!'):'게임 종료';
 $('endText').textContent=e?.reason||'교사가 다음 게임을 준비하고 있습니다.';
 $('myEndScore').textContent=mode==='student'?`내 누적 점수: ⭐ ${myScore()}점`:'';
 $('teacherEndActions').style.display=mode==='teacher'?'flex':'none';
 $('studentEndWait').style.display=mode==='student'?'block':'none';
 updateScoreUI();showScreen('endScreen',true);if(!resumed)sceneSound('end');
}

$('attackBtn').onclick=attack;
function attack(){if(!started||currentPhase!=='playing'||myRole!=='police'||!players[meId]?.alive)return;swingT=.22;socket.emit('hitAttempt')}
$('boostBtn').onclick=()=>socket.emit('useBoost');
$('jumpBtn').onclick=jump;
function jump(){
 if(!started||currentPhase!=='playing'||!players[meId])return;
 const p=players[meId],now=Date.now();if((p.jumpUntil||0)>now)return;
 p.jumpStart=now;p.jumpUntil=now+650;socket.emit('jump');
}
$('chatToggle').onclick=()=>$('chatMenu').classList.toggle('open');
document.querySelectorAll('#chatMenu [data-msg]').forEach(b=>b.onclick=()=>{sendChat(b.dataset.msg);$('chatMenu').classList.remove('open')});
$('chatSend').onclick=()=>{sendChat($('chatInput').value);$('chatInput').value='';$('chatMenu').classList.remove('open')};
$('chatInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.stopPropagation();e.preventDefault();$('chatSend').click()}});
function sendChat(text){text=String(text||'').trim().slice(0,24);if(!text||!started)return;socket.emit('playerChat',{text})}

addEventListener('keydown',e=>{
 if(document.activeElement===$('chatInput'))return;
 keys[e.key.toLowerCase()]=true;
 if(e.code==='Space'){e.preventDefault();attack()}
 if(e.key.toLowerCase()==='f')jump();
});
addEventListener('keyup',e=>keys[e.key.toLowerCase()]=false);

(function setupJoystick(){
 const base=$('joystickBase'),knob=$('joystickKnob');
 function moveFromPoint(p){
  const r=base.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;
  let dx=p.clientX-cx,dy=p.clientY-cy,d=Math.hypot(dx,dy),max=r.width*.35;
  if(d>max){dx=dx/d*max;dy=dy/d*max}
  knob.style.transform=`translate(${dx}px,${dy}px)`;joy.dx=dx/max;joy.dy=dy/max;
 }
 const begin=e=>{joy.active=true;e.preventDefault();moveFromPoint(e.touches?e.touches[0]:e)};
 const move=e=>{if(!joy.active)return;e.preventDefault();moveFromPoint(e.touches?e.touches[0]:e)};
 const end=e=>{joy.active=false;joy.dx=joy.dy=0;knob.style.transform='translate(0,0)';if(e)e.preventDefault()};
 base.addEventListener('touchstart',begin,{passive:false});base.addEventListener('touchmove',move,{passive:false});base.addEventListener('touchend',end,{passive:false});base.addEventListener('touchcancel',end,{passive:false});
 base.addEventListener('pointerdown',e=>{if(e.pointerType!=='mouse')begin(e)});base.addEventListener('pointermove',e=>{if(joy.active&&e.pointerType!=='mouse')move(e)});base.addEventListener('pointerup',end);
})();

function jumpOffset(o){
 const now=Date.now(),start=o?.jumpStart||0,end=o?.jumpUntil||0;if(now<start||now>end||end<=start)return 0;
 return Math.sin(Math.PI*((now-start)/(end-start)))*36;
}
function rounded(ctx,x,y,w,h,r,fill,stroke){ctx.beginPath();ctx.roundRect(x,y,w,h,r);if(fill){ctx.fillStyle=fill;ctx.fill()}if(stroke){ctx.strokeStyle=stroke;ctx.stroke()}}
function drawDesk(ctx,x,y){ctx.fillStyle='#6e4d35';ctx.fillRect(x+5,y+32,64,12);rounded(ctx,x,y,74,34,5,'#d6a15f','#8b633f')}
function drawPlant(ctx,x,y){ctx.fillStyle='#9a673c';ctx.fillRect(x-10,y,20,18);ctx.fillStyle='#4b8d54';for(let i=0;i<5;i++){ctx.beginPath();ctx.ellipse(x+(i-2)*5,y-8-Math.abs(i-2)*4,7,15,(i-2)*.2,0,Math.PI*2);ctx.fill()}}
function drawEyes(ctx,x,y,skinOffset=0){
 ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(x-4,y-18,3.2,0,Math.PI*2);ctx.arc(x+4,y-18,3.2,0,Math.PI*2);ctx.fill();
 ctx.fillStyle='#152029';ctx.beginPath();ctx.arc(x-4,y-18,1.55,0,Math.PI*2);ctx.arc(x+4,y-18,1.55,0,Math.PI*2);ctx.fill();
}
function drawHair(ctx,x,y,a){
 ctx.fillStyle=a?.hairColor||'#2d241e';const h=a?.hair||'short';
 if(h==='short'){ctx.beginPath();ctx.arc(x,y-24,12,Math.PI,Math.PI*2);ctx.fill()}
 else if(h==='side'){ctx.beginPath();ctx.arc(x-2,y-24,12,Math.PI,Math.PI*2);ctx.fill();ctx.fillRect(x-11,y-26,6,12)}
 else if(h==='bob'){ctx.beginPath();ctx.arc(x,y-23,13,Math.PI,Math.PI*2);ctx.fill();ctx.fillRect(x-12,y-24,5,17);ctx.fillRect(x+7,y-24,5,17)}
 else if(h==='long'){ctx.beginPath();ctx.arc(x,y-23,13,Math.PI,Math.PI*2);ctx.fill();ctx.fillRect(x-12,y-24,5,25);ctx.fillRect(x+7,y-24,5,25)}
 else if(h==='spiky'){for(let i=-2;i<=2;i++){ctx.beginPath();ctx.moveTo(x+i*5-4,y-20);ctx.lineTo(x+i*5,y-36-Math.abs(i));ctx.lineTo(x+i*5+4,y-20);ctx.fill()}}
 else if(h==='cap'){ctx.beginPath();ctx.arc(x,y-25,12,Math.PI,Math.PI*2);ctx.fill();ctx.fillRect(x,y-27,15,5)}
 else if(h==='ponytail'){ctx.beginPath();ctx.arc(x,y-23,12,Math.PI,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(x+14,y-20,6,0,Math.PI*2);ctx.fill()}
}
function drawShadow(ctx,x,y,j){ctx.save();ctx.globalAlpha=.22*(1-j/65);ctx.fillStyle='#111';ctx.beginPath();ctx.ellipse(x,y+40,17+Math.max(0,j)*.1,6,0,0,Math.PI*2);ctx.fill();ctx.restore()}
function drawStudent(ctx,x,y,a,jump,ghost=false){
 const ap=a||{skin:'#efbd98',shirt:'#3f78a9',pants:'#24313d',bag:'#7a4f33',hair:'short',hairColor:'#251c18'};
 drawShadow(ctx,x,y,jump);y-=jump;ctx.save();ctx.globalAlpha=ghost?.38:1;
 ctx.fillStyle=ap.bag;rounded(ctx,x-15,y-4,30,24,6,ap.bag);
 ctx.fillStyle=ap.skin;ctx.beginPath();ctx.arc(x,y-19,12,0,Math.PI*2);ctx.fill();drawHair(ctx,x,y,ap);drawEyes(ctx,x,y);
 ctx.fillStyle=ap.shirt;rounded(ctx,x-12,y-7,24,31,4,ap.shirt);
 ctx.fillStyle=ap.pants;ctx.fillRect(x-11,y+24,8,20);ctx.fillRect(x+3,y+24,8,20);
 ctx.strokeStyle=ap.skin;ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(x-11,y);ctx.lineTo(x-19,y+14);ctx.moveTo(x+11,y);ctx.lineTo(x+19,y+14);ctx.stroke();
 if(ghost){ctx.globalAlpha=.9;ctx.font='21px sans-serif';ctx.fillText('👻',x-11,y-45)}
 ctx.restore();
}
function drawPolice(ctx,x,y,jump,ghost=false){
 drawShadow(ctx,x,y,jump);y-=jump;ctx.save();ctx.globalAlpha=ghost?.38:1;
 ctx.fillStyle='#efbd98';ctx.beginPath();ctx.arc(x,y-19,12,0,Math.PI*2);ctx.fill();ctx.fillStyle='#263b50';ctx.beginPath();ctx.arc(x,y-25,11,Math.PI,Math.PI*2);ctx.fill();drawEyes(ctx,x,y);
 rounded(ctx,x-12,y-7,24,31,4,'#244b78');ctx.fillStyle='#1f2d38';ctx.fillRect(x-11,y+24,8,20);ctx.fillRect(x+3,y+24,8,20);ctx.fillStyle='#f4d03f';ctx.fillRect(x-5,y-32,10,5);
 if(ghost){ctx.globalAlpha=.9;ctx.font='21px sans-serif';ctx.fillText('👻',x-11,y-45)}ctx.restore();
}
function drawRevealedSpy(ctx,x,y,jump,ghost=false){
 drawShadow(ctx,x,y,jump);y-=jump;ctx.save();ctx.globalAlpha=ghost?.38:1;
 ctx.fillStyle='#2a2a2a';ctx.beginPath();ctx.arc(x,y-19,12,0,Math.PI*2);ctx.fill();ctx.fillStyle='#111';ctx.beginPath();ctx.arc(x,y-25,11,Math.PI,Math.PI*2);ctx.fill();
 ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(x-4,y-18,3,0,Math.PI*2);ctx.arc(x+4,y-18,3,0,Math.PI*2);ctx.fill();ctx.fillStyle='#e11';ctx.beginPath();ctx.arc(x-4,y-18,1.5,0,Math.PI*2);ctx.arc(x+4,y-18,1.5,0,Math.PI*2);ctx.fill();
 rounded(ctx,x-12,y-7,24,31,4,'#661f1f');ctx.fillStyle='#222';ctx.fillRect(x-11,y+24,8,20);ctx.fillRect(x+3,y+24,8,20);ctx.fillStyle='#e22';ctx.font='bold 11px sans-serif';ctx.fillText('SPY',x-12,y+10);
 if(ghost){ctx.globalAlpha=.9;ctx.font='21px sans-serif';ctx.fillText('👻',x-11,y-45)}ctx.restore();
}
function drawPerson(ctx,x,y,opt={}){
 const{revealedSpy=false,police=false,ghost=false,name='',showName=false,jump=0,appearance=null}=opt;
 if(police)drawPolice(ctx,x,y,jump,ghost);else if(revealedSpy)drawRevealedSpy(ctx,x,y,jump,ghost);else drawStudent(ctx,x,y,appearance,jump,ghost);
 if(showName&&name){ctx.save();ctx.fillStyle='#172228';ctx.font='bold 13px sans-serif';ctx.textAlign='center';ctx.fillText(name,x,y-jump-48);ctx.restore()}
}
function bubble(ctx,o){
 if(!o?.bubble||o.bubbleUntil<Date.now())return;const j=jumpOffset(o),yy=o.y-j;ctx.font='bold 13px sans-serif';const w=ctx.measureText(o.bubble).width+18;
 ctx.fillStyle='#fff';ctx.strokeStyle='#26343d';ctx.lineWidth=2;ctx.beginPath();ctx.roundRect(o.x-w/2,yy-78,w,30,8);ctx.fill();ctx.stroke();ctx.fillStyle='#222';ctx.fillText(o.bubble,o.x-w/2+9,yy-57)
}

function drawSchool(ctx,floor){
 // background and 3D walls
 const bg=ctx.createLinearGradient(0,0,0,MAP.h);bg.addColorStop(0,'#eaf4f6');bg.addColorStop(1,'#d8e1da');ctx.fillStyle=bg;ctx.fillRect(0,0,MAP.w,MAP.h);
 ctx.fillStyle='#b9cad4';ctx.fillRect(0,500,MAP.w,470);ctx.fillStyle='#98b0bd';ctx.fillRect(0,690,MAP.w,58);
 // floor tiles
 for(let y=520;y<960;y+=55){for(let x=0;x<MAP.w;x+=85){ctx.strokeStyle='rgba(255,255,255,.22)';ctx.strokeRect(x,y,85,55)}}
 // wall depth/shadows
 ctx.fillStyle='rgba(0,0,0,.16)';ctx.fillRect(92,95,2210,355);ctx.fillRect(92,1075,2210,320);
 const labels={
  1:['1-1 교실','1-2 교실','행정실','급식실','도서관','보건실'],
  2:['2-1 교실','컴퓨터실','과학실','영어실','미술실','교무실'],
  3:['3-1 교실','방송실','음악실','회의실','상담실','자료실']
 }[floor];
 const xs=[90,870,1650],ys=[70,1050];let idx=0;
 for(const y of ys)for(const x of xs){
  ctx.fillStyle='#fffaf0';ctx.fillRect(x,y,690,320);ctx.strokeStyle='#586b6d';ctx.lineWidth=7;ctx.strokeRect(x,y,690,320);
  ctx.fillStyle='#47605c';ctx.fillRect(x,y,690,48);ctx.fillStyle='#fff';ctx.font='bold 21px sans-serif';ctx.fillText(labels[idx],x+20,y+31);
  // windows with highlights
  for(let k=0;k<4;k++){ctx.fillStyle='#aad6e8';ctx.fillRect(x+380+k*66,y+68,54,68);ctx.fillStyle='rgba(255,255,255,.55)';ctx.fillRect(x+385+k*66,y+73,12,58)}
  if(labels[idx].includes('컴퓨터')){
    for(let r=0;r<2;r++)for(let c=0;c<4;c++){drawDesk(ctx,x+60+c*135,y+105+r*90);ctx.fillStyle='#233846';ctx.fillRect(x+77+c*135,y+90+r*90,42,27)}
  }else if(labels[idx].includes('도서관')){
    for(let s=0;s<4;s++){ctx.fillStyle='#8c633e';ctx.fillRect(x+55+s*145,y+95,100,135);ctx.fillStyle='#d36d5d';ctx.fillRect(x+65+s*145,y+110,12,90);ctx.fillStyle='#5d8ba7';ctx.fillRect(x+82+s*145,y+110,12,90)}
  }else if(labels[idx].includes('급식')){
    for(let r=0;r<2;r++){rounded(ctx,x+70,y+112+r*88,510,40,8,'#d4ae6a','#9a794b')}
  }else{
    for(let r=0;r<2;r++)for(let c=0;c<4;c++)drawDesk(ctx,x+60+c*135,y+105+r*88)
  }
  drawPlant(ctx,x+625,y+260);
  ctx.fillStyle='#8b5a3b';ctx.fillRect(x+310,y+(y<500?308:-10),72,20);
  idx++;
 }
 // lockers, benches, board
 for(let i=0;i<10;i++){ctx.fillStyle=i%2?'#91b7c8':'#80a5b6';ctx.fillRect(520+i*32,575,29,72);ctx.strokeStyle='#52707c';ctx.strokeRect(520+i*32,575,29,72)}
 for(let i=0;i<10;i++){ctx.fillStyle=i%2?'#91b7c8':'#80a5b6';ctx.fillRect(1660+i*32,575,29,72);ctx.strokeStyle='#52707c';ctx.strokeRect(1660+i*32,575,29,72)}
 rounded(ctx,1030,555,440,95,10,'#f7e3a0','#a98d48');ctx.fillStyle='#654';ctx.font='bold 20px sans-serif';ctx.fillText('🏫 오늘도 즐겁고 안전한 학교생활!',1070,610);
 rounded(ctx,780,840,280,32,7,'#9f7046','#6e4a2f');rounded(ctx,1440,840,280,32,7,'#9f7046','#6e4a2f');

 // compact stairs
 for(const x of [110,MAP.w-250]){
  rounded(ctx,x,625,140,235,15,'#3a596c','#233b49');
  rounded(ctx,x+25,675,90,34,8,floor<3?'#5f8fa7':'#455863','#d7edf7');
  rounded(ctx,x+25,780,90,34,8,floor>1?'#775f7b':'#4e4750','#eaddeb');
  ctx.fillStyle='#fff';ctx.font='bold 14px sans-serif';ctx.textAlign='center';
  ctx.fillText(floor<3?'▲ 위층':'막힘',x+70,698);ctx.fillText(floor>1?'▼ 아래층':'막힘',x+70,803);ctx.textAlign='left';
 }
 // entrance to yard
 if(floor===1){
  ctx.fillStyle='#315b75';ctx.fillRect(1135,1410,230,110);ctx.fillStyle='#d9eff8';ctx.fillRect(1160,1430,90,80);ctx.fillRect(1250,1430,90,80);
  ctx.fillStyle='#fff';ctx.font='bold 20px sans-serif';ctx.fillText('정문 → 운동장',1182,1400);
 }
 ctx.fillStyle='#435b5e';ctx.font='bold 31px sans-serif';ctx.fillText(`${floor}층 중앙 복도`,1100,720);
}

function drawYard(ctx){
 const sky=ctx.createLinearGradient(0,0,0,MAP.h);sky.addColorStop(0,'#c9e8f5');sky.addColorStop(.32,'#e8f4e9');sky.addColorStop(.33,'#78af66');sky.addColorStop(1,'#5f984e');ctx.fillStyle=sky;ctx.fillRect(0,0,MAP.w,MAP.h);
 // school facade
 ctx.fillStyle='rgba(0,0,0,.16)';ctx.fillRect(810,68,900,250);ctx.fillStyle='#f3e6cc';ctx.fillRect(790,45,900,250);ctx.fillStyle='#a85447';ctx.fillRect(760,20,960,45);
 for(let r=0;r<3;r++)for(let c=0;c<8;c++){ctx.fillStyle='#9fd1e5';ctx.fillRect(835+c*100,80+r*62,64,42);ctx.fillStyle='#fff8';ctx.fillRect(840+c*100,84+r*62,12,34)}
 ctx.fillStyle='#2e5e76';ctx.fillRect(1150,225,180,70);ctx.fillStyle='#fff';ctx.font='bold 27px sans-serif';ctx.fillText('우리 학교',1163,62);
 // entrance
 rounded(ctx,1140,65,220,70,12,'#315b75','#23445a');ctx.fillStyle='#fff';ctx.font='bold 19px sans-serif';ctx.fillText('학교 안으로',1196,107);
 // track
 ctx.fillStyle='#b96d54';ctx.beginPath();ctx.ellipse(1510,950,720,390,0,0,Math.PI*2);ctx.fill();
 ctx.strokeStyle='#f2e7dc';ctx.lineWidth=8;for(let i=0;i<3;i++){ctx.beginPath();ctx.ellipse(1510,950,660-i*50,335-i*35,0,0,Math.PI*2);ctx.stroke()}
 ctx.fillStyle='#70a85d';ctx.beginPath();ctx.ellipse(1510,950,470,230,0,0,Math.PI*2);ctx.fill();
 // soccer goals
 ctx.strokeStyle='#fff';ctx.lineWidth=8;ctx.strokeRect(1180,820,90,130);ctx.strokeRect(1760,820,90,130);
 // basketball court
 ctx.fillStyle='#c8a86a';ctx.fillRect(160,850,620,420);ctx.strokeStyle='#fff';ctx.lineWidth=6;ctx.strokeRect(160,850,620,420);ctx.beginPath();ctx.arc(470,1060,95,0,Math.PI*2);ctx.stroke();
 ctx.strokeStyle='#333';ctx.strokeRect(210,990,10,120);ctx.strokeRect(720,990,10,120);ctx.fillStyle='#f37f32';ctx.beginPath();ctx.arc(230,1050,25,0,Math.PI*2);ctx.fill();
 // trees and benches
 for(let i=0;i<8;i++){const x=120+i*290;ctx.fillStyle='#7e5738';ctx.fillRect(x,420,22,75);ctx.fillStyle='#397f48';ctx.beginPath();ctx.arc(x+10,395,55,0,Math.PI*2);ctx.fill()}
 rounded(ctx,220,560,280,34,7,'#956b42','#694a30');rounded(ctx,570,560,280,34,7,'#956b42','#694a30');
 ctx.fillStyle='#fff';ctx.font='bold 32px sans-serif';ctx.fillText('운동장',1180,420);
}

function drawArea(ctx,floor){if(floor===0)drawYard(ctx);else drawSchool(ctx,floor)}

function loop(t){
 const dt=Math.min(.035,(t-last)/1000);last=t;
 if(started&&mode==='student'&&players[meId]){
  const p=players[meId];let dx=0,dy=0;
  if(keys.w||keys.arrowup)dy--;if(keys.s||keys.arrowdown)dy++;if(keys.a||keys.arrowleft)dx--;if(keys.d||keys.arrowright)dx++;
  if(Math.abs(joy.dx)+Math.abs(joy.dy)>.05){dx=joy.dx;dy=joy.dy}
  if(dx||dy){
   const l=Math.hypot(dx,dy);dx/=l;dy/=l;angle=Math.atan2(dy,dx);
   const speed=(Date.now()<boostUntil?1.8:1)*(p.ghost?290:240);
   p.x=clamp(p.x+dx*speed*dt,20,MAP.w-20);p.y=clamp(p.y+dy*speed*dt,20,MAP.h-20);p.angle=angle;
   socket.emit('move',{x:p.x,y:p.y,angle:p.angle,floor:p.floor});
  }
  if(swingT>0)swingT-=dt;drawPlayerView();
 }
 if(started&&mode==='teacher')drawTeacherView();
 requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function drawPlayerView(){
 const p=players[meId];if(!p)return;
 cam.x=clamp(p.x-gameCanvas.width/2,0,Math.max(0,MAP.w-gameCanvas.width));cam.y=clamp(p.y-gameCanvas.height/2,0,Math.max(0,MAP.h-gameCanvas.height));
 g.clearRect(0,0,gameCanvas.width,gameCanvas.height);g.save();g.translate(-cam.x,-cam.y);drawArea(g,p.floor);
 for(const n of npcs.filter(n=>n.floor===p.floor)){drawPerson(g,n.x,n.y,{appearance:n.appearance,jump:jumpOffset(n)});bubble(g,n)}
 for(const q of Object.values(players).filter(q=>q.floor===p.floor)){
  drawPerson(g,q.x,q.y,{revealedSpy:q.revealed,police:q.role==='police',ghost:q.ghost,name:q.nick,showName:myRole==='spy'&&q.role==='spy'&&q.alive,jump:jumpOffset(q),appearance:q.appearance});
  bubble(g,q);
 }
 if(myRole==='police'&&p.alive){
  const j=jumpOffset(p);g.save();g.translate(p.x,p.y-j);let a=p.angle||angle;if(swingT>0){const prog=1-swingT/.22;a+=-1.05+prog*2}
  g.rotate(a);g.fillStyle='#6c4020';g.fillRect(13,-4,58,8);g.restore();
 }
 g.restore();
 $('timerHud').textContent=fmt(timeLeft);$('floorHud').textContent=p.floor===0?'운동장':`${p.floor}층`;
 $('spyHud').textContent=`스파이 ${Object.values(players).filter(x=>x.role==='spy'&&x.alive).length}`;
 $('scoreHud').textContent=`⭐ ${myScore()}`;
 $('jumpBtn').style.display='block';
 if(myRole==='police'){
  $('roleHud').textContent=`🚔 ${'❤️'.repeat(Math.max(0,3-(p.miss||0)))}${'🖤'.repeat(Math.min(3,p.miss||0))}`;
  $('attackBtn').style.display='block';$('boostBtn').style.display='none';
 }else{
  $('roleHud').textContent=p.ghost?'🕵️👻 유령':'🕵️ 스파이';$('attackBtn').style.display='none';
  $('boostBtn').style.display=(p.alive&&timeLeft<=totalTime/2&&!p.boostUsed)?'block':'none';
 }
}
function drawTeacherView(){
 tg.clearRect(0,0,teacherCanvas.width,teacherCanvas.height);
 const scale=Math.min(teacherCanvas.width/MAP.w,teacherCanvas.height/MAP.h)*.92,ox=(teacherCanvas.width-MAP.w*scale)/2,oy=(teacherCanvas.height-MAP.h*scale)/2;
 tg.save();tg.translate(ox,oy);tg.scale(scale,scale);drawArea(tg,selectedTeacherFloor);
 for(const n of npcs.filter(n=>n.floor===selectedTeacherFloor))drawPerson(tg,n.x,n.y,{appearance:n.appearance,jump:jumpOffset(n)});
 for(const p of Object.values(players).filter(p=>p.floor===selectedTeacherFloor))drawPerson(tg,p.x,p.y,{revealedSpy:p.role==='spy',police:p.role==='police',ghost:p.ghost,name:p.nick,showName:true,jump:jumpOffset(p),appearance:p.appearance});
 tg.restore();
 $('teacherTimer').textContent=fmt(timeLeft);
 $('teacherStats').textContent=`경찰 ${Object.values(players).filter(p=>p.role==='police'&&p.alive).length}명 · 스파이 ${Object.values(players).filter(p=>p.role==='spy'&&p.alive).length}명 · 학생 ${npcs.length}명`;
}
document.querySelectorAll('#floorTabs button').forEach(b=>b.onclick=()=>{selectedTeacherFloor=+b.dataset.floor;sceneSound('floor')});

(function initJoinFromUrl(){
 const q=new URLSearchParams(location.search),room=q.get('room');
 if(room){$('joinCode').value=room.replace(/\D/g,'').slice(0,4);mode='student';showScreen('studentJoin',true)}
})();
socket.on('connect',()=>setTimeout(resumeSavedSession,80));
setTimeout(resumeSavedSession,250);
