const APP_ID='com.davy.dashboardbridge';
const input=document.getElementById('homey');
const status=document.getElementById('status');
const grid=document.getElementById('grid');
const title=document.getElementById('title');
let timer=null;

const queryHost=new URLSearchParams(location.search).get('homey');
input.value=queryHost||localStorage.getItem('homeyHost')||'192.168.17.137';

function capabilityText(tile){
  // sourceLabel is normally "Device name — Capability". Keep the capability as a subtle subtitle,
  // while the main label is the user-selected name (device name by default in v0.5).
  if(tile.sourceName) return tile.sourceName;
  const source=String(tile.sourceLabel||'');
  const marker=' — ';
  const at=source.indexOf(marker);
  return at>=0?source.slice(at+marker.length):'';
}

function render(d){
  title.textContent=d.title||'WebDash';
  grid.innerHTML='';
  if(!d.tiles?.length){
    grid.innerHTML='<section class="tile empty"><div><strong>No dashboard tiles selected.</strong><br><br>Open Dashboard Bridge → Settings in Homey, scan sources, choose values, and save.</div></section>';
    return;
  }
  for(const t of d.tiles){
    const el=document.createElement('section');
    const bool=t.kind==='boolean';
    el.className=`tile${bool?' boolean':''}${bool?(t.rawValue?' on':' off'):''}${t.online?'':' offline'}`;

    const label=document.createElement('div');
    label.className='label';
    label.textContent=t.label||t.deviceName||'Tile';

    const source=document.createElement('div');
    source.className='source';
    source.textContent=capabilityText(t);

    const value=document.createElement('div');
    value.className='value';
    const valueText=document.createElement('span');
    valueText.textContent=t.value??'—';
    value.appendChild(valueText);
    if(t.unit){
      const unit=document.createElement('span');
      unit.className='unit';
      unit.textContent=t.unit;
      value.appendChild(unit);
    }
    el.append(label,source,value);
    grid.appendChild(el);
  }
}

function normalizedHost(){
  return input.value.trim().replace(/^https?:\/\//i,'').replace(/\/$/,'');
}

async function refresh(){
  const host=normalizedHost();
  if(!host) return;
  localStorage.setItem('homeyHost',host);
  try{
    const response=await fetch(`http://${host}/api/app/${APP_ID}/dashboard`,{cache:'no-store'});
    if(!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const dashboard=await response.json();
    render(dashboard);
    const age=Math.max(0,Math.round((Date.now()-new Date(dashboard.updatedAt).getTime())/1000));
    status.textContent=`Connected to ${host} • ${dashboard.tiles?.length||0} tile(s) • updated ${age}s ago`;
  }catch(error){
    status.textContent=`Connection failed: ${error.message}`;
  }
}

function connect(){
  refresh();
  if(timer) clearInterval(timer);
  timer=setInterval(refresh,5000);
}

document.getElementById('connect').addEventListener('click',connect);
input.addEventListener('keydown',event=>{if(event.key==='Enter') connect();});
document.getElementById('fullscreen').addEventListener('click',async()=>{
  try{if(!document.fullscreenElement) await document.documentElement.requestFullscreen(); else await document.exitFullscreen();}catch(_){}
});
connect();
