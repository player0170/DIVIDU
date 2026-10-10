/* 规划消息持久化：按聊天与 swipe 绑定记录，把规划块写到正文前方，不复用取消或过期结果。 */
export function fingerprint(text) {
    let hash = 2166136261;
    for (const char of String(text || '')) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return `${String(text || '').length}:${hash >>> 0}`;
}
export function planBlock(record) {
    if (!record?.text || !record.openTag || !record.closeTag) return '';
    return `${record.openTag}\n${record.text}\n${record.closeTag}`;
}
export function createMessagePlans(host) {
    const pending = new Map();
    let live;
    function render() {
        const records = new Map();
        const userBefore = index => {
            const messages = host.messages();
            for (let i = index; i >= 0; i--) if (messages[i]?.is_user) return i;
            return -1;
        };
        const messages=host.messages();
        const latestUser=userBefore(messages.length-1);
        if(host.display())for(let messageId=messages.length-1;messageId>latestUser;messageId--){
            const message=messages[messageId],swipeId=message.swipe_id??0;
            const record=message.extra?.czghCreativePlanning?.[swipeId];
            if(record&&latestUser>=0){records.set(latestUser,{...record,messageId:latestUser,sourceMessageId:messageId,swipeId,stale:record.bodyFingerprint!==fingerprint(message.mes)});break;}
        }
        if (host.display()) for (const record of pending.values()) {
            const anchor = userBefore(Math.min(record.expectedMessageId ?? host.messages().length, host.messages().length) - 1);
            if (record.chatId === host.chatId() && anchor >= 0 && anchor === latestUser) records.set(anchor, { ...record, messageId: anchor, stale: false });
        }
        if (host.display() && live?.chatId === host.chatId()) {
            const anchor = userBefore(Math.min(live.expectedMessageId, host.messages().length) - 1);
            if (anchor >= 0 && anchor === latestUser) records.set(anchor, { ...live, messageId: anchor });
        }
        host.render([...records.values()]);
    }
    return {
        updateLive(record) { if (record.chatId !== host.chatId()) return; live = structuredClone(record); render(); },
        settleWaiting(phase) { if (live?.phase === 'waiting') { live.phase = phase; render(); } },
        clearLive() { live = null; render(); },
        stage(record) { live = null; pending.clear(); pending.set(record.requestId, structuredClone(record)); render(); },
        async bind({ requestId, messageId, swipeId }) {
            const record = pending.get(requestId); pending.delete(requestId);
            const message = host.messages()[messageId];
            if (!record || record.chatId !== host.chatId() || !message || message.is_user || message.is_system || !message.mes) return;
            record.swipeId = swipeId;
            // Plain text in front of the body, like a preset's own reasoning block; ST regex scripts apply as usual.
            const block = planBlock(record);
            if (block && !message.mes.startsWith(block)) {
                message.mes = `${block}\n\n${message.mes}`;
                if (Array.isArray(message.swipes) && typeof message.swipes[swipeId] === 'string') message.swipes[swipeId] = message.mes;
            }
            record.bodyFingerprint = fingerprint(message.mes);
            delete record.nextWorldState;
            message.extra ??= {};
            message.extra.czghCreativePlanning ??= {};
            message.extra.czghCreativePlanning[swipeId] = record;
            if (message.swipe_info?.[swipeId]) {
                message.swipe_info[swipeId].extra ??= {};
                message.swipe_info[swipeId].extra.czghCreativePlanning = structuredClone(message.extra.czghCreativePlanning);
            }
            await host.save(); host.refresh?.(messageId); render();
        },
        render,
        discard(requestId) { if (requestId) pending.delete(requestId); else pending.clear(); render(); },
        dispose() { live = null; pending.clear(); host.render([]); },
    };
}
