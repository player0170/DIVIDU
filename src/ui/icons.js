/* 共享线条图标：工作台和楼内 iframe 使用相同 SVG 与外观状态标识。 */
const shapes = {
    reply: '<path d="M3 4h18v14H7l-4 3z"/>',
    edit: '<path d="M13 3H5v18h14v-7M13 3v6h6M13 3l6 6M10 16l7-7 3 3-7 7-4 1z"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
    settings: '<path d="M9.5 3h5l.6 2.4 2.1 1.2 2.4-.7 2.5 4.2-1.8 1.8v2.4l1.8 1.8-2.5 4.2-2.4-.7-2.1 1.2-.6 2.4h-5l-.6-2.4-2.1-1.2-2.4.7L1.9 16l1.8-1.8v-2.4l-1.8-1.8 2.5-4.2 2.4.7 2.1-1.2z" transform="translate(1 0) scale(.92)"/><circle cx="12" cy="12" r="3.2"/>',
    preview: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3.5"/>',
    pause: '<rect x="5" y="5" width="4" height="14" rx="1"/><rect x="15" y="5" width="4" height="14" rx="1"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" stroke="none"/>',
    light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>',
    dark: '<path d="M20 14A8.5 8.5 0 0 1 10 3a8.5 8.5 0 1 0 10 11Z"/>',
    auto: '<path d="M5 19c-4-9 5-12 14-15 1 10-2 17-10 16M4 22l11-12M8 15l5 1"/>',
    theater: '<path d="M12 3.5 14 9.5l6 .5-4.6 3.9 1.5 6.1L12 16.8 7.1 20l1.5-6.1L4 10l6-.5z"/>',
};
export function setIcon(node, name) {
    if (!shapes[name]) return;
    node.innerHTML = `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name]}</svg>`;
    node.dataset.icon = name;
}
export function appearanceIcon(node, mode = 'auto') {
    setIcon(node, mode);
    node.title = `切换外观（当前：${{auto:'自适应',light:'日间',dark:'夜间'}[mode]}）`;
}

export function generationIcon(node, busy) {
    setIcon(node, busy ? 'pause' : 'stop');
    node.classList.toggle('is-generating', !!busy);
    node.title = busy ? '正在生成 · 点击停止本轮' : '停止本轮';
}
