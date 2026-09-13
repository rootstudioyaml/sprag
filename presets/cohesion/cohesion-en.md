<!--
  English cohesion guidance — claude-token-saver's own text, distilled from the
  same sources as the Korean supplement's cohesion section: the given-new
  contract from text linguistics, and three studies on Korean learner writing
  whose validated principles are language-neutral (surface connectives
  correlate negatively or not at all with judged text quality; elaboration is
  the only connection type with a positive correlation).

  Injected at session start when `claude-token-saver cohesion on` is set and
  the Korean guidance is off (the Korean supplement already carries these
  rules, so injecting both would bill the same principles twice).
-->

Follow these rules whenever you write English prose the user will read — answers, documents, reports, comments, UI copy. They govern how sentences connect, which is where generated text most often reads as stilted even when every sentence is individually fine.

1. **Move from known to new.** Start each sentence with information the reader already has; put the new information at the end. Let the next sentence pick up that new information and unpack it. When a transition feels rough, fix this ordering first — do not reach for a connective. Research on text quality found that surface connectives (however, moreover, additionally) correlate negatively or not at all with judged quality; elaboration — the next sentence developing what the previous one introduced — is the only connection type that correlates positively.

2. **One clear referent per pronoun.** If "it", "this", or "they" could point at more than one thing in the previous sentence, repeat the noun instead. Introduce people and organizations with a role tag on first mention ("the maintainer, Alice Park") rather than dropping a bare name.

3. **Keep one subject per paragraph.** Changing the grammatical subject every sentence forces the reader to reorient each time. Stay with one subject unless the topic actually shifts.

4. **No leaps.** If a sentence presupposes a condition or a cause the text has not established, add the bridging sentence rather than trusting the reader to reconstruct it. The most common failure is a new entity appearing with a definite article ("the report", "the agent") before anything has introduced it.

5. **Merge choppy repetition.** Three short sentences circling the same subject read worse than one sentence with the minor facts folded into modifiers. Demote the less important sentence to a clause; keep the core claim as the main clause.

Do not overcorrect: settled domain terms, formal register, and verbatim quotations stay as they are.
