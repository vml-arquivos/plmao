import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * Markdown enxuto e seguro para artigos: títulos (##, ###), parágrafos, listas (-, 1.), citação (>),
 * **negrito**, *itálico*, `código` e [links](url). Nada de HTML cru: tudo vira elementos React.
 */

function safeHref(url: string): string | null {
  const u = url.trim();
  if (/^https?:\/\//i.test(u) || /^mailto:/i.test(u)) return u;
  if (/^\/(?![/\\])/.test(u) && !u.includes('\\')) return u;
  return null;
}

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let i = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith('**')) out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith('`')) out.push(<code key={key}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith('[')) {
      const mm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
      const href = mm ? safeHref(mm[2]) : null;
      if (mm && href) {
        out.push(href.startsWith('/') ? <Link key={key} to={href}>{mm[1]}</Link> : <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow">{mm[1]}</a>);
      } else out.push(tok);
    } else out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source, className = 'prose' }: { source: string; className?: string }) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let k = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const h = /^(#{2,3})\s+(.+)$/.exec(line);
    if (h) {
      const Tag = h[1].length === 2 ? 'h2' : 'h3';
      blocks.push(<Tag key={k++}>{inline(h[2].trim(), `h${k}`)}</Tag>);
      i++; continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++; }
      blocks.push(<ul key={k++}>{items.map((t, n) => <li key={n}>{inline(t, `u${k}-${n}`)}</li>)}</ul>);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+[.)]\s+/, '')); i++; }
      blocks.push(<ol key={k++}>{items.map((t, n) => <li key={n}>{inline(t, `o${k}-${n}`)}</li>)}</ol>);
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { quote.push(lines[i].replace(/^>\s?/, '')); i++; }
      blocks.push(<blockquote key={k++}>{inline(quote.join(' '), `q${k}`)}</blockquote>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{2,3}\s|\s*[-*]\s+|\s*\d+[.)]\s+|>\s?)/.test(lines[i])) { para.push(lines[i].trim()); i++; }
    blocks.push(<p key={k++}>{inline(para.join(' '), `p${k}`)}</p>);
  }
  return <div className={className}>{blocks.map((b, n) => <Fragment key={n}>{b}</Fragment>)}</div>;
}
