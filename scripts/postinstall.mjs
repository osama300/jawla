// node-pty يأتي مع ملف spawn-helper بلا صلاحية تنفيذ على macOS، فيفشل فتح الترمينال (posix_spawnp failed)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

try {
  const require = createRequire(import.meta.url);
  const dir = path.join(path.dirname(require.resolve("node-pty/package.json")), "prebuilds");
  for (const d of fs.readdirSync(dir)) {
    const f = path.join(dir, d, "spawn-helper");
    if (fs.existsSync(f)) fs.chmodSync(f, 0o755);
  }
} catch {}
