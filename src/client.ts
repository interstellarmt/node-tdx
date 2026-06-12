import { EventEmitter } from 'node:events';
import * as net from 'node:net';
import {
  buildCodeListRequest,
  buildCountRequest,
  CODE_LIST_PAGE_SIZE,
  parseCodeListResponse,
  parseCountResponse,
  type StockListItem,
} from './commands/codelist';
import { buildHeartbeatFrame, parseConnectResponse } from './commands/connect';
import {
  buildKlineRequest,
  parseKlineResponse,
  type KlineRequest,
  type KlineResponse,
} from './commands/kline';
import {
  buildHistoryMinuteRequest,
  buildMinuteRequest,
  parseHistoryMinuteResponse,
  parseMinuteResponse,
  type MinuteResponse,
} from './commands/minute';
import { buildQuoteRequest, parseQuoteResponse } from './commands/quote';
import {
  buildHistoryTradeRequest,
  buildTradeRequest,
  parseHistoryTradeResponse,
  parseTradeResponse,
  type TradeResponse,
} from './commands/trade';
import {
  CommandType,
  CONNECT_TIMEOUT,
  DEFAULT_PORT,
  Exchange,
  HEARTBEAT_INTERVAL,
  REQUEST_TIMEOUT,
} from './protocol/constants';
import {
  decodeResponse,
  encodeFrame,
  extractFrame,
  type DecodedResponse,
  type FrameOptions,
} from './protocol/frame';
import type { QuoteData } from './protocol/types';
import { isIndex } from './protocol/types';
import { getFastestHost } from './server-list';

export interface TdxClientOptions {
  /** 服务器 IP（不指定则自动测速选最快的） */
  host?: string;
  /** 端口，默认 7709 */
  port?: number;
  /** TCP 连接超时 ms，默认 5000 */
  connectTimeout?: number;
  /** 命令请求超时 ms，默认 10000 */
  requestTimeout?: number;
  /** 心跳间隔 ms，默认 30000 */
  heartbeatInterval?: number;
  /** 是否自动重连，默认 true */
  autoReconnect?: boolean;
}

interface PendingRequest {
  resolve: (response: DecodedResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class TdxClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private receiveBuffer: Buffer = Buffer.alloc(0);
  private msgIdCounter = 0;
  private pending = new Map<number, PendingRequest>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private connected = false;
  private connecting = false;
  private destroyed = false;
  private reconnectAttempts = 0;
  /** 请求串行化链：保证同一连接同一时刻只有一个在途请求 */
  private requestChain: Promise<unknown> = Promise.resolve();

  private readonly host?: string;
  private readonly port: number;
  private readonly connectTimeout: number;
  private readonly requestTimeout: number;
  private readonly heartbeatInterval: number;
  private readonly autoReconnect: boolean;

  private resolvedHost = '';

  constructor(options: TdxClientOptions = {}) {
    super();
    this.host = options.host;
    this.port = options.port ?? DEFAULT_PORT;
    this.connectTimeout = options.connectTimeout ?? CONNECT_TIMEOUT;
    this.requestTimeout = options.requestTimeout ?? REQUEST_TIMEOUT;
    this.heartbeatInterval = options.heartbeatInterval ?? HEARTBEAT_INTERVAL;
    this.autoReconnect = options.autoReconnect ?? true;
  }

  /** 是否已连接 */
  get isConnected(): boolean {
    return this.connected;
  }

  /** 当前连接的服务器地址 */
  get serverAddress(): string {
    return this.resolvedHost;
  }

  /**
   * 连接到通达信服务器
   */
  async connect(): Promise<string> {
    if (this.connected) return this.resolvedHost;
    if (this.connecting) throw new Error('Connection already in progress');
    if (this.destroyed) throw new Error('Client has been destroyed');

    this.connecting = true;

    try {
      // 如果没有指定 host，自动测速选最快的
      const targetHost = this.host ?? (await getFastestHost());
      this.resolvedHost = targetHost;

      await this.createConnection(targetHost);

      // 发送连接请求
      const connectResponse = await this.sendCommand({
        control: 0x01,
        type: CommandType.Connect,
        data: Buffer.from([0x01]),
      });

      const result = parseConnectResponse(connectResponse);
      this.connected = true;
      this.reconnectAttempts = 0;
      this.startHeartbeat();
      this.emit('connected', { host: targetHost, info: result.info });

      return targetHost;
    } finally {
      this.connecting = false;
    }
  }

  /**
   * 发送一个命令并等待响应。
   *
   * 通达信单条 TCP 连接虽在帧中携带 msgId，但参考实现（Go injoyai/tdx、pytdx/mootdx）
   * 均以锁串行化请求。这里通过一条 Promise 链将所有请求串行化：同一时刻只有一个在途
   * 请求，上一个 settle 后才发下一个，避免多路复用导致的响应错配 / 串包。
   */
  sendCommand(options: Omit<FrameOptions, 'msgId'>): Promise<DecodedResponse> {
    const run = this.requestChain.then(() => this.dispatch(options));
    // 让队列只关心"前一个是否结束"，吞掉其结果/异常，避免一个失败阻塞后续排队
    this.requestChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** 实际发送单个命令并等待其响应（不含排队逻辑） */
  private dispatch(options: Omit<FrameOptions, 'msgId'>): Promise<DecodedResponse> {
    return new Promise((resolve, reject) => {
      if (!this.socket || this.socket.destroyed) {
        reject(new Error('Not connected'));
        return;
      }

      const msgId = this.nextMsgId();
      const frame = encodeFrame({ ...options, msgId });

      const timer = setTimeout(() => {
        this.pending.delete(msgId);
        reject(new Error(`Request timeout (msgId=${msgId}, type=0x${options.type.toString(16)})`));
      }, this.requestTimeout);

      this.pending.set(msgId, { resolve, reject, timer });

      this.socket.write(frame, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(msgId);
          reject(err);
        }
      });
    });
  }

  // ─── 高级 API ──────────────────────────────────────────────────────────────

  /** 获取 K 线数据 */
  async getKline(request: KlineRequest): Promise<KlineResponse> {
    const frameOpts = buildKlineRequest(request);
    const response = await this.sendCommand(frameOpts);
    return parseKlineResponse(response.data, request.category, isIndex(request.code));
  }

  /** 获取五档盘口（支持批量） */
  async getQuote(codes: string | string[]): Promise<QuoteData[]> {
    const codeList = Array.isArray(codes) ? codes : [codes];
    const frameOpts = buildQuoteRequest(codeList);
    const response = await this.sendCommand(frameOpts);
    return parseQuoteResponse(response.data);
  }

  /** 获取当日分时数据 */
  async getMinute(code: string): Promise<MinuteResponse> {
    const frameOpts = buildMinuteRequest(code);
    const response = await this.sendCommand(frameOpts);
    return parseMinuteResponse(response.data);
  }

  /** 获取历史分时数据 */
  async getHistoryMinute(code: string, date: number): Promise<MinuteResponse> {
    const frameOpts = buildHistoryMinuteRequest(code, date);
    const response = await this.sendCommand(frameOpts);
    return parseHistoryMinuteResponse(response.data);
  }

  /** 获取当日分笔成交 */
  async getTrade(code: string, start?: number, count?: number): Promise<TradeResponse> {
    const frameOpts = buildTradeRequest(code, start, count);
    const response = await this.sendCommand(frameOpts);
    return parseTradeResponse(response.data, code);
  }

  /** 获取历史分笔成交 */
  async getHistoryTrade(
    code: string,
    date: number,
    start?: number,
    count?: number,
  ): Promise<TradeResponse> {
    const frameOpts = buildHistoryTradeRequest(code, date, start, count);
    const response = await this.sendCommand(frameOpts);
    return parseHistoryTradeResponse(response.data, code);
  }

  /** 获取指定交易所的证券数量 */
  async getStockCount(exchange: Exchange): Promise<number> {
    const response = await this.sendCommand(buildCountRequest(exchange));
    return parseCountResponse(response.data);
  }

  /** 获取指定交易所的全部证券列表（自动分页拉取） */
  async getStockList(exchange: Exchange): Promise<StockListItem[]> {
    const count = await this.getStockCount(exchange);
    const all: StockListItem[] = [];
    for (let start = 0; start < count; start += CODE_LIST_PAGE_SIZE) {
      const response = await this.sendCommand(buildCodeListRequest(exchange, start));
      const items = parseCodeListResponse(response.data, exchange);
      if (items.length === 0) break;
      all.push(...items);
    }
    return all;
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    this.cleanup();
  }

  /**
   * 销毁客户端（不可复用）
   */
  destroy(): void {
    this.destroyed = true;
    this.cleanup();
  }

  // ─── 内部方法 ─────────────────────────────────────────────────────────────

  private nextMsgId(): number {
    return this.msgIdCounter++;
  }

  private createConnection(host: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      this.socket = socket;
      this.receiveBuffer = Buffer.alloc(0);

      // 启用 OS 级 TCP keepalive，探测"对端静默死亡"（无 FIN/RST）的半开连接，
      // 触发 'error'/'close' 后由重连逻辑接管；空闲期也不会误判。
      socket.setKeepAlive(true, this.heartbeatInterval);

      const connectTimer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Connection timeout: ${host}:${this.port}`));
      }, this.connectTimeout);

      socket.connect(this.port, host, () => {
        clearTimeout(connectTimer);
        resolve();
      });

      socket.on('data', (chunk: Buffer) => {
        this.onData(chunk);
      });

      socket.on('error', (err) => {
        clearTimeout(connectTimer);
        if (!this.connected) {
          // 连接阶段失败：通过 connect() 的 reject 向上反馈
          reject(err);
        }
        // 运行期 socket 错误（如 ECONNRESET）随后会触发 'close'，
        // 由 close 统一拒绝在途请求并按需重连。
        // EventEmitter 在没有 'error' 监听者时会直接抛错杀死进程，
        // 因此仅在存在监听者时再向上 emit。
        if (this.listenerCount('error') > 0) {
          this.emit('error', err);
        }
      });

      socket.on('close', () => {
        const wasConnected = this.connected;
        this.connected = false;
        this.stopHeartbeat();
        this.rejectAllPending(new Error('Connection closed'));

        if (wasConnected) {
          this.emit('disconnected');
          if (this.autoReconnect && !this.destroyed) {
            this.scheduleReconnect();
          }
        }
      });
    });
  }

  private onData(chunk: Buffer): void {
    this.receiveBuffer = Buffer.concat([this.receiveBuffer, chunk]) as Buffer<ArrayBuffer>;

    // 持续尝试从缓冲区提取完整帧
    while (true) {
      const [remaining, frameBuffer] = extractFrame(this.receiveBuffer);
      this.receiveBuffer = remaining;

      if (!frameBuffer) break;

      try {
        const response = decodeResponse(frameBuffer);
        this.handleResponse(response);
      } catch (err) {
        if (this.listenerCount('error') > 0) {
          this.emit('error', err);
        }
      }
    }
  }

  private handleResponse(response: DecodedResponse): void {
    const pending = this.pending.get(response.msgId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(response.msgId);
      pending.resolve(response);
    } else {
      // 可能是心跳响应或未知消息
      this.emit('message', response);
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.connected || !this.socket) return;
      const msgId = this.nextMsgId();
      const frame = buildHeartbeatFrame(msgId);
      this.socket.write(frame);
    }, this.heartbeatInterval);
    // 不让心跳 timer 阻止进程退出
    this.heartbeatTimer.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private cleanup(): void {
    this.stopHeartbeat();
    this.rejectAllPending(new Error('Client disconnected'));
    this.connected = false;
    this.connecting = false;
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }

  private scheduleReconnect(): void {
    // 指数退避：3s, 6s, 12s, 24s … 上限 30s，避免服务器长时间不可用时空转重试
    const delay = Math.min(3000 * 2 ** this.reconnectAttempts, 30000);
    this.reconnectAttempts++;
    const timer = setTimeout(async () => {
      if (this.destroyed || this.connected) return;
      try {
        this.emit('reconnecting');
        await this.connect();
      } catch {
        this.scheduleReconnect();
      }
    }, delay);
    // 不让重连 timer 阻止进程退出
    timer.unref();
  }
}
