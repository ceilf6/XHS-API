import express from 'express';
import axios from 'axios';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import multer from 'multer';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 配置multer用于文件上传
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB限制
});

const XHS_API_ENDPOINT = 'https://ark.xiaohongshu.com/ark/open_api/v3/common_controller';

function generateSignature(parameters, appSecret) {
  const entries = Object.entries(parameters).filter(([_, v]) => v !== undefined && v !== null && v !== '');
  const sortedKeys = entries.map(([k]) => k).sort();
  const query = sortedKeys.map((k) => `${k}=${Array.isArray(parameters[k]) ? JSON.stringify(parameters[k]) : parameters[k]}`).join('&');
  return crypto.createHmac('sha256', appSecret).update(query).digest('hex');
}

app.get('/r', async (req, res) => {
  try {
    const imageUrl = req.query.img;
    const name = req.query.name || 'Web上传图片';
    const type = (req.query.type || 'IMAGE').toUpperCase();
    if (!imageUrl) {
      return res.status(400).send('缺少参数: img');
    }

    const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const base64Image = Buffer.from(imageResponse.data).toString('base64');

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const payload = {
      name,
      type,
      materialContent: [base64Image],
      timestamp,
      appId: process.env.XHS_APP_ID,
      version: '2.0',
      method: process.env.XHS_METHOD_UPLOAD || 'uploadMaterial',
    };

    if (process.env.XHS_ACCESS_TOKEN) {
      payload.accessToken = process.env.XHS_ACCESS_TOKEN;
    }

    const appSecret = process.env.XHS_APP_SECRET || '';
    if (!payload.appId || !appSecret) {
      return res.status(500).send('服务端未配置 XHS_APP_ID 或 XHS_APP_SECRET');
    }

    payload.sign = generateSignature(payload, appSecret);

    const apiResponse = await axios.post(XHS_API_ENDPOINT, payload, {
      headers: { 'Content-Type': 'application/json;charset=utf-8' },
      timeout: 30000,
    });

    const data = apiResponse.data || {};
    const materialUrl = data.url || (data.data && data.data.url) || '';
    const materialId = data.materialId || (data.data && data.data.materialId) || '';

    const template = process.env.XHS_PUBLISH_SCHEME || 'xhsdiscover://creation?materialUrl={url}';
    const deepLink = template
      .replace('{url}', encodeURIComponent(materialUrl))
      .replace('{materialId}', encodeURIComponent(materialId));

    const fallbackStore = process.env.FALLBACK_APPSTORE_URL || 'https://apps.apple.com/cn/search?term=%E5%B0%8F%E7%BA%A2%E4%B9%A6';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>打开小红书发布页</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif; padding: 24px; }
    a.btn { background: #ff2442; color: #fff; padding: 12px 18px; border-radius: 10px; text-decoration: none; display: inline-block; }
    .tips { color: #666; margin-top: 12px; }
  </style>
  <script>
    function openApp() { window.location.href = document.getElementById('open-link').href; }
    window.addEventListener('load', function(){
      setTimeout(openApp, 500);
      setTimeout(function(){ window.location.href = '${fallbackStore}'; }, 3000);
    });
  </script>
  <meta name="apple-itunes-app" content="app-id=911999244" />
  <!-- app-id 请替换为小红书在 App Store 的真实 ID，如果已知 -->
  <meta http-equiv="refresh" content="6;url=${fallbackStore}" />
  <meta property="xhs:materialId" content="${materialId}" />
  <meta property="xhs:materialUrl" content="${materialUrl}" />
  <meta property="xhs:deepLink" content="${deepLink}" />
  <link rel="preload" href="${deepLink}" as="document" />
  <link rel="preload" href="${materialUrl}" as="fetch" crossorigin="anonymous" />
  <link rel="preconnect" href="https://ark.xiaohongshu.com" />
  <link rel="dns-prefetch" href="//ark.xiaohongshu.com" />
  <link rel="dns-prefetch" href="//www.xiaohongshu.com" />
  <link rel="dns-prefetch" href="//o3.xiaohongshu.com" />
  <link rel="dns-prefetch" href="//sns-img-qc.xhscdn.com" />
  <link rel="dns-prefetch" href="//sns-video-qc.xhscdn.com" />
  <script>window.XHS_DEEP_LINK = ${JSON.stringify(deepLink)};</script>
  <script type="application/json" id="xhs-material">${JSON.stringify({ materialId, materialUrl })}</script>
  <script>(function(){ var ifr = document.createElement('iframe'); ifr.style.display='none'; ifr.src='${deepLink}'; setTimeout(function(){document.body.appendChild(ifr);}, 800); setTimeout(function(){ if (ifr && ifr.parentNode) ifr.parentNode.removeChild(ifr); }, 3500); })();</script>
</head>
<body>
  <h3>即将打开小红书发布页</h3>
  <p class="tips">已成功上传素材：${name}。如未自动跳转，请点击下方按钮手动打开。</p>
  <p><a id="open-link" class="btn" href="${deepLink}">打开小红书</a></p>
  <p class="tips">若未安装小红书，将跳转至应用商店。</p>
</body>
</html>`);
  } catch (error) {
    const message = error?.response?.data || error?.message || 'Unknown error';
    res.status(500).send(`上传或跳转失败: ${typeof message === 'string' ? message : JSON.stringify(message)}`);
  }
});

// 测试端点 - 直接使用原始API调用，不需要配置env
app.post('/test-upload', async (req, res) => {
  try {
    const { name, type, materialContent } = req.body;
    
    // 使用你提供的示例代码
    const myHeaders = {
      "Content-Type": "application/json;charset=utf-8"
    };

    const raw = JSON.stringify({
      "name": name || "测试图片",
      "type": type || "VIDEO", 
      "materialContent": materialContent || ["string"]
    });

    const requestOptions = {
      method: 'POST',
      headers: myHeaders,
      body: raw,
      redirect: 'follow'
    };

    console.log('发送请求到 XHS API...');
    console.log('请求体:', raw);

    const response = await fetch("https://ark.xiaohongshu.com/ark/open_api/v3/common_controller", requestOptions);
    const result = await response.text();
    
    console.log('XHS API 响应:', result);

    // 尝试解析为JSON，如果失败则返回原始文本
    let parsedResult;
    try {
      parsedResult = JSON.parse(result);
    } catch (e) {
      parsedResult = { rawResponse: result };
    }

    res.json({
      success: true,
      status: response.status,
      statusText: response.statusText,
      data: parsedResult
    });

  } catch (error) {
    console.error('测试上传失败:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.toString()
    });
  }
});

// 直接文件上传接口
app.post('/upload-file', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: '没有上传文件' });
    }

    const { name, type } = req.body;
    
    // 将文件转换为base64
    const base64Content = req.file.buffer.toString('base64');
    
    // 自动判断文件类型
    let materialType = type;
    if (!materialType) {
      if (req.file.mimetype.startsWith('image/')) {
        materialType = 'IMAGE';
      } else if (req.file.mimetype.startsWith('video/')) {
        materialType = 'VIDEO';
      } else {
        materialType = 'IMAGE'; // 默认为图片
      }
    }

    const myHeaders = {
      "Content-Type": "application/json;charset=utf-8"
    };

    const raw = JSON.stringify({
      "name": name || req.file.originalname || "上传文件",
      "type": materialType,
      "materialContent": [base64Content]
    });

    console.log('上传文件信息:', {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      type: materialType
    });

    const requestOptions = {
      method: 'POST',
      headers: myHeaders,
      body: raw,
      redirect: 'follow'
    };

    const response = await fetch("https://ark.xiaohongshu.com/ark/open_api/v3/common_controller", requestOptions);
    const result = await response.text();
    
    console.log('XHS API 响应:', result);

    let parsedResult;
    try {
      parsedResult = JSON.parse(result);
    } catch (e) {
      parsedResult = { rawResponse: result };
    }

    res.json({
      success: true,
      status: response.status,
      statusText: response.statusText,
      fileInfo: {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        type: materialType
      },
      data: parsedResult
    });

  } catch (error) {
    console.error('文件上传失败:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.toString()
    });
  }
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${port}`);
});


