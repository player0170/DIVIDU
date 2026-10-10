/* 只读来源快照：预设、角色、聊天、世界书及本轮插件注入；异步期间检查聊天身份。 */
import { createId } from '../bridge/id.js?v=0.5.0';
import { captureAuthorNote } from '../planning/author-note.js?v=0.5.0';
function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(freeze); }
    return value;
}
export async function captureSources(host, { signal, extraBooks = [], generationType } = {}) {
    const context = host.context();
    const identity = () => JSON.stringify([host.context().chatId, host.context().characterId, host.context().groupId]);
    const chatId = identity();
    const check = () => { signal?.throwIfAborted(); if (identity() !== chatId) throw new Error('读取期间聊天已切换，请重试。'); };
    check();
    const character = structuredClone(context.characters?.[context.characterId] || {});
    const { presets = [], preset_names = [] } = host.manager.getPresetList();
    const presetMap = {};
    for (const [name, index] of Array.isArray(preset_names) ? preset_names.map((name, i) => [name, i]) : Object.entries(preset_names)) {
        if (presets[Number(index)]) Object.defineProperty(presetMap, name, { value: structuredClone(presets[Number(index)]), enumerable: true, configurable: true });
    }
    const currentPreset = host.manager.getSelectedPresetName?.() || '';
    if (currentPreset && host.openai.oai_settings?.prompts) Object.defineProperty(presetMap, currentPreset, { value: structuredClone(host.openai.oai_settings), enumerable: true, configurable: true });
    const world = host.world;
    const file = character.avatar?.replace(/\.[^.]+$/, '');
    const primary = character.data?.extensions?.world;
    const persona = host.powerUser?.persona_description_lorebook;
    const bindings = {
        global: [...(world.selected_world_info || world.world_info?.globalSelect || [])],
        character: [...new Set([primary, ...(world.world_info?.charLore?.find(x => x.name === file)?.extraBooks || [])].filter(Boolean))],
        chat: context.chatMetadata?.world_info ? [context.chatMetadata.world_info] : [],
        persona: persona ? [persona] : [],
    };
    const books = {};
    for (const name of new Set([...Object.values(bindings).flat(), ...extraBooks])) {
        check(); const data = await world.loadWorldInfo(name); check();
        if (!data?.entries) throw new Error(`无法读取世界书「${name}」。`);
        Object.defineProperty(books, name, { value: structuredClone(data), enumerable: true });
    }
    // Text history goes through the same prompt-side regex scripts ST applies, so hidden blocks stay hidden here too.
    const chat = context.chat || [];
    const history = await Promise.all(chat.map(async (m, i) => m.is_system ? null : ({ role: m.is_user ? 'user' : 'assistant', content: m.content != null ? structuredClone(m.content) : host.promptText ? await host.promptText(m.mes ?? '', m, chat.length - 1 - i) : (m.mes ?? ''), name: m.name, extra: structuredClone(m.extra || {}) }))).then(items => items.filter(Boolean));
    check();
    // ST retains the replaced floor for swipe, but has already removed it for regenerate.
    if (generationType === 'swipe' && history.at(-1)?.role === 'assistant') history.pop();
    const injections = Object.fromEntries(Object.entries(context.extensionPrompts || {}).map(([key,p]) => [key,{value:String(p.value || ''),position:p.position,depth:p.depth,role:p.role,scan:!!p.scan,hasFilter:typeof p.filter==='function'}]));
    const snapshot = { id: createId(), chatId, character, history, userInput: history.at(-1)?.role === 'user' ? history.at(-1).content : '', presets: presetMap, currentPreset, books, bookNames: [...(world.world_names || [])], bindings, injections,
        macroEnvironment: { user: context.name1 || '', char: context.name2 || character.name || '', description: character.description || character.data?.description || '', personality: character.personality || character.data?.personality || '', scenario: character.scenario || character.data?.scenario || '', persona: host.powerUser?.persona_description || '', original: '', lastusermessage: history.findLast(m => m.role === 'user')?.content || '', lastcharmessage: history.findLast(m => m.role === 'assistant')?.content || '', lastmessage: history.at(-1)?.content || '', lastmessageid: history.length - 1 },
        authorNote: captureAuthorNote(context, character),
        variables: { local: structuredClone(context.chatMetadata?.variables || {}), global: structuredClone(context.extensionSettings?.variables?.global || {}) },
        worldSettings: structuredClone(world.getWorldInfoSettings?.() || {}), maxContext: Number(context.chatCompletionSettings?.openai_max_context) || context.maxContext || 8192,
        capabilities: { groupChat: !!context.groupId, media: history.some(m => m.extra?.media?.length || m.extra?.image || m.extra?.files?.length || m.extra?.file) },
    };
    check(); return freeze(snapshot);
}
