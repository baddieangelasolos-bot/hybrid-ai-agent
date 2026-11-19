'use client';

import { useMemo, useState } from 'react';
import type { WorkspaceFile } from '@/lib/types';
import { Icon } from './Icons';

const REACT_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js';
const REACT_DOM_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js';
const BABEL_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.26.2/babel.min.js';

function escapeForScript(value: string): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** Builds a sandboxed preview document for HTML files or a single React component. Returns null when not previewable. */
export function buildPreviewDoc(files: WorkspaceFile[]): string | null {
  const html = files.find((f) => /\.html?$/i.test(f.path));
  if (html) return html.content;
  const react = files.find((f) => /\.(tsx|jsx)$/i.test(f.path) && /export\s+default/.test(f.content));
  if (!react) return null;

  let code = react.content;
  code = code.replace(/^import\s+React(?:\s*,\s*\{([^}]*)\})?\s+from\s+['"]react['"];?[ \t]*$/gm, (_m, names: string | undefined) => (names ? 'const {' + names + '} = React;' : ''));
  code = code.replace(/^import\s+\{([^}]*)\}\s+from\s+['"]react['"];?[ \t]*$/gm, (_m, names: string) => 'const {' + names + '} = React;');
  code = code.replace(/^import\s[^;\n]*from\s+['"][^'"]+['"];?[ \t]*$/gm, '');
  code = code.replace(/^import\s+['"][^'"]+['"];?[ \t]*$/gm, '');
  code = code.replace(/^'use client';?[ \t]*$/gm, '');

  let name = 'App';
  const fn = code.match(/export\s+default\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
  const ident = code.match(/export\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/m);
  if (fn) {
    name = fn[1];
    code = code.replace(/export\s+default\s+/, '');
  } else if (ident) {
    name = ident[1];
    code = code.replace(/export\s+default\s+[A-Za-z_$][\w$]*\s*;?\s*$/m, '');
  } else {
    code = code.replace(/export\s+default\s+/, 'const App = ');
  }
  code = code.replace(/^export\s+(?=(const|function|class|type|interface|enum)\b)/gm, '');

  const runner = [
    'try {',
    '  var src = ' + escapeForScript(code) + ';',
    '  var out = Babel.transform(src, { filename: "App.tsx", presets: [["typescript", { isTSX: true, allExtensions: true }], "react"] }).code;',
    '  var factory = new Function("React", "ReactDOM", out + "\\n;return typeof ' + name + ' !== \\"undefined\\" ? ' + name + ' : null;");',
    '  var Component = factory(React, ReactDOM);',
    '  if (!Component) throw new Error("No default component found.");',
    '  ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(Component));',
    '} catch (e) {',
    '  document.body.innerHTML = "<pre style=\\"color:#b00020;padding:12px;white-space:pre-wrap\\">" + String(e) + "</pre>";',
    '}',
  ].join('\n');

  return (
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>html,body{margin:0;font-family:system-ui,sans-serif;background:#fff;color:#111}</style></head><body><div id="root"></div>' +
    '<script src="' + REACT_CDN + '"></script><script src="' + REACT_DOM_CDN + '"></script><script src="' + BABEL_CDN + '"></script>' +
    '<script>' + runner + '</script></body></html>'
  );
}

export default function MultiFileWorkspace({ title, files, note }: { title: string; files: WorkspaceFile[]; note?: string }) {
  const [active, setActive] = useState(0);
  const [preview, setPreview] = useState(false);
  const [copied, setCopied] = useState('');
  const previewDoc = useMemo(() => buildPreviewDoc(files), [files]);
  const file = files[Math.min(active, files.length - 1)];
  if (!file) return null;

  async function copy(text: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      window.setTimeout(() => setCopied(''), 1500);
    } catch {
      setCopied('Copy failed');
    }
  }

  return (
    <section className='glass overflow-hidden rounded-2xl' aria-label={'Workspace: ' + title}>
      <header className='flex flex-wrap items-center justify-between gap-2 px-3 py-2' style={{ borderBottom: '1px solid var(--line)' }}>
        <div className='flex items-center gap-2 text-sm font-medium'>
          <Icon name='code' size={14} />
          {title}
          <span className='text-xs font-normal text-[color:var(--muted)]'>{files.length} file{files.length === 1 ? '' : 's'}</span>
        </div>
        <div className='flex items-center gap-2'>
          {previewDoc && (
            <button type='button' className={(preview ? 'neon-btn' : 'ghost-btn') + ' inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs'} onClick={() => setPreview(!preview)}>
              <Icon name='play' size={11} />
              {preview ? 'Code' : 'Preview'}
            </button>
          )}
          <button type='button' className='ghost-btn inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs' onClick={() => void copy(files.map((f) => '// ' + f.path + '\n' + f.content).join('\n\n'), 'All copied')}>
            <Icon name='copy' size={11} />
            {copied || 'Copy all'}
          </button>
        </div>
      </header>
      <div className='scroll-thin flex gap-1 overflow-x-auto px-2 pt-2'>
        {files.map((f, i) => (
          <button key={f.path + i} type='button' onClick={() => { setActive(i); setPreview(false); }} className={(i === active ? 'neon-btn' : 'ghost-btn') + ' shrink-0 rounded-lg px-2.5 py-1 text-xs'}>
            {f.path}
          </button>
        ))}
      </div>
      {preview && previewDoc ? (
        <iframe title='Live preview' sandbox='allow-scripts' srcDoc={previewDoc} className='mt-2 h-80 w-full bg-white' />
      ) : (
        <div className='relative m-2 rounded-xl bg-black/40'>
          <button type='button' className='ghost-btn absolute right-2 top-2 rounded-lg p-1.5' onClick={() => void copy(file.content, 'Copied')} aria-label={'Copy ' + file.path}>
            <Icon name='copy' size={12} />
          </button>
          <pre className='code scroll-thin max-h-96 p-3 pr-10'>{file.content}</pre>
        </div>
      )}
      {note && <p className='px-3 pb-3 text-xs text-[color:var(--muted)]'>{note}</p>}
    </section>
  );
}
