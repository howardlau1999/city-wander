# 高德接入与路线交接

核对日期：2026-11-02。以下以高德官方公开文档为依据；已核对参数，不代表已完成手机或车机实测。

## 本地配置

1. 在高德开放平台创建应用，分别申请 **Web 服务**类型 Key 和 **Web 端（JS API）**类型 Key。两种 Key 用途不同，不要混用。
2. 将根目录 `.env.example` 复制为 `.env`，填写 `AMAP_WEB_KEY`、`AMAP_JS_KEY`、`AMAP_SECURITY_JS_CODE`。`AMAP_WEB_KEY` 仅后端读取，不能改成 `VITE_` 前缀或写到前端源码。
3. 运行 `npm install`、`npm run dev`。填写 Key 后重启开发服务。未填写 Web 服务 Key 时仅有演示路线，不提供导航链接。
4. 按高德控制台设置 JS Key 的域名限制、服务 Key 的服务授权与配额，确认开发访问域名被允许。手机访问真实部署时使用 HTTPS，以支持浏览器定位。
5. 开发模式会向浏览器提供 JS Key 和 `securityJsCode`。正式公开部署应改为高德推荐的服务器安全代理，让 JS 安全密钥留在服务端。

高德说明新申请的 JS Key 需要安全密钥，支持代理和明文两种方式，并建议正式环境使用代理。来源：[JS API 安全密钥](https://lbs.amap.com/api/javascript-api-v2/guide/abc/jscode)、[JS API 加载](https://lbs.amap.com/api/javascript-api-v2/guide/abc/load)。

## 预览路线交给高德 App

优先传起点、终点与有序途经点，让高德 App 重新规划，再由用户确认。路线规划 URI 没有导入整条 polyline 的参数，所以预览中的道路、预计时长与 App 重算结果可能不同。这个限制也意味着“高架偏好”不能保证在交接后继续生效。

### Android

官方现行示例使用 `amapuri://route/plan/`。参数：

- `sourceApplication=city-wander`：调用方名称。
- `slon` / `slat` / `sname`：起点经纬度与名称；不传起点坐标时 App 使用当前位置。
- `dlon` / `dlat` / `dname`：终点经纬度与名称。已知 POI ID 可额外传 `sid` / `did`。
- `t=0`：驾车；`t=2`：步行。
- `dev=0`：坐标已是高德使用的 GCJ-02，不要再偏移。
- `vian`：途经点数量；`vialons` / `vialats` / `vianames`：用 `|` 分隔的等长列表。

例如以下 URL 的参数值应由 `URLSearchParams` 编码生成：

```text
amapuri://route/plan/?sourceApplication=city-wander&slon=121.4737&slat=31.2304&sname=出发点&dlon=121.4737&dlat=31.2304&dname=出发点&dev=0&t=0&vian=2&vialons=121.49|121.45&vialats=31.24|31.25&vianames=途经点一|途经点二
```

文档没有给出多途经点最大数或最低支持版本；不要擅自宣称无限途经点兼容性。旧文中的 `m` 驾车策略从 Android 7.5.9 起不再支持，使用 App 本地偏好。来源：[Android 路径规划](https://lbs.amap.com/api/amap-mobile/guide/android/route)。

### iOS

使用 `iosamap://path`，起终点、`t`、`dev` 和多途经点参数与上述相同。`m` 从 iOS 7.7.4 起不再支持，使用 App 本地偏好。来源：[iOS 路线规划](https://lbs.amap.com/api/amap-mobile/guide/ios/route)。

### Web URI 与备选方案

`https://uri.amap.com/navigation` 接受 `from`、`to`（格式均为 `经度,纬度,名称`）、`mode=car|walk`、`src`、`callnative=1`。其中 `via` **最多一个，仅驾车生效**。`callnative` 仅移动端尝试唤起 App，部分内置浏览器会拦截。来源：[URI API 路径规划](https://lbs.amap.com/api/uri-api/guide/travel/route)。

因此，多途经点线路不能静默截断为一个 `via` 后称为“发送整条路线”。备选方式是显示有序分段链接，逐段交接；步行也按段交接。面向已安装高德的 Android/iOS 用户，可优先提供原生 schema 的完整途经点交接，同时保留分段方式。按钮由用户点击触发，不能用定时自动唤起并报告成功；浏览器无法可靠知道 App 是否收到、是否开始导航。

## 发送到车机

本应用可打开手机高德的规划页，但当前查阅的公开 URI 文档未提供第三方 Web 应用直推用户车机的通用接口。这不是对所有商业合作接口的否定；只是本应用没有可依赖的公开协议。

高德车机版官方说明介绍了手机与车机登录同一账号后，通过地点详情的分享入口发送位置到车。来源：[高德车机版快速引导，第 10 节](https://mapdownload.autonavi.com/amapauto/auto/shuomingshu.pdf)。这份说明证明的是“发送位置”，不能据此保证整条多途经点路线无损同步。高德官网也将手车互联列为车机方案能力，但没有在公开页面承诺所有车型的路线导入行为。来源：[高德地图车机版](https://www.amapauto.com/)。

产品交互应说明：先在手机高德核对路线，再使用当前车型支持的“手车互联 / 发送到车”功能；具体入口、是否保留途经点，需要用户的车型、车机版本和手机版本实测。不要显示“已发送到车机”，除非将来接入了具备真实回执的协议。

### 杭州 + 高德车机版的第一次验证

1. 手机高德与车机高德登录同一账号，确保两端联网，并按车机提示完成手车互联。
2. 在本应用选择杭州的真实出发点，生成路线后先核对途经点与返程。
3. 在手机浏览器点击“打开高德”，在高德内核对途经点数量、顺序以及终点仍为出发点。
4. 如当前版本提供路线的“发送到车”入口，发送后在车机再次核对途经点；若只有地点分享功能，改用分段目的地，不能把它视为整条环线同步成功。


## 路线规划的相关边界

高德 Web 服务的驾车规划支持多个途经点，步行接口为起终点规划，步行环线需要按段计算并拼接。驾车 `strategy` 包含大路优先（37）和高速优先（34），但两者都不等于“高架优先”；高架只能作为候选路线的软偏好，不能承诺全程高架。来源：[路径规划 2.0](https://lbs.amap.com/api/webservice/guide/api/newroute)。

“兜风一小时”是本应用的目标函数：生成候选点，调用高德算实际道路与耗时，按时长偏差和地点偏好排序；这不是高德现成的随机路线 API。预计时长是估计，交通变化与 App 重算都会使它变化。

## 上线前真机核对

- Android Chrome、iOS Safari 打开原生路线链接，核对起点、终点和途经点的顺序与数量。
- 验证“起点等于终点”的环线是否被当前 App 版本保留；若被化简，使用分段方式。
- 确认多途经点在驾车、步行下的实际支持；官方参数表并未逐项声明所有模式的兼容细节。
- 浏览器不支持原生唤起、未安装高德、内置浏览器拦截时，显示分段备选。
- 对目标车机验证分享的是目的地、途经点序列还是完整路线；核对车端结果后才能承诺功能支持。
