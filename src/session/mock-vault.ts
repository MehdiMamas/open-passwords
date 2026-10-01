import type { Capabilities, CodeRow, LoginName, SaveOffer, Vault, VaultState } from "./contract.ts";

const LOGINS: Record<string, LoginName[]> = {
  unlocked: [{ username: "test@example.com", sites: [] }],
  multi: [
    { username: "alice@example.com" },
    { username: "bob@work.com" },
  ],
  locked: [],
  pinflow: [{ username: "test@example.com" }],
  otp: [{ username: "test@example.com" }],
  no_helper: [],
  connecting: [],
  needs_pin: [],
};

export class MockVault implements Vault {
  #state: VaultState;
  #listeners = new Set<(state: VaultState) => void>();
  #kind: string;

  constructor(kind: VaultState | "multi" | "locked" | "pinflow" | "otp" = "unlocked") {
    this.#kind = kind;
    if (kind === "locked" || kind === "pinflow" || kind === "needs_pin") this.#state = "needs_pin";
    else if (kind === "no_helper" || kind === "connecting") this.#state = kind;
    else this.#state = "unlocked";
  }

  state() {
    return this.#state;
  }

  capabilities(): Capabilities {
    return {
      oneTimeCodes: this.#kind === "otp" || this.#kind === "unlocked",
      newPasswordSheet: this.#state === "unlocked",
      setUpTotp: this.#state === "unlocked",
    };
  }

  async requestChallenge() {
    this.#set("needs_pin");
    return this.#state;
  }

  async verifyPin(pin: string) {
    if (pin === "123456") {
      this.#set("unlocked");
      return { ok: true as const };
    }
    return { ok: false as const, error: "Incorrect code", newCode: true };
  }

  async loginsFor() {
    if (this.#state !== "unlocked") return [];
    return LOGINS[this.#kind] || LOGINS.unlocked;
  }

  async passwordFor(login: LoginName) {
    return `${login.username || "account"}-secret`;
  }

  async oneTimeCodes(): Promise<CodeRow[]> {
    if (this.#kind !== "otp" && this.#kind !== "unlocked") return [];
    return [{ id: 0, source: "totp", username: "alice@example.com", domain: "acme.example" }];
  }

  async codeFor() {
    return "246810";
  }

  async offerSave(_offer: SaveOffer) {}

  async openPasswordsApp() {}

  async lock() {
    this.#set("needs_pin");
  }

  onState(cb: (state: VaultState) => void) {
    this.#listeners.add(cb);
    return () => this.#listeners.delete(cb);
  }

  #set(state: VaultState) {
    this.#state = state;
    for (const cb of this.#listeners) cb(state);
  }
}
