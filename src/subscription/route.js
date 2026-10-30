/**
 * 订阅层：/config 与 /sub 两个 HTTP 路由的渲染。
 *
 * 只属于「订阅版」入口；基础版没有这两条路由。
 */

import { base64Decode } from '../common/codec.js';
import { fetchRepoFile, fetchPageText } from '../common/remote.js';
import { genAddrsFromCIDR, pageItems } from '../common/addr.js';
import { renderJson, renderLinks, renderYaml, getConfigPage } from './render.js';
import { REDIRECT_LIST } from '../core/config.js';

/** formatB 订阅的 outbounds 外层模板 */
const FORMAT_B_OUTLINE = 'ew0KICAib3V0Ym91bmRzIjogWw0KI291dGJkcyMNCiAgXQ0KfQ';
/** formatC 订阅在 workers.dev 域名下使用的提示文案 */
const FORMAT_C_NOTICE = '6K2m5ZGK77ya5L2/55So5Z+f5ZCNI2hvc3ROYW1lI+eUn+aIkOeahGNsYXNo6K6i6ZiF5peg5rOV5L2/55So77yB57uI5q2i5pON5L2c44CC';
/** workers.dev 域名的 base64，用于判断当前域名是不是 workers.dev */
const SHARED_HOST_SUFFIX = 'd29ya2Vycy5kZXY';

// 模板只需解码一次，放在模块级常量里，避免每次请求重复解码
const FORMAT_B_OUTLINE_TEXT = base64Decode(FORMAT_B_OUTLINE);
const FORMAT_C_NOTICE_TEXT = base64Decode(FORMAT_C_NOTICE);
const SHARED_HOST_SUFFIX_TEXT = base64Decode(SHARED_HOST_SUFFIX);

/**
 * 检查 GitHub 配置是否完整，任何一项参数为空都视为不完整。
 */
export function isRepoConfigComplete(githubConfig) {
	return Object.values(githubConfig).every((val) => val !== '');
}

/**
 * 替换 formatC 模板，匹配空白+符号+空白+占位符，
 * 这里指“  - ${proxies}”和“      - ${proxy_name}”所在行。
 */
export function fillTemplate(template, data) {
	return template.replace(/(\s*[-*]\s*)\$\{(\w+)\}/g, (_, prefix, key) => {
		return '\n' + data[key];
	});
}

/**
 * 读取订阅用的 IP 列表：优先 CIDR 随机生成，其次 GitHub 私有文件，最后公共数据源。
 * @returns {Promise<string[]>}
 */
async function resolveAddrList(config, cidr, maxItem) {
	const ipsArray = genAddrsFromCIDR(cidr, maxItem);
	if (ipsArray.length > 0) return ipsArray;

	const { DATA_SOURCE_URL } = config.env.urls;
	const github = config.env.github;
	let ipContents = '';

	if (isRepoConfigComplete(github)) {
		try {
			const file = await fetchRepoFile(
				github?.GITHUB_TOKEN,
				github?.GITHUB_OWNER,
				github?.GITHUB_REPO,
				github?.GITHUB_FILE_PATH,
				github?.GITHUB_BRANCH
			);
			ipContents = new TextDecoder().decode(file.body);
		} catch (e) {
			console.log(`获取GitHub的数据失败：${e.message}`);
		}
	}
	if (!ipContents.trim()) ipContents = await fetchPageText(DATA_SOURCE_URL);
	if (!ipContents.trim()) return [];

	return ipContents
		.trim()
		.split(/\r\n|\n|\r/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

/**
 * 处理订阅版的 HTTP 路由。
 * @param {string} path 请求路径
 * @param {object} config 由入口组装好的配置，见 extractGroupedEnv / extractUrlParams
 * @param {object} maxItemMap 各平台的最大条目数策略
 */
export async function handleRoute(path, config, maxItemMap) {
	const { target, hostName, pwdPassword, defaultPort, maxItem, page, itemPath, cidr } = config.query;
	const { CONFIG_PASSWORD, SUB_PASSWORD } = config.env.password;
	const { C_TEMPLATE_URL } = config.env.urls;

	switch (path) {
		case '/': {
			const randomDomain = REDIRECT_LIST[Math.floor(Math.random() * REDIRECT_LIST.length)];
			return Response.redirect(randomDomain, 301);
		}

		case '/config': {
			let htmlDoc = '404 Not Found!';
			let status = 404;
			if (pwdPassword === CONFIG_PASSWORD) {
				htmlDoc = getConfigPage(config?.subParameter, hostName, itemPath);
				status = 200;
			}
			return new Response(htmlDoc, { status: status, headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
		}

		case '/sub': {
			if (pwdPassword !== SUB_PASSWORD) {
				return new Response('Not Found!', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
			}

			const ipsArray = await resolveAddrList(config, cidr, maxItem);
			if (ipsArray.length === 0) {
				return new Response('Null Data', { status: 200, headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
			}

			let upperLimit = maxItemMap[target]?.upperLimit ?? maxItemMap['']?.upperLimit;
			let defaultCount = maxItemMap[target]?.default ?? maxItemMap['']?.default;
			let ipsResult = pageItems(ipsArray, maxItem, page, upperLimit, defaultCount);
			if (ipsResult?.hasError) {
				return new Response(ipsResult.message, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
			}

			let htmlDoc = 'Not Found!';
			if (target === 'djJyYXk=') {
				htmlDoc = renderLinks(ipsResult?.chunkedIPs, config?.subParameter, hostName, itemPath, defaultPort);
			} else if (target === 'c2luZ2JveA==') {
				let [_, outbds] = renderJson(ipsResult?.chunkedIPs, config?.subParameter, hostName, itemPath, defaultPort);
				if (outbds.length > 0) htmlDoc = FORMAT_B_OUTLINE_TEXT.replace('#outbds#', outbds.join(',\n'));
			} else if (target === 'Y2xhc2g=') {
				const isCFworkersDomain = hostName.endsWith(SHARED_HOST_SUFFIX_TEXT);
				if (isCFworkersDomain) {
					htmlDoc = FORMAT_C_NOTICE_TEXT.replace('#hostName#', hostName);
					return new Response(htmlDoc, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
				}
				let [names, entries] = renderYaml(ipsResult?.chunkedIPs, config?.subParameter, hostName, itemPath, defaultPort);
				let confTemplate = await fetchPageText(C_TEMPLATE_URL);
				if (entries.length > 0 && entries.length > 0) {
					htmlDoc = fillTemplate(confTemplate, {
						proxies: entries.join('\n'),
						proxy_name: names.map((ipWithPort) => `      - ${ipWithPort}`).join('\n'),
					});
				}
			}
			return new Response(htmlDoc, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
		}

		default:
			return new Response('Not Found!', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
	}
}
