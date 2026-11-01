将`_worker.js`（订阅版、完整版）或`_worker-基础版.js`代码托管到CF的Workers或Pages后，按照下面内容操作。

## 一、CF中，设置环境变量

- 表1：控制三大代理协议（`Vless`、`Trojan`、`Shadowsocks`）

| **变量名称** | **说明**                                                     |
| --------------- | ------------------------------------------------------------ |
| UUID4           | 【必选】Vless协议的userID，例如：61098bdc-b734-4874-9e87-d18b1ef1cfaf |
| USERPWD         | 【必选】Trojan、ss协议的密码(2022-blake3-aes-128-gcm)，例如：yQ0wV0N1K3xir9WmJ8YOZQ== |
| ENABLE      | 【可选】开启ss协议（默认是关闭），不能使用它，启用它的有效值范围：['1', 'true', 'yes', 'on'] |
| WS_ALLOWED_RULES | 【可选】WebSocket入口IP白名单（默认所有IP，即不限制）。不设置=全放行；设置后只有白名单内的IP才能建立WS连接，三种协议都受限（支持纯IPv4/IPv6与CIDR，可多个）。仅基础版/订阅版生效，流控版不受影响 |

注意：

1、**USERPWD**：Trojan、ss协议都共用它，ss要16个字节的base64字符串，可使用`openssl rand -base64 16`命令生成。

2、**WS_ALLOWED_RULES：**慎用，不知自己的地址就看CF后台的日志信息My IP，一旦写错，全部都上不了，还是有bug，检查到非自己的本地IP，致使全部连接不上？

- 表2：控制使用哪个外部代理，访问CF无法访问的网站

| 变量名称(代理途径) | 说明：用于访问授CF保护的网站(worker无法访问才用它)           |
| ------------------ | ------------------------------------------------------------ |
| SOCKS5             | 【可选】格式: user:pass@host:port、host:port。使用它绕过CF限制访问的网站 |
| HTTP               | 【可选】同上，它就是网上常看到的`http(s)://1.2.3.4:8080`、`http://user:pass@host:port`代理，必须手动去掉`http(s)://`字符，GitHub上或一些网站有免费HTTP(S)代理列表，能否使用要亲测且有时效性 |
| PYIP               | 【可选】等价于大家公认的PROXYIP，换个名字(防止风控)，格式：(Sub-)Domain:PORT、IPv4:PORT、[IPv6]:PORT（没有端口，默认是443端口） |
| NAT64              | 【可选】兜底的外部代理方式，支持`2602:fc59:11:64::`或`2602:fc59:11:64::/96`这两种格式 |
|                    | 此表格前面那些变量值可以都不设置(包括代码中、节点path值中)，默认只能访问worker允许访问的有限非CF网站(如：Youtube、Google等) |

```txt
1、通俗地说，CF能上的，用不到它，CF不能上的ChatGPT、Netflix等，就它顶上去，使用它访问,一般是严格授CF保护的CDN站点。
2、上表的参数都可以不设置，使用后面的path指定对应的代理访问(不安全，本质是从明文URL中截取关键代理信息使用访问，只能临时使用)。
```


- 表3：【订阅版】控制使用哪些数据(私有GitHub仓库、公开URL)制作订阅

| **变量名称(订阅版)** | 说明                                                         |
| -------------------- | ------------------------------------------------------------ |
| PWD                  | 【非必须】查看节点配置(/config)与订阅(/sub)的统一密码。不填会被其他人知道你的节点信息；不设置时默认使用 `env.UUID4`，再没有才用内置的 61098bdc-b734-4874-9e87-d18b1ef1cfaf。用法：`https://your_worker_domain/config?pwd={PWD}`、`https://your_worker_domain/sub?pwd={PWD}` |
| GITHUB_TOKEN         | 【非必须】Github token                                       |
| GITHUB_OWNER         | 【非必须】GitHub 仓库拥有者                                  |
| GITHUB_REPO          | 【非必须】GitHub 仓库名                                      |
| GITHUB_BRANCH        | 【非必须】GitHub 分支名(通常是main/master)                   |
| GITHUB_FILE_PATH     | 【非必须】GitHub 文件路径(相对于仓库根目录)                  |
| DATA_SOURCE_URL      | 【非必须】数据源URL，它指的是优选的IP和域名，存放的txt文件，无端口且每行一个，URL格式为 `https://example.com/data.txt`，当GitHub的所有变量参数都没有设置或无效，包括没有读取到数据时，它才有效。 |

注意：pages部署方式，增、删、改 => 环境变量值，都要重新部署才生效。

## 二、订阅版

### 1、v2ray分享链接、singbox和clash配置怎么样的？

- 使用例子

```
https://your_worker_domain/config?pwd=123456  # 假如123456是CF后台中，环境变量PWD设置的值
```

### 2、怎么使用订阅

| 参数   | 含义                                                         |
| ------ | ------------------------------------------------------------ |
| pwd    | 【必选/可选】查看订阅的密码，CF后台中设置了PWD变量值，就要传入pwd={PWD}（/config 与 /sub 共用同一个 PWD） |
| target | 【必选】target=v2ray、singbox、clash，分别是v2ray分享链接的订阅、singbox的订阅、clash的订阅 |
| page   | 【可选】页码，默认为1，如果DATA_SOURCE_URL/GitHub私有文件的静态文件，数据多，使用哪一页的数据订阅内容？ |
| port   | 【可选】不采用随机端口（随机内置的几个端口的其中一个），而采用固定的端口值，写入订阅里节点的port中 |
| path   | 【可选】修改节点的path值，不是更换打开订阅的路径，而是修改节点配置里面的path |
| host   | 【可选】修改节点sni和host的值，仅用于修改订阅中sni和host值，不能使用它连接这个脚本进行代理 |
| max    | 【可选】修改每页最多写多少个节点。v2ray链接默认为300，可选1-2000；clash默认为50，可选1-200；singbox默认为50，可选1~300。 |
| cidr   | 【可选】不使用从DATA_SOURCE_URL/GitHub私有文件获取的数据写入节点，而是使用从url传入的cidr参数值生成的唯一不重复IP地址写入节点。注意：只支持IPv4的CIDR。 |

#### （1）v2ray订阅，使用例子：

```
https://your_worker_domain/sub?pwd=123456&target=v2ray                     # 第一页的节点
https://your_worker_domain/sub?pwd=123456&target=v2ray&page=2              # 翻页，第二页
https://your_worker_domain/sub?pwd=123456&target=v2ray&port=2053           # 全部都使用这个端口
https://your_worker_domain/sub?pwd=123456&target=v2ray&host=githu.com      # 修改节点信息中的sni和host值
https://your_worker_domain/sub?pwd=123456&target=v2ray&path=/?ed=2560      # 修改节点信息中的path
https://your_worker_domain/sub?pwd=123456&target=v2ray&cidr=104.16.0.0/13  # 使用这个cidr范围内的随机IP生成订阅
```

#### （2）SingBox订阅，使用例子：

```
https://your_worker_domain/sub?pwd=123456&target=singbox                     # 第一页的节点
https://your_worker_domain/sub?pwd=123456&target=singbox&page=2              # 翻页，第二页
https://your_worker_domain/sub?pwd=123456&target=singbox&port=2053           # 全部都使用这个端口
https://your_worker_domain/sub?pwd=123456&target=singbox&host=githu.com      # 修改节点信息中的sni和host值
https://your_worker_domain/sub?pwd=123456&target=singbox&path=/?ed=2560      # 修改节点信息中的path
https://your_worker_domain/sub?pwd=123456&target=singbox&cidr=104.16.0.0/13  # 使用这个cidr范围内的随机IP生成订阅
```

#### （3）Clash订阅，使用例子：

```
https://your_worker_domain/sub?pwd=123456&target=clash                     # 第一页的节点
https://your_worker_domain/sub?pwd=123456&target=clash&page=2              # 翻页，第二页
https://your_worker_domain/sub?pwd=123456&target=clash&port=2053           # 全部都使用这个端口
https://your_worker_domain/sub?pwd=123456&target=clash&host=githu.com      # 修改节点信息中的sni和host值
https://your_worker_domain/sub?pwd=123456&target=clash&path=/?ed=2560      # 修改节点信息中的path
https://your_worker_domain/sub?pwd=123456&target=clash&cidr=104.16.0.0/13  # 使用这个cidr范围内的随机IP生成订阅
```

注意：

1、前面那些参数可以随意组合，只要参数是前面表格中的，都可以全部使用。

2、DATA_SOURCE_URL链接的数据支持`地址[:端口][#名称]` 形式[Link](https://raw.githubusercontent.com/Senflare/Senflare-IP/refs/heads/main/Senflare-Pro.txt)，单个`地址`也支持，里面的地址可能不能使用，或者能使用，但是网速差的情况，就需要自己更新它，有需要的更改为自己的，或者使用下面的GitHub私有仓库解决。

### 3、巧用GitHub的私有仓库，隐藏您搜集的反代IP和域名

如果您花费大量时间，收集一些反代IP、域名，被别人白嫖，而且您当前的网络环境抢不过别人，导致网速大不如以前，气不气？现在你不用为其烦恼，下面使用 GitHub 的私有仓库，将您收集的反代IP、域名的文件隐藏起来，只有对应的 token 才能访问，减少文件内容泄露的风险，保护您收集到的反代IP、域名。

#### （1）设置访问GitHub私有文件所需的参数


| 参数             | 含义                                                         |
| ---------------- | ------------------------------------------------------------ |
| GITHUB_TOKEN     | （必选）GitHub访问令牌，用于授权请求（获取方法，在后面）     |
| GITHUB_OWNER     | （必选）仓库所有者的用户名，填您的GitHub用户名               |
| GITHUB_REPO      | （必选）私有文件所在的仓库名称                               |
| GITHUB_BRANCH    | （可选）私有文件所在的分支名称，默认是main，如果您创建了其它分支，就改为您创建的分支名称 |
| GITHUB_FILE_PATH | （必选）私有文件所在的路径（是相对路径，不是绝对路径）       |

<img src="images\在cloudflare中设置与GitHub相关的变量(参数).png" style="zoom:50%;" />

#### （2）GITHUB_TOKEN 值怎么获取？

1、获取 GitHub token 的地址：[link](https://github.com/settings/tokens)

2、获取 GitHub token 的教程

- 【官方版】创建 personal access token (classic) 的教程：[link](https://docs.github.com/zh/enterprise-server@3.10/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#%E5%88%9B%E5%BB%BA-personal-access-token-classic)
- 如何在 GitHub 生成经典的个人访问令牌(token)：[link](https://medium.com/@mbohlip/how-to-generate-a-classic-personal-access-token-in-github-04985b5432c7)

#### （3）优选的CF IP、反代IP和域名

```txt
time.cloudflare.com
time.is
ip.sb
172.64.229.197
104.19.106.250
104.19.124.30
104.19.206.63
104.18.200.122
104.19.113.92
172.64.203.72
172.64.53.56
```
注意：不支持在文件中添加对应的端口，也不支持csv文件。

## 三、通过path指定外部代理方式

在v2rayN中，单独修改path的值，指定socks、http、pyip、nat值；也可以在singbox、clash订阅中，修改对应节点path键的值。

**socks/http支持的格式：** user:pass@host:port、host:port

**pyip支持的格式：** ipv4、ipv4:port、[ipv6]、[ipv6]:port、domain.com、sub1.domain.com、sub2.sub1.domain.com、subN..sub1.domain.com (没有端口，默认使用443端口，其它端口需要写出来；它就是源码中LANDING_ADDRESS变量值，大家公认的PROXYIP)

**nat支持的格式：** 例如`2602:fc59:11:64::`、`2602:fc59:11:64::/96`

**优先级：** path > env；SOCKS5 > HTTP > LANDING_ADDRESS > NAT64

### 1、SOCKS5、HTTP的path

<img src="images\path设置socks5.png" />

<img src="images\path设置http.png" />

带用户密码认证的：

```
/socks=user:pass@72.167.46.208:1080
/http=user:pass@72.167.46.208:1080  (不区分http和https)
/https=user:pass@72.167.46.208:1080 (这个也可以)
```

匿名方式，无需用户名和密码的：

```
/socks=72.167.46.208:1080
/http=72.167.46.208:1080  (不区分http和https)
/https=72.167.46.208:1080 (这个也可以)
```

注意：以上的socks5/http，仅用于举例，还有socks5/http的密码含有一些特殊字符的，可能在这里设置没有用。

### 2、LANDING_ADDRESS的path

<img src="images\path设置proxyip.png" />

域名：

```
/pyip=speed.cloudflare.com
/pyip=speed.cloudflare.com:443
```

IPv4地址：

```
/pyip=192.168.1.1
/pyip=192.168.1.1:443
```

IPv6地址：

```
/pyip=[fe80::c789:ece7:5079:3406]
/pyip=[fe80::c789:ece7:5079:3406]:443
```

注意：以上的LANDING_ADDRESS，仅用于举例。

### 3、NAT64 的 PATH

<img src="images\path设置nat.png" />

```
/nat=2602:fc59:11:64::/96   (传入/96可以的)
/nat=2602:fc59:11:64::		(不传入/96也可以)
```

注意：传入nat参数，其他设置的代理参数无效，强制使用它，取决于你传入的参数是否能使用。

## 四、温馨提示

1、关于订阅版和基础版部署代码，要清楚自己部署那个代码。

```txt
     源码              可直接部署到cloudflare的代码
src/worker.js -----------|=> dist/worker.js
			             |=> _worker.js

src/worker-基础版.js -----|=> dist/worker-基础版.js
			             |=> _worker-基础版.js

src/worker-流控版.js -----|=> dist/worker-流控版.js
			             |=> _worker-流控版.js
```

前面两个入口共用 `src/core/` 下的同一份实现，差别只有「是否提供订阅页面」；最后一个是 「vless流控」无其他协议，无订阅。
`npm run build` 一次构建全部入口；`npm run dev` 与 `npm run deploy` 都以 `wrangler.toml` 的 `main` 为准。

源码按职责分三个目录：

```txt
src/core/          WebSocket 隧道核心（两个入口共用）
src/subscription/  订阅相关（路由 + 渲染），只被 src/worker.js 使用
src/common/        纯工具函数（地址 / 编解码 / 抓取 / 流）
```

```bash
npm run build     # 构建全部入口
npm run dev       # 本地调试
npm run deploy    # 部署基础版（wrangler.toml 的 main）
npm run deploy:sub  # 部署订阅版单文件产物（_worker.js）
npm test          # 差分回归测试：重构前后逐字段比对
npm run test:e2e  # 真实隧道端到端冒烟（需要先 npm run dev）
npm run test:size # 重构前后产物体积对比
```

> 注意：把 `_worker.js` 拖到 CF **Pages** 上部署时，CF 会自动识别根目录的这个文件，
> 三条路径产出的是不同的 Worker，请按需选择。

2、路径`src/`下所有代码为开发中写的源代码，大部代码根据[@zizifn](https://github.com/zizifn/edgetunnel)、[@ca110us](https://github.com/ca110us/epeius)、[@FoolVPN-ID](https://github.com/FoolVPN-ID/Nautica)、[@cmliu](https://github.com/cmliu/edgetunnel)修改而来，如果不是开发者，使用 `_worker.js` 或 `_worker-基础版.js` 的代码，简单修改一下前面提到的环境变量，部署到CF wokers或pages就可以使用。

3、部署时，有几率遇到Error 1101错误，建议将原js代码进行混淆，如果js混淆后，依然无法解决问题，就等开发者遇到该问题且有时间再解决这个问题。

<img src="images\Error 1101.png" style="zoom:50%;" />

4、shadowsocks协议的，只支持`2022-blake3-aes-128-gcm`加密的，可使用git bash命令生成，自带openssl命令生成

```bash
openssl rand -base64 16
```

<img src="images\git_bash命令在win11的位置.png" style="zoom:50%;" />

可额外在cf后台，添加**ENABLED_S5** 启用该协议，默认所有IP都能使用该协议。

```
ENABLE = true
```

5、_worker-流控版.js 指 vless-vision-ws-tls，由于xray、sing-box核心都不支持，要魔改sing-box才能使用，具体见另一个文档说明。

## 五、免责声明

该项目仅供学习/研究目的，用户对法律合规和道德行为负责，作者对任何滥用行为概不负责。
