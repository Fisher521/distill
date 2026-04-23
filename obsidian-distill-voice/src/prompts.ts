export interface InteractiveCalloutPromptInput {
  filePath: string;
  question: string;
  noteContent: string;
  currentSelection: string;
  currentLine: string;
  targetLanguage: string;
}

const SYSTEM_PROMPT = `You are Distill's voice reading companion inside Obsidian.
The user is actively reading a note and has asked one spoken question.
Return exactly one JSON object matching this shape:

{
  "type": "insight" | "connect" | "artifact" | "takeaway",
  "anchor_text": string,
  "body": string
}

Field rules:
- type: choose the sharpest reaction type for the question.
- anchor_text: quote the current selection when possible; otherwise use a short exact snippet from the current line.
- body: 1 to 3 sentences, written in the target language. It must react to the reading context, not restate it.

Hard rules:
- Output only the JSON object.
- No markdown fences.
- No prose before or after the object.
- Do not invent note content that is absent from the provided note.

=== JSON FORMATTING, NON-NEGOTIABLE ===

Your output must be valid JSON parseable by JSON.parse().
Inside every string value:
  - Escape newline as \\n.
  - Escape carriage return as \\r.
  - Escape tab as \\t.
  - Escape double quote as \\".
  - Escape backslash as \\\\.
Use double quotes for keys and string values only.
Do not include trailing commas.`;

export function buildInteractiveCalloutPrompt(
  input: InteractiveCalloutPromptInput,
): { system: string; user: string } {
  const selection = input.currentSelection.trim();
  const currentLine = input.currentLine.trim();
  const user = `# Active note

Path: ${input.filePath}
Target language: ${input.targetLanguage}

## Spoken question
${input.question.trim()}

## Current selection
${selection.length > 0 ? selection : '(no selection)'}

## Current line
${currentLine.length > 0 ? currentLine : '(no current line)'}

## Full note content
${input.noteContent}

Return one Callout JSON object.`;

  return {
    system: SYSTEM_PROMPT,
    user,
  };
}
