import { CommandType } from '../protocol/constants';
import { readVarInt } from '../protocol/encoding';
import type { FrameOptions } from '../protocol/frame';
import type { MinuteItem } from '../protocol/types';
import { parseCode } from '../protocol/types';

// ─── 当日分时 ──────────────────────────────────────────────────────────────────

/**
 * 构造当日分时请求
 *
 * Go 请求结构体: Market(u16) + Code(6) + Start(u16) + Count(u16) = 12 bytes
 * PkgLen = 0x0e
 */
export function buildMinuteRequest(code: string): Omit<FrameOptions, 'msgId'> {
  const { exchange, code: rawCode } = parseCode(code);
  const data = Buffer.alloc(12);
  data.writeUInt16LE(exchange, 0);
  data.write(rawCode, 2, 6, 'ascii');
  // Start=0, Count=0 → 返回全部分时（与 Go 一致）

  return { control: 0x01, type: CommandType.Minute, data };
}

export interface MinuteResponse {
  count: number;
  items: MinuteItem[];
}

/**
 * 解析当日分时响应 (0x0537 KMSG_MINUTETIMEDATA)
 *
 * Go get_minute_time_data.go 的响应体结构:
 * - count (u16LE) + ignored (u16LE) = 4 字节头
 * - 分时数据 × count: price(varInt) + avg(varInt) + vol(varInt)
 * - 注意：0x0537 没有盘口快照（0x051D 才有）
 *
 * Go 累加逻辑:
 *   if startPrice != 0 { price += startPrice }
 *   即：第一条是绝对值，后续 delta 累加到第一条
 *
 * Go: Price = float64(price) / 100.0 (元), Avg = float64(avg) / 10000.0 (元)
 * Price 类型 = 厘 (元 × 1000)
 *   → price × 10 = 厘, avg / 10 = 厘
 */
export function parseMinuteResponse(data: Buffer): MinuteResponse {
  if (data.length < 4) return { count: 0, items: [] };

  const count = data.readUInt16LE(0);
  let offset = 4; // count(2) + ignored(2)

  const items: MinuteItem[] = [];
  let cumulativePrice = 0;
  let cumulativeAvg = 0;
  let startPrice = 0;
  let startAvg = 0;

  for (let i = 0; i < count && offset < data.length; i++) {
    let price: number;
    [offset, price] = readVarInt(data, offset);

    let avg: number;
    [offset, avg] = readVarInt(data, offset);

    let volume: number;
    [offset, volume] = readVarInt(data, offset);

    // Go 累加逻辑：第一条是绝对值，后续 delta 加到第一条上
    if (startPrice !== 0) {
      price += startPrice;
    }
    if (startAvg !== 0) {
      avg += startAvg;
    }

    if (startPrice === 0) startPrice = price;
    if (startAvg === 0) startAvg = avg;

    cumulativePrice = price;
    cumulativeAvg = avg;

    // 时间: 09:31 起，i=120 时跳到 13:01
    const totalMinutes = i < 120 ? 9 * 60 + 31 + i : 13 * 60 + 1 + (i - 120);
    const hour = Math.floor(totalMinutes / 60);
    const minute = totalMinutes % 60;
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

    items.push({
      time: timeStr,
      price: cumulativePrice * 10,
      avgPrice: Math.round(cumulativeAvg / 10),
      volume,
    });
  }

  return { count, items };
}

// ─── 历史分时 ──────────────────────────────────────────────────────────────────

/**
 * 构造历史分时请求
 *
 * Data 格式 (11 bytes):
 * [0:4]   Date      i32 LE (取负值，如 20260611 → -20260611)
 * [4]     Exchange  u8
 * [5:11]  Code      6 bytes ASCII
 *
 * Go 源码: if req.Date > 0 { req.Date = -req.Date }
 */
export function buildHistoryMinuteRequest(code: string, date: number): Omit<FrameOptions, 'msgId'> {
  const { exchange, code: rawCode } = parseCode(code);
  const data = Buffer.alloc(11);
  data.writeInt32LE(date > 0 ? -date : date, 0);
  data[4] = exchange;
  data.write(rawCode, 5, 6, 'ascii');

  return { control: 0x01, type: CommandType.HistoryMinute, data };
}

/**
 * 解析历史分时响应 (0x0feb KMSG_HISTORYMINUTETIMEDATE)
 *
 * Go get_history_minute_time_data.go:
 * - count (u16LE) + skip 8 字节 (2 个 unknown uint32) → pos += 10
 * - 逐条: price(varInt) + avg(varInt) + vol(varInt)
 * - 累加逻辑与当日分时一致（第一条绝对值，后续 delta 加到第一条）
 * - Price = float64(price) / 100.0, Avg = float64(avg) / 10000.0
 */
export function parseHistoryMinuteResponse(data: Buffer): MinuteResponse {
  if (data.length < 10) return { count: 0, items: [] };

  const count = data.readUInt16LE(0);
  let offset = 10; // count(2) + 2 unknown uint32(8) = 10

  const items: MinuteItem[] = [];
  let startPrice = 0;
  let startAvg = 0;

  for (let i = 0; i < count && offset < data.length; i++) {
    let price: number;
    [offset, price] = readVarInt(data, offset);

    let avg: number;
    [offset, avg] = readVarInt(data, offset);

    let volume: number;
    [offset, volume] = readVarInt(data, offset);

    if (startPrice !== 0) price += startPrice;
    if (startAvg !== 0) avg += startAvg;

    if (startPrice === 0) startPrice = price;
    if (startAvg === 0) startAvg = avg;

    const totalMinutes = i < 120 ? 9 * 60 + 31 + i : 13 * 60 + 1 + (i - 120);
    const hour = Math.floor(totalMinutes / 60);
    const minute = totalMinutes % 60;
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

    items.push({
      time: timeStr,
      price: price * 10,
      avgPrice: Math.round(avg / 10),
      volume,
    });
  }

  return { count, items };
}
