import express from 'express';
import axios from 'axios';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import multer from 'multer';
import QRCode from 'qrcode';

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

// 临时存储上传的文件信息
const tempFiles = new Map();

// 上传文件到小红书并生成深度链接二维码
app.post('/upload-and-generate-qr', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: '没有上传文件' });
    }

    const { name } = req.body;
    const fileName = name || req.file.originalname || '上传图片';
    
    // 将文件转换为base64
    const base64Content = req.file.buffer.toString('base64');
    
    // 自动判断文件类型
    let materialType = 'IMAGE';
    if (req.file.mimetype.startsWith('video/')) {
      materialType = 'VIDEO';
    }

    console.log('开始上传到小红书:', {
      originalname: req.file.originalname,
      size: req.file.size,
      type: materialType
    });

    // 检查是否配置了小红书API
    const appId = process.env.XHS_APP_ID;
    const appSecret = process.env.XHS_APP_SECRET;
    
    let deepLink;
    let materialUrl;
    let isDemo = false;

    if (appId && appSecret) {
      // 真实上传到小红书API
      try {
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const payload = {
          name: fileName,
          type: materialType,
          materialContent: [base64Content],
          timestamp,
          appId: appId,
          version: '2.0',
          method: process.env.XHS_METHOD_UPLOAD || 'uploadMaterial',
        };

        if (process.env.XHS_ACCESS_TOKEN) {
          payload.accessToken = process.env.XHS_ACCESS_TOKEN;
        }

        payload.sign = generateSignature(payload, appSecret);

        const apiResponse = await fetch(XHS_API_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json;charset=utf-8' },
          body: JSON.stringify(payload),
          timeout: 30000,
        });

        const apiResult = await apiResponse.text();
        console.log('小红书API响应:', apiResult);

        let parsedResult;
        try {
          parsedResult = JSON.parse(apiResult);
        } catch (e) {
          parsedResult = { rawResponse: apiResult };
        }

        // 从API响应中获取真实的materialUrl
        materialUrl = parsedResult.url || (parsedResult.data && parsedResult.data.url) || '';
        
        if (materialUrl) {
          // 为真实上传生成跳转页面
          const realFileId = 'real_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
          tempFiles.set(realFileId, {
            buffer: req.file.buffer,
            originalname: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size,
            name: fileName,
            uploadTime: Date.now(),
            realMaterialUrl: materialUrl // 存储真实的materialUrl
          });

          // 5分钟后自动清理
          setTimeout(() => {
            tempFiles.delete(realFileId);
          }, 5 * 60 * 1000);

          deepLink = `${process.env.BASE_URL || 'http://localhost:3000'}/xhs-jump/${realFileId}`;
        } else {
          throw new Error('小红书API未返回有效的materialUrl');
        }

      } catch (apiError) {
        console.error('小红书API调用失败:', apiError);
        // 降级到演示模式
        isDemo = true;
        
        // 降级模式下，将文件存储到临时存储，使用文件ID
        const fileId = 'fallback_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        tempFiles.set(fileId, {
          buffer: req.file.buffer,
          originalname: req.file.originalname,
          mimetype: req.file.mimetype,
          size: req.file.size,
          name: fileName,
          uploadTime: Date.now()
        });

        // 5分钟后自动清理
        setTimeout(() => {
          tempFiles.delete(fileId);
        }, 5 * 60 * 1000);

        // 使用跳转页面URL而不是直接的数据URL
        materialUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/material/${fileId}`;
        
        // 生成跳转页面，而不是直接的深度链接
        deepLink = `${process.env.BASE_URL || 'http://localhost:3000'}/xhs-jump/${fileId}`;
      }
    } else {
      // 演示模式 - 未配置API密钥
      isDemo = true;
      
      // 演示模式下，将文件存储到临时存储，使用文件ID
      const fileId = 'demo_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      tempFiles.set(fileId, {
        buffer: req.file.buffer,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        name: fileName,
        uploadTime: Date.now()
      });

      // 5分钟后自动清理
      setTimeout(() => {
        tempFiles.delete(fileId);
      }, 5 * 60 * 1000);

      // 使用跳转页面URL而不是直接的数据URL
      materialUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/material/${fileId}`;
      
      // 生成跳转页面，而不是直接的深度链接
      deepLink = `${process.env.BASE_URL || 'http://localhost:3000'}/xhs-jump/${fileId}`;
    }

    // 生成二维码
    const QRCode = (await import('qrcode')).default;
    const qrCodeDataURL = await QRCode.toDataURL(deepLink, {
      width: 200,
      height: 200,
      margin: 2,
      colorDark: '#000000',
      colorLight: '#ffffff',
      errorCorrectionLevel: 'M'
    });

    res.json({
      success: true,
      isDemo: isDemo,
      fileInfo: {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        name: fileName,
        type: materialType
      },
      materialUrl: materialUrl,
      deepLink: deepLink,
      qrCode: qrCodeDataURL
    });

  } catch (error) {
    console.error('上传并生成二维码失败:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.toString()
    });
  }
});

// 提供材料文件访问
app.get('/material/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    
    // 从临时存储中获取文件信息
    const fileInfo = tempFiles.get(fileId);
    
    if (!fileInfo) {
      return res.status(404).json({ 
        success: false, 
        error: '文件不存在或已过期' 
      });
    }

    // 设置正确的Content-Type
    res.setHeader('Content-Type', fileInfo.mimetype);
    res.setHeader('Content-Disposition', `inline; filename="${fileInfo.originalname}"`);
    
    // 返回文件内容
    res.send(fileInfo.buffer);

  } catch (error) {
    console.error('获取材料文件失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 小红书跳转页面 - 多种深度链接尝试
app.get('/xhs-jump/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    
    // 从临时存储中获取文件信息
    const fileInfo = tempFiles.get(fileId);
    
    if (!fileInfo) {
      return res.status(404).send(`
        <div style="text-align: center; padding: 50px; font-family: Arial, sans-serif;">
          <h2>❌ 文件不存在或已过期</h2>
          <p>该文件可能已被清理或链接已过期（5分钟有效期）</p>
          <p><a href="/">返回上传页面</a></p>
        </div>
      `);
    }

    // 确定materialUrl
    let materialUrl;
    if (fileInfo.realMaterialUrl) {
      // 真实上传的情况
      materialUrl = fileInfo.realMaterialUrl;
    } else {
      // 演示模式
      materialUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/material/${fileId}`;
    }

    console.log('准备跳转到小红书:', {
      fileId,
      originalname: fileInfo.originalname,
      materialUrl: materialUrl
    });

    // 小红书APP相关链接
    const xhsAppStoreUrl = 'https://apps.apple.com/cn/app/%E5%B0%8F%E7%BA%A2%E4%B9%A6/id741292507';
    const xhsWebUrl = 'https://www.xiaohongshu.com';
    
    // 尝试的深度链接格式
    const deepLinks = [
      `xhsdiscover://`,
      `xiaohongshu://`,
      `xhs://`,
      xhsWebUrl,
    ];

    const fallbackStore = 'https://apps.apple.com/cn/app/%E5%B0%8F%E7%BA%A2%E4%B9%A6/id741292507';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>跳转到小红书发布页面</title>
  <style>
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; 
      padding: 24px; 
      text-align: center;
      background: linear-gradient(135deg, #ff2442 0%, #ff6b8a 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      background: white;
      border-radius: 20px;
      padding: 40px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.1);
      max-width: 500px;
    }
    .success-icon { font-size: 64px; margin-bottom: 20px; }
    h1 { color: #ff2442; margin-bottom: 15px; }
    .file-info {
      background: #f8f9fa;
      border-radius: 10px;
      padding: 20px;
      margin: 20px 0;
      text-align: left;
    }
    .file-info h3 { margin-top: 0; color: #333; }
    .file-info p { margin: 5px 0; color: #666; font-size: 14px; }
    .preview-img {
      max-width: 200px;
      max-height: 200px;
      border-radius: 8px;
      margin: 15px 0;
    }
    a.btn { 
      background: #ff2442; 
      color: #fff; 
      padding: 15px 30px; 
      border-radius: 25px; 
      text-decoration: none; 
      display: inline-block;
      font-weight: bold;
      margin: 10px;
      text-decoration: none;
    }
    .tips { color: #666; margin-top: 20px; font-size: 14px; line-height: 1.6; }
    .try-links {
      background: #e3f2fd;
      border: 1px solid #90caf9;
      border-radius: 8px;
      padding: 15px;
      margin: 15px 0;
      text-align: left;
    }
    .try-links h4 { margin-top: 0; color: #1565c0; }
    .try-links a { 
      display: block; 
      color: #1565c0; 
      margin: 5px 0; 
      padding: 8px;
      background: #f3f4f6;
      border-radius: 5px;
      text-decoration: none;
      font-size: 12px;
      word-break: break-all;
    }
  </style>
  <script>
    function manualTry(link) {
      // 尝试打开深度链接
      window.location.href = link;
      
      // 如果3秒后还在当前页面，说明没有安装APP，显示提示
      setTimeout(() => {
        if (!document.hidden) {
          alert('似乎没有安装小红书APP，请下载后重试');
        }
      }, 3000);
    }
    
    // 自动尝试打开小红书APP
    window.addEventListener('load', function(){
      console.log('页面加载完成');
      // 给用户2秒时间查看页面内容
      setTimeout(() => {
        console.log('尝试打开小红书APP...');
        manualTry('xhsdiscover://');
      }, 2000);
    });
  </script>
</head>
<body>
  <div class="container">
    <div class="success-icon">📱</div>
    <h1>正在打开小红书</h1>
    
    <div class="file-info">
      <h3>📁 文件信息</h3>
      <p><strong>文件名：</strong>${fileInfo.originalname}</p>
      <p><strong>文件大小：</strong>${(fileInfo.size / 1024).toFixed(1)} KB</p>
      <p><strong>文件类型：</strong>${fileInfo.mimetype}</p>
      ${fileInfo.mimetype.startsWith('image/') ? 
        `<img src="/material/${fileId}" alt="预览" class="preview-img">` : 
        '<p>📹 视频文件已处理</p>'
      }
    </div>
    
    <div style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 20px; margin: 20px 0; color: #856404;">
      <h3 style="margin-top: 0;">📋 手动操作指南</h3>
      <p><strong>由于小红书APP的限制，无法直接跳转到发布页面，请按以下步骤操作：</strong></p>
      <ol style="text-align: left; margin-left: 20px; line-height: 1.8;">
        <li><strong>保存上方图片</strong> - 长按图片保存到相册</li>
        <li><strong>打开小红书APP</strong> - 点击下方按钮或手动打开</li>
        <li><strong>开始发布</strong> - 点击底部"+"号按钮</li>
        <li><strong>选择图片</strong> - 从相册中选择刚保存的图片</li>
        <li><strong>编辑发布</strong> - 添加标题和内容后发布</li>
      </ol>
    </div>
    
    <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
      <a class="btn" href="xhsdiscover://" onclick="manualTry('xhsdiscover://')">🚀 打开小红书APP</a>
      <a class="btn" href="${xhsAppStoreUrl}" style="background: #28a745;">📲 下载小红书</a>
    </div>
    
    <div style="background: #e8f5e8; border-left: 4px solid #28a745; padding: 15px; margin: 20px 0; text-align: left;">
      <strong>💡 提示：</strong><br>
      • 图片已处理完成，可直接保存使用<br>
      • 建议在WiFi环境下操作以节省流量<br>
      • 如需帮助，请联系技术支持
    </div>
  </div>
</body>
</html>`);

  } catch (error) {
    console.error('跳转处理失败:', error);
    res.status(500).send(`处理失败: ${error.message}`);
  }
});

// 通过文件ID跳转到小红书
app.get('/jump/:fileId', async (req, res) => {
  try {
    const { fileId } = req.params;
    
    // 从临时存储中获取文件信息
    const fileInfo = tempFiles.get(fileId);
    
    if (!fileInfo) {
      return res.status(404).send(`
        <div style="text-align: center; padding: 50px; font-family: Arial, sans-serif;">
          <h2>❌ 文件不存在或已过期</h2>
          <p>该文件可能已被清理或链接已过期（5分钟有效期）</p>
          <p><a href="/">返回上传页面</a></p>
        </div>
      `);
    }

    // 将文件转换为base64
    const base64Content = fileInfo.buffer.toString('base64');
    
    // 自动判断文件类型
    let materialType = 'IMAGE';
    if (fileInfo.mimetype.startsWith('video/')) {
      materialType = 'VIDEO';
    }

    console.log('处理跳转请求:', {
      fileId,
      originalname: fileInfo.originalname,
      size: fileInfo.size,
      type: materialType
    });

    // 模拟小红书响应（演示模式）
    const demoMaterialUrl = `data:${fileInfo.mimetype};base64,${base64Content}`;
    const demoMaterialId = fileId;
    
    // 创建深度链接
    const deepLink = `xhsdiscover://creation?materialUrl=${encodeURIComponent(demoMaterialUrl)}`;
    const fallbackStore = 'https://apps.apple.com/cn/search?term=%E5%B0%8F%E7%BA%A2%E4%B9%A6';

    // 使用完后清理文件
    tempFiles.delete(fileId);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>扫码成功 - 跳转小红书</title>
  <style>
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; 
      padding: 24px; 
      text-align: center;
      background: linear-gradient(135deg, #ff2442 0%, #ff6b8a 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      background: white;
      border-radius: 20px;
      padding: 40px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.1);
      max-width: 500px;
    }
    .success-icon { font-size: 64px; margin-bottom: 20px; }
    h1 { color: #ff2442; margin-bottom: 15px; }
    .file-info {
      background: #f8f9fa;
      border-radius: 10px;
      padding: 20px;
      margin: 20px 0;
      text-align: left;
    }
    .file-info h3 { margin-top: 0; color: #333; }
    .file-info p { margin: 5px 0; color: #666; font-size: 14px; }
    .preview-img {
      max-width: 200px;
      max-height: 200px;
      border-radius: 8px;
      margin: 15px 0;
    }
    a.btn { 
      background: #ff2442; 
      color: #fff; 
      padding: 15px 30px; 
      border-radius: 25px; 
      text-decoration: none; 
      display: inline-block;
      font-weight: bold;
      margin: 10px;
    }
    .tips { color: #666; margin-top: 20px; font-size: 14px; line-height: 1.6; }
    .demo-note {
      background: #e8f5e8;
      border: 1px solid #a8d5a8;
      border-radius: 8px;
      padding: 15px;
      margin-top: 20px;
      color: #2d5a2d;
      font-size: 14px;
    }
  </style>
  <script>
    function openApp() { 
      console.log('扫码成功，跳转到小红书APP...');
      window.location.href = '${deepLink}'; 
    }
    window.addEventListener('load', function(){
      console.log('扫码页面加载完成，准备跳转...');
      setTimeout(openApp, 1000);
      setTimeout(function(){ 
        console.log('回退到应用商店...');
        window.location.href = '${fallbackStore}'; 
      }, 5000);
    });
  </script>
</head>
<body>
  <div class="container">
    <div class="success-icon">📱</div>
    <h1>扫码成功！</h1>
    
    <div class="file-info">
      <h3>📁 文件信息</h3>
      <p><strong>文件名：</strong>${fileInfo.originalname}</p>
      <p><strong>文件大小：</strong>${(fileInfo.size / 1024).toFixed(1)} KB</p>
      <p><strong>文件类型：</strong>${fileInfo.mimetype}</p>
      <p><strong>素材类型：</strong>${materialType}</p>
      ${fileInfo.mimetype.startsWith('image/') ? 
        `<img src="${demoMaterialUrl}" alt="预览" class="preview-img">` : 
        '<p>📹 视频文件已处理</p>'
      }
    </div>
    
    <a class="btn" href="${deepLink}" onclick="openApp()">🚀 立即打开小红书</a>
    
    <div class="tips">
      📱 <strong>正在自动跳转...</strong><br>
      如果没有自动跳转，请点击上方按钮<br>
      📲 没有安装小红书？将跳转到应用商店
    </div>
    
    <div class="demo-note">
      <strong>✅ 扫码上传成功</strong><br>
      文件已成功处理，即将跳转到小红书APP发布页面。这是演示模式，配置API密钥后可实现真实上传。
    </div>
  </div>
</body>
</html>`);

  } catch (error) {
    console.error('跳转处理失败:', error);
    res.status(500).send(`处理失败: ${error.message}`);
  }
});

// 生成二维码API
app.get('/generate-qr', async (req, res) => {
  try {
    const { url, size = 200 } = req.query;
    
    if (!url) {
      return res.status(400).json({ error: '缺少URL参数' });
    }

    // 生成二维码
    const qrCodeDataURL = await QRCode.toDataURL(url, {
      width: parseInt(size),
      height: parseInt(size),
      margin: 2,
      colorDark: '#000000',
      colorLight: '#ffffff',
      errorCorrectionLevel: 'M'
    });

    res.json({
      success: true,
      qrCode: qrCodeDataURL,
      url: url
    });

  } catch (error) {
    console.error('生成二维码失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 本地文件上传路由 - 直接跳转到小红书
app.post('/upload-and-redirect', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send('没有上传文件');
    }

    const { name } = req.body;
    const fileName = name || req.file.originalname || '本地上传图片';
    
    // 将文件转换为base64
    const base64Content = req.file.buffer.toString('base64');
    
    // 自动判断文件类型
    let materialType = 'IMAGE';
    if (req.file.mimetype.startsWith('video/')) {
      materialType = 'VIDEO';
    }

    console.log('本地文件上传:', {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      type: materialType,
      base64Length: base64Content.length
    });

    // 模拟小红书响应（演示模式）
    const demoMaterialUrl = `data:${req.file.mimetype};base64,${base64Content}`;
    const demoMaterialId = 'local_' + Date.now();
    
    // 创建深度链接（实际应该包含真实的materialUrl）
    const deepLink = `xhsdiscover://creation?materialUrl=${encodeURIComponent(demoMaterialUrl)}`;
    const fallbackStore = 'https://apps.apple.com/cn/search?term=%E5%B0%8F%E7%BA%A2%E4%B9%A6';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>本地图片已处理 - 打开小红书</title>
  <style>
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; 
      padding: 24px; 
      text-align: center;
      background: linear-gradient(135deg, #ff2442 0%, #ff6b8a 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      background: white;
      border-radius: 20px;
      padding: 40px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.1);
      max-width: 500px;
    }
    .success-icon { font-size: 64px; margin-bottom: 20px; }
    h1 { color: #ff2442; margin-bottom: 15px; }
    .file-info {
      background: #f8f9fa;
      border-radius: 10px;
      padding: 20px;
      margin: 20px 0;
      text-align: left;
    }
    .file-info h3 { margin-top: 0; color: #333; }
    .file-info p { margin: 5px 0; color: #666; font-size: 14px; }
    .preview-img {
      max-width: 200px;
      max-height: 200px;
      border-radius: 8px;
      margin: 15px 0;
    }
    a.btn { 
      background: #ff2442; 
      color: #fff; 
      padding: 15px 30px; 
      border-radius: 25px; 
      text-decoration: none; 
      display: inline-block;
      font-weight: bold;
      margin: 10px;
    }
    .tips { color: #666; margin-top: 20px; font-size: 14px; line-height: 1.6; }
    .demo-note {
      background: #e3f2fd;
      border: 1px solid #90caf9;
      border-radius: 8px;
      padding: 15px;
      margin-top: 20px;
      color: #1565c0;
      font-size: 14px;
    }
  </style>
  <script>
    function openApp() { 
      console.log('尝试打开小红书APP...');
      window.location.href = '${deepLink}'; 
    }
    window.addEventListener('load', function(){
      console.log('页面加载完成，准备跳转...');
      setTimeout(openApp, 1500);
      setTimeout(function(){ 
        console.log('回退到应用商店...');
        window.location.href = '${fallbackStore}'; 
      }, 6000);
    });
  </script>
</head>
<body>
  <div class="container">
    <div class="success-icon">✅</div>
    <h1>本地图片处理完成！</h1>
    
    <div class="file-info">
      <h3>📁 文件信息</h3>
      <p><strong>文件名：</strong>${req.file.originalname}</p>
      <p><strong>文件大小：</strong>${(req.file.size / 1024).toFixed(1)} KB</p>
      <p><strong>文件类型：</strong>${req.file.mimetype}</p>
      <p><strong>素材类型：</strong>${materialType}</p>
      ${req.file.mimetype.startsWith('image/') ? 
        `<img src="${demoMaterialUrl}" alt="预览" class="preview-img">` : 
        '<p>📹 视频文件已处理</p>'
      }
    </div>
    
    <a class="btn" href="${deepLink}" onclick="openApp()">🚀 打开小红书发布</a>
    
    <div class="tips">
      📱 <strong>自动跳转中...</strong><br>
      如果没有自动跳转，请点击上方按钮<br>
      📲 没有安装小红书？将跳转到应用商店
    </div>
    
    <div class="demo-note">
      <strong>💡 本地文件测试模式</strong><br>
      文件已成功转换为base64格式，可以模拟完整的上传流程。配置API密钥后即可实现真实上传。
    </div>
  </div>
</body>
</html>`);

  } catch (error) {
    console.error('本地文件处理失败:', error);
    res.status(500).send(`处理失败: ${error.message}`);
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


