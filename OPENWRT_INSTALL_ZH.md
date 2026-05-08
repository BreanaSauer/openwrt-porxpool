# OpenWrt / KWRT 安装与使用指南

本文档用于在 OpenWrt / KWRT 软路由上部署 `openwrt-porxpool` 代理池服务。

项目目标：

- 手机统一设置一个 HTTP 代理入口，例如 `192.168.31.2:10000`
- 软路由自动读取代理池 `IP.txt`
- 自动过滤过期代理
- 自动检测 SOCKS5 代理可用性
- 按手机 MAC 地址绑定代理出口
- 每个代理默认最多分配 3 台设备
- 使用 sing-box 作为实际转发内核
- 不接管全屋流量，不影响 OpenClash、Samba、DHCP、Wi-Fi

## 1. 工作原理

整体结构：

```text
手机 / 平板
  |
  | 手动 HTTP 代理：192.168.31.2:10000
  v
软路由 proxy-pool 服务
  |
  | 根据 DHCP 租约识别手机 MAC / IP
  | 根据 bindings.json 绑定手机与代理出口
  v
sing-box
  |
  | source_ip 分流
  v
上游 SOCKS5 代理 IP
```

Python 只负责管理逻辑：

```text
读取 IP.txt
检测代理
维护 MAC 绑定
生成 sing-box 配置
启动 / 重启 sing-box
```

实际流量由 `sing-box` 处理。

## 2. 前置条件

建议环境：

```text
系统：OpenWrt / KWRT
架构：mipsel_24kc / aarch64 / x86_64 等均可
存储：建议已配置 extroot 或有足够 overlay 空间
内存：建议可用内存 100MB 以上
```

确认软路由能联网：

```sh
ping -c 3 github.com
```

确认可用空间：

```sh
df -h
free -h
```

## 3. 安装依赖

在软路由 SSH 中执行：

```sh
opkg update
opkg install git python3 sing-box
```

确认安装成功：

```sh
python3 --version
sing-box version
```

## 4. 拉取项目

如果仓库是公开仓库，执行：

```sh
cd /tmp
git clone https://github.com/BreanaSauer/openwrt-porxpool.git
cd openwrt-porxpool
```

如果你后续修改了仓库名，请把 URL 换成新的仓库地址。

## 5. 安装服务

执行：

```sh
sh install-openwrt.sh
```

安装后主要文件位置：

```text
/opt/proxy-pool/proxy_poold.py
/opt/proxy-pool/proxy_pool_ctl.py
/opt/proxy-pool/config.json
/opt/proxy-pool/bindings.json
/opt/proxy-pool/state.json
/opt/proxy-pool/sing-box.json
/overlay/share/IP.txt
/etc/init.d/proxy-pool
```

启用并启动服务：

```sh
/etc/init.d/proxy-pool enable
/etc/init.d/proxy-pool start
```

查看服务状态：

```sh
/etc/init.d/proxy-pool status
```

查看代理池状态：

```sh
python3 /opt/proxy-pool/proxy_pool_ctl.py status
```

## 6. 配置代理池 IP.txt

代理池文件默认位置：

```text
/overlay/share/IP.txt
```

如果你已经配置了 Samba，可以在 Windows 中访问：

```text
\\192.168.31.2\share\IP.txt
```

`IP.txt` 格式：

```text
ip|port|username|password|expire_date
```

示例：

```text
121.41.78.38|9125|user001|pass001|2026-06-01
112.124.1.49|9125|user002|pass002|2026-06-01
```

规则：

- 空行会被忽略
- `#` 开头的行会被忽略
- 到期日期早于当前日期的代理会被忽略
- SOCKS5 握手或认证失败的代理会被忽略

修改 `IP.txt` 后手动刷新：

```sh
python3 /opt/proxy-pool/proxy_pool_ctl.py reload
```

## 7. 手机如何设置

先查看服务输出的推荐代理入口：

```sh
python3 /opt/proxy-pool/proxy_pool_ctl.py status
```

状态中会出现类似：

```json
"advertised_proxy": "192.168.31.2:10000"
```

手机 Wi-Fi 中设置手动 HTTP 代理：

```text
代理主机名：192.168.31.2
代理端口：10000
```

所有手机都可以填同一个端口。

服务会自动根据手机 MAC 地址分配不同上游代理。

## 8. 常用管理命令

查看状态：

```sh
python3 /opt/proxy-pool/proxy_pool_ctl.py status
```

查看配置：

```sh
python3 /opt/proxy-pool/proxy_pool_ctl.py settings
```

启用服务逻辑：

```sh
python3 /opt/proxy-pool/proxy_pool_ctl.py enable
```

禁用服务逻辑：

```sh
python3 /opt/proxy-pool/proxy_pool_ctl.py disable
```

手动刷新代理池：

```sh
python3 /opt/proxy-pool/proxy_pool_ctl.py reload
```

修改统一代理端口：

```sh
python3 /opt/proxy-pool/proxy_pool_ctl.py set listen_port=10000
```

修改每个代理最多绑定设备数：

```sh
python3 /opt/proxy-pool/proxy_pool_ctl.py set max_devices_per_proxy=3
```

## 9. 重要配置说明

配置文件：

```text
/opt/proxy-pool/config.json
```

常用字段：

```json
{
  "enabled": true,
  "ip_file": "/overlay/share/IP.txt",
  "dhcp_leases": "/tmp/dhcp.leases",
  "listen_addr": "0.0.0.0",
  "listen_port": 10000,
  "max_devices_per_proxy": 3,
  "stale_device_days": 30,
  "health_check_interval_sec": 300,
  "reconcile_interval_sec": 30,
  "lan_interface": "br-lan"
}
```

说明：

- `listen_addr`: 建议保持 `0.0.0.0`，方便 LAN 设备访问
- `listen_port`: 手机统一设置的代理端口
- `max_devices_per_proxy`: 每个上游代理最多绑定几台手机
- `stale_device_days`: 手机多久没出现后释放绑定
- `health_check_interval_sec`: 代理可用性检测间隔
- `lan_interface`: 用于自动识别软路由 LAN IP，常见为 `br-lan`

## 10. 验证是否工作

查看 alive proxy 数量：

```sh
python3 /opt/proxy-pool/proxy_pool_ctl.py status
```

重点看：

```json
"running": true,
"alive_proxy_count": 10,
"assigned_device_count": 3
```

查看 sing-box 是否运行：

```sh
ps w | grep -E 'proxy_pool|sing-box' | grep -v grep
```

查看监听端口：

```sh
netstat -lntp | grep 10000
```

手机连接代理后，访问：

```text
https://ip.sb
https://myip.ipip.net
```

确认出口 IP 是否为上游代理 IP。

## 11. 防火墙建议

本服务只建议 LAN 内使用，不建议开放到 WAN。

默认监听：

```text
0.0.0.0:10000
```

如果你的防火墙没有额外限制，一般 LAN 设备可以直接访问。

请不要做 WAN 端口转发到 `10000`。

## 12. 卸载

停止并禁用服务：

```sh
/etc/init.d/proxy-pool stop
/etc/init.d/proxy-pool disable
```

运行卸载脚本：

```sh
sh uninstall-openwrt.sh
```

卸载脚本会保留数据：

```text
/opt/proxy-pool
/overlay/share/IP.txt
```

如果确认要完全删除：

```sh
rm -rf /opt/proxy-pool
rm -f /overlay/share/IP.txt
```

## 13. 故障排查

### 13.1 手机无法连接代理

检查服务是否运行：

```sh
/etc/init.d/proxy-pool status
ps w | grep -E 'proxy_pool|sing-box' | grep -v grep
```

检查端口是否监听：

```sh
netstat -lntp | grep 10000
```

检查手机是否和软路由在同一局域网：

```text
手机 IP 应该和软路由同网段，例如 192.168.31.x
```

### 13.2 alive_proxy_count 为 0

可能原因：

- `IP.txt` 为空
- 代理已过期
- 代理账号密码错误
- 上游 SOCKS5 代理不可达

查看 `IP.txt`：

```sh
cat /overlay/share/IP.txt
```

手动刷新：

```sh
python3 /opt/proxy-pool/proxy_pool_ctl.py reload
```

### 13.3 手机没有被分配代理

检查 DHCP 租约：

```sh
cat /tmp/dhcp.leases
```

如果手机不在租约里，可能是：

- 手机没有通过这台软路由获取 DHCP
- 手机在另一个路由器 / Guest 网络下
- 网络存在二级 NAT

### 13.4 修改 IP.txt 后没有生效

手动 reload：

```sh
python3 /opt/proxy-pool/proxy_pool_ctl.py reload
```

查看状态：

```sh
python3 /opt/proxy-pool/proxy_pool_ctl.py status
```

### 13.5 不想让旧手机长期占位

修改释放时间：

```sh
python3 /opt/proxy-pool/proxy_pool_ctl.py set stale_device_days=7
python3 /opt/proxy-pool/proxy_pool_ctl.py reload
```

## 14. 与现有服务的关系

本服务是独立服务。

不会主动修改：

```text
OpenClash
PassWall
Samba
DHCP
Wi-Fi
默认网关
DNS
```

只有手动把手机代理设置为：

```text
192.168.31.2:10000
```

该手机流量才会进入代理池。

