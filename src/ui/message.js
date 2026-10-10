/* 楼内规划/小剧场视图：安全文本渲染、五项主题接收以及高度上报。 */
import {CHANNEL,THEME_KEYS,acceptsMessage} from '../bridge/protocol.js?v=0.5.0';
import { appearanceIcon, generationIcon, setIcon } from './icons.js?v=0.5.0';
appearanceIcon(document.querySelector('#appearance'));
setIcon(document.querySelector('#resume'),'reply');
setIcon(document.querySelector('#theater'),'theater');
document.querySelector('#resume').addEventListener('click',event=>{event.preventDefault();event.stopPropagation();document.querySelector('#resume').disabled=true;parent.postMessage({channel:CHANNEL,type:'resume'},location.origin);});
document.querySelector('#theater').addEventListener('click',event=>{event.preventDefault();event.stopPropagation();document.querySelector('#theater').disabled=true;parent.postMessage({channel:CHANNEL,type:'theater.generate'},location.origin);});
const details=document.querySelector('details');
const resize=()=>parent.postMessage({channel:CHANNEL,type:'height',payload:document.body.scrollHeight+4},location.origin);
const THEATER_BUSY=['preparing','generating','streaming'];
window.addEventListener('message',event=>{
    if(!acceptsMessage(event,parent,location.origin))return;
    const {type,payload}=event.data;
    const theme=type==='plan'||type==='theater'?payload.theme:type==='theme'?payload:null;
    if(theme)for(const key of THEME_KEYS)if(typeof theme[key]==='string'&&theme[key])document.documentElement.style.setProperty(key,theme[key]);
    if(type==='appearance'||type==='plan'||type==='theater'){const mode=type==='appearance'?payload:payload.appearance||'auto';document.documentElement.dataset.appearance=mode;appearanceIcon(document.querySelector('#appearance'),mode);}
    if(type==='plan') {
        const record=payload.record;
        document.querySelector('#resume').disabled=record.phase!=='awaiting';
        generationIcon(document.querySelector('#cancel'),['waiting','preparing','streaming'].includes(record.phase));
        document.querySelector('#cancel').disabled=!['waiting','preparing','streaming','awaiting'].includes(record.phase);
        const labels={awaiting:'等待生成正文',waiting:'等待规划开始',preparing:'正在准备资料',streaming:'正在生成',error:'生成失败',cancelled:'已停止',skipped:'本轮未生成规划'};
        document.querySelector('#phase').textContent=record.phase?`· ${labels[record.phase]||record.phase}`:'';
        document.querySelector('pre').textContent=record.phase
            ? [record.text,record.error?`错误：${record.error}`:!record.text?labels[record.phase]:''].filter(Boolean).join('\n\n')
            : `${record.openTag}\n${record.text}\n${record.closeTag}`;
        document.querySelector('#stale').textContent=record.stale?'· 历史规划（正文已编辑）':'';
    }
    if(type==='theater') {
        const record=payload.record, busy=THEATER_BUSY.includes(record.phase);
        document.body.classList.add('theater');
        document.querySelector('#title').textContent='小剧场';
        document.querySelector('#resume').hidden=true;
        const generate=document.querySelector('#theater');generate.hidden=false;generate.disabled=busy;generate.title=record.phase==='done'?'重新生成小剧场':'生成小剧场';generate.setAttribute('aria-label',generate.title);
        generationIcon(document.querySelector('#cancel'),busy);
        document.querySelector('#cancel').disabled=!busy;
        const labels={idle:'尚未生成',preparing:'正在准备',generating:'正在生成',streaming:'正在生成',error:'生成失败',cancelled:'已停止',done:''};
        const label=labels[record.phase]??record.phase;
        document.querySelector('#phase').textContent=label?`· ${label}`:'';
        document.querySelector('pre').textContent=[record.text,record.error?`错误：${record.error}`:!record.text?(record.phase==='idle'?'点击右侧按钮生成本轮小剧场。':label):''].filter(Boolean).join('\n\n');
        document.querySelector('#stale').textContent=record.stale?'· 历史小剧场（正文已编辑）':'';
    }
    requestAnimationFrame(resize);
});
details.addEventListener('toggle',resize);new ResizeObserver(resize).observe(document.body);

document.querySelector('#cancel').addEventListener('click',event=>{event.preventDefault();event.stopPropagation();parent.postMessage({channel:CHANNEL,type:'cancel'},location.origin);});

document.querySelector('#appearance').addEventListener('click',event=>{event.preventDefault();event.stopPropagation();parent.postMessage({channel:CHANNEL,type:'appearance'},location.origin);});
