/**
 * 构建脚本：把所有入口编译成「可读版」与「单文件压缩版」。
 *
 * 产物约定：
 *   dist/<name>.js   —— 可读版，便于排查问题
 *   _<name>.js       —— 单文件压缩版（根目录），便于直接粘贴进 Cloudflare 控制台
 *
 */

import { build } from 'esbuild';
import { minify } from 'terser';
import { readFile, writeFile, stat } from 'fs/promises';

/** 所有入口；产物名 = 入口文件名去掉 .js */
const ENTRIES = ['src/worker-基础版.js', 'src/worker.js', 'src/worker-流控版.js'];

const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

const report = [];

for (const entry of ENTRIES) {
	const baseName = entry.split('/').pop().replace(/\.js$/, '');
	const readable = `dist/${baseName}.js`;
	const bundle = `_${baseName}.js`;

	// 可读版
	await build({
		entryPoints: [entry],
		bundle: true,
		platform: 'browser',
		format: 'esm',
		outfile: readable,
		sourcemap: false,
		minify: false,
		external: ['cloudflare:sockets'],
	});

	// 单文件压缩版
	await build({
		entryPoints: [entry],
		bundle: true,
		platform: 'browser',
		format: 'esm',
		outfile: bundle,
		sourcemap: false,
		minify: false,
		external: ['cloudflare:sockets'],
	});

	const code = await readFile(bundle, 'utf8');
	const terserResult = await minify(code, {
		compress: true,
		mangle: true,
	});
	await writeFile(bundle, terserResult.code, 'utf8');

	const readableSize = (await stat(readable)).size;
	const bundleSize = (await stat(bundle)).size;
	report.push({ entry, readable, readableSize, bundle, bundleSize });
}

console.log('构建完成：\n');
for (const r of report) {
	console.log(`  ${r.entry}`);
	console.log(`    ${r.readable.padEnd(28)} ${kib(r.readableSize).padStart(10)}`);
	console.log(`    ${r.bundle.padEnd(28)} ${kib(r.bundleSize).padStart(10)}`);
}
console.log('\n提示：npm run deploy 使用 wrangler.toml 的 main 作为部署入口，与 npm run dev 一致。');
