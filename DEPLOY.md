# 部署与运维

## 日常启动：双击 `start.cmd`

一步搞定，脚本会依次做完你以前手动做的四件事：

1. 检查 3000 端口，没起就去 `%USERPROFILE%\api-enhanced`（可用环境变量 `PM_API_DIR` 覆盖）后台跑 `node app.js`，并等它真的能响应；
2. 检查 8080 端口，没起就在项目目录后台跑 `node server.mjs`；
3. **自动自检代理链路**：请求 `http://127.0.0.1:8080/api/search?...`，确认 `api proxy /api/* -> http://127.0.0.1:3000` 真的通（不再靠眼睛看那行日志）；
4. 检查 cloudflared 服务状态，没在跑就尝试拉起。

两个服务都以隐藏窗口启动，脚本窗口关掉也不影响它们。标准输出与错误写到：

```
%TEMP%\purple-music-logs\api.out.log     api.err.log
%TEMP%\purple-music-logs\static.out.log  static.err.log
```

常用参数：

```
start.cmd -Restart      先杀掉旧的 node 再重启（改了 server.mjs 之后用）
start.cmd -NoBrowser    不自动打开浏览器
```

## 停止：双击 `stop.cmd`

只结束占用 8080 / 3000 的 **node** 进程；端口若被别的程序占着会跳过、不会乱杀。

```
stop.cmd -Tunnel        连 cloudflared 服务一起停（需要管理员）
```

停掉之后**登录状态会丢**：凭证只存在 `server.mjs` 进程内存里，重启后要重新扫码。这是设计如此，不是 bug。

## 一次性配置：cloudflared（**不要每次都执行**）

`cloudflared.exe service install <token>` 是**安装 Windows 服务**，只需执行一次。当前状态：

| 项 | 值 |
| --- | --- |
| 服务名 | `Cloudflared` |
| 状态 | Running，启动类型 Automatic（**开机自动启动**） |
| 实际命令 | `cloudflared.exe tunnel run --token-file C:\ProgramData\cloudflared\token` |

也就是说 token 已经落盘在 `C:\ProgramData\cloudflared\token`，服务开机自起。**以后不需要再敲那条 install 命令**，重复执行只会报错或重复注册。

想确认或手动控制：

```
sc query Cloudflared           查看状态
net start Cloudflared          启动（管理员）
net stop  Cloudflared          停止（管理员）
sc delete Cloudflared          彻底卸载服务（管理员，慎用）
```

隧道映射到哪个本地端口，是在 Cloudflare Zero Trust 控制台里配的（Networks → Tunnels → 选中隧道 → Public Hostname → Service），不在本机文件里。

## 安全须知（重要）

1. **公网入口没有鉴权。** 隧道一开，知道那个域名的人就能用你的播放器；而登录凭证在服务端内存里，等于**别人能拿你的网易云账号操作**。强烈建议在 Cloudflare Zero Trust 里给这个 hostname 加一条 Access 策略（限定你自己的邮箱一次性验证码），几分钟就能配完。
2. **隧道 token 等同于凭证。** 拿到它就能把你的隧道跑在别的机器上。不要写进任何脚本、不要提交到 Git、不要贴进聊天窗口或截图。**如果怀疑泄露过，去 Zero Trust 控制台 refresh/rotate 该隧道的 token，然后重装一次服务。**
3. **音乐 API 监听在 `0.0.0.0:3000`**，同一局域网内的设备可以直连、且没有任何鉴权。只在可信网络下使用，或把它改成只绑 `127.0.0.1`。
4. 本项目的 `server.mjs` 只绑 `127.0.0.1`，本身不对外；对外全靠隧道，TLS 由 Cloudflare 边缘终止。

## 排障

```
netstat -ano | findstr ":3000 :8080"      看端口有没有人在听
type %TEMP%\purple-music-logs\api.err.log 看音乐 API 的报错
```

- 页面能开但接口 502 → 3000 没起来，或者 `api-enhanced` 目录被移动过。
- 页面完全打不开 → 8080 没起来。**注意：项目文件夹一旦改名或移动，正在运行的 node 进程会立刻失效**，重跑 `start.cmd` 即可。
- 公网域名 502 → 本地 8080 没起来，隧道本身是好的。

## 临时公网地址（不用域名）：双击 `tunnel-temp.cmd`

脚本会向 Cloudflare 申请一个 `*.trycloudflare.com` 的**快速隧道**地址，打印出来并复制到剪贴板，窗口开着期间有效，关掉即断开，重开会换一个新地址。

它会按「协议 + 边缘 IP 版本」四档依次尝试（http2/auto → http2/IPv6 → quic/auto → http2/IPv4），并且**只有在隧道真的注册到边缘、且公网地址真的请求得通之后，才把地址打印出来**——早期版本一拿到地址就打印，于是经常给出一个立刻 1033 的死地址。

```
tunnel-temp.cmd                        默认 8080，自动逐档尝试
tunnel-temp.cmd -Protocol quic         只用 QUIC
tunnel-temp.cmd -EdgeIp 6              只用 IPv6 边缘
tunnel-temp.cmd -KeepLogs              保留全部日志（默认只留最近 6 份）
```

### 这台机器上的实测情况（重要）

网络状况会变，下面按时间倒序记录，**最新一条才是当前有效结论**：

- **2026-09-04 起：只有 QUIC 能用。** `--protocol http2`（TCP 7844）的 TLS 握手被中间设备直接 EOF 掉，日志刷 `TLS handshake with edge error: EOF`；重试到一定次数后 Cloudflare 会回收快速隧道的注册（日志出现 `Unauthorized: Tunnel not found`），此后公网必然报 **Error 1033**，而且这时候再换协议也救不回同一个地址，只能重开拿新的。改 `--protocol quic`（UDP 7844）后 1 秒内就 `Registered tunnel connection`（边缘 `hkg12`），公网 HEAD 返回 200。**脚本档位顺序已改成 quic 打头。**
- 排除过的方向：`GODEBUG=tlsmlkem=0` 关掉后量子 TLS（怀疑加大的 ClientHello 被中间设备丢弃）——http2 照旧 EOF。所以不是 ClientHello 的问题，是 TCP 7844 这条路被干扰。
- **2026-09-01 及之前：结论相反。** 那时 QUIC 超时（`failed to dial to edge with quic: timeout: no recent network activity`）、http2 正常。同一个 cloudflared 二进制，纯粹是网络侧在变，所以**两种协议都要留着，不要删任何一档**。
- `api.trycloudflare.com` 本身会间歇性被重置（`failed to request quick Tunnel: ... unexpected EOF`），脚本内置了重试；连着几次失败就是网络问题，过一会儿再试。
- 已装成服务的那条命名隧道受同样影响。**要让它稳定，给服务也加 `--protocol quic`**（改服务的 ImagePath 或重装服务时带上该参数）。

### 遇到 Cloudflare Error 1033 怎么办

1033 的含义是「边缘认不出这个隧道」，也就是 **cloudflared 没有成功连上 Cloudflare**，跟本地 8080 是否正常无关。排查顺序：

1. 先确认本地在跑：`netstat -ano | findstr :8080`，没有就双击 `start.cmd`。
2. 看最新日志：`%TEMP%\purple-music-logs\quicktunnel-*.err.log`。搜两个关键字——有 `Registered tunnel connection` 说明连上过；只有 `TLS handshake with edge error: EOF` 或 `failed to dial to edge` 说明一直没连上。
3. 关掉旧窗口，重新双击 `tunnel-temp.cmd`（现在 quic 打头，通常 5 秒内就拿到地址）；还不行再手动试 `-Protocol http2`、`-EdgeIp 6`。
4. 两种协议都失败，才是**整个 7844 端口被掐**：换手机热点验证一次最快；确认是网络问题就只能等，或改用命名隧道 + 域名。

判据就看日志里 `Registered tunnel connection` 出现过几次：**0 次**是从头没连上，换协议或换网络；**出现过 1 次、后面全是 EOF**是连上后被掐断且注册已被回收，这种地址救不回来，重开是唯一出路。

### 想要固定地址

快速隧道每次重开都换地址。要固定地址必须用**命名隧道 + 自己的域名**：在 Zero Trust → Networks → Tunnels 选中隧道 → Public Hostname → Add，Service 填 `http://127.0.0.1:8080`。这台机器上的隧道 `config_version` 目前是 0、`total_requests` 是 0，说明还没配过任何 Public Hostname。

### 局域网测试（最省事的替代方案）

只想用手机在同一个 WiFi 下试试，不必走公网：让 `server.mjs` 监听 `0.0.0.0` 再从手机访问 `http://<本机内网IP>:8080`。当前代码是**故意只绑 `127.0.0.1`** 的，改绑等于把带登录态的服务暴露给整个局域网，要改再说。
