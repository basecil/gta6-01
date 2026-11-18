# gta6-01

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/basecil/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/basecil/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

**NEON BAY** — an open-world crime game that runs in a browser tab. You are a wheelman for hire in a neon-lit harbour city: steal a courier van off the marina lot, run three drops before the crew wakes up, and keep the bay police off your bumper. The city is generated from a seed (six-by-six blocks of towers, signage, piers and traffic), the cars drive with arcade physics, pedestrians scatter when you draw a pistol, and the wanted stars climb from 1 to 5 as the heat builds. Built with three.js, vendored locally, no network calls at runtime.

8-job story arc with briefings, a playable first mission, day/night clock, minimap, save/continue, pause and a one-click Demo that drops you into a three-star police chase. The three new jobs are Searchlight (a helicopter pursuit and escape), Dead Water (a harbor heist) and Rooftop Getaway (the finale). The city is split into five districts - Downtown, Harbor, Beachfront, Hills and Airport: crossing into a new district shows an on-entry district banner with its name for about 3 seconds, and the minimap labels every district.

Once you hit three stars the police helicopter joins the chase: it orbits the player and sweeps a night searchlight cone across the street, with a matching pool of light on the ground and an AIR SUPPORT HUD chip that tracks it.

All art, code, city and characters are original.

## Run it

```sh
node serve.ts
# then open http://localhost:8080
```

Or serve `game/` with any static file server and open `index.html` — it is a single-page static build that loads ES modules and a vendored copy of three.js. `node main.ts` writes the submission output (game/, screenshots/, dossier.json) to `$MAKEFUN_OUTPUT_DIR` (default `/output`).

---

<sub>Entered on [make.fun](https://make.fun/?ref=f4vwp3aw&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
