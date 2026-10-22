import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectBuildAssets, pickRetainedBuilds, retainAssets } from "./retain-assets.mjs";

describe("collectBuildAssets", () => {
  it("顺着 index.html 找到入口、按需加载的分包和字体，没用到的不算", () => {
    const files = {
      "index-a1.js": 'import("./ThemeManage-b2.js");import "./react-c3.js";',
      "ThemeManage-b2.js": "export const x = 1;",
      "react-c3.js": "",
      "index-d4.css": "@font-face{src:url(/assets/inter-e5.woff2)}",
      "inter-e5.woff2": "binary",
      "old-f6.js": "",
    };
    const html = '<script src="/assets/index-a1.js"></script><link href="/assets/index-d4.css">';
    const used = collectBuildAssets(html, Object.keys(files), (name) => Buffer.from(files[name]));
    expect([...used].sort()).toEqual(["ThemeManage-b2.js", "index-a1.js", "index-d4.css", "inter-e5.woff2", "react-c3.js"]);
  });
});

describe("pickRetainedBuilds", () => {
  const now = 100_000;
  it("上一版一定保留；更早的在被替换不到 2 小时时保留", () => {
    const builds = [
      { commit: "c", time: now - 600 },
      { commit: "b", time: now - 3 * 3600 },
      { commit: "a", time: now - 5 * 3600 },
    ];
    // b 在 10 分钟前被 c 替换下来，还要留；a 在 3 小时前就被 b 替换了，不留。
    expect(pickRetainedBuilds(builds, now)).toEqual(["c", "b"]);
    expect(pickRetainedBuilds([{ commit: "c", time: now - 10 * 3600 }, { commit: "b", time: now - 11 * 3600 }], now)).toEqual(["c"]);
  });
});

describe("retainAssets", () => {
  const dirs = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function makeBuild(tag) {
    const dir = mkdtempSync(join(tmpdir(), "retain-dist-"));
    dirs.push(dir);
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "index.html"), `<script src="/assets/index-${tag}.js"></script>`);
    writeFileSync(join(dir, "assets", `index-${tag}.js`), `import("./Settings-${tag}.js")`);
    writeFileSync(join(dir, "assets", `Settings-${tag}.js`), "export default 1");
    writeFileSync(join(dir, "assets", "shared-s1.css"), "body{}");
    return dir;
  }

  function git(workdir, args, time) {
    execFileSync("git", ["-C", workdir, "-c", "user.name=t", "-c", "user.email=t@t", ...args], {
      env: { ...process.env, GIT_COMMITTER_DATE: `${time} +0000`, GIT_AUTHOR_DATE: `${time} +0000` },
      stdio: "pipe",
    });
  }

  function publish(workdir, distDir, time) {
    for (const name of readdirSync(workdir)) if (name !== ".git") rmSync(join(workdir, name), { recursive: true, force: true });
    cpSync(distDir, workdir, { recursive: true });
    const state = retainAssets(workdir, distDir, time);
    git(workdir, ["add", "-A"], time);
    git(workdir, ["commit", "-q", "--allow-empty", "-m", "build"], time);
    return state;
  }

  it("发布新版时留下上一版的分包；超过 2 小时的旧版本不再保留；同一份产物报告 same", () => {
    const workdir = mkdtempSync(join(tmpdir(), "retain-work-"));
    dirs.push(workdir);
    execFileSync("git", ["init", "-q", workdir]);
    const t0 = 1_700_000_000;

    expect(publish(workdir, makeBuild("a"), t0)).toBe("changed");
    expect(publish(workdir, makeBuild("b"), t0 + 10 * 3600)).toBe("changed");
    // 三小时后发 c：访客可能还拿着缓存的 b 版 index.html，b 的设置页分包要留；a 早在 3 小时前就被替换了，不留。
    expect(publish(workdir, makeBuild("c"), t0 + 13 * 3600)).toBe("changed");
    const has = (name) => existsSync(join(workdir, "assets", name));
    expect(has("Settings-b.js") && has("index-b.js") && has("Settings-c.js")).toBe(true);
    expect(has("Settings-a.js")).toBe(false);

    // 十分钟后又发 d：c 是上一版，b 被替换才 10 分钟，都留着。
    const d = makeBuild("d");
    expect(publish(workdir, d, t0 + 13 * 3600 + 600)).toBe("changed");
    expect(has("Settings-b.js") && has("Settings-c.js") && has("Settings-d.js")).toBe(true);
    expect(has("Settings-a.js")).toBe(false);

    // 之后再发同一份产物：报告 same（工作流据此跳过发布）。
    expect(publish(workdir, d, t0 + 20 * 3600)).toBe("same");
    // 要起几十个 git 进程，Windows 上和别的测试一起跑时会超过默认的 5 秒。
  }, 30_000);
});
