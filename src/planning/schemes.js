/* 独立方案存储：迁移旧设置、校验可持久化数据，以副本执行增删改。 */
import { createId } from '../bridge/id.js?v=0.5.0';
const KINDS = ['api', 'preset', 'world'];
export function assertSafeData(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
        if (/^(?:__proto__|prototype|constructor|key|apiKey|api_key|authorization|password)$/i.test(key)) throw new Error('方案不能保存明文凭据或不安全字段。');
        assertSafeData(child);
    }
}
export function migrateSchemes(settings = {}) {
    const result = structuredClone(settings);
    if (result.schemes && result.schemes.version !== 1) throw new Error('方案数据版本不支持，请保留原数据。');
    if (!result.schemes) {
        result.schemes = { version: 1, api: [], preset: [], world: [] };
        if (result.apiUrl && !result.profileId) result.schemes.api.push({ id: 'legacy-manual', kind: 'api', name: '原手动配置', payload: { apiUrl: result.apiUrl, model: result.model || '', source: 'custom', connection: { custom_url: result.apiUrl } }, updatedAt: 0 });
    }
    for (const kind of KINDS) if (!Array.isArray(result.schemes[kind])) throw new Error('方案数据损坏，请保留原数据。');
    result.selection ??= { presetId: '', promptOverrides: {}, groupOverrides: {}, bookOverrides: {}, entryOverrides: {}, extraBooks: [], compatibilityIds: ['baibai', 'seven-days'] };
    result.schemeSelection ??= { preset: '', world: '' };
    result.schemeBaseline ??= {};
    for (const kind of ['preset','world']) {
        if (result.schemeSelection[kind] !== '@current' && !result.schemes[kind].some(x => x.id === result.schemeSelection[kind])) result.schemeSelection[kind] = '';
        result.schemeBaseline[kind] ??= selectionPayload(result, kind);
    }
    result.apiSelection ??= result.profileId ? `external:${result.profileId}` : result.schemes.api.length ? 'local:legacy-manual' : 'current';
    result.theaterApiSelection ??= '';
    result.displayPlan ??= false;
    result.appearance ??= 'auto';
    return result;
}
export function applySchemeOperation(state, { kind, operation, id, name, payload }) {
    if (!KINDS.includes(kind) || !['create', 'overwrite', 'delete'].includes(operation)) throw new Error('无效的方案操作。');
    const next = migrateSchemes(state);
    const list = next.schemes[kind];
    const index = list.findIndex(item => item.id === id);
    if (operation !== 'create' && index < 0) throw new Error('仅可修改创作规划中仍存在的方案。');
    if (operation === 'delete') { list.splice(index, 1); if (next.schemeSelection[kind] === id) next.schemeSelection[kind] = ''; }
    else {
        if (typeof name !== 'string' || !name.trim() || name.length > 100) throw new Error('请输入不超过 100 字的方案名称。');
        assertSafeData(payload);
        const item = { id: operation === 'create' ? createId() : id, name: name.trim(), kind, payload: structuredClone(payload), updatedAt: Date.now() };
        if (index < 0) list.push(item); else list[index] = item;
    }
    return next;
}

export function selectionPayload(state, kind) {
    const keys = kind === 'preset' ? ['presetId','promptOverrides','groupOverrides'] : ['bookOverrides','entryOverrides','extraBooks'];
    return structuredClone(Object.fromEntries(keys.map(k => [k,state.selection[k]])));
}
export function rememberScheme(state, kind, id) {
    state.schemeSelection[kind] = id;
    state.schemeBaseline[kind] = selectionPayload(state, kind);
}
export function schemeSelectionState(state, kind) {
    const id = state.schemeSelection[kind];
    const base = state.schemes[kind].find(x => x.id === id)?.payload || state.schemeBaseline[kind];
    const normalize = value => Array.isArray(value) ? value.map(normalize).sort() : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k,normalize(value[k])])) : value;
    return { id, dirty: JSON.stringify(normalize(selectionPayload(state,kind))) !== JSON.stringify(normalize(base)) };
}
