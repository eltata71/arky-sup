export const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export const stripMarkdown = (content: string): string => content
  .replace(/```[\s\S]*?```/g, '')
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/^#{1,6}\s+/gm, '')
  .replace(/^\s*[-*+]\s+/gm, '• ')
  .replace(/^\s*\d+\.\s+/gm, '')
  .replace(/[>*_`~]/g, '')
  .replace(/\|/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

export const normalizeText = (value: string): string => value.replace(/\r\n?/g, '\n');
