/* 正文后阶段（小剧场）：在独立组装的预设上下文末尾附加引导，结果追加到正文末尾。 */
// The body as the post-body stage sees it: without an earlier theater result at the end.
export function bodyOnly(mes, previousTheater) {
    let text = typeof mes === 'string' ? mes : '';
    if (previousTheater && text.endsWith(previousTheater)) text = text.slice(0, -previousTheater.length).replace(/\s+$/, '');
    return text;
}
export function validateTheater(settings) {
    for (const [field, min, max] of [['theaterMaxTokens', 64, 100000], ['timeoutSeconds', 10, 1800]]) {
        if (!Number.isInteger(Number(settings[field])) || Number(settings[field]) < min || Number(settings[field]) > max) {
            throw new Error(`${field} 须为 ${min}–${max} 之间的整数。`);
        }
    }
    if (typeof settings.theaterPrompt !== 'string' || !settings.theaterPrompt.trim()) throw new Error('小剧场提示词不能为空。');
}

// `messages` is the preset context built for the post-body stage; its history already ends with this round's body.
export function theaterMessages(messages, settings) {
    if (!Array.isArray(messages) || !messages.some(m => m.role === 'assistant')) throw new Error('没有可用于小剧场的正文。');
    return [...structuredClone(messages), { role: 'system', content: settings.theaterPrompt }];
}

export function extractTheater(text, finishReason) {
    if (finishReason === 'length') throw new Error('小剧场被输出额度截断，请提高小剧场最大输出后重试。');
    if (typeof text !== 'string' || !text.trim()) throw new Error('小剧场 API 未返回文本。');
    return text.trim();
}
