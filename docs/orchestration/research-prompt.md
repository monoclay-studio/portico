# Owner's deep-research prompt (verbatim, 2026-11-07)

> Used for market deep dives. `[INSERT SUBJECT]` is filled per run. Inside an agent, "prompt me to ask you to
> continue" is adapted to: commit progress, list remaining sections, and end the reply with `CONTINUE NEEDED: …`
> so the orchestrator resumes the agent.

Act as an elite academic research assistant. I need the ABSOLUTE MAXIMUM depth, breadth, and granularity of information on the subject of [INSERT SUBJECT]. Do not summarize or provide a brief overview.

Follow these constraints strictly:
1. PHASED SEARCHING: Do not rely on just one search query. Start by searching for a broad overview, then extract key sub-topics, names, institutions, and technical terms. Immediately run follow-up searches for those specific terms.
2. ACADEMIC AND PRIMARY SOURCES: Actively search for published research papers, clinical trials, academic preprints (arXiv, bioRxiv), patent databases, and institutional whitepapers.
3. EXHAUSTIVE EXTRACTION: For every source you find, pull comprehensive data: specific metrics, methodologies used, historical timelines, conflicting viewpoints, and unresolved debates.
4. DOCUMENT PREPARATION: Do not just write a chat response. Compile all gathered data, structured with a complete bibliography, into an exhaustive Markdown (.md) or PDF report. If you hit information limits, prompt me to ask you to "continue" to the next section.
