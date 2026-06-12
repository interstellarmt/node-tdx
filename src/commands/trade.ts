import { CommandType } from '../protocol/constants';
import { decodeHourMinute, readVarInt } from '../protocol/encoding';
import type { FrameOptions } from '../protocol/frame';
import { parseCode, TradeDirection, type TradeItem } from '../protocol/types';

// ─── 当日分笔成交 ─────────────────────────────────────────────────────────────

/**
 * 构造当日分笔成交请求
 *
 * Go 请求结构体: Market(u16) + Code(6) + Start(u16) + Count(u16) = 12 bytes
 * PkgLen = 0x0e (data.length + 2)
 */
export function buildTradeRequest(
  code: string,
  start: number = 0,
  count: number = 1000,
): Omit<FrameOptions, 'msgId'> {
  const { exchange, code: rawCode } = parseCode(code);
  const data = Buffer.alloc(12);
  data.writeUInt16LE(exchange, 0);
  data.write(rawCode, 2, 6, 'ascii');
  data.writeUInt16LE(start, 8);
  data.writeUInt16LE(Math.min(count, 2000), 10);

  return { control: 0x01, type: CommandType.Trade, data };
}

export interface TradeResponse {
  count: number;
  items: TradeItem[];
}

/**
 * Go baseUnit: 60/30/68/00 开头 → 100, 其他 → 1000
 * 转厘系数 = 1000 / baseUnit
 *   普通股票 (60/30/68/00): 1000/100 = 10
 *   ETF 等: 1000/1000 = 1
 */
function priceToLiMultiplier(code: string): number {
  const prefix = code.slice(0, 2);
  if (prefix === '60' || prefix === '30' || prefix === '68' || prefix === '00') {
    return 10;
  }
  return 1;
}

/**
 * 解析当日分笔成交响应
 *
 * Go get_transaction_data.go:
 * - count (u16LE), 无 skip
 * - 逐条: time(2 bytes) + priceraw(vi) + vol(vi) + num(vi) + buyOrSell(vi) + unknown(vi)
 * - lastprice += priceraw; Price = float64(lastprice) / baseUnit(code)
 */
export function parseTradeResponse(data: Buffer, code: string): TradeResponse {
  if (data.length < 2) return { count: 0, items: [] };

  const count = data.readUInt16LE(0);
  let offset = 2;

  const { code: rawCode } = parseCode(code);
  const multiplier = priceToLiMultiplier(rawCode);

  const items: TradeItem[] = [];
  let lastPrice = 0;

  for (let i = 0; i < count && offset + 2 <= data.length; i++) {
    const time = decodeHourMinute(data, offset);
    offset += 2;

    let priceRaw: number;
    [offset, priceRaw] = readVarInt(data, offset);
    lastPrice += priceRaw;

    let volume: number;
    [offset, volume] = readVarInt(data, offset);

    let _number: number;
    [offset, _number] = readVarInt(data, offset);

    let buyOrSell: number;
    [offset, buyOrSell] = readVarInt(data, offset);

    [offset] = readVarInt(data, offset);

    items.push({
      time,
      price: lastPrice * multiplier,
      volume,
      direction: buyOrSell as TradeDirection,
    });
  }

  return { count, items };
}

// ─── 历史分笔成交 ─────────────────────────────────────────────────────────────

/**
 * 构造历史分笔成交请求
 *
 * Go 请求结构体: Date(u32) + Market(u16) + Code(6) + Start(u16) + Count(u16) = 16 bytes
 * PkgLen = 0x12 (data.length + 2)
 */
export function buildHistoryTradeRequest(
  code: string,
  date: number,
  start: number = 0,
  count: number = 2000,
): Omit<FrameOptions, 'msgId'> {
  const { exchange, code: rawCode } = parseCode(code);
  const data = Buffer.alloc(16);
  data.writeUInt32LE(date, 0);
  data.writeUInt16LE(exchange, 4);
  data.write(rawCode, 6, 6, 'ascii');
  data.writeUInt16LE(start, 12);
  data.writeUInt16LE(Math.min(count, 2000), 14);

  return { control: 0x01, type: CommandType.HistoryTrade, data };
}

/**
 * 解析历史分笔成交响应
 *
 * Go get_history_transaction_data.go:
 * - count (u16LE) + skip 4 bytes → pos += 6
 * - 逐条: time(2) + priceraw(vi) + vol(vi) + buyOrSell(vi) + unknown(vi)
 * - 历史分笔没有 num 字段（和当日分笔不同）
 * - lastprice += priceraw; Price = float64(lastprice) / baseUnit(code)
 */
export function parseHistoryTradeResponse(data: Buffer, code: string): TradeResponse {
  if (data.length < 6) return { count: 0, items: [] };

  const count = data.readUInt16LE(0);
  let offset = 6; // count(2) + skip(4)

  const { code: rawCode } = parseCode(code);
  const multiplier = priceToLiMultiplier(rawCode);

  const items: TradeItem[] = [];
  let lastPrice = 0;

  for (let i = 0; i < count && offset + 2 <= data.length; i++) {
    const time = decodeHourMinute(data, offset);
    offset += 2;

    let priceRaw: number;
    [offset, priceRaw] = readVarInt(data, offset);
    lastPrice += priceRaw;

    let volume: number;
    [offset, volume] = readVarInt(data, offset);

    let buyOrSell: number;
    [offset, buyOrSell] = readVarInt(data, offset);

    [offset] = readVarInt(data, offset);

    items.push({
      time,
      price: lastPrice * multiplier,
      volume,
      direction: buyOrSell as TradeDirection,
    });
  }

  return { count, items };
}
