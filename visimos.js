\
/* Visimos V4 — Memory & Adaptive Behavior
   - Stores profile in localStorage.visimos_profile_v4
   - Greets "Welcome back." if profile found
   - Learns: avgDensity, avgSpeed, preferred orbSize
   - Balanced natural learning (gradual updates)
*/

const STORAGE_KEY = "visimos_profile_v4";
const video = document.getElementById("cam");
const overlay = document.getElementById("overlay");
const ctx = overlay.getContext("2d");
const orb = document.getElementById("orbLayer");
const octx = orb.getContext("2d");

let prevGray = null;
let speakCooldown = false;
const COOLDOWN_MS = 2000;

// Parameters (can adapt from memory)
let FAST_STEP = 0.12;
let orbX = 0.5, orbY = 0.5, orbSize = 0.22;

// Memory model (balanced learning)
let profile = {
  visits: 0,
  avgDensity: 0.2,
  avgSpeed: 0.02,
  preferredSize: 0.22,
  lastSeen: null
};

function loadProfile(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw){
      const p = JSON.parse(raw);
      Object.assign(profile, p);
      profile.lastSeen = profile.lastSeen ? new Date(profile.lastSeen) : null;
      document.getElementById("memoryInfo").textContent = `Profile: ${profile.visits} visits · preferredSize ${profile.preferredSize.toFixed(2)}`;
      speak("Welcome back.");
    } else {
      document.getElementById("memoryInfo").textContent = `No profile yet — first visit.`;
    }
  }catch(e){
    console.warn("loadProfile:", e);
  }
}

function saveProfile(){
  profile.visits = (profile.visits || 0) + 1;
  profile.lastSeen = new Date().toISOString();
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)); }catch(e){console.warn("save error",e);}
  document.getElementById("memoryInfo").textContent = `Profile: ${profile.visits} visits · preferredSize ${profile.preferredSize.toFixed(2)}`;
}

function speak(text){
  if(!window.speechSynthesis) return;
  if(speakCooldown) return;
  const msg = new SpeechSynthesisUtterance(text);
  msg.pitch = 1.05; msg.rate = 0.96; msg.volume = 1; msg.lang = "en-US";
  const voices = speechSynthesis.getVoices();
  const preferred = voices.find(v => /female|google us|samantha|alloy/i.test(v.name));
  if(preferred) msg.voice = preferred;
  speechSynthesis.speak(msg);
  speakCooldown = true;
  setTimeout(()=> speakCooldown = false, COOLDOWN_MS);
}

async function startCamera(){
  try{
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal:1280 }, height: { ideal:720 } }, audio: false });
    video.srcObject = stream;
    await video.play();
    overlay.width = video.videoWidth || overlay.clientWidth;
    overlay.height = video.videoHeight || overlay.clientHeight;
    orb.width = overlay.width; orb.height = overlay.height;
    document.getElementById("status").textContent = "Status: camera running";
    orbSize = profile.preferredSize || orbSize;
    FAST_STEP = profile.avgSpeed || FAST_STEP;
    requestAnimationFrame(loop);
  }catch(e){
    document.getElementById("status").textContent = "Camera error: " + (e.message || e);
  }
}

function getGray(imgData){
  const w = imgData.width, h = imgData.height;
  const d = imgData.data, g = new Uint8ClampedArray(w*h);
  for(let i=0,j=0;i<d.length;i+=4,j++){
    g[j] = (0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2])|0;
  }
  return g;
}

let prevCentroid = null;
let interactionAccumulator = { densitySum:0, speedSum:0, frames:0 };
function loop(){
  const w = overlay.width, h = overlay.height;
  const smallW = Math.max(160, Math.floor(w/8));
  const smallH = Math.max(90, Math.floor(h/8));
  const tmp = document.createElement("canvas"); tmp.width=smallW; tmp.height=smallH;
  const tctx = tmp.getContext("2d");
  tctx.drawImage(video,0,0,smallW,smallH);
  const img = tctx.getImageData(0,0,smallW,smallH);
  const gray = getGray(img);

  let motionPixels = [];
  if(prevGray){
    for(let y=0;y<smallH;y+=3){
      const row = y*smallW;
      for(let x=0;x<smallW;x+=3){
        const idx = row + x;
        if(Math.abs(gray[idx] - prevGray[idx]) > 36){
          motionPixels.push([x,y]);
        }
      }
    }
  }
  prevGray = gray;

  const motionCount = motionPixels.length;
  const hasMotion = motionCount > 160;

  ctx.clearRect(0,0,w,h);

  if(hasMotion){
    let sx=0, sy=0;
    for(const p of motionPixels){ sx+=p[0]; sy+=p[1]; }
    const cx = sx/motionCount, cy = sy/motionCount;
    const nx = cx/smallW, ny = cy/smallH;

    const targetX = 1 - nx;
    const targetY = ny;

    let speed = 0;
    if(prevCentroid){
      const dx = targetX - prevCentroid.x;
      const dy = targetY - prevCentroid.y;
      speed = Math.hypot(dx,dy);
    }
    prevCentroid = { x: targetX, y: targetY };

    orbX += (targetX - orbX) * FAST_STEP;
    orbY += (targetY - orbY) * FAST_STEP;

    const density = Math.min(1, motionCount / 4000);
    const targetSize = profile.preferredSize ? (profile.preferredSize + density*0.18) : (0.22 + density*0.15);
    orbSize += (targetSize - orbSize) * 0.08;

    interactionAccumulator.densitySum += density;
    interactionAccumulator.speedSum += speed;
    interactionAccumulator.frames += 1;

    if(motionCount > 300 && speed < 0.003){
      if(!window._stopStart) window._stopStart = performance.now();
      else if(performance.now() - window._stopStart > 900){
        triggerIntent("stop");
        window._stopStart = null;
      }
    } else {
      window._stopStart = null;
    }

    window._centroidHistory = window._centroidHistory || [];
    window._centroidHistory.push({x:targetX, t: performance.now()});
    window._centroidHistory = window._centroidHistory.filter(it => performance.now() - it.t < 700);
    if(window._centroidHistory.length >= 3){
      const first = window._centroidHistory[0].x, last = window._centroidHistory[window._centroidHistory.length-1].x;
      const dx = last - first;
      if(Math.abs(dx) > 0.08){
        if(dx > 0.08) triggerIntent("move_right"); else triggerIntent("move_left");
        window._centroidHistory = [];
      }
    }
  } else {
    orbX += (0.5 - orbX) * 0.012;
    orbY += (0.5 - orbY) * 0.012;
    orbSize += ( (profile.preferredSize || 0.22) - orbSize) * 0.02;
    prevCentroid = null;
  }

  orbX = Math.max(0.08, Math.min(0.92, orbX));
  orbY = Math.max(0.08, Math.min(0.92, orbY));

  drawOrb(w,h,orbX,orbY,orbSize);

  if(interactionAccumulator.frames > 60){
    const observedDensity = interactionAccumulator.densitySum / interactionAccumulator.frames;
    const observedSpeed = interactionAccumulator.speedSum / Math.max(1, interactionAccumulator.frames);
    profile.avgDensity = profile.avgDensity * 0.92 + observedDensity * 0.08;
    profile.avgSpeed = profile.avgSpeed * 0.92 + observedSpeed * 0.08;
    profile.preferredSize = profile.preferredSize * 0.94 + orbSize * 0.06;
    interactionAccumulator = { densitySum:0, speedSum:0, frames:0 };
    FAST_STEP = 0.08 + Math.max(0.04, Math.min(0.18, profile.avgSpeed * 6));
    saveProfile();
  }

  requestAnimationFrame(loop);
}

function drawOrb(w,h,x,y,size){
  octx.clearRect(0,0,orb.width,orb.height);
  const cx = x * w, cy = y * h;
  const r = Math.min(w,h) * size;
  for(let i=5;i>=1;i--){
    const alpha = 0.06 * i;
    octx.beginPath();
    octx.fillStyle = `rgba(255,215,120,${alpha})`;
    octx.arc(cx,cy,r*(i/5),0,Math.PI*2);
    octx.fill();
  }
  octx.beginPath();
  octx.strokeStyle = "rgba(255,220,130,0.95)";
  octx.lineWidth = Math.max(4, w*0.01);
  octx.arc(cx,cy,r*0.6,0,Math.PI*2);
  octx.stroke();
}

let lastIntentTime = 0;
function triggerIntent(intent){
  const now = performance.now();
  if(now - lastIntentTime < 900) return;
  lastIntentTime = now;
  if(intent === "stop"){
    orbX = 0.5; orbY = 0.45; orbSize = Math.max(orbSize, 0.28);
    speak("I am listening.");
  } else if(intent === "move_left"){
    orbX = Math.max(0.12, orbX - 0.16);
    speak("Understood.");
  } else if(intent === "move_right"){
    orbX = Math.min(0.88, orbX + 0.16);
    speak("Okay.");
  }
  octx.beginPath();
  octx.fillStyle = "rgba(255,230,150,0.06)";
  octx.arc(orbX*orb.width, orbY*orb.height, Math.min(orb.width,orb.height)*orbSize*1.1, 0, Math.PI*2);
  octx.fill();
}

document.getElementById("runBtn").onclick = () => {
  document.getElementById("status").textContent = "Rules applied.";
};

function saveProfile(){
  profile.visits = (profile.visits || 0) + 1;
  profile.lastSeen = new Date().toISOString();
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)); }catch(e){console.warn("save error",e);}
  document.getElementById("memoryInfo").textContent = `Profile: ${profile.visits} visits · preferredSize ${profile.preferredSize.toFixed(2)}`;
}

loadProfile();
startCamera();
