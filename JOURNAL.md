# distill — Dev Journal

A grow-in-public log. No polish, no marketing — just what happened, what I noticed, what's next.

---

## Day 1 · 2026-04-21 · Why I'm building this

**The morning ritual that broke me**

Every morning I read somewhere between 5 and 15 articles from my Burn bookmarks. Today it was 8. The reading itself isn't the problem — the problem is that I'm doing it across 4 apps simultaneously: browser for the original, DeepL for translation when something's in English I want to really chew on, Claude for summary and analysis, Notion for the to-dos and connections I want to capture. Each switch costs me 10-30 seconds of attention and a working-memory reset. For 8 articles that's 20+ minutes of pure context-switching tax on top of the reading. I timed it this morning and felt stupid.

**What I tried first**

Obsidian Web Clipper captures well but it's a one-way street — nothing helps me react. Readwise Reader has beautiful highlights but it's still a reader, not a workflow; the loop ends at "highlighted." Matter is the same shape. None of them close the **read → react** loop, which is where the value actually lives for me. Even Claude Code, which I already use for everything, needs me to paste each article in manually. Not a ritual. Just another tab.

**The aha**

Voice. Typing a comment after reading is 30-second friction and I skip it about 70% of the time. Speaking is 3-second friction and I'll actually do it. If my voice can go directly to Claude with the full context of what I just read, and Claude can react back inline in the same document, the loop closes. I don't think this was possible a year ago — it needed Opus 4.7-tier reasoning over long article context to be anything other than a toy. Not sure yet if voice-first is a real moat or just my personal preference; I'll know in two weeks.

**Why open source, not just a Burn feature**

The workflow is valuable to any power reader, not only Burn customers. Burn becomes the default bookmark source because that's what I dogfood, but it isn't required — any markdown list of URLs should work. Burn I've been building privately. distill I'm building in public. Time to build the surrounding ecosystem out loud, and let the audit trail be the marketing.

Reference points I'm borrowing from today: Elvis Saravia (@omarsar0) has this YouTube-to-interactive-artifact workflow I watched that clarified what "augmented" should feel like — not a summary, a reading companion. And `icebear0828/notebooklm-client` (97 stars, reverse-engineered CLI over NotebookLM's 9 media formats) is a proof that small wrappers around big models earn attention when they remove a real friction.

**The meta-experiment**

I'm developing distill itself with a main-agent + parallel-subagent + /autoresearch loop. This JOURNAL entry you're reading is being written by a subagent running in parallel with four others scaffolding the repo — src layout, README, LICENSE, package.json. Karpathy's skills repo (60k stars, read it last night) pushed me to add Surgical Changes and Goal-Driven Execution rules to CLAUDE.md this morning before starting. Whether this parallel-agent architecture is actually faster than sequential coding, or whether it just feels faster because five things happen at once, is an open question. The journal will tell.

---

**Tomorrow's plan (Wave 1)**

- Local-file fetcher reading `urls.txt` (zero dependency, no API required)
- Jina Reader wrapper for pulling article text
- The augmented markdown prompt — the actual core: original passages + Claude's insight / connect / takeaway callouts interwoven, target 30% of final word count in author's original pull quotes
- End-to-end: `echo "https://..." > urls.txt && distill fetch` → one augmented markdown file I'd actually want to re-read
