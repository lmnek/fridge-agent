import { Fragment, type ReactNode } from "react";

/** Minimální markdown: odstavce, odrážky, **tučně** a odkazy. Nic víc agent nepotřebuje. */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s)]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith("**")) {
      out.push(
        <strong key={key} className="font-semibold text-frost">
          {tok.slice(2, -2)}
        </strong>,
      );
    } else if (tok.startsWith("[")) {
      const label = tok.slice(1, tok.indexOf("]"));
      const href = tok.slice(tok.indexOf("(") + 1, -1);
      out.push(
        <a key={key} href={href} target="_blank" rel="noreferrer" className="text-glacier underline underline-offset-2">
          {label}
        </a>,
      );
    } else {
      out.push(
        <a key={key} href={tok} target="_blank" rel="noreferrer" className="break-all text-glacier underline underline-offset-2">
          {tok.replace(/^https?:\/\//, "").slice(0, 40)}
        </a>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function RichText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split(/\n/);
  let list: string[] = [];
  const flush = (k: number) => {
    if (!list.length) return;
    blocks.push(
      <ul key={`ul-${k}`} className="my-1.5 space-y-1 pl-1">
        {list.map((li, j) => (
          <li key={j} className="flex gap-2">
            <span className="mt-[0.6em] size-1 shrink-0 rounded-full bg-glacier/70" aria-hidden />
            <span>{inline(li, `li-${k}-${j}`)}</span>
          </li>
        ))}
      </ul>,
    );
    list = [];
  };
  lines.forEach((raw, k) => {
    const line = raw.trimEnd();
    const bullet = /^\s*(?:[-•*]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      list.push(bullet[1]);
      return;
    }
    flush(k);
    if (!line.trim()) return;
    blocks.push(
      <p key={`p-${k}`} className="[&:not(:first-child)]:mt-2">
        {inline(line.replace(/^#+\s*/, ""), `p-${k}`)}
      </p>,
    );
  });
  flush(lines.length);
  return <Fragment>{blocks}</Fragment>;
}
