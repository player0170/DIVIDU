/* 工作台宿主接口：连接只读来源、方案服务、RPC 操作和独立上下文准备。 */
import { migrateSchemes, applySchemeOperation, assertSafeData, rememberScheme, listKind, selectionOf } from '../planning/schemes.js?v=0.5.0';
import { createApiSchemes } from './api-schemes.js?v=0.5.0';
import { captureSources } from './sources.js?v=0.5.0';
import { migrateSettings } from '../planning/core.js?v=0.5.0';
import { captureHelperVariables, createTemplateRenderer } from './template-compat.js?v=0.5.0';
import { resolvePreset } from '../planning/presets.js?v=0.5.0';
import { adapters } from '../planning/compatibility.js?v=0.5.0';
import { buildPlanningContext } from '../planning/context.js?v=0.5.0';
import { cleanSettings } from '../bridge/protocol.js?v=0.5.0';
import { materializePluginMacros } from './plugin-macros.js?v=0.5.0';
import { freezeCurrentRequest } from '../planning/current-request.js?v=0.5.0';
import { theaterMessages } from '../planning/theater.js?v=0.5.0';
import { createCredentialStore } from './credential-store.js?v=0.5.0';
import { profileRequest, authorizeLocalRequest } from '../planning/profiles.js?v=0.5.0';
const ID = 'czgh_external_planner';
export function createWorkbench({ context, headers, saveSettings, promptText }) {
    // Source caches are separate so switching preset/entry switches reuses the captured preset data,
    // while only world toggles reload the (potentially many) worldbooks.
    let presetSource = null, worldSource = null;
    let bodyRequest = null; // Last body request seen on CHAT_COMPLETION_SETTINGS_READY, for the theater's "current connection".
    const vault = createCredentialStore();
    const parseYaml = text => globalThis.SillyTavern.libs?.yaml?.parse?.(text) ?? JSON.parse(text);
    const read = () => migrateSettings(migrateSchemes(context().extensionSettings[ID]));
    // Panel toggles must not block the UI on a full settings write; ST's debounced save is enough here.
    const write = async value => {
        context().extensionSettings[ID] = value;
        if (context().saveSettingsDebounced) context().saveSettingsDebounced();
        else if (saveSettings) await saveSettings();
    };
    const external = () => {
        const store = context().extensionSettings.preset_compare_api_manager;
        if (store && (store.version !== 1 || !Array.isArray(store.profiles))) throw new Error('外部 API 方案格式不受支持。');
        return store?.profiles || [];
    };
    async function current() {
        const c = context().chatCompletionSettings;
        if (!c || c.chat_completion_source !== 'custom') throw new Error('当前连接无法复制为兼容 API 方案，请使用预设编辑器方案或手动填写。');
        const response = await fetch('/api/secrets/read', { method: 'POST', headers: headers(), body: '{}' });
        if (!response.ok) throw new Error('无法读取密钥引用。');
        const secretId = (await response.json()).api_key_custom?.find(x => x.active)?.id;
        return { source: 'custom', model: c.custom_model, connection: { custom_url: c.custom_url }, additional:Object.fromEntries(['custom_include_body','custom_exclude_body','custom_include_headers'].map(k=>[k,c[k]||''])), secretId };
    }
    const api = createApiSchemes({ read, write, external, current, currentAdditional:()=>Object.fromEntries(['custom_include_body','custom_exclude_body','custom_include_headers'].map(k=>[k,context().chatCompletionSettings?.[k]||''])), vault, models: async config => {
        let request = profileRequest({ ...config, model: config.model || 'models' }, [], 1, parseYaml);
        if (config.keyRef) request = authorizeLocalRequest(request, await vault.get(config.keyRef), parseYaml);
        const response = await fetch('/api/backends/chat-completions/status', { method: 'POST', headers: headers(), body: JSON.stringify(request) });
        if (!response.ok) throw new Error('模型拉取失败，可手动输入模型名称。');
        const data = await response.json();
        if (!Array.isArray(data.data)) throw new Error('API 没有返回模型列表，可手动输入。');
        return data.data.map(x => x.id).filter(x => typeof x === 'string');
    } });
    async function capture(signal, extraBooks, generationType, replaceMes) {
        const world = await import('/scripts/world-info.js');
        const c = context();
        const manager = c.getPresetManager?.('openai') || (await import('/scripts/preset-manager.js')).getPresetManager('openai');
        return captureSources({ context, world, manager, openai: { oai_settings: c.chatCompletionSettings }, powerUser: c.powerUserSettings, baiBai: globalThis.STBaiBaiBook, promptText }, { signal, extraBooks, generationType, replaceMes });
    }
    // Preset, entry and book switches are applied from the cached snapshot during the scan; only adding or
    // removing an extra book changes what has to be loaded, so only then is the worldbook cache reloaded.
    async function resolveSource(selection) {
        const capturePresets = !presetSource;
        const captureWorld = capturePresets || !worldSource;
        if (!capturePresets && !captureWorld) return { ...presetSource, ...worldSource };
        const fresh = await capture(undefined, captureWorld ? selection.extraBooks : []);
        if (captureWorld) worldSource = fresh;
        if (capturePresets) presetSource = fresh;
        // The freshly captured half is always at least as new as the other; let it win the shared fields.
        return { ...presetSource, ...worldSource };
    }
    // The post-body stage shares world/compatibility selection with planning but has its own preset and entry switches.
    const theaterSelection = state => ({ ...state.selection, ...state.theaterSelection });
    async function snapshot(refresh = false) {
        const settings = read();
        if (refresh) presetSource = worldSource = null;
        const source = await resolveSource(settings.selection);
        let preset = null, error = '', theaterPreset = null, theaterError = '';
        try { preset = resolvePreset(source, settings.selection); } catch (e) { error = e.message; }
        try { theaterPreset = resolvePreset(source, settings.theaterSelection); } catch (e) { theaterError = e.message; }
        return { settings, profiles: await api.list(), presets: Object.keys(source.presets), preset, theaterPreset, theaterError, books: source.books, bookNames: source.bookNames, bindings: source.bindings, error,
            compatibility: adapters.map(a => ({ id: a.id, name: a.name, category: a.category, status: a.slots.some(key => source.injections[key]?.value) ? '本轮有注入' : '暂无注入' })) };
    }
    return {
        snapshot,
        // Chat changes invalidate the per-chat world/character/preset capture so the next read reloads it.
        invalidate() { presetSource = worldSource = null; },
        async execute(method, payload = {}) {
            const state = read();
            if (method === 'state.read' || method === 'sources.refresh') return snapshot(true);
            if (method === 'settings.update') {
                Object.assign(state, cleanSettings(payload));
                if (typeof payload.displayPlan === 'boolean') state.displayPlan = payload.displayPlan;
                if (['auto','light','dark'].includes(payload.appearance)) state.appearance = payload.appearance;
                if (typeof payload.apiSelection === 'string' && (await api.list()).some(p => p.id === payload.apiSelection)) state.apiSelection = payload.apiSelection;
                if (typeof payload.theaterApiSelection === 'string' && (payload.theaterApiSelection === '' || (await api.list()).some(p => p.id === payload.theaterApiSelection))) state.theaterApiSelection = payload.theaterApiSelection;
                await write(state);
            } else if (method === 'selection.update') {
                assertSafeData(payload);
                const theater = payload.stage === 'theater', target = theater ? state.theaterSelection : state.selection;
                for (const key of theater ? ['promptOverrides','groupOverrides'] : ['promptOverrides','groupOverrides','bookOverrides','entryOverrides']) if (payload[key] && typeof payload[key] === 'object' && !Array.isArray(payload[key])) {
                    if (Object.values(payload[key]).some(v => typeof v !== 'boolean')) throw new Error('开关值必须为布尔值。');
                    target[key] = structuredClone(payload[key]);
                }
                if (typeof payload.presetId === 'string') target.presetId = payload.presetId;
                if (!theater) for (const key of ['extraBooks','compatibilityIds']) if (Array.isArray(payload[key]) && payload[key].every(v => typeof v === 'string')) state.selection[key] = [...new Set(payload[key])];
                // Preset/entry/group switches only change the selection, which is applied from the cached
                // snapshot; only adding or removing an extra book changes which worldbooks must be loaded.
                if (!theater && Array.isArray(payload.extraBooks)) worldSource = null;
                await write(state);
            } else if (method === 'api.save') {
                let base = {};
                if (payload.sourceId && !(payload.key && payload.apiUrl && payload.sourceId === 'current')) base = await api.resolve(payload.sourceId);
                const config = { ...base, source: 'custom', model: payload.model || base.model || '', connection: { custom_url: payload.apiUrl || base.connection?.custom_url || '' } };
                if(payload.additional!==undefined)config.additional=payload.additional;
                profileRequest({...config,keyRef:config.keyRef||'validate'},[],state.maxTokens,parseYaml);
                const url = new URL(config.connection.custom_url);
                if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('请填写有效的 HTTP(S) 基础地址。');
                await api.save({ id: payload.id, name: payload.name, config, key: payload.key });
            } else if (method === 'api.remove') await api.remove(payload.id);
            else if (method === 'api.models') return api.models(await api.resolve(state.apiSelection));
            else if (method === 'scheme.loadCurrent') {
                if (!['preset','world','theater'].includes(payload.kind)) throw new Error('无效方案类型。');
                const fresh = await capture(undefined, state.selection.extraBooks);
                if (payload.kind !== 'world') {
                    const native = resolvePreset(fresh, { presetId: fresh.currentPreset }), target = selectionOf(state, payload.kind);
                    target.presetId = fresh.currentPreset;
                    target.promptOverrides = Object.fromEntries(native.groups.flatMap(g => g.entries.map(e => [e.identifier, e.enabled])));
                    target.groupOverrides = Object.fromEntries(native.groups.filter(g => g.id).map(g => [g.id, g.enabled]));
                } else {
                    state.selection.bookOverrides = {};
                    state.selection.entryOverrides = {};
                    state.selection.extraBooks = [];
                }
                rememberScheme(state, payload.kind, '@current');
                // The capture above is the current baseline for every selection; refresh both caches.
                presetSource = fresh; worldSource = fresh;
                await write(state);
            } else if (method === 'scheme.save') {
                if (!['preset','world','theater'].includes(payload.kind)) throw new Error('无效方案类型。');
                const list = listKind(payload.kind), target = selectionOf(state, payload.kind);
                const keys = payload.kind === 'world' ? ['bookOverrides','entryOverrides','extraBooks'] : ['presetId','promptOverrides','groupOverrides'];
                if (payload.applyId) {
                    const item = state.schemes[list].find(s => s.id === payload.applyId);
                    if (!item) throw new Error('方案已不存在。');
                    for (const key of keys) target[key] = structuredClone(item.payload[key]);
                    rememberScheme(state, payload.kind, payload.applyId);
                    // Applying a world scheme can change the extra books; presets themselves never change here.
                    if (payload.kind === 'world') worldSource = null;
                    await write(state);
                } else {
                    const next = applySchemeOperation(state, { kind: list, operation: payload.id ? 'overwrite' : 'create', id: payload.id, name: payload.name, payload: Object.fromEntries(keys.map(k => [k, target[k]])) });
                    rememberScheme(next, payload.kind, payload.id || next.schemes[list].at(-1).id);
                    await write(next);
                }
            } else if (method === 'scheme.remove') await write(applySchemeOperation(state, { kind: listKind(payload.kind), operation: 'delete', id: payload.id }));
            return snapshot();
        },
        rememberBodyRequest(data) {
            if (!data || typeof data !== 'object' || !data.chat_completion_source) return;
            const copy = structuredClone(data); copy.messages = []; bodyRequest = copy;
        },
        // Post-body stage: the same independent context assembly as planning, with the stage's own preset selection
        // and a history that already ends with this round's body (minus the theater result being replaced).
        async theaterPrepare({ messageId, body, config, signal }) {
            const state = migrateSchemes(config);
            const selection = theaterSelection(state);
            const frozen = await capture(signal, state.selection.extraBooks, 'theater', { index: messageId, mes: body });
            const snapshotData = await materializePluginMacros(frozen, selection, globalThis.STBaiBaiBook);
            await captureHelperVariables(snapshotData, context(), globalThis.TavernHelper, 'theater');
            signal.throwIfAborted();
            const selectedPreset = snapshotData.presets[selection.presetId || snapshotData.currentPreset];
            snapshotData.maxContext = Number(selectedPreset?.openai_max_context) || snapshotData.maxContext;
            snapshotData.inputBudget = snapshotData.maxContext - Number(config.theaterMaxTokens);
            if (snapshotData.inputBudget <= 0) throw new Error('小剧场最大输出已超过所选预设的上下文额度。');
            snapshotData.trigger = 'theater';
            const built = await buildPlanningContext({ snapshot: snapshotData, selection, worldState: context().chatMetadata?.czghCreativePlanningWorld || {}, tokenize: text => context().getTokenCountAsync(text), serializeYaml: value => globalThis.SillyTavern.libs?.yaml?.stringify?.(value), renderTemplate: createTemplateRenderer({ enabled: state.templateCompat, api: globalThis.EjsTemplate, signal }) });
            signal.throwIfAborted();
            const request = await this.theaterRequest({ selection: state.theaterApiSelection, maxTokens: config.theaterMaxTokens, signal });
            return { messages: theaterMessages(built.messages, config), request, sourceManifest: built.sourceManifest };
        },
        // Theater runs after the body; "current connection" reuses the connection settings of the body request just sent.
        async theaterRequest({ selection, maxTokens, signal }) {
            if (!selection) throw new Error('请先在设置中选择小剧场 API 方案。');
            if (selection === 'current') {
                if (!bodyRequest) throw new Error('尚未捕获到本轮正文连接，请先生成一次正文或选择其他小剧场 API 方案。');
                const response = await fetch('/api/secrets/read', { method: 'POST', headers: headers(), body: '{}', signal });
                if (!response.ok) throw Error('无法冻结当前连接的密钥引用。');
                const request = freezeCurrentRequest(bodyRequest, await response.json(), parseYaml);
                request.max_tokens = Number(maxTokens);
                return request;
            }
            const profile = await api.resolve(selection);
            const request = profileRequest(profile, [], maxTokens, parseYaml);
            if (profile.keyRef) return authorizeLocalRequest(request, await vault.get(profile.keyRef), parseYaml);
            const response = await fetch('/api/secrets/read', { method: 'POST', headers: headers(), body: '{}', signal });
            if (!response.ok) throw new Error('无法核对小剧场方案的密钥引用。');
            const keys = (await response.json()).api_key_custom;
            if (!Array.isArray(keys) || !keys.some(item => item.id === profile.secretId)) throw new Error('小剧场方案引用的密钥已不存在；未使用其他密钥。');
            return request;
        },
        async prepare({ data, config, signal }) {
            const state = migrateSchemes(config);
            let currentRequest;
            if(state.apiSelection==='current'){
                const response=await fetch('/api/secrets/read',{method:'POST',headers:headers(),body:'{}',signal});
                if(!response.ok)throw Error('无法冻结当前连接的密钥引用。');
                currentRequest=freezeCurrentRequest(data,await response.json(),text=>globalThis.SillyTavern.libs?.yaml?.parse?.(text)??JSON.parse(text));
            }
            const frozen = await capture(signal, state.selection.extraBooks, data.type);
            const snapshotData = await materializePluginMacros(frozen,state.selection,globalThis.STBaiBaiBook);
            await captureHelperVariables(snapshotData, context(), globalThis.TavernHelper, data.type);
            signal.throwIfAborted();
            const selectedPreset=snapshotData.presets[state.selection.presetId||snapshotData.currentPreset];
            snapshotData.maxContext=Number(selectedPreset?.openai_max_context)||snapshotData.maxContext;
            snapshotData.inputBudget=snapshotData.maxContext-Number(config.maxTokens);
            if(snapshotData.inputBudget<=0)throw new Error('规划最大输出已超过所选预设的上下文额度。');
            snapshotData.trigger = data.type || 'normal';
            const built = await buildPlanningContext({ snapshot: snapshotData, selection: state.selection, worldState: context().chatMetadata?.czghCreativePlanningWorld || {}, tokenize: text => context().getTokenCountAsync(text), serializeYaml: value => globalThis.SillyTavern.libs?.yaml?.stringify?.(value), renderTemplate: createTemplateRenderer({ enabled: state.templateCompat, api: globalThis.EjsTemplate, signal }) });
            signal.throwIfAborted();
            if (state.apiSelection === 'current') {
                return { ...built, request: currentRequest };
            }
            const profile = await api.resolve(state.apiSelection);
            if (profile.keyRef) {
                const request = authorizeLocalRequest(profileRequest(profile, [], config.maxTokens, parseYaml), await vault.get(profile.keyRef), parseYaml);
                return { ...built, request };
            }
            if (!profile.secretId) throw new Error('此方案尚无可用密钥引用，请选择已保存的 API 方案。');
            return { ...built, profile };
        },
    };
}
