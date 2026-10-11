/* 规划标签识别、提示构建、结果校验和配置迁移。 */
export const defaults = Object.freeze({
    autoReply: true,
    enabled: false,
    stream: false,
    templateCompat: false,
    apiUrl: '',
    model: '',
    profileId: '',
    maxTokens: 6000,
    timeoutSeconds: 180,
    tagMode: 'auto',
    openTag: '',
    closeTag: '',
    rules: '[]',
    theaterEnabled: false,
    theaterAutoGenerate: true,
    theaterStream: false,
    theaterMaxTokens: 2000,
    plannerInstruction: '你正在参与一次分阶段的协作写作。本轮由你完成当前预设要求的写作准备和创作规划，随后会由写作同事结合原始资料与你的规划完成正文及其他要求的成品。请沿用预设指定的身份、语言和创作方式。',
    writerInstruction: '你的规划同事已经完成了本轮写作准备，以下是供你接续使用的创作规划。请结合原始上下文、用户最新输入及当前预设，继续完成正文和预设要求的其他成品，无需重新输出规划区块。',
});


const previousPlanningGuidance = `请按当前预设已启用的创作规划步骤及顺序完成交接，保留原有标题、层级及编号：
1. 问题式引导逐项回答；
2. 非问题式指导必须先一字不差的逐字复述指导原文，再在同一子项下另起一行写“本轮安排：”说明执行方式。原文与安排必须分开，安排不能替代原文。一个子项同时包含指导与问题时，指导必须原样一字不差的写出，问题另起一行回答。
3. 指导原文保留措辞、否定词、数值及标签，不概括、不改写、不替换为执行说明。安排遵循原要求的作用对象、单位、范围、强度、条件及否定关系，并参考预设已启用条目的具体定义；不自行增加硬性数值或规则。
4. 完整处理各步骤及子项，不用笼统总结替代后续步骤。条件步骤按预设条件处理；资料缺失时说明缺失，区分已发生事实与本轮拟写安排。列举、信息读取、召回、核算、例句和预写片段等明确任务仍需完成，不仅仅复制任务指令。
5. 预设中涉及正文与附加成品的要求，是后续写作同事需要执行的交付要求，请在相关规划步骤中准确保留。格式确认按该步骤原文作答，不用本插件的规划外层标签替代正文成品格式。正文及其他成品由下一阶段的同事根据你本轮交付的规划完成。
6. 交接内容以预设指定的规划区块为范围，不复制整个预设或区块外的成品模板，不增加预设未要求的自我评价、总结、检查报告或结束宣言。`;
const planningGuidance = `请按当前预设已启用的创作规划步骤及顺序完成交接，保留原有标题、层级及编号：
1. 提问式引导规划步骤需逐项回答；
2. 非提问式的陈述性步骤指导必须先一字不差的写出该陈述性指导的原文，再在同一子项下另起一行写“本轮安排：”说明该指导用于本轮正文中的执行方式。陈述性指导原文与安排必须分开，安排不能替代陈述性指导原文。
- 当一个子项同时包含陈述性指导与提问式引导时，需先一字不差的写出该陈述性指导的原文，再另起一行回答提问式引导。
3. 非提问式的陈述性步骤指导原文保留措辞、否定词、数值及标签，不概括、不改写、不替换为执行说明。另起一行写的安排遵循陈述性指导要求的作用对象、单位、范围、强度、条件及否定关系；不自行增加规则。
4. 输入中的各个规划步骤与输出中的步骤须逐一对应，保留各自的标题、顺序及子项，不因主题相近而合并、改名或相互替代。每个召回、读取、检查和核算任务，都应在所属步骤下写出具体结果或本轮处理安排；不能仅以“已检查”“按规则执行”“后台自动维护”等承诺代替。资料缺失时，在对应子项下明确说明缺少什么；条件不成立时，按原条件说明不适用。
5. 涉及正文写作与附加成品的要求，是后续写作同事需要执行的交付要求，请在相关规划步骤中准确保留与写出，方便写作同事查看。格式确认按该步骤原文作答，不用本插件的规划外层标签替代正文成品格式。正文及其他成品由下一阶段的写作同事根据你本轮交付的规划来完成。
6. 交接内容以指定的规划区块为范围，不复制整个预设或区块外的成品模板，不增加未要求的自我评价、总结、检查报告或结束宣言。`;
const writingGuidance = `将规划中的安排落实到创作中，同时继续遵守原预设的具体要求，包括声明式指导、必须项、禁止项、节奏、篇幅、比例和格式。规划属于辅助材料，不替代原始资料；规划未复述某项要求不代表该要求失效，原预设要求生成的成品照常生成，未要求或禁止的不要新增。拟写安排不应当作已经发生的事实；与用户最新输入或已知事实冲突时以原始资料为准。无需额外展示预设未要求的执行说明或检查清单。`;
// Post-body stage: the preset itself says which blocks follow the body and how they are tagged.
const theaterGuidance = `你正在参与一次分阶段的协作写作。本轮正文已由写作同事完成，就是上方最后一条助手回复。现在由你补全当前预设要求放在正文之后输出的全部内容（例如小剧场、状态栏、选项、总结等附加区块），沿用预设指定的身份、语言和创作方式。
1. 按预设中各附加区块的要求，使用预设规定的标签和格式逐一完整输出，保留预设规定的顺序；预设未要求的区块不要新增。
2. 内容须承接本轮正文、用户最新输入及已有资料；不要重复、续写或改写正文，不要再次输出规划区块。
3. 只输出这些附加区块本身，不加任何说明、标题或结束语。`;
const previousTheaterPrompt = '本轮正文已经完成。请根据下方提供的角色资料、最近聊天和本轮正文，写一段简短的番外小剧场，例如幕后花絮、角色内心吐槽、平行时空或 Q 版短剧。贴合角色性格与说话方式；不续写、不改写正文剧情，小剧场内容不视为已发生的事实；篇幅约 200–500 字。只输出小剧场本身，不输出正文、状态栏、规划或额外说明。';
export const promptDefaults = Object.freeze({
    plannerPrompt: `${defaults.plannerInstruction}\n${planningGuidance}`,
    writerPrompt: `${defaults.writerInstruction}\n${writingGuidance}`,
    theaterPrompt: theaterGuidance,
});

// Conservative recognition of explicit format instructions, not past assistant output.
// Ambiguous/unsupported layouts require a manual override; never silently guess Abstract.
export function resolvePlanningTags(messages, settings) {
    if (settings.tagMode === 'manual') return { openTag: settings.openTag, closeTag: settings.closeTag };
    const candidates = new Map();
    const cue = /思维链|写作准备|创作准备|规划|思考|推演|reasoning|planning|thinking/i;
    const forbidden = /^(?:content|body|status.*|bbs_.*|details|summary|div|span|p|script|style|system|user|assistant)$/i;
    for (const message of messages) {
        if (!['system', 'developer'].includes(message.role) || typeof message.content !== 'string') continue;
        const lines = message.content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const tokens = [...line.matchAll(/<(\/?)([\p{L}_][\p{L}\p{N}_.:-]*)\s*>/gu)];
            for (let j = 0; j < tokens.length; j++) {
                const token = tokens[j];
                const name = token[2];
                if (forbidden.test(name)) continue;
                const before = line.slice(Math.max(0, token.index - 90), token.index);
                const after = line.slice(token.index + token[0].length, tokens[j + 1]?.index ?? token.index + token[0].length + 70);
                const previous = lines[i - 1] || '';
                // Never interpret an explicit ban, a legacy alternative or quoted negative example as selection.
                if (/(?:不要|不得|禁止|不使用|不再|而非|不是|旧版|旧标签|错误示例|do not|don't|instead of)[^。；;\n]*$/i.test(before)) continue;
                const close = tokens[j + 1];
                const enclosesCue = !token[1] && close?.[1] === '/' && close[2] === name && cue.test(after);
                const directive = cue.test(before) && /标签|包裹|放在|输出|关闭|格式|使用|tag|wrap|output|close/i.test(before);
                const standalone = tokens.length === 1 && line.trim() === token[0] && cue.test(previous) && /标签|输出|使用|tag|output/i.test(previous);
                if (enclosesCue || directive || standalone) {
                    candidates.set(name, { openTag: `<${name}>`, closeTag: `</${name}>` });
                }
            }
        }
    }
    if (candidates.size === 1) return [...candidates.values()][0];
    if (candidates.size > 1) throw new Error(`预设中有多个可能的规划标签：${[...candidates.keys()].join('、')}。请在扩展中手动指定本轮预设使用的标签。`);
    throw new Error('未能从已生效指令中明确识别规划标签。请在扩展中选择手动指定；不会使用固定默认标签。');
}

export function migrateSettings(saved = {}) {
    const merged = { ...defaults, ...saved };
    if (saved.plannerInstruction === '按当前预设已启用的写作准备问题逐项完成本轮公开创作规划。保留主题、编号、具体依据和创作要求；区分已发生事实与本轮拟写安排。只输出规划，不生成正文、状态栏、时间戳或其他附加成品。') merged.plannerInstruction = defaults.plannerInstruction;
    if (saved.plannerInstruction === '按当前预设已启用条目完成其指定规划标签内的全部写作准备内容，保留原有顺序、标题、编号与子问题，区分已发生事实与本轮拟写安排。') merged.plannerInstruction = defaults.plannerInstruction;
    if (saved.plannerInstruction === "按当前预设已启用条目完成其指定规划标签内的全部写作准备内容，保留原有顺序、标题、编号、子问题及声明式要求，区分已发生事实与本轮拟写安排。") merged.plannerInstruction = defaults.plannerInstruction;
    if (saved.writerInstruction === "本轮写作规划已在下方提供。将预设中要求生成、展示或再次回答规划的问题视为已经完成，不重复输出规划区块。从规划之后的实际成品开始，按规划完成本轮回复。继续遵守原预设的人设、文风、正文、顶栏、状态栏、时间戳、摘要及其他附加内容要求：原本要求生成的照常生成，原本未要求或禁止的不要新增。规划中的拟写安排不是已发生的历史事实；与用户最新输入或已知事实冲突时以原始资料为准。") merged.writerInstruction = defaults.writerInstruction;
    if (saved.plannerInstruction === "你正在参与一次分阶段的协作写作。本轮由你完成当前预设要求的写作准备，随后由写作同事结合原始资料与你的规划完成正文及其他要求的成品。请沿用预设指定的身份、语言和创作方式。") merged.plannerInstruction = defaults.plannerInstruction;
    if (!saved.tagMode) {
        // Preserve an explicit non-default override from 0.1.0; migrate its default to auto.
        merged.tagMode = saved.openTag && saved.closeTag
            && (saved.openTag !== '<Abstract>' || saved.closeTag !== '</Abstract>') ? 'manual' : 'auto';
        if (merged.tagMode === 'auto') { merged.openTag = ''; merged.closeTag = ''; }
    }
    if (typeof saved.plannerPrompt !== 'string') merged.plannerPrompt = `${merged.plannerInstruction}\n${planningGuidance}`;
    if (saved.plannerPrompt === `${defaults.plannerInstruction}\n${previousPlanningGuidance}`) merged.plannerPrompt = promptDefaults.plannerPrompt;
    if (typeof saved.writerPrompt !== 'string') merged.writerPrompt = `${merged.writerInstruction}\n${writingGuidance}`;
    if (typeof saved.theaterPrompt !== 'string' || saved.theaterPrompt === previousTheaterPrompt) merged.theaterPrompt = promptDefaults.theaterPrompt;
    return merged;
}

export function validateSettings(settings) {
    const url = new URL(settings.apiUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error('API 地址须为不含凭据、查询参数的 HTTP(S) 基础地址。');
    }
    if (!settings.model.trim()) throw new Error('请填写规划模型名称。');
    if (!settings.openTag.trim() || !settings.closeTag.trim() || settings.openTag === settings.closeTag) {
        throw new Error('请设置不同且非空的规划开始、结束标签。');
    }
    for (const [field, min, max] of [['maxTokens', 256, 100000], ['timeoutSeconds', 10, 1800]]) {
        if (!Number.isInteger(Number(settings[field])) || Number(settings[field]) < min || Number(settings[field]) > max) {
            throw new Error(`${field} 须为 ${min}–${max} 之间的整数。`);
        }
    }
    parseRules(settings.rules);
}

// Exact, opt-in edits to instructions only. History and user input are never rewritten.
export function parseRules(raw) {
    const rules = JSON.parse(raw || '[]');
    if (!Array.isArray(rules) || rules.some(r => !r || typeof r.find !== 'string' || !r.find || typeof r.replace !== 'string')) {
        throw new Error('适配规则须为 [{"find":"原文","replace":"替换文字"}]。');
    }
    return rules;
}

export function planningMessages(messages, settings) {
    return [...structuredClone(messages), { role: 'system', content:
        `${settings.plannerPrompt ?? `${settings.plannerInstruction}\n${planningGuidance}`}
请将完整规划放入当前预设指定的标签中：${settings.openTag}规划内容${settings.closeTag}。` }];
}

export function extractPlan(text, settings, finishReason) {
    if (finishReason === 'length') throw new Error('规划被输出额度截断，请提高额度后重试。');
    if (typeof text !== 'string') throw new Error('规划 API 未返回文本。');
    // Inline code quoting an exact delimiter is documentation, not a boundary.
    // Preserve offsets and original text; do not exempt arbitrary code blocks.
    let boundaries = text;
    for (const tag of [settings.openTag, settings.closeTag]) {
        const quoted = '`' + tag + '`';
        boundaries = boundaries.split(quoted).join(' '.repeat(quoted.length));
    }
    const start = boundaries.indexOf(settings.openTag);
    const end = boundaries.indexOf(settings.closeTag, start + settings.openTag.length);
    if (start < 0 || end < 0) {
        throw new Error('未找到完整的规划标签区块；本次不注入。');
    }
    const plan = text.slice(start + settings.openTag.length, end).trim();
    const inner = boundaries.slice(start + settings.openTag.length, end);
    if (!plan || inner.includes(settings.openTag) || inner.includes(settings.closeTag)) throw new Error('规划为空或存在重复嵌套标签。');
    return plan;
}

export function writingMessages(messages, plan, settings) {
    const result = structuredClone(messages);
    const rules = parseRules(settings.rules);
    for (const message of result) {
        if (!['system', 'developer'].includes(message.role) || typeof message.content !== 'string') continue;
        for (const rule of rules) message.content = message.content.split(rule.find).join(rule.replace);
    }
    result.push({ role: 'system', content: `${settings.writerPrompt ?? `${settings.writerInstruction}\n${writingGuidance}`}\n\n【本轮创作规划】\n${settings.openTag}\n${plan}\n${settings.closeTag}` });
    return result;
}

export function eligibleRequest(data) {
    return [undefined, 'normal', 'regenerate', 'swipe'].includes(data?.type)
        && Array.isArray(data?.messages) && data.messages.length > 0
        && !data.messages.some(m => m.role === 'tool' || m.tool_calls?.length);
}

export function unresolvedBaiBaiMacros(messages) {
    return /\{\{\s*bbs\w*(?:::|\s*\}\})/i.test(JSON.stringify(messages));
}
