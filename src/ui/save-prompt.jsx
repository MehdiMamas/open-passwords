import { createRoot } from "react-dom/client";

const params = new URLSearchParams(location.search);
const token = params.get("token") || "";
const update = params.get("update") === "1";
const user = params.get("user") || "";

function send(action) {
  parent.postMessage({ token, action }, "*");
}

function SavePrompt() {
  return (
    <div data-passbridge="save-bar" className="w-[360px] rounded-2xl border border-[color-mix(in_srgb,CanvasText_20%,Canvas)] bg-[Canvas] p-3.5 text-[CanvasText] shadow-xl">
      <p className="text-sm font-semibold">{update ? "Update password in iCloud Passwords?" : "Save login to iCloud Passwords?"}</p>
      <p className="mt-1 truncate text-[13px] opacity-70">{user || "Apple's save sheet still asks you to confirm."}</p>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className="px-2 py-1 text-[13px] opacity-80" onClick={() => send("never")}>
          Never for this site
        </button>
        <button type="button" className="px-2 py-1 text-[13px] opacity-80" onClick={() => send("dismiss")}>
          Not now
        </button>
        <button type="button" className="rounded-lg bg-accent px-2.5 py-1 text-[13px] font-semibold text-white" onClick={() => send("save")}>
          {update ? "Update" : "Save"}
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<SavePrompt />);
