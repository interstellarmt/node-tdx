import { CommandType, KlineCategory, MINUTE_KLINE_CATEGORIES } from '../protocol/constants';
import { decodeDayTime, decodeMinuteTime, decodeVolume, readVarInt } from '../protocol/encoding';
import type { FrameOptions } from '../protocol/frame';
import type { KlineBar, Price } from '../protocol/types';
import { parseCode } from '../protocol/types';

// ─── 请求构造 ──────────────────────────────────────────────────────────────────

export interface KlineRequest {
  /** 股票代码，如 '600036' 或 'sh600036' */
  code: string;
  /** K 线周期 */
  category: KlineCategory;
  /** 起始位置（0 = 最新，往前倒推） */
  start?: number;
  /** 数量（最大 800） */
  count?: number;
}

/**
 * 构造 K 线请求的帧参数
 *
 * Data 格式:
 * [0]     Exchange   u8
 * [1]     0x00       u8
 * [2:8]   Code       6 bytes ASCII
 * [8]     Category   u8
 * [9]     0x00       u8
 * [10:12] 0x0100     u16 LE (固定)
 * [12:14] Start      u16 LE
 * [14:16] Count      u16 LE
 * [16:26] 0x00×10    padding
 */
export function buildKlineRequest(request: KlineRequest): Omit<FrameOptions, 'msgId'> {
  const { exchange, code } = parseCode(request.code);
  const category = request.category;
  const start = request.start ?? 0;
  const count = Math.min(request.count ?? 800, 800);

  const data = Buffer.alloc(26);
  data[0] = exchange;
  data[1] = 0x00;
  data.write(code, 2, 6, 'ascii');
  data[8] = category;
  data[9] = 0x00;
  data.writeUInt16LE(0x0001, 10);
  data.writeUInt16LE(start, 12);
  data.writeUInt16LE(count, 14);
  // [16:26] = 0x00 (already zeroed by alloc)

  return { control: 0x01, type: CommandType.Kline, data };
}

// ─── 响应解析 ──────────────────────────────────────────────────────────────────

export interface KlineResponse {
  count: number;
  bars: KlineBar[];
}

/**
 * 解析 K 线响应数据
 *
 * @param data - 解压后的响应 data 部分
 * @param category - K 线周期（用于区分分钟/日线时间编码和成交量处理）
 * @param isIndex - 是否是指数（指数多 4 字节且成交量 ×100）
 */
export function parseKlineResponse(
  data: Buffer,
  category: KlineCategory,
  isIndex: boolean = false,
): KlineResponse {
  if (data.length < 2) {
    return { count: 0, bars: [] };
  }

  const count = data.readUInt16LE(0);
  let offset = 2;
  const bars: KlineBar[] = [];
  const isMinuteLevel = MINUTE_KLINE_CATEGORIES.has(category);
  const needDivide100 = isMinuteLevel || category === KlineCategory.Day2;

  let lastClose: Price = 0;

  for (let i = 0; i < count && offset < data.length; i++) {
    // 解码时间 (4 bytes)
    const time = isMinuteLevel ? decodeMinuteTime(data, offset) : decodeDayTime(data, offset);
    offset += 4;

    // 解码价格 (变长差分编码)
    // Go 原版顺序: open, close(delta), high, low — 都相对于 lastClose+open
    let openDelta: number;
    let closeDelta: number;
    let highDelta: number;
    let lowDelta: number;

    [offset, openDelta] = readVarInt(data, offset);
    [offset, closeDelta] = readVarInt(data, offset);
    [offset, highDelta] = readVarInt(data, offset);
    [offset, lowDelta] = readVarInt(data, offset);

    const open = lastClose + openDelta;
    const close = lastClose + openDelta + closeDelta;
    const high = lastClose + openDelta + highDelta;
    const low = lastClose + openDelta + lowDelta;
    lastClose = close;

    // 成交量 (4 bytes, 特殊浮点编码)
    let volume = Math.floor(decodeVolume(data.readUInt32LE(offset)));
    offset += 4;

    if (needDivide100) {
      volume = Math.floor(volume / 100);
    }

    // 成交额 (4 bytes, 特殊浮点编码, 转为厘)
    const amount = Math.floor(decodeVolume(data.readUInt32LE(offset)) * 1000);
    offset += 4;

    if (isIndex) {
      // 指数: 成交量 ×100，多 4 字节（上涨/下跌家数，暂跳过）
      volume *= 100;
      offset += 4;
    }

    bars.push({
      time,
      open,
      high,
      low,
      close,
      volume,
      amount,
    });
  }

  return { count, bars };
}
