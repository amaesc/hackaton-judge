# Hackathon Judge v4

Mobile-first hackathon judging web app with **panels (judge groups)**, **self-paced phases**, **multi-hackathon**, **judge↔team assignments**, **rubric templates**, **multi-phase brackets**, **real-time dashboard**, and **EN/ES + light/dark** UI.

## What's new in v4

- **Panels (judge groups)**: Create named panels ("Technical Panel", "Business Panel"), assign a set of teams each panel evaluates, then drop judges into the panel. Every judge in the panel inherits the panel's team access. Panels COEXIST with per-judge individual assignments (union semantics).
- **Self-paced phases**: When creating or editing a phase, toggle "Self-paced". In that mode, judges see a list of all the teams they can evaluate, each with a green ✓ if already scored. No admin-coordinated "currently presenting" team needed.

## Inherited from v3

- Multiple hackathons in parallel
- Judge↔hackathon membership (one account, many hackathons)
- Judge↔team assignments (manual + auto-split)
- Rubric templates (Sections → Criteria → Rubric Levels)
- Phases, live leaderboard, race dashboard
- EN/ES i18n + Light/Dark/Auto theme
- Real-time admin updates via Server-Sent Events

## Stack

Node.js 22+ + Express + SQLite (built-in `node:sqlite`), vanilla HTML/CSS/JS, port 3001.

## Run

```bash
npm install
npm start
```

Open <http://localhost:3001>. Admin: `admin` / `admin123` (change immediately from Account tab). On first run, "Tech4Good 2026" is seeded with the Tech4Good rubric + three phases.

## Panels

Go to the **Panels** tab (hackathon-scoped). Create a panel, tap **Edit panel**:
- Check the teams this panel evaluates → **Save teams**
- Check the judges who should be in this panel → **Save judges**

Adding a judge to a panel automatically adds them to the hackathon if they weren't a member already.

Access rule: a judge can evaluate a team if (1) they have no restrictions at all (seen all teams — backward compat), OR (2) an individual `judge_team_assignments` row matches, OR (3) they're in a panel that has the team. Union semantics.

## Self-paced phases

Tick the "Self-paced" checkbox when creating or editing a phase. In a self-paced phase:
- The admin does NOT set an active team. All assigned judges are unblocked simultaneously.
- Judges see a scrollable list of all teams they can score in this phase, with a green ✓ next to each already-scored one.
- They tap a team → rubric form → submit → back to list. Repeat at their own pace.

Switching a phase from admin-controlled to self-paced mid-event is safe. Previously submitted scores stay valid.

## Data model additions

```
panels             (id, hackathon_id, name, description)
panel_teams        (panel_id, team_id)
panel_judges       (panel_id, judge_id)
phases.self_paced  INTEGER NOT NULL DEFAULT 0
```

## Reset

```bash
rm data/app.db*
npm start
```

## License

MIT.
