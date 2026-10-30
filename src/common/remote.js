/**
 * 异步函数：使用提供的GitHub访问令牌(token)和其他参数，从指定的仓库中获取文件内容。
 * @param {string} token - GitHub访问令牌，用于授权请求。
 * @param {string} owner - 仓库所有者的用户名。
 * @param {string} repo - 仓库名称。
 * @param {string} filePath - 要获取的文件路径。
 * @param {string} branch - 文件所在的分支名称。
 * @returns {Object} - 包含文件内容和内容类型的对象。如果请求失败，内容为空字符串。
 */
export async function fetchRepoFile(token, owner, repo, filePath, branch = 'main') {
	const githubUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`;
	try {
		const response = await fetch(githubUrl, {
			headers: {
				Authorization: `token ${token}`,
				Accept: 'application/vnd.github.v3.raw',
				'User-Agent': 'Mozilla/5.0',
			},
		});
		if (!response.ok) {
			console.error(`GitHub API Error: ${response.status} ${response.statusText}`);
			return emptyFile();
		}
		const contentType = response.headers.get('Content-Type') || 'application/octet-stream';
		const body = await response.arrayBuffer();
		return { body, contentType };
	} catch (error) {
		console.error(`Network or parsing error: ${error.message}`);
		return emptyFile();
	}

	function emptyFile() {
		return { body: new ArrayBuffer(0), contentType: 'text/plain; charset=utf-8' };
	}
}

/**
 * @param {string} url - 要抓取网页的内容
 * @returns {string} - 返回网页的全部内容
 */
export async function fetchPageText(url) {
	try {
		const response = await fetch(url);
		if (response.ok) {
			return await response.text();
		}
		console.error(`Failed to get: ${response.status}`);
	} catch (err) {
		console.error(`Failed to fetch ${url} web content: ${err.message}`);
	}
	return '';
}
