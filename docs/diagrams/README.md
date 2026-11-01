# Diagram sources

These are editable [Mermaid](https://mermaid.js.org/) sources for the diagrams
in [the Murmur technical paper](../murmur-paper.md). GitHub renders the fenced
Mermaid blocks in the paper directly; the `.mmd` files are here for reuse,
review, and export.

| File | Shows |
| --- | --- |
| `system-context.mmd` | Deployment and data-plane boundaries: Actions, relay, sources, Pages, browser, IndexedDB |
| `build-pipeline.mmd` | Hourly cache build, previous-cache retention, model call, artifact and failure gates |
| `browser-runtime.mmd` | Boot, ten-minute refresh, validation, idempotent persistence, and the thirty-second mood clock |
| `mood-model.mmd` | Eligibility, news slots, single-source picks, decay, aggregation, and the calm fallback |
| `mood-budgets.mmd` | Source-group budget shares |
| `data-model.mmd` | IndexedDB observations, reactions, source states, and metadata |

Render one locally without changing the project dependencies:

```bash
npx --yes @mermaid-js/mermaid-cli -i docs/diagrams/mood-model.mmd -o mood-model.svg
```

The paper is the canonical explanation. If the implementation changes the
diagram should change with it.
