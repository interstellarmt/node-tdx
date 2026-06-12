# node-tdx

Node.js 实现的通达信（TDX）股票行情 TCP 协议客户端。直连通达信公开行情服务器（端口 `7709`），免费、零鉴权，提供 A 股 K 线、五档盘口、分时、分笔成交、证券列表等数据。

## 致谢与来源（Attribution）

本包的协议类型码、帧格式与数据解析逻辑**移植/参考**自以下开源项目，并以 TypeScript 重写了连接管理、心跳、自动重连、服务器测速等部分：

- **Go：[`github.com/injoyai/tdx`](https://github.com/injoyai/tdx)（MIT License）** —— 主要参考，协议解析逻辑以此为准。
- Python：[`github.com/mootdx/mootdx`](https://github.com/mootdx/mootdx) —— 部分结构（如盘口尾部字节）参考。

> 与 Go 原版的差异：原版价格返回浮点「元」，本包统一用整数「厘」（元 × 1000）作为 `Price` 类型以规避浮点精度问题；连接/重连/心跳/单例等运行期逻辑为本包自有实现。

依据 MIT 协议，使用方需保留上述版权与许可声明。`injoyai/tdx` 的完整 MIT 许可文本见其原始仓库。

## 特性

- K 线（多周期 + 历史）、五档盘口（批量）、当日/历史分时、当日/历史分笔成交
- 沪深京全量证券列表与名称解析
- 自动测速选择最快服务器、心跳保活、断线自动重连（可关闭）
- 纯 TypeScript，二进制协议结构化解析，无第三方行情依赖

## 目录结构

```
src/
  index.ts            # 统一导出（Client / 类型 / 编解码 / 命令）
  client.ts           # TdxClient：连接、心跳、重连、请求调度（高级 API 入口）
  server-list.ts      # 行情服务器 IP 列表 + 测速选最快节点
  protocol/           # 协议底层
    constants.ts      # 命令类型码、K 线周期、交易所枚举、默认端口
    types.ts          # Price / KlineBar / QuoteData 等类型 + 代码/单位辅助函数
    encoding.ts       # 变长整数、价格、成交量、时间等字段解码
    frame.ts          # 帧的编码 / 解码 / 拆包（extractFrame）
  commands/           # 各业务命令的请求构造 + 响应解析
    connect.ts        # 握手
    kline.ts          # K 线
    quote.ts          # 五档盘口
    minute.ts         # 当日 / 历史分时
    trade.ts          # 当日 / 历史分笔成交
    codelist.ts       # 证券数量 / 全量列表
```

分层关系：`commands/*` 与 `client.ts` 依赖 `protocol/*`（底层编解码与帧），`client.ts` 调用 `commands/*` 组合出高级 API，`index.ts` 统一对外导出。

## 安装

```bash
npm install node-tdx
# 或
pnpm add node-tdx
```

> 包以编译后的 `dist` 发布（`main: ./dist/index.js`，自带类型声明），开箱即用，无需额外构建。

## 快速开始

```ts
import { TdxClient, KlineCategory } from 'node-tdx';

const client = new TdxClient({ autoReconnect: false });

// 没有 'error' 监听者时，socket 异常会让进程崩溃，务必监听
client.on('error', (err) => console.error(err));

await client.connect(); // 自动选最快服务器

// K 线（日线，最近 10 根）
const kline = await client.getKline({
  code: 'sh600036',
  category: KlineCategory.Day,
  start: 0,
  count: 10,
});

// 五档盘口（支持批量）
const quotes = await client.getQuote(['sz000001', 'sh600036']);

// 分时 / 分笔
const minute = await client.getMinute('sh600036');
const trade = await client.getTrade('sh600036', 0, 100);

// 全量证券列表
import { Exchange } from 'node-tdx';
const list = await client.getStockList(Exchange.SH);

client.disconnect();
```

## 主要 API

| 方法                                                                             | 说明                            |
| -------------------------------------------------------------------------------- | ------------------------------- |
| `connect()` / `disconnect()` / `destroy()`                                       | 连接 / 断开 / 销毁（不可复用）  |
| `getKline({ code, category, start, count })`                                     | K 线                            |
| `getQuote(codes)`                                                                | 五档盘口，`string \| string[]`  |
| `getMinute(code)` / `getHistoryMinute(code, date)`                               | 当日 / 历史分时                 |
| `getTrade(code, start?, count?)` / `getHistoryTrade(code, date, start?, count?)` | 当日 / 历史分笔成交             |
| `getStockCount(exchange)` / `getStockList(exchange)`                             | 证券数量 / 全量列表（自动分页） |

事件：`connected`、`disconnected`、`reconnecting`、`message`、`error`。

### 单位约定

所有价格与成交额字段返回的是 **`Price` 类型 = 厘（元 × 1000）的整数**。需要元时除以 1000，或使用导出的 `priceToYuan(v)` / `yuanToPrice(v)` 辅助函数。成交量 `volume` 为原始值（手 / 股）。

## 构建

```bash
pnpm build   # tsc 编译到 dist
pnpm dev     # tsc --watch
```

## License

MIT。本包包含移植自 `github.com/injoyai/tdx`（MIT）的协议实现，相关版权归原作者所有。
