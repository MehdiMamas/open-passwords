import type { Capabilities, CodeRow, LoginName, SaveOffer, Vault, VaultState } from "../session/contract.ts";

export interface AppleLike {
  state: string;
  ready: boolean;
  hasChallenge: boolean;
  canFillOneTimeCodes: boolean;
  canOpenPasswordsAppToNewPasswordSheet: boolean;
  canSetUpTotp: boolean;
  connect(): Promise<void>;
  disconnect(): void;
  requestChallenge(opts?: { ifNeeded?: boolean }): Promise<unknown>;
  verifyPin(pin: string): Promise<void>;
  getLoginNamesForURL(tabId: number, url: string): Promise<LoginName[]>;
  getPasswordForLoginName(tabId: number, url: string, login: LoginName, queryUrl?: string): Promise<{ password?: string } | null>;
  getOneTimeCodes(tabId: number, frameId: number, frameUrls: string[]): Promise<{ entries: Array<{ source?: string; username?: string; domain?: string; code?: string }> }>;
  readOneTimeCode(tabId: number, frameId: number, frameUrls: string[], username: string): Promise<Array<{ code?: string }>>;
  saveLogin(tabId: number, url: string, username: string, password: string): Promise<void>;
  launchPasswordsApp(opts: { searchUrl?: string; newPasswordUrl?: string; totpUri?: string }): void;
  onStateChange(cb: (state: string) => void): void;
}

function asVaultState(state: string): VaultState {
  if (state === "no_helper" || state === "needs_pin" || state === "unlocked") return state;
  return "connecting";
}

// The service worker still talks to ApplePasswords directly. This class is the
// typed seam the UI and a future background router share.
export class AppleVault implements Vault {
  #codes: CodeRow[] = [];

  constructor(private apple: AppleLike) {}

  state(): VaultState {
    return asVaultState(this.apple.state);
  }

  capabilities(): Capabilities {
    return {
      oneTimeCodes: !!this.apple.canFillOneTimeCodes,
      newPasswordSheet: !!this.apple.canOpenPasswordsAppToNewPasswordSheet,
      setUpTotp: !!this.apple.canSetUpTotp,
    };
  }

  async requestChallenge(opts?: { ifNeeded?: boolean }): Promise<VaultState> {
    await this.apple.requestChallenge(opts);
    return this.state();
  }

  async verifyPin(pin: string) {
    try {
      await this.apple.verifyPin(pin);
      return { ok: true as const };
    } catch (err) {
      const error = err as { message?: string; code?: string };
      return {
        ok: false as const,
        error: error.message || "Verification failed.",
        newCode: error.code === "challenge_reissued",
      };
    }
  }

  loginsFor(url: string) {
    return this.apple.getLoginNamesForURL(0, url);
  }

  async passwordFor(login: LoginName, url: string) {
    const cred = await this.apple.getPasswordForLoginName(0, url, login);
    if (!cred?.password) throw new Error("Couldn't read the password for this site.");
    return cred.password;
  }

  async oneTimeCodes(): Promise<CodeRow[]> {
    const { entries } = await this.apple.getOneTimeCodes(0, 0, []);
    this.#codes = (entries || []).map((entry, id) => ({
      id,
      source: entry.source || "",
      username: entry.username,
      domain: entry.domain,
    }));
    return this.#codes;
  }

  async codeFor(id: number) {
    const row = this.#codes[id];
    const fresh = await this.apple.readOneTimeCode(0, 0, [], row?.username || "");
    const code = fresh.find((entry) => entry.code)?.code;
    if (!code) throw new Error("no code returned");
    return code;
  }

  async offerSave(offer: SaveOffer) {
    await this.apple.saveLogin(0, offer.url, offer.username, offer.password);
  }

  async openPasswordsApp(mode: "search" | "new" | "totp", uri?: string) {
    if (mode === "totp") this.apple.launchPasswordsApp({ totpUri: uri });
    else if (mode === "new") this.apple.launchPasswordsApp({ newPasswordUrl: uri });
    else this.apple.launchPasswordsApp({ searchUrl: uri });
  }

  async lock() {
    this.apple.disconnect();
  }

  onState(cb: (state: VaultState) => void) {
    this.apple.onStateChange((state) => cb(asVaultState(state)));
    return () => {};
  }
}
