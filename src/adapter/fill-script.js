// Builds the same action list Bitwarden's generateLoginFillScript returns:
// fill_by_opid, then focus the password field. The page applies it 20ms apart.

export function generateLoginFillScript({ username, password, usernameOpid, passwordOpid }) {
  const script = [];
  if (username && usernameOpid) {
    script.push({ op: "fill_by_opid", opid: usernameOpid, value: username });
  }
  if (password && passwordOpid) {
    script.push({ op: "fill_by_opid", opid: passwordOpid, value: password });
  }
  const focus = passwordOpid || usernameOpid;
  if (focus) script.push({ op: "focus_by_opid", opid: focus });
  return script;
}
