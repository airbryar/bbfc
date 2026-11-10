// Which week the site shows. ESPN starts the new week early Tuesday morning (Nov 10, 2026:
// between 2:48 and 4:27 AM Eastern). Bryar wants the week that just finished to stay up
// through Tuesday and the site to switch to the new week on Wednesday. So on Tuesdays
// (Eastern time) the pages and the lineups sheet keep showing last week's final scores,
// as long as the new week hasn't scored a point. The playoff odds, the alerts and the
// Newspaper still use ESPN's real week.
//
// "newWeekOnWednesday": false in data/league.json turns this off.
import fs from "node:fs";

function setting() {
  try {
    return JSON.parse(fs.readFileSync("data/league.json", "utf8")).newWeekOnWednesday !== false;
  } catch {
    return true;
  }
}

// True on Tuesdays, Eastern time
export function holdingLastWeek(now = new Date()) {
  if (!setting()) return false;
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(now);
  return day === "Tue";
}

// The league data as the pages should show it: on Tuesdays, last week's final scores as
// "this week" (with held.next, the week that starts Wednesday)
export function shownWeek(E, now = new Date()) {
  const cur = E.currentWeek, prev = cur - 1;
  const started = (E.current || []).some((m) => m.h[1] > 0 || m.a[1] > 0);
  const prevGames = (E.games || []).filter((g) => g.p === prev);
  if (!holdingLastWeek(now) || started || prev < 1 || !prevGames.length) return E;
  return {
    ...E,
    currentWeek: prev,
    current: prevGames.map((g) => ({ h: [g.h[0], g.h[1], g.h[1]], a: [g.a[0], g.a[1], g.a[1]] })),
    held: { next: cur },
  };
}
