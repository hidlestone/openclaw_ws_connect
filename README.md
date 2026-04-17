# OpenClaw WebSocket 连接管理器

基于 Node.js 的 OpenClaw WebSocket 连接管理工具，提供了 Web 界面来配置和管理 WebSocket 连接。

## 功能特点

- 通过 Web 界面配置 WebSocket 连接参数
- 实时查看连接状态
- 发送和接收 WebSocket 消息
- 消息历史记录
- 自动重连机制

## 安装依赖

```bash
npm install
```

## 启动服务

```bash
node client.js
```

服务将在 http://localhost:3000 启动。

## 使用说明

1. 打开浏览器访问 http://localhost:3000
2. 在"连接配置"区域输入 WebSocket URL 和 Token
3. 点击"连接"按钮建立连接
4. 在"发送消息"区域输入要发送的消息（JSON 格式）
5. 点击"发送"按钮发送消息
6. 在"消息记录"区域查看发送和接收的消息

## API 端点

- `GET /status` - 获取连接状态
- `POST /config` - 更新 WebSocket 配置
- `POST /send` - 发送消息
- `GET /messages` - 获取消息历史记录

## 配置说明

默认配置在 `client.js` 中的 `CONFIG` 对象中：

```javascript
const CONFIG = {
    wsUrl: 'wss://wordplay.work?token=...',
    token: '...',
    httpPort: 3000,
    keyFile: path.join(__dirname, 'device_key.pem')
};
```

## 技术栈

- Node.js
- Express.js
- WebSocket (ws)
- 原生 JavaScript (前端)
