import type { Editor } from 'obsidian';
import type { Callout, CalloutType } from './distill-compat.js';

interface CalloutStyle {
  admonition: string;
  label: string;
}

const CALLOUT_STYLES: Record<CalloutType, CalloutStyle> = {
  insight: { admonition: 'note', label: 'Insight' },
  connect: { admonition: 'info', label: 'Connect' },
  artifact: { admonition: 'tip', label: 'Artifact' },
  takeaway: { admonition: 'important', label: 'Takeaway' },
};

export function renderCalloutBlock(callout: Callout): string {
  const style = CALLOUT_STYLES[callout.type];
  const body = callout.body
    .trim()
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n');

  return `> [!${style.admonition}] ${style.label}\n${body}`;
}

export function insertCalloutAtCursor(editor: Editor, callout: Callout): void {
  const block = renderCalloutBlock(callout);
  const insertionPoint = editor.getSelection().length > 0 ? editor.getCursor('to') : editor.getCursor();
  const prefix = insertionPoint.ch === 0 ? '' : '\n\n';
  const suffix = '\n\n';
  editor.replaceRange(`${prefix}${block}${suffix}`, insertionPoint);
}
