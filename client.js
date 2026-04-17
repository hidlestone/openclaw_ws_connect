const WebSocket = require('ws');
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- 配置区 ---
const CONFIG = {
    wsUrl: '',
    token: '',
    httpPort: 3000,
    keyFile: path.join(__dirname, 'device_key.pem')
};

// ========== 密钥管理 ==========

function loadOrCreateKeyPair() {
    if (fs.existsSync(CONFIG.keyFile)) {
        console.log('🔑 加载已有设备密钥...');
        const privateKeyPem = fs.readFileSync(CONFIG.keyFile, 'utf-8');
        const privateKey = crypto.createPrivateKey(privateKeyPem);
        const publicKey = crypto.createPublicKey(privateKey);
        return {privateKey, publicKey};
    } else {
        console.log('🆕 生成新设备密钥对...');
        const {privateKey, publicKey} = crypto.generateKeyPairSync('ed25519', {
            privateKeyEncoding: {type: 'pkcs8', format: 'pem'},
            publicKeyEncoding: {type: 'spki', format: 'pem'}
        });
        fs.writeFileSync(CONFIG.keyFile, privateKey);
        console.log(`💾 私钥已保存到: ${CONFIG.keyFile}`);
        return {
            privateKey: crypto.createPrivateKey(privateKey),
            publicKey: crypto.createPublicKey(publicKey)
        };
    }
}

const {privateKey, publicKey} = loadOrCreateKeyPair();

// ========== 提取 32 字节原始公钥 ==========
const publicKeySpki = publicKey.export({type: 'spki', format: 'der'});
const rawPublicKey = publicKeySpki.slice(-32);

console.log('🔍 原始公钥长度:', rawPublicKey.length);
console.log('🔍 公钥 (hex):', rawPublicKey.toString('hex'));

// ========== Device ID 生成 ==========
function deriveDeviceId(rawPublicKey) {
    return crypto.createHash('sha256').update(rawPublicKey).digest('hex');
}

const deviceId = deriveDeviceId(rawPublicKey);
console.log('📱 设备 ID:', deviceId);

const publicKeyBase64 = rawPublicKey.toString('base64');
console.log('🔑 公钥 (Base64):', publicKeyBase64);

let ws = null;
let isReady = false;
let messageHistory = [];
let connectionStatus = 'disconnected'; // 新增：连接状态变量

function connect() {
    console.log('\n🌐 正在连接 OpenClaw 网关...');
    ws = new WebSocket(CONFIG.wsUrl);

    ws.on('open', () => {
        console.log('✅ WebSocket 基础连接已建立');
        console.log('⏳ 等待 connect.challenge...');
        isReady = false;
    });

    ws.on('message', (data) => {
        let msg;
        try {
            msg = JSON.parse(data);
        } catch (e) {
            console.error('❌ 消息解析失败:', data.toString());
            return;
        }

        console.log('\n📩 收到消息:', JSON.stringify(msg, null, 2));

        // 存储消息到历史记录
        messageHistory.push({
            type: 'received',
            content: msg,
            timestamp: new Date().toISOString()
        });

        if (msg.event === 'connect.challenge') {
            handleChallenge(msg.payload);
        }

        if (msg.type === 'res' && msg.ok === true && msg.payload?.type === 'hello-ok') {
            console.log('✨ 握手认证成功！连接已激活');
            isReady = true;
            connectionStatus = 'connected'; // 更新连接状态
        } else if (msg.type === 'res' && msg.ok === false) {
            console.error('❌ 握手失败:', msg.error);
            connectionStatus = 'disconnected'; // 更新连接状态
            if (msg.error?.details?.code?.includes('DEVICE')) {
                console.log('💡 提示：如需重置设备身份，请删除文件:', CONFIG.keyFile);
            }
        }
    });

    ws.on('close', (code, reason) => {
        console.log(`\n⚠️ 连接已断开 (code: ${code}, reason: ${reason})`);
        isReady = false;
        connectionStatus = 'disconnected'; // 更新连接状态
        // 移除自动重连逻辑，等待用户手动点击连接
    });

    ws.on('error', (err) => {
        console.error('🔴 WebSocket 错误:', err.message);
    });
}

/**
 * ========== v3 签名格式 ==========
 * v3|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce|platform|deviceFamily
 *
 * - scopes: 逗号分隔 "operator.read,operator.write"
 * - 添加 platform 和 deviceFamily
 */
function handleChallenge(payload) {
    const nonce = payload.nonce;
    const timestamp = Date.now();

    console.log(`\n🚀 收到 Challenge`);
    console.log(`   Nonce: ${nonce}`);
    console.log(`   Timestamp: ${timestamp}`);

    const clientId = 'cli';
    const clientMode = 'ui';  // 改为 operator
    const role = 'operator';
    const platform = 'macos';
    const deviceFamily = 'server';  // v3 新增

    // ========== 关键修复：v3 格式，逗号分隔 scopes，添加 platform 和 deviceFamily ==========
    const scopes = 'operator.read,operator.write';  // 逗号分隔，无空格
    const signPayload = `v3|${deviceId}|${clientId}|${clientMode}|${role}|${scopes}|${timestamp}|${CONFIG.token}|${nonce}|${platform}|${deviceFamily}`;

    console.log(`📝 v3 签名载荷: ${signPayload}`);

    // 使用私钥签名
    const signature = crypto.sign(null, Buffer.from(signPayload), privateKey);
    const signatureBase64 = signature.toString('base64');

    console.log(`✍️  签名长度: ${signatureBase64.length} 字符`);

    const handshakePayload = {
        type: 'req',
        id: `msg-${Date.now()}`,
        method: 'connect',
        params: {
            minProtocol: 3,
            maxProtocol: 3,
            client: {
                id: clientId,
                version: '1.2.3',
                platform: platform,
                mode: clientMode,
                deviceFamily: deviceFamily  // v3 新增
            },
            role: role,
            scopes: ['operator.read', 'operator.write'],  // 数组格式给服务器
            auth: {
                token: CONFIG.token
            },
            locale: 'zh-CN',
            userAgent: 'openclaw-cli/1.2.3',
            device: {
                id: deviceId,
                publicKey: publicKeyBase64,
                signature: signatureBase64,
                signedAt: timestamp,
                nonce: nonce
            }
        }
    };

    ws.send(JSON.stringify(handshakePayload));
    console.log('📤 握手请求已发送 (v3)');
    console.log(`   client.mode: "${clientMode}"`);
    console.log(`   scopes: "${scopes}"`);
    console.log(`   platform: "${platform}"`);
    console.log(`   deviceFamily: "${deviceFamily}"`);
}

// --- HTTP 接口 ---
app.post('/send', (req, res) => {
    try {
        ws.send(JSON.stringify(req.body));

        // 存储发送的消息到历史记录
        messageHistory.push({
            type: 'sent',
            content: req.body,
            timestamp: new Date().toISOString()
        });

        res.json({status: 'success', deviceId: deviceId, sent: req.body});
    } catch (e) {
        res.status(500).json({error: e.message, deviceId: deviceId});
    }
});

app.get('/status', (req, res) => {
    res.json({deviceId: deviceId, isReady: isReady, connectionStatus: connectionStatus});
});

app.get('/messages', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    const messages = messageHistory.slice(-limit);
    res.json({messages: messages, total: messageHistory.length});
});

app.post('/config', (req, res) => {
    const {wsUrl, token} = req.body;
    if (wsUrl) {
        CONFIG.wsUrl = wsUrl;
    }
    if (token) {
        CONFIG.token = token;
    }

    // 如果连接已存在，先关闭再重新连接
    if (ws) {
        ws.close();
        isReady = false;
        connectionStatus = 'disconnected';
    }

    connect();
    res.json({status: 'success', config: CONFIG});
});

app.post('/disconnect', (req, res) => {
    if (ws) {
        ws.close();
        isReady = false;
        connectionStatus = 'disconnected';
        res.json({status: 'success', message: '连接已断开'});
    } else {
        res.json({status: 'success', message: '无活动连接'});
    }
});

app.listen(CONFIG.httpPort, () => {
    console.log(`\n🌐 HTTP 接口已启动: http://localhost:${CONFIG.httpPort}`);
    console.log(`   密钥文件: ${CONFIG.keyFile}`);
    console.log(`   等待通过页面配置并连接...`);
});