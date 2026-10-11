/* 酒馆宿主入口：魔法棒面板、受限 RPC、规划请求和楼内 iframe 生命周期。 */
import { attachPanelInteractions } from './panel-interactions.js?v=0.5.0';
import { getRequestHeaders, stopGeneration, saveSettings } from '/script.js';
import { createPlanner } from './planner.js?v=0.5.0';
import { createWorkbench } from './workbench.js?v=0.5.0';
import { createMessagePlans } from './message-plans.js?v=0.5.0';
import { createGenerationBinding } from './generation-binding.js?v=0.5.0';
import { createTheater } from './theater.js?v=0.5.0';
import { migrateSchemes } from '../planning/schemes.js?v=0.5.0';
import { CHANNEL, acceptsMessage, validateRpc, themeSnapshot } from '../bridge/protocol.js?v=0.5.0';
const ID='czgh_external_planner';
const ctx=()=>SillyTavern.getContext();
const chatId=()=>JSON.stringify([ctx().chatId,ctx().characterId,ctx().groupId]);
let initialized=false;
function init(){
    if(initialized)return;
    const menu=document.querySelector('#extensions_menu')||document.querySelector('#extensionsMenu');if(!menu)return;initialized=true;
    const dialog=document.createElement('dialog');dialog.id='czgh-planner-container';dialog.setAttribute('aria-label','创作规划');
    for(const [key,value] of Object.entries({padding:'0',margin:'auto',border:'0',background:'transparent',width:'min(460px,96vw)',height:'min(840px,92dvh)','max-width':'96vw','max-height':'92dvh',overflow:'hidden','box-shadow':'0 24px 80px #101d3540, 0 4px 16px #101d351f','border-radius':'14px','clip-path':'inset(0 round 14px)',transform:'none'}))dialog.style.setProperty(key,value,'important');
    const frame=document.createElement('iframe');frame.title='创作规划';frame.src=new URL('../ui/index.html?v=0.5.0',import.meta.url).href;
    frame.style.cssText='display:block!important;width:100%!important;height:100%!important;border:0!important;margin:0!important;padding:0!important;background:transparent!important;border-radius:14px!important;clip-path:inset(0 round 14px)!important;';dialog.append(frame);document.body.append(dialog);attachPanelInteractions(dialog);
    const send=(type,payload)=>frame.contentWindow?.postMessage({channel:CHANNEL,type,payload},location.origin);
    const theme=()=>themeSnapshot(getComputedStyle(document.body));
    // ST's own regex scripts, prompt side, so the planner and theater see the same history the body request does.
    let regexEngine;const promptText=async(text,message,depth)=>{regexEngine??=await import('/scripts/extensions/regex/engine.js').catch(()=>({}));if(typeof regexEngine.getRegexedString!=='function')return text;try{return regexEngine.getRegexedString(text,message?.is_user?regexEngine.regex_placement.USER_INPUT:regexEngine.regex_placement.AI_OUTPUT,{isPrompt:true,depth});}catch{return text;}};
    const workbench=createWorkbench({context:ctx,headers:getRequestHeaders,saveSettings,promptText});
    // Plan and theater are written into the floor text itself; re-render that floor the way ST does.
    const refresh=id=>{const c=ctx(),message=c.chat?.[id];if(!message)return;if(typeof c.updateMessageBlock==='function'){c.updateMessageBlock(id,message);return;}const node=document.querySelector(`.mes[mesid="${id}"] .mes_text`);if(node&&typeof c.messageFormatting==='function')node.innerHTML=c.messageFormatting(message.mes,message.name,!!message.is_system,!!message.is_user,id);};
    const panelFrames=new Map();
    // One floor bar under the latest user message carries plan progress and the theater controls.
    const syncFrames=(frames,records,title,type)=>{
        for(const [id,item] of frames)if(!records.some(r=>r.messageId===id)||!item.frame.isConnected){item.frame.remove();frames.delete(id);}
        for(const record of records){
            const parent=document.querySelector(`.mes[mesid="${record.messageId}"] .mes_block`);if(!parent)continue;
            let item=frames.get(record.messageId);
            const payload=()=>({record:item.record,theme:theme(),appearance:ctx().extensionSettings[ID]?.appearance||'auto'});
            if(!item){const panel=document.createElement('iframe');panel.title=title;panel.src=new URL('../ui/message.html?v=0.5.0',import.meta.url).href;panel.style.cssText='display:block!important;width:100%!important;height:42px!important;border:0!important;margin:8px 0!important;background:transparent!important;';parent.append(panel);item={frame:panel,record};frames.set(record.messageId,item);panel.addEventListener('load',()=>panel.contentWindow?.postMessage({channel:CHANNEL,type,payload:payload()},location.origin));}
            item.record=record;
            const deliver=()=>{item.timer=null;if(item.frame.isConnected)item.frame.contentWindow?.postMessage({channel:CHANNEL,type,payload:payload()},location.origin);};
            if(record.phase==='streaming'||record.theater?.phase==='streaming'){if(!item.timer)item.timer=setTimeout(deliver,60);}else{clearTimeout(item.timer);deliver();}
        }
    };
    const allFrames=()=>[...panelFrames.values()];
    const showBar=()=>{const s=ctx().extensionSettings[ID]||{};return !!s.displayPlan||(!!s.theaterEnabled&&s.theaterAutoGenerate===false);};
    let theater;
    const plans=createMessagePlans({chatId,messages:()=>ctx().chat||[],save:()=>ctx().saveChat(),refresh,display:showBar,render:records=>syncFrames(panelFrames,records.map(r=>({...r,theater:theater?.current()||null})),'本楼创作规划','plan')});
    // The theater request preview replaces the planning preview in the panel until the next planning round.
    theater=createTheater({getContext:ctx,getRequestHeaders,prepare:args=>workbench.theaterPrepare(args),save:()=>ctx().saveChat(),chatId,refresh,isAborted:()=>!!ctx().streamingProcessor?.abortController?.signal?.aborted,render:()=>plans.render(),onDiagnostics:d=>send('diagnostics',d)});
    const binding=createGenerationBinding({identity:chatId,isAborted:()=>!!ctx().streamingProcessor?.abortController?.signal?.aborted,discard:id=>plans.discard(id),bind:async(record,messageId)=>{
        const message=ctx().chat?.[messageId];if(!message)return;
        await plans.bind({requestId:record.requestId,messageId,swipeId:message.swipe_id??0});
        if(record.chatId===chatId()&&record.nextWorldState){ctx().chatMetadata.czghCreativePlanningWorld=record.nextWorldState;ctx().saveMetadataDebounced();}
    }});
    const announced=new WeakSet(ctx().chat||[]);
    let observedChat=chatId();
    let busy=false;
    let planner;planner=createPlanner({getContext:ctx,getRequestHeaders,stopGeneration,getYaml:()=>SillyTavern.libs?.yaml,onState:s=>send('state',{...s,awaitingReply:planner?.getState().awaitingReply||false,busy:planner?.isPlanning()||false}),onDiagnostics:d=>send('diagnostics',d),prepare:args=>workbench.prepare(args),onPlanReady:record=>{binding.stage(record);plans.stage(record);},onProgress:record=>{busy=['waiting','preparing','streaming'].includes(record.phase);send('state',{...planner.getState(),busy:planner.isPlanning()});if(record.chatId===chatId())for(let id=Math.min(record.expectedMessageId,ctx().chat.length)-1;id>=0;id--){if(ctx().chat[id]?.is_user){announced.add(ctx().chat[id]);break;}}plans.updateLive(record);},onDiscard:requestId=>plans.discard(requestId)});
    ctx().extensionSettings[ID]=migrateSchemes(ctx().extensionSettings[ID]);
    let rpcQueue=Promise.resolve();
    window.addEventListener('message',event=>{
        const knownFrame=acceptsMessage(event,frame.contentWindow,location.origin)||allFrames().some(item=>acceptsMessage(event,item.frame.contentWindow,location.origin));
        if(knownFrame&&event.data.type==='resume'){const item=[...panelFrames.values()].find(x=>x.frame.contentWindow===event.source);if(!item||(item.record.phase==='awaiting'&&item.record.chatId===chatId()))planner.resume();return;}
        if(knownFrame&&event.data.type==='theater.generate'){const item=[...panelFrames.values()].find(x=>x.frame.contentWindow===event.source);const t=item?.record.theater;if(t&&t.chatId===chatId()&&!theater.busy(t.phase))void theater.generate(t.messageId);else theater.render();return;}
        if(knownFrame&&event.data.type==='appearance'){
            rpcQueue=rpcQueue.then(async()=>{
                const mode={auto:'light',light:'dark',dark:'auto'}[ctx().extensionSettings[ID]?.appearance||'auto'];
                ctx().extensionSettings[ID].appearance=mode;await saveSettings();send('appearance',mode);
                for(const item of allFrames())item.frame.contentWindow?.postMessage({channel:CHANNEL,type:'appearance',payload:mode},location.origin);
            }).catch(error=>send('state',{...planner.getState(),status:error.message}));return;
        }
        // Closing must not wait for source loading or any pending RPC operation.
        if(acceptsMessage(event,frame.contentWindow,location.origin)&&event.data.type==='close'){dialog.close();return;}
        if(acceptsMessage(event,frame.contentWindow,location.origin)&&event.data.type==='cancel'){if([...panelFrames.values()].some(item=>item.record.phase==='waiting'))stopGeneration();planner.stop();binding.stopped();plans.settleWaiting('cancelled');return;}
        for(const item of panelFrames.values())if(acceptsMessage(event,item.frame.contentWindow,location.origin)&&event.data.type==='cancel'){
            if(item.record.chatId===chatId()&&['waiting','preparing','streaming','awaiting'].includes(item.record.phase)){if(item.record.phase==='waiting')stopGeneration();planner.stop();binding.stopped();plans.settleWaiting('cancelled');}
            else if(theater.busy(item.record.theater?.phase))theater.cancel();
            return;
        }
        for(const item of allFrames())if(acceptsMessage(event,item.frame.contentWindow,location.origin)&&event.data.type==='height'){
            const height=Number(event.data.payload);if(Number.isFinite(height))item.frame.style.setProperty('height',`${Math.min(560,Math.max(42,height))}px`,'important');return;
        }
        if(!acceptsMessage(event,frame.contentWindow,location.origin)||event.data.type!=='request')return;
        rpcQueue=rpcQueue.then(async()=>{
            const requestId=event.data.requestId;
            try{const {method,payload}=validateRpc(event.data);let result;
                if(method==='ui.close'){dialog.close();result={};}
                else if(method==='planner.cancel'){planner.stop();binding.stopped();result={};}
                else{result=await workbench.execute(method,payload);planner.settingsChanged();theater.settingsChanged();plans.render();}
                frame.contentWindow?.postMessage({channel:CHANNEL,type:'response',requestId,ok:true,result},location.origin);send('theme',theme());send('state',{...planner.getState(),busy:planner.isPlanning()});
            }catch(error){frame.contentWindow?.postMessage({channel:CHANNEL,type:'response',requestId,ok:false,error:error.message},location.origin);}
        });
    });
    const button=document.createElement('button');button.id='czgh-planner-menu';button.type='button';button.className='list-group-item flex-container flexGap5 interactable';button.textContent='✎ 创作规划';
    button.addEventListener('click',()=>{if(!dialog.open)dialog.showModal();send('theme',theme());send('refresh');send('diagnostics',planner.getDiagnostics());});menu.append(button);
    const on=(name,fn)=>{if(ctx().eventTypes[name])ctx().eventSource.on(ctx().eventTypes[name],fn);};
    const announceUser=id=>{
        const message=ctx().chat?.[id];
        if(!ctx().extensionSettings[ID]?.enabled||!message?.is_user||announced.has(message))return;
        announced.add(message);plans.updateLive({chatId:chatId(),expectedMessageId:Number(id)+1,phase:'waiting',text:''});
    };
    on('MESSAGE_SENT',announceUser);
    on('USER_MESSAGE_RENDERED',id=>{announceUser(id);plans.render();});
    // Some extensions await API work inside native event listeners. Observe inserted floors too.
    new MutationObserver(changes=>{
        if(!changes.some(c=>[...c.addedNodes].some(n=>n.nodeType===1&&(n.matches('.mes')||n.querySelector('.mes')))))return;
        if(observedChat!==chatId()){observedChat=chatId();for(const message of ctx().chat||[])announced.add(message);plans.render();return;}
        const id=(ctx().chat?.length||0)-1;
        if(document.querySelector(`.mes[mesid="${id}"]`))announceUser(id);
        plans.render();
    }).observe(document.body,{childList:true,subtree:true});
    on('CHAT_COMPLETION_SETTINGS_READY',data=>workbench.rememberBodyRequest(data));
    // The plan is written into the floor first, so the theater reads a body that already carries it.
    on('MESSAGE_RECEIVED',async(messageId,type)=>{await binding.received(messageId,type);theater.received(messageId,type);});
    on('GENERATION_STARTED',(type,_options,dryRun)=>{busy=true;send('state',{...planner.getState(),busy:planner.isPlanning()});binding.started();theater.generationStarted(type,dryRun);});
    on('GENERATION_STOPPED',()=>{busy=false;send('state',{...planner.getState(),busy:planner.isPlanning()});binding.stopped();plans.settleWaiting('cancelled');});
    on('GENERATION_ENDED',()=>{busy=false;send('state',{...planner.getState(),busy:planner.isPlanning()});binding.ended();plans.settleWaiting('skipped');plans.render();});
    on('CHAT_CHANGED',()=>{binding.stopped();plans.dispose();plans.render();theater.chatChanged();if(dialog.open)send('refresh');});
    on('MESSAGE_SWIPED',()=>{plans.clearLive();});
    for(const event of ['CHARACTER_MESSAGE_RENDERED','MESSAGE_UPDATED','MESSAGE_EDITED','MESSAGE_DELETED','CHAT_LOADED'])on(event,()=>plans.render());
    let previous='';setInterval(()=>{const value=theme(),json=JSON.stringify(value);if(json===previous)return;previous=json;if(dialog.open)send('theme',value);for(const item of allFrames())item.frame.contentWindow?.postMessage({channel:CHANNEL,type:'theme',payload:value},location.origin);},800);
    plans.render();
}
ctx().eventSource.on(ctx().eventTypes.APP_READY,init);init();
