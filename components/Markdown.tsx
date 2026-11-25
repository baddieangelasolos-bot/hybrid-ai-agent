'use client';

import { memo, useState, type ReactNode } from 'react';
import { Icon } from './Icons';

/** Small, safe markdown renderer (no HTML injection): code, headings, lists, tables, quotes, links, emphasis. */

const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s)<]+)/g;

function inline(text: string, key: string): ReactNode[] {
  return text.split(INLINE).map((tok, i) => {
    const k = key + '-' + i;
    if (!tok) return null;
    if (tok.startsWith('`') && tok.endsWith('`') && tok.length > 2) return <code key={k}>{tok.slice(1, -1)}</code>;
    if (tok.startsWith('**') && tok.endsWith('**') && tok.length > 4) return <strong key={k}>{tok.slice(2, -2)}</strong>;
    if (tok.startsWith('*') && tok.endsWith('*') && tok.length > 2) return <em key={k}>{tok.slice(1, -1)}</em>;
    const link = tok.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (link) return <a key={k} href={link[2]} target='_blank' rel='noopener noreferrer'>{link[1]}</a>;
    if (/^https?:\/\//.test(tok)) return <a key={k} href={tok} target='_blank' rel='noopener noreferrer'>{tok}</a>;
    return tok;
  });
}

export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className='my-2 overflow-hidden rounded-xl' style={{ background: 'var(--code-bg)', border: '1px solid var(--line)' }}>
      <div className='flex items-center justify-between px-3 py-1.5 text-[11px] text-[color:var(--muted)]' style={{ borderBottom: '1px solid var(--line)' }}>
        <span className='font-mono'>{lang || 'code'}</span>
        <button
          className='flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-[color:var(--hover)]'
          onClick={() => {
            void navigator.clipboard.writeText(code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          <Icon name={copied ? 'check' : 'copy'} size={12} />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className='code scroll-thin p-3'>{code}</pre>
    </div>
  );
}

function renderBlocks(src: string, base: string): ReactNode[] {
  const lines = src.split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let n = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = base + '-b' + n++;
    if (!line.trim()) {
      i++;
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const Tag = ('h' + h[1].length) as 'h1' | 'h2' | 'h3';
      out.push(<Tag key={key}>{inline(h[2], key)}</Tag>);
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && (ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/).test(lines[i])) {
        items.push(lines[i].replace(ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/, ''));
        i++;
      }
      const L = ordered ? 'ol' : 'ul';
      out.push(<L key={key}>{items.map((t, j) => <li key={j}>{inline(t, key + '-' + j)}</li>)}</L>);
      continue;
    }
    if (line.startsWith('>')) {
      const q: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) q.push(lines[i++].replace(/^>\s?/, ''));
      out.push(<blockquote key={key}>{inline(q.join(' '), key)}</blockquote>);
      continue;
    }
    if (line.includes('|') && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? '')) {
      const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      out.push(
        <div key={key} className='scroll-thin mb-2 overflow-x-auto'>
          <table>
            <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, key + 'h' + j)}</th>)}</tr></thead>
            <tbody>{rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{inline(c, key + j + '-' + k)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|\s*[-*]\s+|\s*\d+[.)]\s+|>)/.test(lines[i])) para.push(lines[i++]);
    out.push(
      <p key={key}>
        {para.map((t, j) => (
          <span key={j}>
            {j > 0 && <br />}
            {inline(t, key + '-' + j)}
          </span>
        ))}
      </p>,
    );
  }
  return out;
}

/**
 * One blank-line separated block. Memoised on its text, so while an answer streams only the block that is
 * still growing is parsed and re-rendered; every finished block above it is skipped by React.
 */
const Chunk = memo(function Chunk({ src, base }: { src: string; base: string }) {
  return <>{renderBlocks(src, base)}</>;
});
const FencedCode = memo(CodeBlock);

function textBlocks(src: string, seg: number): ReactNode[] {
  // Blank lines already end paragraphs, lists, quotes and tables, so splitting on them changes nothing visually.
  return src.split(/\n[ \t]*\n/).map((c, i) => (c.trim() ? <Chunk key={'t' + seg + '-' + i} src={c} base={'m' + seg + '-' + i} /> : null));
}

function Markdown({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let rest = text;
  let n = 0;
  for (;;) {
    const open = rest.indexOf('```');
    if (open < 0) {
      nodes.push(...textBlocks(rest, n++));
      break;
    }
    nodes.push(...textBlocks(rest.slice(0, open), n++));
    const afterOpen = rest.slice(open + 3);
    const nl = afterOpen.indexOf('\n');
    const lang = nl >= 0 ? afterOpen.slice(0, nl).trim() : afterOpen.trim();
    const body = nl >= 0 ? afterOpen.slice(nl + 1) : '';
    const close = body.indexOf('```');
    if (close < 0) {
      nodes.push(<FencedCode key={'c' + n++} code={body.replace(/\n$/, '')} lang={lang} />);
      break;
    }
    nodes.push(<FencedCode key={'c' + n++} code={body.slice(0, close).replace(/\n$/, '')} lang={lang} />);
    rest = body.slice(close + 3);
  }
  return <div className='md break-words text-[15px] leading-relaxed'>{nodes}</div>;
}

export default memo(Markdown);
