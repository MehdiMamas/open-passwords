export type VaultState = "no_helper" | "connecting" | "needs_pin" | "unlocked";

export interface LoginName {
  username: string;
  sites?: string[];
}

export interface CodeRow {
  id: number;
  source: string;
  username?: string;
  domain?: string;
}

export interface Capabilities {
  newPasswordSheet: boolean;
  setUpTotp: boolean;
  oneTimeCodes: boolean;
}

export interface SaveOffer {
  url: string;
  username: string;
  password: string;
  update: boolean;
}

export interface Vault {
  state(): VaultState;
  capabilities(): Capabilities;
  requestChallenge(opts?: { ifNeeded?: boolean }): Promise<VaultState>;
  verifyPin(pin: string): Promise<{ ok: boolean; newCode?: boolean; error?: string }>;
  loginsFor(url: string): Promise<LoginName[]>;
  passwordFor(login: LoginName, url: string): Promise<string>;
  oneTimeCodes(url?: string): Promise<CodeRow[]>;
  codeFor(id: number): Promise<string>;
  offerSave(offer: SaveOffer): Promise<void>;
  openPasswordsApp(mode: "search" | "new" | "totp", uri?: string): Promise<void>;
  lock(): Promise<void>;
  onState(cb: (state: VaultState) => void): () => void;
}

export type UiRequest =
  | { type: "getState" }
  | { type: "getPlatform" }
  | { type: "getSettings" }
  | { type: "requestChallenge"; ifNeeded?: boolean }
  | { type: "verifyPin"; pin: string }
  | { type: "getLogins"; tabId?: number; url?: string }
  | { type: "lookupLogins"; url: string }
  | { type: "fillOnPage"; tabId?: number; url?: string; loginName: LoginName }
  | { type: "getOneTimeCodes" }
  | { type: "fillOneTimeCode"; id: number }
  | { type: "copyField"; field: "username" | "password" | "otp"; username?: string; id?: number }
  | { type: "openPasswordsApp"; mode: "search" | "new" | "totp"; uri?: string }
  | { type: "refreshAndRefill" }
  | { type: "autoPairCheck" }
  | { type: "connect" }
  | { type: "disconnect" };

export interface UiResponse {
  ok?: boolean;
  state?: string;
  error?: string;
  newCode?: boolean;
  logins?: LoginName[];
  rows?: CodeRow[];
  filled?: boolean;
  code?: string;
  caps?: Capabilities;
  settings?: Record<string, unknown>;
  os?: string;
  label?: string;
}
