## 小红书扫码上传并打开发布页（示例）

流程：
- Web 侧输入图片直链，生成二维码。
- 手机扫码访问 `/r?img=...`，服务端抓取图片、Base64 编码，调用小红书素材上传接口。
- 返回一个页面尝试通过 URL Scheme 打开小红书发布页，并回落到应用商店。

参考文档：见小红书 Apifox 文档的“上传素材”接口（`/ark/open_api/v3/common_controller`）。

### 本地运行

1. 安装依赖：
   ```bash
   cd 尝试
   npm install
   ```
2. 复制并填写环境变量：
   ```bash
   cp .env.example .env
   # 编辑 .env，填入 XHS_APP_ID / XHS_APP_SECRET 等
   ```
3. 启动：
   ```bash
   npm start
   ```
4. 打开 `http://localhost:3000/` 生成二维码。

### 注意事项
- `sign` 的生成依据官方“签名算法”文档，当前实现为 key 升序 + HMAC-SHA256(secret)。如与官方要求不一致，请按官方规则修改 `generateSignature`。
- URL Scheme `XHS_PUBLISH_SCHEME` 需替换为官方提供的“打开发布页”跳转格式，可使用占位符 `{url}` 或 `{materialId}`。
- 如果小红书返回字段结构与示例不同，请在 `server.js` 中根据实际返回结构取值。



'''
快速使用步骤（本地）
前置
你已在 尝试/ 目录安装依赖并启动服务（已在运行: http://localhost:3000）。
若需重新启动，请在 尝试/ 下执行：
start
配置环境变量
复制示例并填写小红书开放平台的凭据：
env
编辑 .env，至少填写：
}
注意：签名算法与 URL Scheme 以官方为准，参考文档见文末链接。
生成二维码（Web）
打开浏览器访问：http://localhost:3000/
粘贴一张“能直接下载访问”的图片直链（HTTPS），点击“生成二维码”。
页面会展示一个二维码和对应链接。
手机扫码与跳转（移动端）
用手机扫码该二维码。
服务端会：
拉取图片 → Base64 → 调用小红书“上传素材”接口（/ark/open_api/v3/common_controller）。
拿到素材 url/materialId 后，生成配置好的 deep link，尝试打开小红书发布页。
若未安装小红书，将跳转到应用商店（可在 .env 配置回落地址）。
常见问题
必填参数未配置
确保 .env 中 XHS_APP_ID、XHS_APP_SECRET 已填写；若业务接口要求 accessToken，请补充 XHS_ACCESS_TOKEN。
无法打开发布页
确认 XHS_PUBLISH_SCHEME 为官方提供、可打开“发布页面”的 Scheme，并根据支持情况使用 {url} 或 {materialId} 占位符。
403/签名失败
根据官方“签名算法”文档校对 server.js 中的签名实现（当前为“key升序 + HMAC-SHA256(secret)”），若与官方不一致，请按文档改。
文档引用
小红书开放平台·上传素材（POST /ark/open_api/v3/common_controller）：Apifox 文档
已搭建本地服务并运行，提供 /r?img=... 路由实现“扫码→上传素材→尝试打开发布页”。
使用步骤：配置 .env → 打开 http://localhost:3000/ 生成二维码 → 手机扫码自动上传并唤起小红书。
'''