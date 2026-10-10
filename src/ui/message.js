/* 楼内状态条：规划进度、小剧场按钮、五项主题接收以及高度上报；规划与小剧场正文本身显示在楼层正文里。 */
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
    const theme=type==='plan'?payload.theme:type==='theme'?payload:null;
    if(theme)for(const key of THEME_KEYS)if(typeof theme[key]==='string'&&theme[key])document.documentElement.style.setProperty(key,theme[key]);
    if(type==='appearance'||type==='plan'){const mode=type==='appearance'?payload:payload.appearance||'auto';document.documentElement.dataset.appearance=mode;appearanceIcon(document.querySelector('#appearance'),mode);}
    if(type==='plan') {
        // One bar: plan progress plus the theater controls; both results live in the floor text itself.
        const record=payload.record, theater=record.theater, planBusy=['waiting','preparing','streaming'].includes(record.phase), theaterBusy=!!theater&&THEATER_BUSY.includes(theater.phase);
        document.querySelector('#resume').disabled=record.phase!=='awaiting';
        const generate=document.querySelector('#theater');generate.hidden=!theater;generate.disabled=!theater||theaterBusy||planBusy;generate.title=theater?.phase==='done'?'重新生成小剧场':'生成小剧场';generate.setAttribute('aria-label',generate.title);
        generationIcon(document.querySelector('#cancel'),planBusy||theaterBusy);
        document.querySelector('#cancel').disabled=!(planBusy||record.phase==='awaiting'||theaterBusy);
        const labels={awaiting:'等待生成正文',waiting:'等待规划开始',preparing:'正在准备资料',streaming:'正在生成',error:'生成失败',cancelled:'已停止',skipped:'本轮未生成规划'};
        const theaterLabels={idle:'',preparing:'小剧场准备中',generating:'小剧场生成中',streaming:'小剧场生成中',error:'小剧场失败',cancelled:'小剧场已停止',done:''};
        const parts=[record.phase?labels[record.phase]||record.phase:'',theater?theaterLabels[theater.phase]??theater.phase:''].filter(Boolean);
        document.querySelector('#phase').textContent=parts.map(x=>`· ${x}`).join(' ');
        const theaterNote=theater?.error?`小剧场错误：${theater.error}`:'';
        document.querySelector('pre').textContent=[record.phase
            ? [record.text,record.error?`错误：${record.error}`:!record.text?labels[record.phase]:''].filter(Boolean).join('\n\n')
            : `${record.openTag}\n${record.text}\n${record.closeTag}`,theaterNote].filter(Boolean).join('\n\n');
        document.querySelector('#stale').textContent=record.stale?'· 历史规划（正文已编辑）':theater?.stale?'· 历史小剧场（正文已编辑）':'';
    }
    requestAnimationFrame(resize);
});
details.addEventListener('toggle',resize);new ResizeObserver(resize).observe(document.body);

document.querySelector('#cancel').addEventListener('click',event=>{event.preventDefault();event.stopPropagation();parent.postMessage({channel:CHANNEL,type:'cancel'},location.origin);});

document.querySelector('#appearance').addEventListener('click',event=>{event.preventDefault();event.stopPropagation();parent.postMessage({channel:CHANNEL,type:'appearance'},location.origin);});
