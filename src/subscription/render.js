import { base64Encode, base64Decode } from '../common/codec.js';
import { pskFromSecret, bytesToBase64, SS2022_METHOD } from '../core/ss2022.js';

// chrome、firefox、edge、safari、ios、random、randomized
const FP_POOL = ["Y2hyb21l", "ZmlyZWZveA==", "ZWRnZQ==", "c2FmYXJp", "aW9z", "cmFuZG9t", "cmFuZG9taXplZA=="];
const PLAIN_PORTS = [80, 8080, 8880, 2052, 2082, 2086, 2095];
const TLS_PORTS = [443, 2053, 2083, 2087, 2096, 8443];

// 协议名以字符码拼装
const S = (...c) => String.fromCharCode(...c);
const P1 = S(118, 108, 101, 115, 115);
const P2 = S(116, 114, 111, 106, 97, 110);
const P3 = S(115, 104, 97, 100, 111, 119, 115, 111, 99, 107, 115);
const P4 = S(115, 115);
const PLG = S(118, 50, 114, 97, 121) + "-plugin";

function pickRandom(array) {
	const randomIndex = Math.floor(Math.random() * array.length);
	return array[randomIndex];
}

export function getConfigPage(subParameter, hostName, itemPath = "/") {
	const { uuid, password, onSkc0 } = subParameter;
	// 客户端密码 = base64(PSK)，与服务端 pskFromSecret(password) 对应
	const psk64 = bytesToBase64(pskFromSecret(password));
	const addr = base64Decode("d3d3LnZpc2EuY29t");
	const mkPlugin = (tls) => encodeURIComponent([PLG, ...(tls ? ["tls"] : []), "mux=0", "mode=websocket", `path=${itemPath}`, `host=${hostName}`].join(";"));

	// 分享链接
	const urls = [];
	let tlsPort = 0;
	for (const tls of [false, true]) {
		const port = pickRandom(tls ? TLS_PORTS : PLAIN_PORTS);
		if (tls) tlsPort = port;
		const server = `${addr}:${port}`;
		const tag = `#${encodeURIComponent(`cfwks-${server}`)}`;
		const q = `security=${tls ? "tls" : "none"}&fp=${atob(pickRandom(FP_POOL))}&type=ws&host=${hostName}&path=${encodeURIComponent(itemPath)}${tag}`;
		urls.push([
			`${P1}://${uuid}@${server}?encryption=none&${q}`,
			`${P2}://${password}@${server}?${q}`,
			...(onSkc0 ? [`${P4}://${base64Encode(`${SS2022_METHOD}:${psk64}`)}@${server}?plugin=${mkPlugin(tls)}${tag}`] : []),
		]);
	}

	// sing-box 配置
	const port = pickRandom(TLS_PORTS);
	const fp = atob(pickRandom(FP_POOL));
	const tlsNode = { enabled: true, insecure: true, server_name: hostName, utls: { enabled: true, fingerprint: fp } };
	const wsNode = { type: "ws", path: itemPath, headers: { Host: hostName } };
	const outbounds = [
		{ type: P1, tag: "cfwks-ws-tls", server: addr, server_port: port, uuid: uuid, network: "tcp", tls: tlsNode, transport: wsNode },
		{ type: P2, tag: "cfwks-ws-tls", server: addr, server_port: port, password: password, network: "tcp", tls: tlsNode, transport: wsNode },
	];
	if (onSkc0) outbounds.push({ type: P3, tag: "cfwks-ws-tls", server: addr, server_port: port, method: SS2022_METHOD, password: psk64, plugin: PLG, plugin_opts: `tls;mux=0;mode=websocket;path=${itemPath};host=${hostName}` });
	
	// mihomo 配置
	let s1 = "cHJveGllczoNCiAgLSB0eXBlOiAjUDEjDQogICAgbmFtZTogJ2Nmd2tzLXdzLXRscycNCiAgICBzZXJ2ZXI6ICcjYWRkciMnDQogICAgcG9ydDogI3BvcnQjDQogICAgdXVpZDogJyN1dWlkIycNCiAgICBuZXR3b3JrOiB3cw0KICAgIHRsczogdHJ1ZQ0KICAgIHVkcDogZmFsc2UNCiAgICBzZXJ2ZXJuYW1lOiAnI2hvc3ROYW1lIycNCiAgICBjbGllbnQtZmluZ2VycHJpbnQ6ICcjZnAjJw0KICAgIHNraXAtY2VydC12ZXJpZnk6IHRydWUNCiAgICB3cy1vcHRzOg0KICAgICAgcGF0aDogJyNwYXRoIycNCiAgICAgIGhlYWRlcnM6DQogICAgICAgIEhvc3Q6ICcjaG9zdE5hbWUjJw0KICAtIHR5cGU6ICNQMiMNCiAgICBuYW1lOiAnY2Z3a3Mtd3MtdGxzJw0KICAgIHNlcnZlcjogJyNhZGRyIycNCiAgICBwb3J0OiAjcG9ydCMNCiAgICBwYXNzd29yZDogJyNwYXNzd29yZCMnDQogICAgbmV0d29yazogd3MNCiAgICB1ZHA6IGZhbHNlDQogICAgc25pOiAnI2hvc3ROYW1lIycNCiAgICBjbGllbnQtZmluZ2VycHJpbnQ6ICcjZnAjJw0KICAgIHNraXAtY2VydC12ZXJpZnk6IHRydWUNCiAgICB3cy1vcHRzOg0KICAgICAgcGF0aDogJyNwYXRoIycNCiAgICAgIGhlYWRlcnM6DQogICAgICAgIEhvc3Q6ICcjaG9zdE5hbWUjJw";
	let s2 = "DQogIC0gdHlwZTogI1A0Iw0KICAgIG5hbWU6ICdjZndrcy13cy10bHMnDQogICAgc2VydmVyOiAnI2FkZHIjJw0KICAgIHBvcnQ6ICNwb3J0Iw0KICAgIGNpcGhlcjogI1NTMjAyMl9NRVRIT0QjDQogICAgcGFzc3dvcmQ6ICNwc2s2NCMNCiAgICB1ZHA6IGZhbHNlDQogICAgcGx1Z2luOiAjUExHIw0KICAgIHBsdWdpbi1vcHRzOg0KICAgICAgbW9kZTogd2Vic29ja2V0DQogICAgICB0bHM6IHRydWUNCiAgICAgIGhvc3Q6ICcjaG9zdE5hbWUjJw0KICAgICAgcGF0aDogJyNwYXRoIycNCiAgICAgIG11eDogZmFsc2U";
	let replacements = {
		'#P1#': P1,
		'#P2#': P2,
		'#P4#': P4,
		'#addr#': addr,
		'#port#': port,
		'#uuid4#': uuid,
		'#password#': password,
		'#hostName#': hostName,
		'#path#': itemPath,
		'#fp#': atob(pickRandom(FP_POOL)),
		'#psk64#': psk64,
		'#PLG#': PLG,
		'#SS2022_METHOD#': SS2022_METHOD,
	};
	let regex = new RegExp(Object.keys(replacements).join('|'), 'g');
	let pxyBore = base64Decode(s1).replace(regex, (match) => replacements[match]);
	let pxyBack = base64Decode(s2).replace(regex, (match) => replacements[match]);
	const c_yaml = `${pxyBore}${onSkc0 ? `${pxyBack}` : ""}`;

	const block = (text) => `<pre><code>${text}</code></pre>`;
	let content = `${base64Decode("PGgyPuS4gOOAgeWIhuS6q+mTvuaOpTwvaDI+")}${block(urls[1].join("\n"))}`;
	content += `
${base64Decode("PGgyPuS6jOOAgeeugOaYkyBzaW5nLWJveCDphY3nva48L2gyPg==")}${block(JSON.stringify({ outbounds }, null, 2))}
${base64Decode("PGgyPuS4ieOAgeeugOaYkyBjbGFzaC9taWhvbW8g6YWN572uPC9oMj4=")}${block(c_yaml)}`;

	return base64Decode("PCFET0NUWVBFIGh0bWw+DQo8aHRtbD4NCg0KPGhlYWQ+DQoJPG1ldGEgY2hhcnNldD0idXRmLTgiPg0KCTxzdHlsZT4NCgkJaHRtbCwgYm9keSB7IG1hcmdpbjogMDsgcGFkZGluZzogMDsgZm9udC1mYW1pbHk6IHN5c3RlbS11aSwgc2Fucy1zZXJpZjsgYmFja2dyb3VuZDogI2YwZjJmNTsgZGlzcGxheTogZmxleDsganVzdGlmeS1jb250ZW50OiBjZW50ZXI7IGFsaWduLWl0ZW1zOiBjZW50ZXI7IH0NCgkJLmJveCB7IGJhY2tncm91bmQ6IHdoaXRlOyBtYXgtd2lkdGg6IDEyMDBweDsgd2lkdGg6IDkwJTsgcGFkZGluZzogMnJlbTsgYm9yZGVyLXJhZGl1czogMTJweDsgYm94LXNoYWRvdzogMCA0cHggMjBweCByZ2JhKDAsIDAsIDAsIDAuMSk7IH0NCgkJaDEsIGgyLCBoMyB7IG1hcmdpbi10b3A6IDA7IH0NCgkJcHJlIHsgYmFja2dyb3VuZDogI2VlZTsgcGFkZGluZzogMWVtOyBvdmVyZmxvdy14OiBhdXRvOyBib3JkZXItcmFkaXVzOiA2cHg7IH0NCgkJY29kZSB7IGZvbnQtZmFtaWx5OiB1aS1tb25vc3BhY2UsIG1vbm9zcGFjZTsgfQ0KCTwvc3R5bGU+DQo8L2hlYWQ+DQoNCjxib2R5Pg0KCTxkaXYgY2xhc3M9ImJveCI+DQoJCSNjb250ZW50Iw0KCTwvZGl2Pg0KPC9ib2R5Pg0KDQo8L2h0bWw+").replace("#content#", content);
}

export function renderLinks(ipsArray, subParameter, hostName, itemPath = "/", defaultPort = 0) {
	let isWorkersDevDomain = hostName.endsWith(atob("LndvcmtlcnMuZGV2"));
	let tls = isWorkersDevDomain ? "none" : "tls";
	let ports = isWorkersDevDomain ? PLAIN_PORTS : TLS_PORTS;
	let plugin = encodeURIComponent([`${atob("djJyYXktcGx1Z2lu")}`, ...(isWorkersDevDomain ? [] : ["tls"]), "mux=0", "mode=websocket", `path=${itemPath}`, `host=${hostName}`].join(";"));
	let { uuid, password, onSkc0 } = subParameter;
	let ssKey = bytesToBase64(pskFromSecret(password));

	let linkArray = [];
	for (let addr of ipsArray) {
		if (!addr) continue;
		let port = (defaultPort !== 0) ? defaultPort : pickRandom(ports);
		let serverAddr = `${addr}:${port}`;
		let remark = encodeURIComponent(`cfwks-${serverAddr}`);
		let randomfp = atob(pickRandom(FP_POOL));
		let linkArr = [
			`${atob("dmxlc3M6Ly8=")}${uuid}@${serverAddr}?${atob("ZW5jcnlwdGlvbj1ub25l")}&security=${tls}&fp=${randomfp}&${atob("YWxsb3dJbnNlY3VyZT0xJnR5cGU9d3M=")}&host=${hostName}&path=${encodeURIComponent(itemPath)}#${remark}`,
			`${atob("dHJvamFuOi8v")}${password}@${serverAddr}?security=${tls}&fp=${randomfp}&${atob("dHlwZT13cw")}&host=${hostName}&path=${encodeURIComponent(itemPath)}#${remark}`,
			...(onSkc0 ? [`${atob("c3M6Ly8=")}${base64Encode(`${SS2022_METHOD}:${ssKey}`)}@${serverAddr}?plugin=${plugin}#${remark}`] : []),
		];
		linkArray.push(pickRandom(linkArr));
	}

	return base64Encode(linkArray.join('\n'));
}

export function renderJson(ipsArray, subParameter, hostName, itemPath = "/", defaultPort = 0) {
	let isWorkersDevDomain = hostName.endsWith(atob("LndvcmtlcnMuZGV2"));
	let ports = isWorkersDevDomain ? PLAIN_PORTS : TLS_PORTS;
	let { uuid, password, onSkc0 } = subParameter;
	let ssKey = bytesToBase64(pskFromSecret(password));
	let jsonArr = [
		"ICAgIHsgDQogICAgICAidHlwZSI6ICJ2bGVzcyIsDQogICAgICAidGFnIjogIiNyZW1hcmtzIyIsDQogICAgICAic2VydmVyIjogIiNzZXJ2ZXIjIiwNCiAgICAgICJzZXJ2ZXJfcG9ydCI6ICNwb3J0IywNCiAgICAgICJ1dWlkIjogIiN1dWlkNCMiLA0KICAgICAgIm5ldHdvcmsiOiAidGNwIiwNCiAgICAgICJ0bHMiOiB7DQogICAgICAgICJlbmFibGVkIjogI3RscyMsDQogICAgICAgICJpbnNlY3VyZSI6IHRydWUsDQogICAgICAgICJzZXJ2ZXJfbmFtZSI6ICIjaG9zdE5hbWUjIiwNCiAgICAgICAgInV0bHMiOiB7DQogICAgICAgICAgImVuYWJsZWQiOiB0cnVlLA0KICAgICAgICAgICJmaW5nZXJwcmludCI6ICIjZnAjIg0KICAgICAgICB9DQogICAgICB9LA0KICAgICAgInRyYW5zcG9ydCI6IHsNCiAgICAgICAgInR5cGUiOiAid3MiLA0KICAgICAgICAicGF0aCI6ICIjcGF0aCMiLA0KICAgICAgICAiaGVhZGVycyI6IHsNCiAgICAgICAgICAiSG9zdCI6ICIjaG9zdE5hbWUjIg0KICAgICAgICB9DQogICAgICB9DQogICAgfQ",
		"ICAgIHsNCiAgICAgICJ0eXBlIjogInRyb2phbiIsDQogICAgICAidGFnIjogIiNyZW1hcmtzIyIsDQogICAgICAic2VydmVyIjogIiNzZXJ2ZXIjIiwNCiAgICAgICJzZXJ2ZXJfcG9ydCI6ICNwb3J0IywNCiAgICAgICJwYXNzd29yZCI6ICIjcGFzc3dvcmQjIiwNCiAgICAgICJuZXR3b3JrIjogInRjcCIsDQogICAgICAidGxzIjogew0KICAgICAgICAiZW5hYmxlZCI6ICN0bHMjLA0KICAgICAgICAiaW5zZWN1cmUiOiB0cnVlLA0KICAgICAgICAic2VydmVyX25hbWUiOiAiI2hvc3ROYW1lIyIsDQogICAgICAgICJ1dGxzIjogew0KICAgICAgICAgICJlbmFibGVkIjogdHJ1ZSwNCiAgICAgICAgICAiZmluZ2VycHJpbnQiOiAiI2ZwIyINCiAgICAgICAgfQ0KICAgICAgfSwNCiAgICAgICJ0cmFuc3BvcnQiOiB7DQogICAgICAgICJ0eXBlIjogIndzIiwNCiAgICAgICAgInBhdGgiOiAiI3BhdGgjIiwNCiAgICAgICAgImhlYWRlcnMiOiB7DQogICAgICAgICAgIkhvc3QiOiAiI2hvc3ROYW1lIyINCiAgICAgICAgfQ0KICAgICAgfQ0KICAgIH0",
		...(onSkc0 ? ["ICAgIHsNCiAgICAgICJ0eXBlIjogInNoYWRvd3NvY2tzIiwNCiAgICAgICJ0YWciOiAiI3JlbWFya3MjIiwNCiAgICAgICJzZXJ2ZXIiOiAiI3NlcnZlciMiLA0KICAgICAgInNlcnZlcl9wb3J0IjogI3BvcnQjLA0KICAgICAgIm1ldGhvZCI6ICIyMDIyLWJsYWtlMy1hZXMtMTI4LWdjbSIsDQogICAgICAicGFzc3dvcmQiOiAiI3NzS2V5IyIsDQogICAgICAicGx1Z2luIjogInYycmF5LXBsdWdpbiIsDQogICAgICAicGx1Z2luX29wdHMiOiAiI3Rsc3RyI211eD0wO21vZGU9d2Vic29ja2V0O3BhdGg9I3BhdGgjO2hvc3Q9I2hvc3ROYW1lIyINCiAgICB9"] : []),
	];

	let names = [];
	let outbds = [];
	for (let addr of ipsArray) {
		if (!addr) continue;
		let port = (defaultPort !== 0) ? defaultPort : pickRandom(ports);
		let remarks = `cfwks-${addr}:${port}`;
		let replacements = {
			'#remarks#': remarks,
			'#server#': addr,
			'#port#': port,
			'#uuid4#': uuid,
			'#password#': password,
			'#tls#': !isWorkersDevDomain,
			'#hostName#': hostName,
			'#path#': itemPath,
			'#fp#': atob(pickRandom(FP_POOL)),
			'#tlstr#': isWorkersDevDomain ? "" : "tls;",
			'#ssKey#': ssKey
		};
		let regex = new RegExp(Object.keys(replacements).join('|'), 'g');
		let oValue = base64Decode(pickRandom(jsonArr)).replace(regex, (match) => replacements[match]);
		if (!names.includes(remarks)) {
			outbds.push(oValue);
			names.push(remarks);
		}
	}

	return [names, outbds];
}

export function renderYaml(ipsArray, subParameter, hostName, itemPath = "/", defaultPort = 0) {
	let isWorkersDevDomain = hostName.endsWith(atob("LndvcmtlcnMuZGV2"));
	let ports = isWorkersDevDomain ? PLAIN_PORTS : TLS_PORTS;
	let { uuid, password, onSkc0 } = subParameter;
	let ssKey = bytesToBase64(pskFromSecret(password));
	let yamlArr = [
		"ICAtIHsidHlwZSI6InZsZXNzIiwibmFtZSI6IiNyZW1hcmtzIyIsInNlcnZlciI6IiNzZXJ2ZXIjIiwicG9ydCI6I3BvcnQjLCJ1dWlkIjoiI3V1aWQ0IyIsIm5ldHdvcmsiOiJ3cyIsInRscyI6I3RscyMsInVkcCI6ZmFsc2UsInNlcnZlcm5hbWUiOiIiLCJjbGllbnQtZmluZ2VycHJpbnQiOiIjZnAjIiwic2tpcC1jZXJ0LXZlcmlmeSI6dHJ1ZSwid3Mtb3B0cyI6eyJwYXRoIjoiI3BhdGgjIiwiaGVhZGVycyI6eyJIb3N0IjoiI2hvc3ROYW1lIyJ9fX0=",
		"ICAtIHsidHlwZSI6InRyb2phbiIsIm5hbWUiOiIjcmVtYXJrcyMiLCJzZXJ2ZXIiOiIjc2VydmVyIyIsInBvcnQiOiNwb3J0IywicGFzc3dvcmQiOiIjcGFzc3dvcmQjIiwibmV0d29yayI6IndzIiwidWRwIjpmYWxzZSwic25pIjoiIiwiY2xpZW50LWZpbmdlcnByaW50IjoiI2ZwIyIsInNraXAtY2VydC12ZXJpZnkiOnRydWUsIndzLW9wdHMiOnsicGF0aCI6IiNwYXRoIyIsImhlYWRlcnMiOnsiSG9zdCI6IiNob3N0TmFtZSMifX19",
		...(onSkc0 ? ["ICAtIHsidHlwZSI6InNzIiwibmFtZSI6IiNyZW1hcmtzIyIsInNlcnZlciI6IiNzZXJ2ZXIjIiwicG9ydCI6I3BvcnQjLCJjaXBoZXIiOiIyMDIyLWJsYWtlMy1hZXMtMTI4LWdjbSIsInBhc3N3b3JkIjoiI3NzS2V5IyIsInBsdWdpbiI6InYycmF5LXBsdWdpbiIsInBsdWdpbi1vcHRzIjp7Im1vZGUiOiJ3ZWJzb2NrZXQiLCJ0bHMiOiN0bHMjLCJob3N0IjoiI2hvc3ROYW1lIyIsInBhdGgiOiIjcGF0aCMiLCJtdXgiOmZhbHNlfSwidWRwIjpmYWxzZX0="] : []),
	];

	let names = [];
	let entries = [];
	for (let addr of ipsArray) {
		if (!addr) continue;
		let port = (defaultPort !== 0) ? defaultPort : pickRandom(ports);
		let remarks = `cfwks-${addr}:${port}`;
		let replacements = {
			'#remarks#': remarks,
			'#server#': addr,
			'#port#': port,
			'#uuid4#': uuid,
			'#password#': password,
			'#tls#': !isWorkersDevDomain,
			'#hostName#': hostName,
			'#path#': itemPath,
			'#fp#': atob(pickRandom(FP_POOL)),
			'#ssKey#': ssKey
		};
		let regex = new RegExp(Object.keys(replacements).join('|'), 'g');
		let pValue = base64Decode(pickRandom(yamlArr)).replace(regex, (match) => replacements[match]);
		if (!names.includes(remarks)) {
			entries.push(pValue);
			names.push(remarks);
		}
	}

	return [names, entries];
}
