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
  anywhere on the site, including Median Watch. (The per-viewer "My team" highlight is
  different: each person picks their own team in Settings, and nothing is picked by
  default. Never pre-set it.)
- **No tall, condensed display fonts** beyond the ones listed under Design. He disliked a
  tall-lettered font early on and asked that it not appear anywhere.
- **Never ask for the ESPN codes in chat.** They live only in GitHub secrets.
- **The logo:** the BBFC shield is an NFL-style shield Bryar uploaded himself. Don't
  redraw or recreate the NFL logo.
- **Easter egg:** the footer's small "Darren Waller is a BUM!" (Bryar's wording, Nov 2026) is a league running joke
  Bryar asked for. Leave it.

## How the site updates

`.github/workflows/update.yml`, "Update the BBFC site", does everything:

1. `scripts/fetch-espn.mjs` reads the private league from ESPN with the `ESPN_S2` and
   `ESPN_SWID` repo secrets and writes `data/espn.json` (including `seedingRule`, the
   league's tiebreaker, which the playoff odds follow). If ESPN fails, it keeps the last
   good data and the site keeps working.
2. `scripts/fetch-lineups.mjs` writes `data/lineups.json` (both lineups for every game this
   week) for the matchup details sheet; `continue-on-error`. It reads the fantasy box scores
   plus ESPN's public NFL scoreboard for opponents, kickoffs and live game clocks (the
   fantasy NFL schedule is only a backup). If ESPN fails, it keeps the live site's copy.
   Then `scripts/fetch-trades.mjs` writes `data/trades.json` for the Transactions section:
   the trades, plus the Waiver Wire (`faab`: budget and each team's FAAB left; `pickups`:
   this week's and last week's waiver claims and free-agent adds with bids). It only reads
   ESPN when its newest copy (the live site's `data/trades.json` or the saved one) is 55+
   minutes old (`FORCE_TRADES=1` skips that; a manual run with the `trades` input set does
   the same: `gh api -X POST repos/airbryar/bbfc/actions/workflows/update.yml/dispatches -f ref=main -f 'inputs[trades]=true'`), and keeps that copy if ESPN fails. The step
   has `continue-on-error`, so it can't block an update.
3. `scripts/fetch-podcast.mjs` reads The Poddy's SoundCloud RSS feed (set in
   `data/league.json`) into `data/pod.json`.
4. `scripts/build.mjs` fills the placeholders in `site/template.html` (`__ESPN__`,
   `__PR__`, `__LEAGUE__`, `__POD__`, `__NEWS__`, `__LOGOS__`, `__TRADES__`, `__ODDS__`,
   `__ICONV__`) and writes `_site/`, including `data/stamp.json` and `data/trades.json`.
   It computes the playoff odds with `scripts/odds.mjs` on every build, and builds
   `_site/team.html` from `site/team.html` (`__ESPN__`, `__ODDS__`, `__TEAMX__` for power
   ranks and top players, `__TRADES__`, `__HISTORY__`, `__LOGOS__`, `__ICONV__`).
   It also builds `_site/record-book.html` from `site/record-book.html` (`__HISTORY__`,
   `__ESPN__`, `__LOGOS__`, `__ICONV__`); without `data/history.json` it skips the Record
   Book and removes its links (between `<!--book-->` markers).
5. The workflow then deploys `_site/` to GitHub Pages.

When it runs:

- Every 5 minutes during game windows, plus hourly the rest of the week. The crons are
  in UTC.
- During game windows (Eastern time, in `scripts/next-run.mjs`), each run starts the next
  one about 50 seconds after its ESPN read. Scores refresh about once a minute.
  `liveEveryMinute` in `data/league.json` turns this off.
- Every push to `main` triggers a run, which is how code changes go live.
- Tuesday mornings it also commits a copy of `data/espn.json`.

**New week on Wednesdays** (Nov 2026, Bryar asked): ESPN starts the new week early Tuesday
(Nov 10: between 2:48 and 4:27 AM ET), but on Tuesdays (Eastern) the pages and the lineups
sheet keep showing the week that just finished, marked "Final" ("Final scores. Week N goes
up Wednesday."), as long as the new week has no points. `scripts/show-week.mjs`
(`shownWeek` in `build.mjs`, `holdingLastWeek` in `fetch-lineups.mjs`). The playoff odds,
alerts and Newspaper use ESPN's real week. `"newWeekOnWednesday": false` in
`data/league.json` turns it off.

Open pages check `data/stamp.json` every 60 seconds and whenever the tab comes back into
view. When the data is newer, the page refreshes **in place** (Nov 2026; full reloads made
iPhones visibly scroll from the top back to the reader's spot every minute): it fetches the
new copy, swaps in its `<body>` and runs the page script (`<script id="page-js">`) again,
all in one step, so nothing scrolls or flashes. The scroll spot, the Median Watch and
Standings views, open folds (`<details>`, by id or title) and the #hash carry over through
`sessionStorage` `bbfc-keep`. Everything the script attaches to window/document goes
through `on()` / `every()` so the old run is switched off first (`window.__bbfcOff`), and
`GEN` / `window.__bbfcGen` makes leftover timers from an old run do nothing; use those for
any new page-wide listener or timer. OneSignal starts once per visit (`window.__bbfcOS`).
If the new copy's page script or `<style>` differs (a code change), it does a full reload
instead.

**GitHub Pages sometimes stalls** with "Deployment failed, try again later." The workflow
retries once on its own: it pushes an empty "Republish the site (automatic)" commit and
dispatches itself. If a change doesn't show up, check the latest Pages deployment.
Pushing another empty commit has always fixed it.

It can also stall silently: on Nov 8, 2026, every deploy from 9:15 AM on reported
`success` while the live site stayed on the 8:28 AM version (same commit all morning), so
scores froze during the London game until a fresh empty commit. `scripts/check-live.mjs`
now runs after each deploy: if the live `data/stamp.json` is 5+ minutes behind the build,
it pushes "Republish the site (automatic: the live site stopped changing)", at most once
every 15 minutes. To see what the live site serves from here, curl it from a temporary
workflow on a branch (this session's shell and WebFetch can't reach github.io).

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
| `scripts/show-week.mjs` | Keeps last week's finals up on Tuesdays (new week on Wednesday) |
| `scripts/check-live.mjs` | After each deploy, republishes if the live site stopped changing |
| `scripts/fetch-trades.mjs` | Trades and Waiver Wire reader (about hourly); same trade logic as the newsroom script |
| `site/sw-offline.js` | The offline copy, added to the service worker by `build.mjs` |
| `scripts/fetch-lineups.mjs` | This week's lineups for the matchup details sheet (every update) |
| `scripts/fetch-podcast.mjs` | SoundCloud feed reader |
| `scripts/fetch-history.mjs` | Reads past seasons into `data/history.json` for the Record Book |
| `site/record-book.html` | The Record Book page |
| `scripts/power.mjs` | Power-rankings formula, the same one the page uses (also gives team pages their rank) |
| `scripts/odds.mjs` | Playoff odds: 10,000 simulations of the rest of the regular season |
| `site/team.html` | Team pages (one page; `team.html?t=<team id>`) |
| `scripts/fetch-newsroom.mjs` | Gathers everything the Newspaper writer needs into `data/newsroom.json` |
| `scripts/add-edition.mjs` | Validates a Newspaper draft and adds it to `data/news.json` |
| `scripts/make-logos.mjs`, `scripts/make-brand.mjs` | Turn uploaded team pictures and the league logo into site images |
| `data/league.json` | Power-ranking weights, optional team "takes", league ID and season, podcast feed, `liveEveryMinute` |
| `data/espn.json`, `data/pod.json` | Latest league data and podcast episodes |
| `data/trades.json` | Trades with points since; a fallback copy (the live site's is usually newer) |
| `data/lineups.json` | Written fresh each update and published; not saved in the repo |
| `data/history.json` | Past seasons' standings and every game's score, managers as m1, m2... with first names only |
| `data/news.json` | Newspaper editions, newest first; the site shows the latest 6 |
| `data/newsroom.json` | The Newspaper writer's data |
| `data/logos.json`, `data/brand.json` | Team picture paths, league logo info |
| `team-pictures/`, `league-logo/` | Where Bryar uploads images on github.com, with READMEs |
| `.github/workflows/update.yml` | Updates and deploys the site |
| `.github/workflows/pictures.yml` | Runs on uploads to `team-pictures/` or `league-logo/` |
| `.github/workflows/newsroom.yml` | Refreshes `data/newsroom.json`; manual or dispatched only |
| `.github/workflows/history.yml` | Refreshes `data/history.json`; monthly (3rd) or dispatched |

## The page

**Section order:** News (Newspaper) → Standings → Power Rankings → Scoreboard → Median
Watch → Transactions → Podcast, then the footer. Power Rankings moved up next to Standings
in Nov 2026 so one bottom-bar button covers both.

- **Bottom bar** (Nov 2026; replaced the sticky top tabs, which had gotten crowded): five
  app-style buttons fixed to the bottom of the screen, icon over label: News, Standings
  (covers Power Rankings), Scores (Scoreboard and Median Watch), Moves (Transactions;
  it read "Trades" until Nov 2026), Podcast. Each
  link's `data-for` lists the sections it covers.
  - Tapping one smooth-scrolls so that section's heading sits about 14px under the top of
    the screen (below the phone's status bar). This uses `scrollToSection`, not the
    browser's anchor jump.
  - The lit button is for the last section whose top has come within 72px of the top of
    the screen; at the very bottom of the page, Podcast.
  - `body` has bottom padding so the footer clears the bar.
- **Record Book pill:** a labeled "Record Book ›" pill in the masthead's lower right
  corner, level with "Through Week N", opens the Record Book. It was first an icon beside
  the light/dark button, but Bryar felt it didn't belong with the settings buttons, and
  chose the pill alone, without a link card under Standings (Nov 2026).
- **Settings** (Nov 2026): the masthead's only corner button is a gear that opens a
  Settings sheet from the bottom. Bryar wanted personal options in one place rather than
  separate bell and light/dark buttons. Sections:
  - **My team:** a team picker, saved on that phone (`localStorage` `bbfc-my-team`).
    Closing the sheet after a change redraws the page in place (`reloadKeepingPlace`).
    Team pages also have a ★ "My team" button that sets the same value.
  - **Appearance:** Match phone / Light / Dark (`localStorage` `bbfc-theme`).
  - **Alerts:** see the Alerts section (between `<!--alerts-->` markers).
- **My team highlight:** for that viewer only, their team's row gets a soft blue tint
  (`--mine`) and a `--gilt` bar on the left in Standings, the playoff odds, Power Rankings
  and Median Watch; on the Scoreboard their game comes first, outlined, labeled "My game"
  with a "Team page ›" link. Bryar knows his own screenshots will show it if he sets it.
- **Spacing:** sections have `padding-block` of 48px/12px, or 36px/8px on phones.
  Bryar tuned this by eye.
- **Standings:** shows the head-to-head and median split, with a "Playoff line · Top 6
  make it" divider.
  - A **Table / Playoff odds** toggle (Nov 2026; kept across automatic refreshes). The odds
    view lists teams by playoff chance with projected record, first-round bye chance and a
    bar, a "Playoff line · top 6" divider and a "How the odds work" explainer. Shows
    ">99%" / "<1%" rather than 100% / 0% unless the team has mathematically clinched or
    been eliminated, which get green "Clinched" / red "Eliminated" tags (on their own line
    under the name, in both the odds view and the Table).
  - **What it takes** (Nov 2026): when the math says one result this week would settle a
    team's spot, a plain green/red line under it says so ("Clinches with a 2–0 week",
    "Clinches with a win", "Needs a 2–0 week to stay alive", "Eliminated with an 0–2
    week"); team pages show the same line under This Week. Bryar didn't want the
    per-result percentages, so nothing shows otherwise. `odds.mjs` gives each team
    `week` (best result first): "in" / "out" when guaranteed, else the simulated chance.
  - Odds (`scripts/odds.mjs`): each team's scores are drawn around its average so far,
    pulled 20% toward the league average, with the league's week-to-week swing; the week
    in progress uses ESPN's live projections, narrowing as games finish, so the odds move
    during games. Median games count. Ties follow ESPN's `seedingRule`. Seeded, so the
    same data gives the same odds. Hidden once the regular season ends.
- **Team names** in Standings, the Scoreboard and the odds view link to that team's page.
- **Median scoring:** each week the top 6 scores win a median game. A team's record
  includes median games.
- **Median Watch:** teams sorted by score, with diverging bars from the median, a cut
  line between 6th and 7th, and current-median and cut-line tiles.
  - The toggle reads **Current / Projected**; it was renamed from "Right now".
  - Live and final are marked, and there's an "Updated … · N min ago" line.
  - **Tap a team** (Nov 2026; "Tap a team for its lineup." under the chart) to open the
    lineups sheet for just that team: its score, projection and "N to play", where it sits
    ("4th of 12", "+9.98 vs median", in the same Current/Projected view), its starters
    (slot, player, game status, points over projection) and a folded Bench, plus a "Team
    page ›" link. Same sheet and data as Matchup details (`openTeamLineup`).
- **Scoreboard:** "Week N Scoreboard". Matchup cards with team pictures, projections and
  scores in the regular number font; the trailing score is muted.
  - **Matchup details** (Nov 2026): each card has a small "›" on its right edge, and the
    line under the heading says "Tap a game for lineups." (A full-width "Lineups ›" row
    made the cards too tall; Bryar wants all six games on one phone screen, so keep the
    cards at their original height.) Tapping the card (anywhere but a team name) opens a
    sheet with both lineups, ESPN-style: team
    scores, projections and "N to play" at the top, then starters facing each other slot
    by slot (short names like "J. Gibbs", "SEA D/ST"; second line "@ MIA · Sun 1p", the
    live clock with a red dot, "Final" or "Bye"; injury tags Q/D/O/IR; points with the
    projection underneath), and the bench in a collapsed "Bench" list.
  - **Win chance** (Nov 2026) under the two scores in that sheet: "57% · Win chance · 43%"
    and a bar (favored side `--gilt`), from each side's live projection with a spread that
    grows with the points still to play (`winK`, sized from the league's weekly swing).
    Hidden once both sides are done. Bryar didn't want it on team pages.
  - The page downloads `data/lineups.json` (~28 KB) only when a game is opened, and
    refreshes it every 60 seconds while the sheet is open. While any sheet is open the
    page doesn't auto-reload; it checks again when the sheet closes.
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
- **Transactions** (bottom-bar button "Moves"; added Nov 2026 as the Trade Center, renamed
  when the Waiver Wire joined it; Bryar picked the name): tiles for the season's trade count and a deadline
  countdown ("Deadline · Dec 2" / "26 days", then "Passed"), then one card per trade,
  newest first. The three newest show; the rest sit under "Earlier trades (N)".
  - Each card: "Week N · date" and "Pts since trade", then each team with the players it
    got. Points count only weeks the player was in that team's starting lineup, finished
    weeks only (tag "Through Week N"). A dash means no starts since.
  - Like the Scoreboard, the side ahead is in ink and the other is muted. No "won" or
    "fleeced" labels.
  - **Pending trades** (Nov 2026, Bryar asked: "it's breaking news"): the league has a
    24-hour review (5 veto votes), and ESPN only adds a trade to the activity feed once it
    goes through. So `fetch-trades.mjs` also reads `view=mPendingTransactions` into
    `pending` (accepted `at`, `goesThrough`, who gets whom). The page crawls them in the
    ticker with a "Pending" tag, puts a blue-outlined "Pending / Goes through Thu 9:10 AM"
    card above the trades (no points; the top line stays on one line, so no date), and
    lights the "new" dot; they don't
    count in the trade tile. `notify.mjs` sends one alert ("… Pending league review until
    Wed 4:44 PM.") and records it in `pending` in `data/alerts-sent.json`; when the same
    deal goes through it's recorded without a second alert. A vetoed trade just drops off.
    The league manager can uphold a trade early (Stroud/Charbonnet was upheld 5 hours in),
    and it moves to the regular list on the next trade read.
    Pending trades show up on the hourly trade read, or right away with a manual run with
    the `trades` input. Team pages don't show them.
  - A side that got no players got FAAB in this league (Bryar confirmed), so the card says
    "FAAB" there. ESPN doesn't record the dollars, so when Bryar gives an amount ("$3 for
    Tre Tucker"), add it to `tradeFaab` in `data/league.json`
    (`{ "player": "Tre Tucker", "from": "The House Cats", "amount": 3 }`: the team that sent
    the player got the money). `scripts/trade-faab.mjs` marks the trade (or pending trade)
    with `faab`, and the card, ticker, team pages and alerts say "$3 FAAB".
  - Trade and pickup dates are Eastern (they were UTC until Nov 2026, so evening deals
    showed the next day). `notify.mjs` still matches the older UTC-dated ledger entries.
  - **Trade ticker:** for three days after a trade, a strip just under the masthead
    shows a red "TRADE" tag and crawls every recent trade, ESPN-style
    ("Rico Dowdle to The House Cats for FAAB"; two-sided deals join with " · ", trades
    are separated by a small red diamond). Verb-free on purpose, since team names don't
    take "acquire(s)" cleanly. Tapping it scrolls to the Trade Center. It doesn't move
    for people with reduced motion turned on.
  - **"New" dot:** a small red dot on the bottom bar's Trades button for two days after
    the latest trade,
    or until that viewer reaches the Trade Center (remembered in `localStorage` under
    `bbfc-trades-seen`).
  - Both use each trade's exact time (`at` in `data/trades.json`), falling back to
    midday Eastern on the trade date.
  - **Waiver Wire** (Nov 2026), under the trades: this week's pickups (last week's until
    the week's first claim) by bid, five shown and the rest under "More pickups (N)"
    (player, team, who they dropped, "$N" or "Free agent"), then "FAAB left · $100 budget"
    for every team with a bar, folded behind a tap (Bryar asked, so Transactions stays
    about the size of the other sections; keep new extras off the main page or behind a
    tap). The ticker, "new" dot and alerts are still trades only.
- **Podcast:** "BBFC Presents: The Poddy" from SoundCloud. The newest episode is clearly
  featured; in dark mode it sits on a navy card so it stands out.
- **Footer:** the club name, the ESPN updated time, and the easter egg.

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
- **Theme:** follows the phone's setting by default. Settings › Appearance overrides it
  (Light or Dark, saved in `localStorage` under `bbfc-theme`; Match phone clears it).
- **Color meaning:** green means above the median or winning, and red means below or
  losing. Don't use either as decoration.
- **Phones first:** everyone in the league is on iPhone, and many add the site to their
  home screen. The league logo is also the home-screen icon.

## Alerts (notifications)

Live since Nov 2026, through OneSignal's free plan (App ID `3c3199ae-b5f8-4d8d-a71c-4ccedc07bae2`,
in `data/league.json` as `onesignalAppId`; the App API Key is the `ONESIGNAL_API_KEY` secret,
which Bryar added himself; never ask for it in chat). OneSignal's site URL is
`https://airbryar.github.io`, Custom Code setup.

- **On the page:** the Alerts part of the Settings sheet (only built in when
  `onesignalAppId` is set; between `<!--alerts-->` markers). It shows Home Screen steps in
  Safari on iPhone (alerts only work from the Home Screen icon, iOS 16.4+), a "Turn on
  alerts" button (iPhone asks permission only from a tap), then switches saved as OneSignal
  tags: `trades`, `news`, `poddy` (all on when someone first turns alerts on), `final`, and
  "My team's result" = `team` set to their My team id (on by default if they've picked a
  team; disabled until they do). The page keeps `team` in step with My team, which can
  also change from a team page. Also blocked and not-available states.
- **Home-screen app:** `_site/manifest.webmanifest` (built by `build.mjs`; keep its `id`),
  icons `icon-192.png` / `icon-512.png` (made by `make-brand.mjs` like the 180px icon), and
  `OneSignalSDKWorker.js` at the site root, registered with scope `/bbfc/`. It's the
  site's one service worker: `build.mjs` writes it from `site/OneSignalSDKWorker.js`
  (OneSignal) plus `site/sw-offline.js` (the offline copy, below). The icon now
  opens the site as a full-screen app; people who added it before may need to re-add it.
- **Sending:** `scripts/notify.mjs` runs in "Update the BBFC site" after the build
  (`continue-on-error`). It compares the data with `data/alerts-sent.json` (saved by the
  workflow) and sends: each new trade (ticker wording; one summary if more than 3 at once),
  a new Newspaper edition (label and lead headline), a new Poddy episode, and when a week
  goes final a league summary (`final`) plus each team's own result (`team=<id>`). The
  first run only records what exists. Quiet hours 10 PM–7 AM Eastern: anything new waits.
  A send that reaches nobody still counts as sent.
- **Test:** the "Send a test alert" workflow (`alerts-test.yml`, dispatch it) sends one
  test to everyone subscribed, so ask Bryar before running it.

## Offline copy

Added Nov 2026 so the home-screen app opens right away on weak signal (`site/sw-offline.js`).
Pages (main, team, Record Book) load from the network as before; if there's a saved copy and
the network hasn't answered in 1.5 seconds, or can't be reached, the saved copy shows while
the fresh page downloads, and the page's update check (also run 2.5 seconds after opening
when its data is 3+ minutes old) refreshes it in place. The page's own "?v=" refresh waits
for the network. Team pictures and icons are served saved-first. The main page registers the
worker unless one is already registered (OneSignal registers the same file), so the two
never trade places. `"offlineCopy": false` in `data/league.json` turns it off and clears
saved copies. Tested with a slow and a dead local server: about 1.5 seconds to open.

## Record Book

`record-book.html`, its own page (added Nov 2026), opened from the masthead's Record Book pill.
Past seasons (2023 on) come from `data/history.json`; this season so far is added from
`data/espn.json` on each build, matched to managers through `history.current.teams`.

- **Look:** same tokens and fonts as the main page; a compact navy masthead with a
  "‹ Home" pill, and its own bottom bar: Home (back to the main page), Champions,
  All-Time, Records, Rivals.
- **Champions:** the reigning champion on a navy feature card (final score, seed,
  regular-season record), earlier champions listed, then a titles count.
- **All-Time Standings:** current managers only, by winning percentage: record (ESPN's,
  so median games count from 2025 on; footnoted), Pct, Titles, Playoff trips.
- **Records:** single-game (highest, lowest, biggest blowout, closest, most points in a
  loss, fewest in a win; regular season and winners-bracket playoffs, not consolation,
  this season included) and season (most and fewest points, best and worst record;
  finished seasons, regular season).
- **Head-to-Head:** two pickers (current managers) with the series and every meeting,
  playoffs and consolation included. Starts on the two most recent champions.
- Managers are named by first name; anyone who has left the league shows as "A former
  manager". ESPN member IDs must never be saved anywhere in this public repo: they're
  tied to people's ESPN sign-ins. The scripts map them to short keys in memory.
- `history.yml` runs monthly to pick up a season once it ends. Run it by hand after the
  championship if you want it sooner.

## Team pages

`team.html?t=<id>` (added Nov 2026), one page that renders any team, with a team picker at
the top and the main page's bottom bar (linking back to its sections). Same look as the
Record Book: navy masthead with the team picture, "Managed by <first name>", place, record
and points, and a "‹ Home" pill.

- Tiles: Record (H2H and median split), Playoff odds (projected record, or Clinched /
  Eliminated), Power rank (same formula as the main page, after the last finished week).
- This Week: the matchup with live scores and projections, plus one line with the
  managers' all-time series from the Record Book's history. (Bryar found a series line on
  every Scoreboard card too much; on the team page he was fine with it.)
- Season: a chart first (Nov 2026; Bryar liked it as previewed): one bar per regular-season
  week, green above / red below that week's median (midpoint of 6th and 7th, like Median
  Watch), one league-wide scale so teams compare fairly, best and worst weeks labeled, and
  tapping a week shows its score, margin and opponent. Then each finished week's opponent
  and score with W/L and median W/L chips; then
  "Still to play" with each opponent's points per game and where the remaining schedule
  ranks league-wide.
- Top Players (points while started) come from `data/newsroom.json`, so they refresh with
  the Newspaper's data (Tuesday, Thursday, Saturday).
- Transactions: "FAAB left: $N of $100 · Nth most", trades (got and sent, FAAB where no
  players went one way), and the team's four latest pickups; then the manager's career
  (seasons, record, titles, playoff trips) with links to Transactions and the Record Book.

## Newspaper

The Newspaper is two scheduled tasks with the same prompt. They run in the cloud,
without Bryar's Mac:

- **BBFC Newspaper** (`trig_01MHdDzVwGDM43saxpx6efob`): Thursday and Saturday at
  4:46 AM Eastern, so editions are up by about 5. Bryar asked for 5 AM (Nov 2026).
  ESPN's API answered normally during its 4-7 AM ET maintenance window when checked.
- **BBFC Newspaper (Tuesday)** (`trig_01RPiymJqjQpM2JbV9WrH81q`): Tuesday at 7:37 AM
  Eastern. Kept later because the recap needs last week to be final on ESPN; move it to
  4:46 AM once a Tuesday rollover shows ESPN finalizes the week before then. If you
  change one prompt, change both.

Each run:

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

## On hold

- **Podcast player** (Nov 2026): an in-page player (featured card plays in place, waveform
  as progress, past episodes, mini player, lock-screen controls, auto-refresh waits while
  playing) is saved on the `podcast-preview` branch, along with a `fetch-podcast.mjs` that
  saves each episode's audio file and length. Bryar chose to keep linking to SoundCloud for
  now. Drop that branch's temporary `podcast-preview.yml` workflow if it's ever merged.

## History

- The site started as a Claude artifact
  (https://claude.ai/artifact/La2absYLbqZfcZLTrqhHE4), which now says "The BBFC site has
  moved" and links here.
- The old artifact-era scheduled tasks ("BBFC Sunday scores", "BBFC Thursday and Monday
  night scores", "BBFC Tuesday final update", "BBFC podcast check") are disabled and
  obsolete. GitHub Actions does their jobs now.
- Bryar's other scheduled tasks, such as the Playback setlist and Spotify playlist ones,
  have nothing to do with this site. Leave them alone.
