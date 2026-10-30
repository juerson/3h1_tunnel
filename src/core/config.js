/**
 * 运行期配置层：env 变量、URL 参数、平台默认值的解析。
 *
 * 设计约束（重要）：
 *   1. 本文件只导出「纯函数 + 常量」，不含任何模块级可变状态；
 *   2. 所有配置一律在请求发生时从 env / URL 现场计算，
 *      避免同一个 Worker isolate 内并发请求互相覆盖配置（历史遗留的全局变量问题）。
 */

import { base64Encode, base64Decode } from '../common/codec.js';
import { sha224 } from '../common/codec.js';
import { pskFromSecret } from './ss2022.js';

/** 根路径访问时的随机重定向域名池 */
export const REDIRECT_LIST = [
	'https://www.bilibili.com',
	'https://www.nicovideo.jp',
	'https://tv.naver.com',
	'https://www.hotstar.com',
	'https://www.netflix.com',
	'https://www.dailymotion.com',
	'https://www.youtube.com',
	'https://www.hulu.com',
	'https://fmovies.llc',
	'https://hdtodayz.to',
	'https://radar.cloudflare.com',
];

/** 代码内置的默认值，均可用同名 env 覆盖 */
export const BUILTIN_DEFAULTS = {
	/** S5elv 条目的 uuid，env.UUID4 优先 */
	userID: '61098bdc-b734-4874-9e87-d18b1ef1cfaf',
	/** Naj0rt 与 Skc0swodahs 条目 password，env.USERPWD 优选 */
	handshakePWD: 'yQ0wV0N1K3xir9WmJ8YOZQ==',
	/** relay 即 socks5 上游地址，格式: user:pass@host:port、host:port */
	relay: '',
	/** gateway 即 http(s) 上游地址，格式同上 */
	gateway: '',
	/** 中转地址 地址即pyip，格式 [Host][:port]，多值用逗号隔开 */
	landing: '',
	/** NAT64 IPv6 前缀，可以去掉或保留 "/96" */
	nat64: `${['2602', 'fc59', 'b0', '64'].join(':')}::`,
};

/** env 变量的默认值，按用途分组 */
export const DEFAULTS = {
	github: {
		GITHUB_TOKEN: '', // 令牌
		GITHUB_OWNER: '', // 仓库所有者
		GITHUB_REPO: '', // 仓库名称
		GITHUB_BRANCH: 'main', // 分支名称
		GITHUB_FILE_PATH: 'README.md', // 文件路径(相对于仓库根目录)
	},
	password: {
		CONFIG_PASSWORD: BUILTIN_DEFAULTS.userID, // 查看条目配置的密码
		SUB_PASSWORD: BUILTIN_DEFAULTS.userID, // 查看条目订阅的密码
	},
	urls: {
		DATA_SOURCE_URL: `https://raw.githubusercontent.com/${base64Decode("anVlcnNvbg==")}/${base64Decode("M2gxX3R1bm5lbA==")}/refs/heads/master/domain.txt`,
		C_TEMPLATE_URL: `https://raw.githubusercontent.com/${base64Decode("anVlcnNvbg==")}/${base64Decode("M2gxX3R1bm5lbA==")}/refs/heads/master/${base64Decode("Y2xhc2hUZW1wbGF0ZQ==")}.yaml`,
	},
};

/**
 * 各订阅平台的最大条目数策略。
 * key 是平台名的 base64 编码，空串用于 target 传错时的兜底。
 */
export const DEFAULT_MAX_ITEM_MAP = {
	'djJyYXk=': {
		upperLimit: 2000, // 最大上限
		default: 300, // 默认值，传入的数据不合法使用它
	},
	'c2luZ2JveA==': {
		upperLimit: 100,
		default: 30,
	},
	'Y2xhc2g=': {
		upperLimit: 100,
		default: 30,
	},
	'': {
		// 这个用于当target输入错误兜底的
		upperLimit: 500,
		default: 300,
	},
};

/**
 * 解析布尔型 env 变量。
 * @param {boolean|string|undefined} value env 原始值
 * @param {boolean} fallback 无法识别时的兜底值
 * @returns {boolean}
 */
export function parseBoolEnv(value, fallback = false) {
	if (typeof value === 'boolean') return value;
	if (typeof value === 'string') return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
	return fallback;
}

/**
 * 按分组读取 env 变量，并给指定字段做 URI 编码。
 * @param {object} env Worker 的 env 对象
 * @param {object} groupedDefaults 分组默认值，见 DEFAULTS
 * @param {string[]} encodeFields 需要 URI 编码的字段名
 */
export function extractGroupedEnv(env, groupedDefaults = DEFAULTS, encodeFields = ['CONFIG_PASSWORD', 'SUB_PASSWORD']) {
	const result = {};

	for (const [groupName, vars] of Object.entries(groupedDefaults)) {
		result[groupName] = {};
		for (const [key, defaultVal] of Object.entries(vars)) {
			let value = env[key] ?? defaultVal;
			// 如果字段在encodeFields中，则对其值进行URI编码
			if (encodeFields.includes(key)) {
				value = encodeURIComponent(String(value));
			}
			result[groupName][key] = value;
		}
	}

	return result;
}

/**
 * 从 URL 查询串里提取订阅相关参数。
 * @param {URL} url 请求 URL
 * @param {object} maxItemMap 各平台的最大条目数策略，见 DEFAULT_MAX_ITEM_MAP
 * @param {string[]} encodeFields 需要 URI 编码的字段名
 */
export function extractUrlParams(url, maxItemMap = DEFAULT_MAX_ITEM_MAP, encodeFields = ['pwdPassword']) {
	const search = url.searchParams;
	const target = base64Encode(search.get('target')) || '';
	const defaultMax = maxItemMap[target]?.default ?? maxItemMap['']?.default; // ??后面的代码，用于预防target输入错误的情况
	const rawParams = {
		target,
		hostName: search.get('host') || url.hostname,
		pwdPassword: search.get('pwd') || '',
		defaultPort: parseInt(search.get('port') || '0', 10),
		maxItem: parseInt(search.get('max') || defaultMax.toString(), 10),
		page: parseInt(search.get('page') || '1', 10),
		itemPath: search.get('path') || '/', // 条目中的path值，可以改为/?ed=2048、/?ed=2560、/landing=x.x.x.x、/relay=xx:xx@x.x.x.x:port
		cidr: search.get('cidr') || '',
	};

	for (const key of encodeFields) {
		if (key in rawParams) {
			rawParams[key] = encodeURIComponent(rawParams[key]);
		}
	}

	return rawParams;
}

/**
 * 计算本次请求的运行期配置（与转发通道连接无关的全局部分）。
 * 每次请求独立计算，不复用上一次的结果。
 * @param {object} env Worker 的 env 对象
 */
export function resolveRuntimeConfig(env = {}) {
	const userID = env.U || env.UUID4 || BUILTIN_DEFAULTS.userID;
	// 应用Naj0rt条目，没有设置，就使用前面的userID
	const password = env.P || env.USERPWD || BUILTIN_DEFAULTS.handshakePWD;

	return {
		userID,
		password,
		sha224Password: sha224(password),
		// 下面skc0Lock和allowedRules控制ss握手格式
		skc0Lock: parseBoolEnv(env.ENABLED_S5, false),
		// SS2022(2022-blake3-aes-128-gcm) 的 16 字节 PSK
		ssPsk: pskFromSecret(password),
		allowedRules: parseAllowedRules(env.ALLOWED_RULES),
		// 远端 TCP 主动断开时，是否立刻关闭 WebSocket（默认关闭）
		closeWSOnSocketClosed: parseBoolEnv(env.CLOSE_WS_ON_SOCKET_CLOSE, false),
	};
}

/**
 * 解析 Skc0swodahs 类型的 IP 白名单。
 * @param {string|undefined} raw 逗号/空白分隔的 IP 或 CIDR 列表
 * @returns {string[]}
 */
export function parseAllowedRules(raw) {
	const list = String(raw ?? '')
		.trim()
		.split(/[, \n\r\t]+/)
		.map((x) => x.trim())
		.filter(Boolean);
	return list.length > 0 ? list : ['0.0.0.0/0', '::/0'];
}
