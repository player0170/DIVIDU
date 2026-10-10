/* 小剧场：正文完成后的独立请求构建与结果校验；只读取聊天，结果追加到正文末尾。 */
// The body as the theater sees it: without the plan block in front and without an earlier theater at the end.
export function bodyOnly(mes, plan, previousTheater) {
    let text = typeof mes === 'string' ? mes : '';
    if (plan?.text && plan.openTag && plan.closeTag) {
        const block = `${plan.openTag}\n${plan.text}\n${plan.closeTag}`;
        if (text.startsWith(block)) text = text.slice(block.length).replace(/^\s+/, '');
    }
    if (previousTheater && text.endsWith(previousTheater)) text = text.slice(0, -previousTheater.length).replace(/\s+$/, '');
    return text;
}
export function validateTheater(settings) {
    for (const [field, min, max] of [['theaterMaxTokens', 64, 100000], ['theaterHistory', 0, 50], ['timeoutSeconds', 10, 1800]]) {
        if (!Number.isInteger(Number(settings[field])) || Number(settings[field]) < min || Number(settings[field]) > max) {
            throw new Error(`${field} 须为 ${min}–${max} 之间的整数。`);
        }
    }
    if (typeof settings.theaterPrompt !== 'string' || !settings.theaterPrompt.trim()) throw new Error('小剧场提示词不能为空。');
}

export function theaterMessages({ chat, messageId, prompt, history, charName, userName, character, persona, body }) {
    const source = chat?.[messageId];
    const target = source && { ...source, mes: typeof body === 'string' ? body : source.mes };
    if (!target || target.is_user || target.is_system || typeof target.mes !== 'string' || !target.mes.trim()) throw new Error('没有可用于小剧场的正文。');
    const count = Math.max(0, Math.min(50, Math.trunc(Number(history) || 0)));
    const earlier = count ? chat.slice(0, messageId).filter(m => !m.is_system && typeof m.mes === 'string' && m.mes.trim()).slice(-count) : [];
    const speaker = m => m.name || (m.is_user ? userName || '用户' : charName || '角色');
    const line = m => `${speaker(m)}：${m.mes.trim()}`;
    const profile = [['角色', charName], ['角色设定', character?.description], ['性格', character?.personality], ['场景', character?.scenario], ['用户', userName], ['用户设定', persona]]
        .filter(([, value]) => typeof value === 'string' && value.trim())
        .map(([label, value]) => `【${label}】\n${value.trim()}`).join('\n\n');
    const messages = [{ role: 'system', content: prompt }];
    if (profile) messages.push({ role: 'system', content: `以下是角色资料：\n\n${profile}` });
    if (earlier.length) messages.push({ role: 'system', content: `以下是最近的聊天记录：\n\n${earlier.map(line).join('\n\n')}` });
    messages.push({ role: 'user', content: `以下是本轮刚完成的正文：\n\n${line(target)}\n\n请根据以上内容写本轮小剧场。` });
    return messages;
}

export function extractTheater(text, finishReason) {
    if (finishReason === 'length') throw new Error('小剧场被输出额度截断，请提高小剧场最大输出后重试。');
    if (typeof text !== 'string' || !text.trim()) throw new Error('小剧场 API 未返回文本。');
    return text.trim();
}
