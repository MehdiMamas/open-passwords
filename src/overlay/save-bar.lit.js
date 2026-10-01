import { LitElement, html, css } from "lit";

const params = new URLSearchParams(location.search);
const token = params.get("token") || "";
const update = params.get("update") === "1";
const user = params.get("user") || "";

class PbSaveBar extends LitElement {
  static properties = {};
  static styles = css`
    :host { display: block; }
    .card {
      box-sizing: border-box;
      width: 360px;
      padding: 14px 14px 12px;
      border-radius: 14px;
      background: Canvas;
      color: CanvasText;
      color-scheme: light dark;
      border: 1px solid rgba(128, 128, 128, 0.35);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.22);
      font: 13px/1.4 system-ui, sans-serif;
    }
    .title { font-weight: 650; margin-bottom: 4px; }
    .sub { opacity: 0.7; margin-bottom: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row { display: flex; gap: 8px; justify-content: flex-end; }
    button { background: transparent; color: inherit; border: none; padding: 6px 8px; cursor: pointer; opacity: 0.8; }
    button.primary { background: #0a84ff; color: #fff; border-radius: 8px; padding: 6px 10px; opacity: 1; }
  `;

  #send(action) {
    parent.postMessage({ token, action }, "*");
  }

  render() {
    return html`
      <div class="card" data-passbridge="save-bar">
        <div class="title">${update ? "Update password in iCloud Passwords?" : "Save login to iCloud Passwords?"}</div>
        <div class="sub">${user || "Apple's save sheet still asks you to confirm."}</div>
        <div class="row">
          <button @click=${() => this.#send("never")}>Never for this site</button>
          <button @click=${() => this.#send("dismiss")}>Not now</button>
          <button class="primary" @click=${() => this.#send("save")}>${update ? "Update" : "Save"}</button>
        </div>
      </div>
    `;
  }
}

customElements.define("pb-save-bar", PbSaveBar);
document.body.appendChild(document.createElement("pb-save-bar"));
