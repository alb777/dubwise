# ops task

Weekly audit of the dubwise repository.

1. Read `AGENTS.md`.
2. Run `npm ci`, `npm test` and `npm run check`. Report only real failures, with the command
   output that proves them.
3. Compare the docs with the code: `README.md`, `AGENTS.md`, `llms.txt`, `skills/dubwise/SKILL.md`
   and the commands they list.
4. Check `.github/workflows/ci.yml` still runs what `AGENTS.md` claims, and that the betoai
   workflows have not drifted from `hq`'s `agent-run.yml` shape.
5. Open at most three issues, one per finding, with evidence. If everything holds, open nothing
   and say so in one line.
