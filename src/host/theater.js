/* 正文后阶段控制器：正文收到后按小剧场预设方案独立组装上下文再请求一次，结果追加到正文末尾并按 swipe 记录在 extra。 */
import { readPlanResponse } from './stream.js?v=0.5.0';
import { createId } from '../bridge/id.js?v=0.5.0';
import { fingerprint } from './message-plans.js?v=0.5.0';
import { extractTheater, validateTheater, bodyOnly } from '../planning/theater.js?v=0.5.0';
const ID = 'czgh_external_planner';
const BUSY = ['preparing', 'generating', 'streaming'];
// `prepare({ messageId, body, config, signal })` returns `{ messages, request }`: the stage's preset context plus the API request.
export function createTheater({ getContext, getRequestHeaders, prepare, save, chatId, isAborted = () => false, render = () => {}, refresh = () => {}, onDiagnostics = () => {} }) {
    let run = null;
    let failure = null; // Errors and cancellations stay on the current page only.
    const settings = () => getContext().extensionSettings[ID] || {};
    const latest = () => {
        const chat = getContext().chat || [], id = chat.length - 1, message = chat[id];
        return message && !message.is_user && !message.is_system ? id : -1;
    };
    function records() {
        if (!settings().theaterEnabled) return [];
        const id = latest(); if (id < 0) return [];
        const message = getContext().chat[id], swipeId = message.swipe_id ?? 0;
        const base = { chatId: chatId(), messageId: id, swipeId };
        const same = item => item && item.chatId === base.chatId && item.messageId === id && item.swipeId === swipeId;
        if (same(run)) return [{ ...base, phase: run.phase, text: run.text }];
        if (same(failure)) return [{ ...base, phase: failure.phase, error: failure.error, text: '' }];
        const saved = message.extra?.czghTheater?.[swipeId];
        if (saved?.text) return [{ ...base, text: saved.text, model: saved.model, createdAt: saved.createdAt, phase: 'done', stale: saved.bodyFingerprint !== fingerprint(message.mes) }];
        return [{ ...base, phase: 'idle', text: '' }];
    }
    const update = () => render(records());
    function cancel(silent = false) {
        const current = run; if (!current) return false;
        run = null; current.controller.abort();
        failure = silent ? null : { chatId: current.chatId, messageId: current.messageId, swipeId: current.swipeId, phase: 'cancelled', error: '小剧场已停止。' };
        update(); return true;
    }
    async function generate(messageId = latest()) {
        const config = structuredClone(settings());
        const c = getContext(), message = c.chat?.[messageId];
        if (!config.theaterEnabled || !message || message.is_user || message.is_system || typeof message.mes !== 'string' || !message.mes.trim()) return false;
        cancel(true);
        const current = { requestId: createId(), chatId: chatId(), messageId, swipeId: message.swipe_id ?? 0, controller: new AbortController(), phase: 'preparing', text: '' };
        run = current; failure = null; update();
        const signal = current.controller.signal;
        const timer = setTimeout(() => current.controller.abort(), Number(config.timeoutSeconds || 180) * 1000);
        // The body must still be the same floor and swipe; edits are detected later via the fingerprint.
        const alive = () => run === current && current.chatId === chatId() && getContext().chat?.[messageId] === message && (message.swipe_id ?? 0) === current.swipeId;
        try {
            validateTheater(config);
            if (!config.theaterApiSelection) throw new Error('请先在设置中选择小剧场 API 方案。');
            const previous = message.extra?.czghTheater?.[current.swipeId]?.text;
            // The history the stage reads ends with this body, minus the earlier theater result it is about to replace.
            const prepared = await prepare({ messageId, body: bodyOnly(message.mes, previous), config, signal });
            signal.throwIfAborted();
            if (!alive()) throw new Error('正文已变化，本次小剧场已放弃。');
            const payload = { ...structuredClone(prepared.request), messages: prepared.messages, stream: !!config.theaterStream, max_tokens: Number(config.theaterMaxTokens) };
            delete payload.tools; delete payload.tool_choice; delete payload.functions; delete payload.function_call;
            onDiagnostics({ requestId: current.requestId, createdAt: new Date().toISOString(), model: payload.model, stream: payload.stream, maxTokens: payload.max_tokens, sourceManifest: prepared.sourceManifest || null, messages: structuredClone(payload.messages) });
            current.phase = 'generating'; update();
            const response = await fetch('/api/backends/chat-completions/generate', { method: 'POST', headers: getRequestHeaders(), signal, body: JSON.stringify(payload) });
            if (!response.ok) throw new Error(`小剧场 API 请求失败（HTTP ${response.status}）。`);
            const choice = await readPlanResponse(response, text => { if (!alive()) return; current.text = text; current.phase = 'streaming'; update(); }, signal);
            const text = extractTheater(choice.message?.content, choice.finish_reason);
            if (!alive()) throw new Error('正文已变化，本次小剧场已放弃。');
            // Appended after the body as plain text; a regenerated theater replaces the earlier one.
            message.mes = `${bodyOnly(message.mes, previous)}\n\n${text}`;
            if (Array.isArray(message.swipes) && typeof message.swipes[current.swipeId] === 'string') message.swipes[current.swipeId] = message.mes;
            const record = { version: 1, requestId: current.requestId, text, model: payload.model, createdAt: Date.now(), bodyFingerprint: fingerprint(message.mes) };
            message.extra ??= {};
            message.extra.czghTheater ??= {};
            message.extra.czghTheater[current.swipeId] = record;
            if (message.swipe_info?.[current.swipeId]) {
                message.swipe_info[current.swipeId].extra ??= {};
                message.swipe_info[current.swipeId].extra.czghTheater = structuredClone(message.extra.czghTheater);
            }
            run = null;
            await save(); refresh(messageId); update();
            return true;
        } catch (error) {
            if (run !== current) return false;
            run = null;
            failure = { chatId: current.chatId, messageId, swipeId: current.swipeId, phase: signal.aborted ? 'cancelled' : 'error', error: signal.aborted ? '小剧场已停止或超时。' : error.message };
            update(); return false;
        } finally { clearTimeout(timer); }
    }
    return {
        generate,
        cancel,
        render: update,
        current: () => records()[0] ?? null,
        isRunning: () => !!run,
        received(messageId, type) {
            const config = settings();
            if (!config.enabled || !config.theaterEnabled || config.theaterAutoGenerate === false || isAborted()) return;
            if (!['normal', 'regenerate', 'swipe', undefined].includes(type)) return;
            void generate(Number(messageId));
        },
        // A new main generation replaces the floor the running request was written for.
        generationStarted(type, dryRun) { if (!dryRun && ['normal', 'regenerate', 'swipe', undefined].includes(type)) cancel(true); },
        chatChanged() { cancel(true); failure = null; update(); },
        settingsChanged() { if (!settings().enabled || !settings().theaterEnabled) cancel(true); update(); },
        busy: phase => BUSY.includes(phase),
    };
}
