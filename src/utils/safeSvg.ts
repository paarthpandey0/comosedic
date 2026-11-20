export function sanitizeSvgMarkup(rawSvg: string): string {
  const trimmed = (rawSvg || '').trim();
  const start = trimmed.indexOf('<svg');
  const end = trimmed.lastIndexOf('</svg>');
  if (start === -1 || end === -1) return '';
  let svg = trimmed.slice(start, end + 6);
  svg = svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
  if (!/class=/i.test(svg.slice(0, 80))) {
    svg = svg.replace('<svg', '<svg class="w-full h-auto max-h-72 rounded-xl bg-white p-2"');
  }
  return svg;
}
