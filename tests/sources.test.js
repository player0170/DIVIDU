import test from 'node:test';
import assert from 'node:assert/strict';
import { captureSources } from '../src/host/sources.js';
test('source capture clones inputs, includes auxiliary/chat books and rejects a switched chat',async()=>{
    const ctx={chatId:'chat',characterId:0,characters:[{avatar:'c.png',name:'角色',data:{extensions:{world:'primary'}}}],chat:[{is_user:true,mes:'hello'}],chatMetadata:{world_info:'chatbook'},extensionPrompts:{foreign:{value:'secret',filter:()=>true}},name1:'玩家',name2:'角色'};
    const world={world_names:['primary','aux','global','chatbook'],selected_world_info:['global'],world_info:{charLore:[{name:'c',extraBooks:['aux']}]},getWorldInfoSettings:()=>({}),loadWorldInfo:async()=>({entries:{}})};
    const manager={getPresetList:()=>({presets:[{prompts:[],prompt_order:[]}],preset_names:{P:0}}),getSelectedPresetName:()=> 'P'};
    const host={context:()=>ctx,world,manager,openai:{oai_settings:{prompts:[],prompt_order:[],active:true}},powerUser:{}};
    const s=await captureSources(host,{});
    assert.deepEqual(s.bindings,{global:['global'],character:['primary','aux'],chat:['chatbook'],persona:[]});
    assert.equal(s.history[0].content,'hello');
    assert.ok(Object.isFrozen(s));
    assert.equal(s.presets.P.active,true);
    assert.equal(s.macroEnvironment.lastusermessage,'hello');
    ctx.maxContext=2048;ctx.chatCompletionSettings={openai_max_context:32000};
    assert.equal((await captureSources(host,{})).maxContext,32000);
    ctx.chat[0].mes='changed'; assert.equal(s.history[0].content,'hello');
    world.loadWorldInfo=async()=>{ctx.chatId='another';return{entries:{}};};
    await assert.rejects(captureSources(host,{}),/聊天/);
});


test('swipe excludes replaced response before history macros, regenerate uses already-trimmed host history',async()=>{
    const ctx={chatId:'c',chat:[{mes:'之前回复'},{is_user:true,mes:'本轮输入'},{mes:'旧备选回复',extra:{image:'old'}}],chatMetadata:{}};
    const host={context:()=>ctx,manager:{getPresetList:()=>({}),getSelectedPresetName:()=>''},world:{loadWorldInfo:async()=>({entries:{}})},openai:{},powerUser:{}};
    const swipe=await captureSources(host,{generationType:'swipe'});
    assert.deepEqual(swipe.history.map(m=>m.content),['之前回复','本轮输入']);
    assert.equal(swipe.userInput,'本轮输入');assert.equal(swipe.macroEnvironment.lastmessage,'本轮输入');
    assert.equal(swipe.macroEnvironment.lastcharmessage,'之前回复');assert.equal(swipe.capabilities.media,false);
    assert.equal(ctx.chat.length,3);
    ctx.chat[1].extra={files:[{name:'附件.txt'}]};
    assert.equal((await captureSources(host,{generationType:'swipe'})).capabilities.media,true);
    delete ctx.chat[1].extra;
    ctx.chat.pop();
    assert.deepEqual((await captureSources(host,{generationType:'regenerate'})).history,swipe.history);
    // ST already removes the replaced reply, even if the preceding message is another assistant.
    ctx.chat=[{mes:'保留的上一条回复'}];
    assert.equal((await captureSources(host,{generationType:'regenerate'})).history.length,1);
});

test('post-body stage keeps the full history, replaces one floor and still applies prompt-side regex',async()=>{
    const ctx={chatId:'c',chat:[{is_user:true,mes:'本轮输入'},{mes:'正文\n\n旧小剧场'}],chatMetadata:{}};
    const host={context:()=>ctx,manager:{getPresetList:()=>({}),getSelectedPresetName:()=>''},world:{loadWorldInfo:async()=>({entries:{}})},openai:{},powerUser:{},promptText:async(text,m,depth)=>`${text}@${depth}`};
    const s=await captureSources(host,{generationType:'theater',replaceMes:{index:1,mes:'正文'}});
    assert.deepEqual(s.history.map(m=>m.content),['本轮输入@1','正文@0']);
    assert.equal(ctx.chat[1].mes,'正文\n\n旧小剧场');
    assert.equal(s.macroEnvironment.lastcharmessage,'正文@0');
});
