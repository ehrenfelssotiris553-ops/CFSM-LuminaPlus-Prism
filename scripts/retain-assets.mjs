/**
 * 发布产物时，把前几版还可能被用到的 assets 留在产物分支上。
 *
 * 后端按 tree/<分支> 加载主题时，会把 index.html 缓存 1 小时（raw.githubusercontent.com 还有 5 分钟）。
 * 这段时间里访客拿到的仍是上一版的 index.html，它按需加载的分包（设置页、详情页等）是上一版的文件名；
 * 发布时把这些文件删掉，这些页面就会 404 打不开，首页看起来也还是旧版。所以：
 *   - 上一版用到的文件一定保留；
 *   - 更早的版本，被下一版替换下来还不到 RETAIN_SECONDS 的也保留；
 *   - 再早的不再保留，产物分支不会越来越大。
 * 锁在 commit 上的主题地址不受影响（那个 commit 的文件一直在 git 历史里）。
 *
 * 用法：node scripts/retain-assets.mjs <产物分支工作目录> <本次构建的 dist 目录>
 * 先把本次构建拷进工作目录，再运行；本次构建和上一版完全一样时输出 same，否则输出 changed。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RETAIN_SECONDS = 2 * 60 * 60;
const TEXT_ASSET = /\.(?:css|html|js|json|mjs|svg)$/i;

/** 从 index.html 出发，找出这一版实际用到的 assets 文件（按需加载的分包、字体也算）。 */
export function collectBuildAssets(indexHtml, assetNames, readAsset) {
  const used = new Set();
  const queue = [indexHtml];
  while (queue.length > 0) {
    const text = queue.pop();
    for (const name of assetNames) {
      if (used.has(name) || !text.includes(name)) continue;
      used.add(name);
      if (TEXT_ASSET.test(name)) queue.push(readAsset(name).toString("utf8"));
    }
  }
  return used;
}

/** builds 按时间从新到旧；上一版一定保留，更早的在它的下一版发布不到 retainSeconds 时保留。 */
export function pickRetainedBuilds(builds, nowSeconds, retainSeconds = RETAIN_SECONDS) {
  const kept = [];
  for (let i = 0; i < builds.length; i += 1) {
    if (i > 0 && builds[i - 1].time < nowSeconds - retainSeconds) break;
    kept.push(builds[i].commit);
  }
  return kept;
}

function git(workdir, args, encoding = "utf8") {
  return execFileSync("git", ["-C", workdir, ...args], { encoding, maxBuffer: 256 * 1024 * 1024 });
}

function readCommitBuild(workdir, commit) {
  const names = git(workdir, ["ls-tree", "--name-only", `${commit}:assets`]).split("\n").filter(Boolean);
  const read = (name) => git(workdir, ["show", `${commit}:assets/${name}`], "buffer");
  const indexHtml = git(workdir, ["show", `${commit}:index.html`]);
  return { indexHtml, read, used: collectBuildAssets(indexHtml, names, read) };
}

/** 把要保留的旧文件写回工作目录；返回本次构建是否和上一版完全一样。 */
export function retainAssets(workdir, distDir, nowSeconds = Math.floor(Date.now() / 1000)) {
  let head = "";
  try {
    head = git(workdir, ["rev-parse", "--verify", "-q", "HEAD"]).trim();
  } catch {
    // 产物分支第一次发布，还没有旧版本。
  }
  if (!head) return "changed";

  const distAssets = join(distDir, "assets");
  const newNames = readdirSync(distAssets);
  const newIndex = readFileSync(join(distDir, "index.html"), "utf8");
  const newUsed = collectBuildAssets(newIndex, newNames, (name) => readFileSync(join(distAssets, name)));

  const builds = git(workdir, ["log", "--format=%H %ct", "-n", "100"])
    .trim()
    .split("\n")
    .map((line) => {
      const [commit, time] = line.split(" ");
      return { commit, time: Number(time) };
    });
  const kept = pickRetainedBuilds(builds, nowSeconds);

  let same = false;
  for (const commit of kept) {
    let build;
    try {
      build = readCommitBuild(workdir, commit);
    } catch {
      continue; // 这个提交不是完整的产物（缺 index.html 或 assets），跳过。
    }
    if (commit === head) {
      same =
        build.indexHtml === newIndex &&
        build.used.size === newUsed.size &&
        [...newUsed].every((name) => build.used.has(name) && build.read(name).equals(readFileSync(join(distAssets, name))));
    }
    for (const name of build.used) {
      const target = join(workdir, "assets", name);
      if (!existsSync(target)) writeFileSync(target, build.read(name));
    }
  }
  return same ? "same" : "changed";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [workdir, distDir] = process.argv.slice(2);
  if (!workdir || !distDir) {
    console.error("用法：node scripts/retain-assets.mjs <产物分支工作目录> <本次构建的 dist 目录>");
    process.exit(1);
  }
  console.log(retainAssets(resolve(workdir), resolve(distDir)));
}
