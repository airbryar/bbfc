# Boys and Bibles Football Club

The BBFC league site: standings, Median Watch, the weekly scoreboard, power rankings and The Poddy.

Live at **https://airbryar.github.io/bbfc/**

## How it updates

A GitHub Action (`.github/workflows/update.yml`) runs every 5 minutes during game windows
(Thursday night, Sunday, Monday night, plus late-season Saturdays) and hourly the rest of the week. Each run:

1. Reads the league from ESPN (`scripts/fetch-espn.mjs`)
2. Checks The Poddy's SoundCloud feed for new episodes (`scripts/fetch-podcast.mjs`)
3. Builds the page (`scripts/build.mjs`) and publishes it to GitHub Pages

Open pages check for new data once a minute and refresh themselves, keeping your place on the page.

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
