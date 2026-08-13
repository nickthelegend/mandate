"use client";

/**
 * A file, shown as a file.
 *
 * The SDK tab used to be a `<pre>`, which is fine for copying and useless for
 * explaining: a reader cannot be pointed at line 34 of a block with no line
 * numbers, and "the policy is read from the chain" is a claim about a specific
 * three lines rather than about a wall of code. This adds the chrome a person
 * already knows how to read — a filename, a gutter, highlighting — and marks
 * the five steps so each one can be addressed on its own.
 *
 * The highlighter is about forty lines and deliberately so. Shipping a
 * syntax-highlighting library to colour one static file is a lot of bytes for a
 * page whose job is to be read once, and this file's grammar is known: imports,
 * strings, comments, numbers, and a handful of keywords.
 */

import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { cn } from "@/lib/utils";

export type Step = {
  /** 1-based, inclusive line range this step covers. */
  from: number;
  to: number;
  label: string;
};

/*
 * Non-capturing on purpose. `String.split` with a regex returns every capture
 * group alongside each match, so a nested `(a|b)` inside the splitter's own
 * group emits the keyword twice and the line renders as `constconst`.
 */
const KEYWORDS =
  /\b(?:import|from|export|const|let|await|async|function|return|if|else|throw|new|process|typeof)\b/g;

/**
 * Tokenise one line for display.
 *
 * Order matters and is the whole trick: comments and strings are taken first
 * and their contents are never scanned again, so a keyword inside a string —
 * or the word `const` inside a sentence in a comment — is not coloured as code.
 */
function highlight(line: string, key: number) {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
    return (
      <span key={key} className="text-[#6b7f6e]">
        {line}
      </span>
    );
  }

  const out: React.ReactNode[] = [];
  /* Strings first, so nothing inside quotes is tokenised further. */
  const parts = line.split(/(`[^`]*`|"[^"]*"|'[^']*')/g);
  parts.forEach((part, i) => {
    if (!part) return;
    if (/^[`"']/.test(part)) {
      out.push(
        <span key={`${key}-${i}`} className="text-[#c98a5e]">
          {part}
        </span>
      );
      return;
    }
    const chunks = part.split(new RegExp(`(${KEYWORDS.source}|\\b\\d[\\d_.e]*n?\\b)`, "g"));
    chunks.forEach((c, j) => {
      if (!c) return;
      const k = `${key}-${i}-${j}`;
      if (new RegExp(`^(${KEYWORDS.source})$`).test(c)) {
        out.push(
          <span key={k} className="text-[#d98a72]">
            {c}
          </span>
        );
      } else if (/^\d/.test(c)) {
        out.push(
          <span key={k} className="text-[#9db4c0]">
            {c}
          </span>
        );
      } else {
        out.push(<span key={k}>{c}</span>);
      }
    });
  });
  return <span key={key}>{out}</span>;
}

export function CodeEditor({
  filename,
  code,
  steps = [],
}: {
  filename: string;
  code: string;
  steps?: Step[];
}) {
  const [copied, setCopied] = useState(false);
  const lines = code.split("\n");
  const stepOf = (n: number) => steps.find((s) => n >= s.from && n <= s.to);

  return (
    <div className="overflow-hidden rounded-[14px] border border-[#2a2c33] bg-[#15161B]">
      <div className="flex items-center justify-between gap-3 border-b border-[#2a2c33] px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="flex gap-1.5">
            {["#e0685a", "#d9a441", "#63a375"].map((c) => (
              <span key={c} className="size-2.5 rounded-full" style={{ background: c }} />
            ))}
          </span>
          <span className="figure ml-2 rounded-md bg-[#1e2027] px-2.5 py-1 text-[11.5px] text-white/80">
            {filename}
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          }}
          className="figure flex items-center gap-1.5 text-[11.5px] text-white/40 transition-colors hover:text-white"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "copied" : "copy"}
        </button>
      </div>

      <div className="no-scrollbar overflow-x-auto">
        <table className="w-full border-separate border-spacing-0">
          <tbody>
            {lines.map((l, i) => {
              const n = i + 1;
              const step = stepOf(n);
              const first = step && step.from === n;
              return (
                <tr
                  key={n}
                  id={`L${n}`}
                  data-line={n}
                  data-step={step ? String(steps.indexOf(step) + 1) : undefined}
                  className={cn(step && "bg-[#191b22]")}
                >
                  <td
                    className={cn(
                      "figure w-[46px] select-none border-r px-3 py-[3px] text-right align-top text-[11px] text-white/25",
                      step ? "border-[var(--brand)]" : "border-[#22242b]"
                    )}
                  >
                    {n}
                  </td>
                  <td className="figure whitespace-pre px-4 py-[3px] text-[12px] leading-[1.55] text-white/85">
                    {first && (
                      <span className="figure mr-2 rounded bg-[var(--brand)] px-1.5 py-[1px] text-[9.5px] font-semibold tracking-wide text-white">
                        {step.label}
                      </span>
                    )}
                    {highlight(l || " ", n)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
