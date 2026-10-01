import { generateLoginFillScript } from "../../src/adapter/fill-script.js";
import { INLINE_MENU_PORTS, portKeyForTab } from "../../src/adapter/ports.js";

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

console.log(failed ? `\n${failed} failed` : "\nunit ok");
process.exit(failed ? 1 : 0);
