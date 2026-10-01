import { generateLoginFillScript } from "../../src/adapter/fill-script.js";
import { INLINE_MENU_PORTS, portKeyForTab } from "../../src/adapter/ports.js";
import { hostsRelated, passwordSearchSteps } from "../../src/session/password-search.js";

let failed = 0;
function ok(name, cond) {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}`);
  if (!cond) failed++;
}

const script = generateLoginFillScript({
  username: "a@b.c",
  password: "secret",
  usernameOpid: "user",
  passwordOpid: "pass",
});
ok("fill script fills username then password then focuses the password", script.map((s) => s.op).join(",") === "fill_by_opid,fill_by_opid,focus_by_opid" && script[1].opid === "pass");
ok("button and list ports are the Bitwarden names", INLINE_MENU_PORTS.has("autofill-inline-menu-button-port") && INLINE_MENU_PORTS.has("autofill-inline-menu-list-port"));
const a = portKeyForTab(3);
const b = portKeyForTab(3);
ok("port key is stable per tab and 12 chars", a === b && a.length === 12);

const moodle = "moodle.augustana.edu";
const google = "accounts.google.com";
const moodleSteps = passwordSearchSteps(moodle, [google, moodle]);
ok(
  "multi-site login retries the record's first website then its other hosts",
  moodleSteps.map((s) => `${s.envelope}|${s.search}`).join(",") ===
    `${moodle}|${moodle},${google}|${moodle},${google}|${google}`,
);
ok(
  "a host the helper did not return is not queried",
  moodleSteps.every((s) => s.search === moodle || s.search === google) &&
    moodleSteps.every((s) => s.envelope === moodle || s.envelope === google),
);
ok("parent of the page host still matches", hostsRelated("login.augustana.edu", "augustana.edu"));
ok("an unrelated extra website is not a parent or child", !hostsRelated(moodle, google));
const childSteps = passwordSearchSteps("login.augustana.edu", ["augustana.edu"]);
ok(
  "parent host is searched with the frame as the outer url after the record's own sites",
  childSteps.some((s) => s.envelope === "login.augustana.edu" && s.search === "augustana.edu") &&
    childSteps.some((s) => s.envelope === "augustana.edu" && s.search === "login.augustana.edu"),
);

console.log(failed ? `\n${failed} failed` : "\nunit ok");
process.exit(failed ? 1 : 0);
