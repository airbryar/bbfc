# BBFC league site: notes for Claude

This repository is the website for the **Boys and Bibles Football Club (BBFC)**, a 12-team
ESPN fantasy football league (league ID 965722644, season 2026). It's live at
**https://airbryar.github.io/bbfc/** and is hosted on GitHub Pages from this repo
(GitHub account `airbryar`).

If you're the scheduled **BBFC Newspaper** writer, follow your task prompt. It only
ever changes `data/news.json`; don't edit anything else.

## Who you're working with

Bryar runs the league and manages **The Mouse Rats**. He isn't a developer and built
this site through conversations with Claude, so:

- Do the work yourself. Don't hand him terminal commands or code to run.
- Explain in plain words. Mention files or code only when he asks.
- He decides by seeing things. For visual changes, show him a preview first, such as a
  screenshot at iPhone size (390px wide) in light and dark mode, then build it once he
  picks. When he says "implement it so I can see it on my phone," put it live; it's easy
  to revert.
- After publishing, confirm it's live. Be honest if you couldn't check it visually.
- Keep replies short. One or two sentences on what changed is usually right.

### Standing preferences

- **Points check / "update the site":** update it and confirm. Don't list points or
  projections in the reply.
- **Newspaper:** sports-page tone. No trash talk, mocking or roasting; he finds it corny.
  Managers' first names are fine. Facts only from league data.
- **Don't single out The Mouse Rats.** No highlighting, extra attention or favorable spin
  anywhere on the site, including Median Watch.
- **No tall, condensed display fonts** beyond the ones listed under Design. He disliked a
  tall-lettered font early on and asked that it not appear anywhere.
- **Never ask for the ESPN codes in chat.** They live only in GitHub secrets.
- **The logo:** the BBFC shield is an NFL-style shield Bryar uploaded himself. Don't
  redraw or recreate the NFL logo.
- **Easter egg:** the footer's small "Darren Waller is a bum." is a league running joke
  Bryar asked for. Leave it.

## How the site updates

`.github/workflows/update.yml`, "Update the BBFC site", does everything:

1. `scripts/fetch-espn.mjs` reads the private league from ESPN with the `ESPN_S2` and
   `ESPN_SWID` repo secrets and writes `data/espn.json`. If ESPN fails, it keeps the last
   good data and the site keeps working.
2. `scripts/fetch-trades.mjs` writes `data/trades.json` for the Trades section. Trades
   change rarely, so it only reads ESPN when its newest copy (the live site's
   `data/trades.json` or the saved one) is 55+ minutes old, and keeps that copy if ESPN
   fails. The step has `continue-on-error`, so it can't block an update.
3. `scripts/fetch-podcast.mjs` reads The Poddy's SoundCloud RSS feed (set in
   `data/league.json`) into `data/pod.json`.
4. `scripts/build.mjs` fills the placeholders in `site/template.html` (`__ESPN__`,
   `__PR__`, `__LEAGUE__`, `__POD__`, `__NEWS__`, `__LOGOS__`, `__TRADES__`,
   `__ICONV__`) and writes `_site/`, including `data/stamp.json` and `data/trades.json`.
5. The workflow then deploys `_site/` to GitHub Pages.

When it runs:

- Every 5 minutes during game windows, plus hourly the rest of the week. The crons are
  in UTC.
- During game windows (Eastern time, in `scripts/next-run.mjs`), each run starts the next
  one about 50 seconds after its ESPN read. Scores refresh about once a minute.
  `liveEveryMinute` in `data/league.json` turns this off.
- Every push to `main` triggers a run, which is how code changes go live.
- Tuesday mornings it also commits a copy of `data/espn.json`.

Open pages check `data/stamp.json` every 60 seconds and whenever the tab comes back into
view. When the data is newer, the page reloads itself and jumps back to the same scroll
spot with no visible scroll. It also keeps the Median Watch view and restores the #hash.

**GitHub Pages sometimes stalls** with "Deployment failed, try again later." The workflow
retries once on its own: it pushes an empty "Republish the site (automatic)" commit and
dispatches itself. If a change doesn't show up, check the latest Pages deployment.
Pushing another empty commit has always fixed it.

## Making a change

1. Most changes are in `site/template.html`: markup, CSS and the rendering script, all
   in one file.
2. Build with `node scripts/build.mjs`, then check `_site/index.html` in Playwright at
   390px wide, in both themes. Block outside network so it's quick, and look for page
   errors. Run `git checkout -- data` afterwards so local builds don't commit data files.
3. Commit as Bryar's account:
   `git -c user.name="airbryar" -c user.email="airbryar@users.noreply.github.com" commit ...`,
   then `git pull --rebase origin main` and push to `main`.
4. Wait for the "Update the BBFC site" run for your commit to succeed. Confirm the Pages
   deployment for that commit shows `success`.

Tooling notes from past sessions:

- The `gh` CLI only works through the REST API here. GraphQL is blocked, so dispatch
  workflows with
  `gh api -X POST repos/airbryar/bbfc/actions/workflows/<file>/dispatches -f ref=main`.
- When the conversation is linked to Bryar's Mac, the built-in browser pane is signed in
  to GitHub and ESPN. That's the best way to see the live site and take phone-size
  screenshots.

## Files

| Path | What it is |
| --- | --- |
| `site/template.html` | The whole page |
| `scripts/build.mjs` | Builds `_site/` from the template and data |
| `scripts/fetch-espn.mjs` | ESPN reader for the site |
| `scripts/next-run.mjs` | Game-window pacing |
| `scripts/fetch-trades.mjs` | Trades reader (about hourly); same trade logic as the newsroom script |
| `scripts/fetch-podcast.mjs` | SoundCloud feed reader |
| `scripts/power.mjs` | Power-rankings formula, the same one the page uses |
| `scripts/fetch-newsroom.mjs` | Gathers everything the Newspaper writer needs into `data/newsroom.json` |
| `scripts/add-edition.mjs` | Validates a Newspaper draft and adds it to `data/news.json` |
| `scripts/make-logos.mjs`, `scripts/make-brand.mjs` | Turn uploaded team pictures and the league logo into site images |
| `data/league.json` | Power-ranking weights, optional team "takes", league ID and season, podcast feed, `liveEveryMinute` |
| `data/espn.json`, `data/pod.json` | Latest league data and podcast episodes |
| `data/trades.json` | Trades with points since; a fallback copy (the live site's is usually newer) |
| `data/news.json` | Newspaper editions, newest first; the site shows the latest 6 |
| `data/newsroom.json` | The Newspaper writer's data |
| `data/logos.json`, `data/brand.json` | Team picture paths, league logo info |
| `team-pictures/`, `league-logo/` | Where Bryar uploads images on github.com, with READMEs |
| `.github/workflows/update.yml` | Updates and deploys the site |
| `.github/workflows/pictures.yml` | Runs on uploads to `team-pictures/` or `league-logo/` |
| `.github/workflows/newsroom.yml` | Refreshes `data/newsroom.json`; manual or dispatched only |

## The page

**Section order:** News (Newspaper) → Standings → Scoreboard → Median Watch → Power
Rankings → Trades → Podcast, then the footer. The sticky tab bar uses the same order:
News, Standings, Scoreboard, Median, Rankings, Trades, Podcast.

- **Tabs:** tapping a tab smooth-scrolls so that section's heading sits about 14px under
  the tab bar. This uses `scrollToSection`, not the browser's anchor jump.
  - The active tab is the last section whose top has passed the tab bar plus 72px.
  - On phones the tab bar scrolls sideways and keeps the active tab in view.
- **Spacing:** sections have `padding-block` of 48px/12px, or 36px/8px on phones.
  Bryar tuned this by eye.
- **Standings:** shows the head-to-head and median split, with a "Playoff line · Top 6
  make it" divider.
- **Median scoring:** each week the top 6 scores win a median game. A team's record
  includes median games.
- **Median Watch:** teams sorted by score, with diverging bars from the median, a cut
  line between 6th and 7th, and current-median and cut-line tiles.
  - The toggle reads **Current / Projected**; it was renamed from "Right now".
  - Live and final are marked, and there's an "Updated … · N min ago" line.
- **Scoreboard:** "Week N Scoreboard". Matchup cards with team pictures, projections and
  scores in the regular number font; the trailing score is muted.
  - Bryar tried LED segments, stadium bulbs and hand-turned plates for the scores. The
    league didn't like them, so they went back to the original font on purpose. Don't
    bring retro score fonts back unless he asks.
- **Power Rankings:** Record 30%, Scoring 35%, Form 20% (last 3 weeks), Schedule 15%.
  Each part is min-max scaled to 0–100 and blended; the weights are in
  `data/league.json`.
  - Rankings use finished weeks only, so they change when a week goes final (Tuesday),
    labeled "After week N".
  - There's a "How the formula works" explainer and per-team breakdowns.
- **Newspaper:**
  - **Layout:** the latest edition's bar ("Friday Edition | Nov 6, 2026 · Week 9"), a
    lead story with its first paragraph and "Keep reading", two more stories behind "Read
    story", and an "Earlier editions" list.
  - **Fonts:** stories use Newsreader, a newspaper serif. Headlines are bold serif in
    normal case, deks are italic, and the lead has a drop cap.
- **Trades** (added Nov 2026): tiles for the season's trade count and a deadline
  countdown ("Deadline · Dec 2" / "26 days", then "Passed"), then one card per trade,
  newest first. The four newest show; the rest sit under "Earlier trades (N)".
  - Each card: "Week N · date" and "Pts since trade", then each team with the players it
    got. Points count only weeks the player was in that team's starting lineup, finished
    weeks only (tag "Through Week N"). A dash means no starts since.
  - Like the Scoreboard, the side ahead is in ink and the other is muted. No "won" or
    "fleeced" labels.
  - A side that got no players got FAAB in this league (Bryar confirmed), so the card says
    "FAAB" there. The trade data has no dollar amounts.
- **Podcast:** "BBFC Presents: The Poddy" from SoundCloud. The newest episode is clearly
  featured; in dark mode it sits on a navy card so it stands out.
- **Footer:** the club name, the ESPN updated time, a "Match my phone's light/dark
  setting" link (shown only after a manual theme choice), and the easter egg.

### Design

- **Fonts** (Google Fonts):
  - Barlow for body text
  - Barlow Condensed for labels and all numbers (Bryar chose it)
  - Saira Condensed for headings (Bryar chose it)
  - Newsreader for Newspaper stories
- **Light mode:** navy masthead with a red ribbon. Tokens on `:root`: `--bg #F3F5F9`,
  `--surface #FFF`, `--ink #101A2C`, `--accent #C21F32`, `--band #13294B`, `--up #23794A`,
  `--down #B3342B`.
- **Dark mode:** modeled on the ESPN Fantasy app. `--bg #101112`, `--surface #1D1E1E`,
  `--muted #A1A2A3`, `--accent #FF5A68`, `--gilt #658EEF`, `--band #000`, `--up #65B752`,
  `--down #EF8682`, `--feature #1B3766`.
- **Theme:** follows the phone's setting by default. The sun/moon button at the top right
  overrides it, saved in `localStorage` under `bbfc-theme`, and the footer link resets it.
- **Color meaning:** green means above the median or winning, and red means below or
  losing. Don't use either as decoration.
- **Phones first:** everyone in the league is on iPhone, and many add the site to their
  home screen. The league logo is also the home-screen icon.

## Newspaper

The **BBFC Newspaper** scheduled task (`trig_01MHdDzVwGDM43saxpx6efob`) runs in the
cloud, without Bryar's Mac, at 7:37 AM Eastern on Tuesday, Thursday and Saturday. Each
run:

1. Dispatches `newsroom.yml` to refresh `data/newsroom.json`.
2. Writes three stories from that data. The focus depends on the day:
   - Tuesday: a recap of the week that just finished
   - Thursday: trades, waivers, trends and history
   - Saturday: a preview of the weekend
3. Validates them with `node scripts/add-edition.mjs draft.json`. That requires exactly 3
   stories, each with:
   - a kicker of 32 characters or fewer
   - a 10–90 character headline
   - a dek of 170 characters or fewer
   - 3–8 paragraphs and 250–520 words
4. Pushes `data/news.json` and sends Bryar the headlines.

Other notes:

- The league data uses managers' first names only. Past seasons' team names are left out
  on purpose.
- Champions: Tyler in 2023, Jared in 2024 and Tyler in 2025.
- Bryar's ESPN sign-in codes may expire. If ESPN starts returning 401, he needs to update
  the `ESPN_S2` and `ESPN_SWID` secrets in GitHub himself.

## Uploads Bryar does himself

- **Team pictures:** he uploads to `team-pictures/` on github.com, named after the team;
  see that folder's README. `pictures.yml` makes 128px WebP badges and republishes.
- **League logo:** he uploads to `league-logo/`. `make-brand.mjs` makes the header logo,
  the favicon and the 180px home-screen icon.

## History

- The site started as a Claude artifact
  (https://claude.ai/artifact/La2absYLbqZfcZLTrqhHE4), which now says "The BBFC site has
  moved" and links here.
- The old artifact-era scheduled tasks ("BBFC Sunday scores", "BBFC Thursday and Monday
  night scores", "BBFC Tuesday final update", "BBFC podcast check") are disabled and
  obsolete. GitHub Actions does their jobs now.
- Bryar's other scheduled tasks, such as the Playback setlist and Spotify playlist ones,
  have nothing to do with this site. Leave them alone.
