#!/usr/bin/env node
// أمر dawra: تشغيل الأداة وفتحها، والتشغيل التلقائي، والربط مع Claude Code.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 4477);
const URL_ = `http://localhost:${PORT}`;
const DATA = process.env.DAWRA_HOME || path.join(os.homedir(), ".dawra");
const LABEL = "com.daeerah.dawra";
const PLIST = path.join(os.homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const CMD_FILE = path.join(os.homedir(), ".claude", "commands", "dawra.md");
const APP_BUNDLE = path.join(os.homedir(), "Applications", "Dawra.app");

/** تطبيق صغير يفتح دورة، حتى تجده في Spotlight وتضعه في الـ Dock */
function makeAppBundle() {
  if (process.platform !== "darwin") return false;
  const script = `do shell script "export PATH=" & quoted form of "${process.env.PATH}" & "; " & quoted form of "${process.execPath}" & " " & quoted form of "${path.join(ROOT, "bin", "dawra.mjs")}" & " open > /dev/null 2>&1 &"`;
  fs.mkdirSync(path.dirname(APP_BUNDLE), { recursive: true });
  fs.rmSync(APP_BUNDLE, { recursive: true, force: true });
  execFileSync("osacompile", ["-o", APP_BUNDLE, "-e", script]);
  const icns = path.join(ROOT, "assets", "Dawra.icns");
  if (fs.existsSync(icns)) fs.copyFileSync(icns, path.join(APP_BUNDLE, "Contents", "Resources", "applet.icns"));
  execFileSync("touch", [APP_BUNDLE]);
  return true;
}

const [cmd = "open", ...args] = process.argv.slice(2);
const flag = (f) => args.includes(f);

async function running() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(800) });
    return r.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await running()) return;
  fs.mkdirSync(DATA, { recursive: true });
  const log = fs.openSync(path.join(DATA, "server.log"), "a");
  spawn(process.execPath, [path.join(ROOT, "server.mjs")], { cwd: ROOT, detached: true, stdio: ["ignore", log, log], env: process.env }).unref();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await running()) return;
  }
  throw new Error(`server did not start — see ${path.join(DATA, "server.log")}`);
}

/** يفتح الواجهة كنافذة تطبيق مستقلة (Chrome/Edge/Brave app mode) أو في المتصفح الافتراضي */
export function openWindow(hash = "") {
  const url = URL_ + (hash ? "/#" + hash : "/");
  const browsers = ["Google Chrome", "Microsoft Edge", "Brave Browser", "Chromium"];
  if (!flag("--browser")) {
    for (const b of browsers) {
      if (fs.existsSync(`/Applications/${b}.app`)) {
        spawn("open", ["-na", b, "--args", `--app=${url}`, "--window-size=1440,920"], { detached: true, stdio: "ignore" }).unref();
        return;
      }
    }
  }
  spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
}

function plist() {
  // نحفظ PATH الحالي حتى يجد الخادم claude وcodex وgh عند التشغيل من launchd
  const env = { PATH: process.env.PATH, HOME: os.homedir(), LANG: process.env.LANG || "en_US.UTF-8", DAWRA_OPEN_ON_START: flag("--no-window") ? "0" : "1" };
  const envXml = Object.entries(env).map(([k, v]) => `    <key>${k}</key><string>${String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${process.execPath}</string><string>${path.join(ROOT, "server.mjs")}</string></array>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>EnvironmentVariables</key>
  <dict>
${envXml}
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>StandardOutPath</key><string>${path.join(DATA, "server.log")}</string>
  <key>StandardErrorPath</key><string>${path.join(DATA, "server.log")}</string>
</dict>
</plist>
`;
}

const SLASH = `---
description: Open Dawra (دورة) — your daily dashboard for Claude Code & Codex sessions
argument-hint: "[today|ask|sessions]"
allowed-tools: Bash(dawra:*)
---
Run \`dawra open $ARGUMENTS\` with the Bash tool to open the Dawra dashboard (it starts the local server if needed).
Then reply with one short line saying it is open at http://localhost:${PORT}. Do nothing else.
`;

async function main() {
  switch (cmd) {
    case "open": {
      await ensureServer();
      openWindow(["today", "ask", "sessions"].includes(args[0]) ? args[0] : "");
      console.log(`Dawra → ${URL_}`);
      break;
    }
    case "start":
    case "serve":
      // تشغيل الخادم في الواجهة الأمامية (للتطوير ولـ launchd)
      await import(path.join(ROOT, "server.mjs"));
      break;
    case "stop": {
      try {
        execFileSync("launchctl", ["bootout", `gui/${process.getuid()}/${LABEL}`], { stdio: "ignore" });
      } catch {}
      try {
        const pids = execFileSync("lsof", ["-ti", `tcp:${PORT}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
        for (const p of pids) process.kill(Number(p), "SIGTERM");
        console.log(pids.length ? "stopped" : "not running");
      } catch {
        console.log("not running");
      }
      break;
    }
    case "status": {
      const up = await running();
      console.log(`server:    ${up ? "running at " + URL_ : "stopped"}`);
      console.log(`autostart: ${fs.existsSync(PLIST) ? "on" : "off"}`);
      console.log(`/dawra:    ${fs.existsSync(CMD_FILE) ? "installed" : "not installed"}`);
      console.log(`app:       ${fs.existsSync(APP_BUNDLE) ? APP_BUNDLE : "not installed"}`);
      console.log(`data:      ${DATA}`);
      break;
    }
    case "autostart": {
      const on = args[0] !== "off";
      try {
        execFileSync("launchctl", ["bootout", `gui/${process.getuid()}/${LABEL}`], { stdio: "ignore" });
      } catch {}
      if (on) {
        // نوقف أي خادم يعمل يدويًا حتى يتولى launchd التشغيل
        try {
          for (const p of execFileSync("lsof", ["-ti", `tcp:${PORT}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim().split("\n").filter(Boolean)) process.kill(Number(p), "SIGTERM");
          await new Promise((r) => setTimeout(r, 600));
        } catch {}
        fs.mkdirSync(path.dirname(PLIST), { recursive: true });
        fs.mkdirSync(DATA, { recursive: true });
        fs.writeFileSync(PLIST, plist());
        execFileSync("launchctl", ["bootstrap", `gui/${process.getuid()}`, PLIST]);
        console.log(`autostart on — Dawra starts at login${flag("--no-window") ? "" : " and opens its window"}.`);
      } else {
        fs.rmSync(PLIST, { force: true });
        console.log("autostart off");
      }
      break;
    }
    case "install": {
      // أمر /dawra داخل Claude Code + خادم MCP ليسأل أي جلسة Claude عن جلساتك
      fs.mkdirSync(path.dirname(CMD_FILE), { recursive: true });
      fs.writeFileSync(CMD_FILE, SLASH);
      console.log(`✓ /dawra command → ${CMD_FILE}`);
      try {
        if (makeAppBundle()) console.log(`✓ Dawra.app → ${APP_BUNDLE} (Spotlight: "Dawra", drag it to your Dock)`);
      } catch (e) {
        console.log("! could not create Dawra.app:", e.message);
      }
      try {
        execFileSync("claude", ["mcp", "remove", "--scope", "user", "dawra"], { stdio: "ignore" });
      } catch {}
      try {
        execFileSync("claude", ["mcp", "add", "--scope", "user", "dawra", "--", process.execPath, path.join(ROOT, "mcp", "server.mjs")], { stdio: "inherit" });
        console.log("✓ MCP server 'dawra' (user scope) — any Claude Code session can now search and query your sessions");
      } catch (e) {
        console.log("! could not register the MCP server automatically:", e.message);
      }
      break;
    }
    case "uninstall": {
      fs.rmSync(CMD_FILE, { force: true });
      fs.rmSync(APP_BUNDLE, { recursive: true, force: true });
      try {
        execFileSync("claude", ["mcp", "remove", "--scope", "user", "dawra"], { stdio: "ignore" });
      } catch {}
      try {
        execFileSync("launchctl", ["bootout", `gui/${process.getuid()}/${LABEL}`], { stdio: "ignore" });
      } catch {}
      fs.rmSync(PLIST, { force: true });
      console.log(`removed /dawra, MCP server, Dawra.app and autostart. Your data is kept in ${DATA}`);
      break;
    }
    default:
      console.log(`Dawra (دورة) — daily dashboard for Claude Code & Codex sessions

  dawra [open] [today|ask|sessions]   start if needed and open the app window
  dawra start                          run the server in the foreground
  dawra stop | status
  dawra autostart on [--no-window]     start at login (launchd); off to disable
  dawra install                        add /dawra + the 'dawra' MCP server to Claude Code, and Dawra.app
  dawra uninstall                      remove the above (keeps your data)

  Options: --browser  open in the default browser instead of an app window`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
