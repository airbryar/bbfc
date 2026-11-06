# Boys and Bibles Football Club

The BBFC league site: the Newspaper, standings, the weekly scoreboard, Median Watch, power rankings and The Poddy.

Working on the site with Claude? Start with [CLAUDE.md](CLAUDE.md): it explains how everything fits together
and the league's standing preferences.

Live at **https://airbryar.github.io/bbfc/**

## How it updates

A GitHub Action (`.github/workflows/update.yml`) runs every 5 minutes during game windows
(Thursday night, Sunday, Monday night, plus late-season Saturdays) and hourly the rest of the week. Each run:

1. Reads the league from ESPN (`scripts/fetch-espn.mjs`)
2. Checks The Poddy's SoundCloud feed for new episodes (`scripts/fetch-podcast.mjs`)
3. Builds the page (`scripts/build.mjs`) and publishes it to GitHub Pages

Open pages check for new data once a minute and refresh themselves, keeping your place on the page.

The Newspaper is written by a Claude scheduled task on Tuesday, Thursday and Saturday mornings. It
refreshes `data/newsroom.json` (`.github/workflows/newsroom.yml`) and adds an edition to `data/news.json`.

## ESPN sign-in

The league is private, so the updater needs two values from an ESPN sign-in, saved as
repository secrets (Settings → Secrets and variables → Actions):

- `ESPN_S2`
- `ESPN_SWID`

Without them the site keeps showing the last saved data.

## Files

- `site/template.html` – the page
- `data/league.json` – power-ranking weights, optional team takes, podcast feed
- `data/logos.json` – team images
- `data/pod.json` – podcast episodes
- `data/espn.json` – the latest saved league data
- `data/news.json` – Newspaper editions, newest first
- `team-pictures/`, `league-logo/` – upload images here (see the README in each)
