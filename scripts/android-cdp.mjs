// Drives the debug Android build through the WebView's DevTools socket.
// Usage: node scripts/android-cdp.mjs <command> [...args]
//   eval "<js>"                      evaluate in the page and print the JSON result
//   shot <file.png>                  capture the screen as the device shows it
//   touch <json>                     dispatch a touch sequence, e.g.
//     '[{"type":"start","points":[[100,300]]},{"type":"move","points":[[160,300]],"wait":50},{"type":"end"}]'
// Requires a debug build (WebView debugging on) running on the only attached device or emulator.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk");
export const adb = join(sdk, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
const port = Number(process.env.CDP_PORT || 9333);
const appId = "io.github.vortezler.counterattack";

export async function connect() {
  const pid = execFileSync(adb, ["shell", "pidof", appId], { encoding: "utf8" }).trim();
  if (!pid) throw new Error("The app is not running. Launch it first.");
  execFileSync(adb, ["forward", "tcp:" + port, "localabstract:webview_devtools_remote_" + pid]);
  const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = pages.find(p => p.type === "page");
  if (!page) throw new Error("No page target.");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
  let id = 0;
  const waiting = new Map();
  const errors = [];
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.method === "Runtime.exceptionThrown")
      errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error")
      errors.push(msg.params.args.map(a => a.value ?? a.description).join(" "));
    if (msg.id && waiting.has(msg.id)) {
      const { ok, fail } = waiting.get(msg.id);
      waiting.delete(msg.id);
      if (msg.error) fail(new Error(msg.error.message)); else ok(msg.result);
    }
  };
  const send = (method, params = {}) => new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error(method + " timed out")), 20000);
    waiting.set(++id, { ok: v => { clearTimeout(timer); ok(v); }, fail: e => { clearTimeout(timer); fail(e); } });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  /** Each step: {type: "start"|"move"|"end"|"cancel", points: [[x, y, id?], ...], wait?: ms}. */
  const touch = async steps => {
    for (const step of steps) {
      if (step.wait) await sleep(step.wait);
      const type = { start: "touchStart", move: "touchMove", end: "touchEnd", cancel: "touchCancel" }[step.type];
      await send("Input.dispatchTouchEvent", {
        type,
        touchPoints: (step.points ?? []).map(([x, y, pid], i) => ({ x, y, id: pid ?? i, radiusX: 4, radiusY: 4, force: 1 })),
      });
    }
  };
  // The device's own capture: DevTools screenshots miss WebGL frames, which are not preserved.
  const shot = async file => {
    writeFileSync(file, execFileSync(adb, ["exec-out", "screencap", "-p"], { maxBuffer: 64 << 20 }));
  };
  await send("Runtime.enable");
  return { send, evaluate, touch, shot, sleep, errors, close: () => ws.close() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, arg] = process.argv.slice(2);
  const cdp = await connect();
  try {
    if (command === "eval") console.log(JSON.stringify(await cdp.evaluate(arg), null, 2));
    else if (command === "shot") await cdp.shot(arg);
    else if (command === "touch") await cdp.touch(JSON.parse(arg));
    else throw new Error("Unknown command " + command);
  } finally {
    cdp.close();
  }
}
