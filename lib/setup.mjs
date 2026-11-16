import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export async function verifyDependencies(root) {
  const require = createRequire(join(root, 'package.json'));
  const expected = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  for (const [name,version] of Object.entries(expected.dependencies)) {
    const file = require.resolve(`${name}/package.json`);
    if (!resolve(file).startsWith(resolve(root, 'node_modules') + sep)) throw Error('依赖没有安装在当前程序目录。');
    const pkg = JSON.parse(await readFile(file, 'utf8'));
    if (pkg.version !== version) throw Error('连接依赖版本不匹配。');
  }
  const mod = await import(pathToFileURL(require.resolve('ws')).href);
  if (!(mod.WebSocketServer || mod.default?.Server)) throw Error('连接依赖不完整。');
}

export function installDependencies(root) {
  return new Promise((resolvePromise, reject) => {
    const windows = process.platform === 'win32';
    const child = spawn(windows ? process.env.ComSpec || 'cmd.exe' : 'npm',
      windows ? ['/d', '/c', 'npm.cmd ci --omit=dev --no-audit --no-fund'] : ['ci', '--omit=dev', '--no-audit', '--no-fund'],
      { cwd: root, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolvePromise() : reject(Error(`npm 安装退出码：${code}`)));
  });
}

export async function ensureDependencies({root, install=true, check=verifyDependencies, runInstall=installDependencies, log=console.log}) {
  if (Number(process.versions.node.split('.')[0]) < 22) throw Error('请安装 Node.js 22 或更高版本。');
  try { await check(root); return; } catch (_) {}
  if (!install) throw Error('本地浏览器依赖缺失，请使用“启动群聊室.cmd”修复。');
  log('正在安装/修复本地浏览器依赖，首次需要联网……');
  try {
    await runInstall(root);
    await check(root);
  } catch (error) {
    throw Error(`浏览器依赖安装失败，平台尚未启动。请检查网络及 npm 是否可用，然后重新运行“启动群聊室.cmd”。\n${error.message}`);
  }
  log('浏览器依赖检查通过。');
}
