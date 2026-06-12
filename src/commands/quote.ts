import * as iconv from 'iconv-lite';
import { CommandType, type Exchange } from '../protocol/constants';
import { decodeVolume, readVarInt } from '../protocol/encoding';
import type { FrameOptions } from '../protocol/frame';
import type { Price, PriceLevel, QuoteData } from '../protocol/types';
import { parseCode } from '../protocol/types';

// ─── 请求构造 ──────────────────────────────────────────────────────────────────

/**
 * 构造五档盘口请求
 *
 * Data 格式:
 * [0:8]   固定头 05 00 00 00 00 00 00 00
 * [8:10]  Count  u16 LE (股票数量)
 * [10:]   逐个 [Exchange:u8][Code:6bytes]
 */
export function buildQuoteRequest(codes: string[]): Omit<FrameOptions, 'msgId'> {
  const parsed = codes.map((c) => parseCode(c));
  const data = Buffer.alloc(8 + 2 + parsed.length * 7);

  // 固定头
  data[0] = 0x05;
  // [1:8] 全 0

  // 股票数量
  data.writeUInt16LE(parsed.length, 8);

  // 逐个写入
  let offset = 10;
  for (const { exchange, code } of parsed) {
    data[offset] = exchange;
    data.write(code, offset + 1, 6, 'ascii');
    offset += 7;
  }

  return { control: 0x01, type: CommandType.Quote, data };
}

// ─── 响应解析 ──────────────────────────────────────────────────────────────────

/**
 * 解析五档盘口响应
 *
 * 参考 Go 的 quote.Decode:
 * - 跳过 2 字节
 * - 读 count (u16 LE)
 * - 逐个解析: exchange + code + active + K(OHLC) + 各种字段 + 5档买卖
 */
export function parseQuoteResponse(data: Buffer): QuoteData[] {
  if (data.length < 4) return [];

  // 前 2 字节未知，跳过
  let offset = 2;
  const count = data.readUInt16LE(offset);
  offset += 2;

  const results: QuoteData[] = [];

  for (let i = 0; i < count && offset < data.length; i++) {
    const exchange = data[offset] as Exchange;
    const codeRaw = data.subarray(offset + 1, offset + 7);
    const code = iconv.decode(Buffer.from(codeRaw), 'gbk').replace(/\0/g, '');
    offset += 7;

    // active1 (2 bytes) - 跳过
    offset += 2;

    // 解码 K 线 OHLC（变长编码，close → last → open → high → low）
    let closeVal: number;
    let lastDelta: number;
    let openDelta: number;
    let highDelta: number;
    let lowDelta: number;

    [offset, closeVal] = readVarInt(data, offset);
    [offset, lastDelta] = readVarInt(data, offset);
    const lastClose = (closeVal + lastDelta) * 10;
    [offset, openDelta] = readVarInt(data, offset);
    const open = (closeVal + openDelta) * 10;
    [offset, highDelta] = readVarInt(data, offset);
    const high = (closeVal + highDelta) * 10;
    [offset, lowDelta] = readVarInt(data, offset);
    const low = (closeVal + lowDelta) * 10;
    const price = closeVal * 10;

    // reversedBytes0 (server time)
    [offset] = readVarInt(data, offset);
    // reversedBytes1
    [offset] = readVarInt(data, offset);
    // totalHand
    let totalVolume: number;
    [offset, totalVolume] = readVarInt(data, offset);
    // intuition (现量)
    [offset] = readVarInt(data, offset);

    // amount (4 bytes 特殊浮点编码)
    const amount = Math.floor(decodeVolume(data.readUInt32LE(offset)) * 1000);
    offset += 4;

    // insideDish (内盘)
    [offset] = readVarInt(data, offset);
    // outerDisc (外盘)
    [offset] = readVarInt(data, offset);
    // reservedBytes2
    [offset] = readVarInt(data, offset);
    // reservedBytes3
    [offset] = readVarInt(data, offset);

    // 5 档买卖
    const bid: PriceLevel[] = [];
    const ask: PriceLevel[] = [];

    for (let level = 0; level < 5; level++) {
      let buyPriceDelta: Price;
      let sellPriceDelta: Price;
      let buyVolume: number;
      let sellVolume: number;

      [offset, buyPriceDelta] = readVarInt(data, offset);
      [offset, sellPriceDelta] = readVarInt(data, offset);
      [offset, buyVolume] = readVarInt(data, offset);
      [offset, sellVolume] = readVarInt(data, offset);

      bid.push({ price: buyPriceDelta * 10 + price, volume: buyVolume });
      ask.push({ price: sellPriceDelta * 10 + price, volume: sellVolume });
    }

    // 尾部（pytdx get_security_quotes.py）:
    // reversed_bytes4 (u16 = 2 bytes)
    offset += 2;
    // reversed_bytes5..8 (4 个 varInt)
    [offset] = readVarInt(data, offset);
    [offset] = readVarInt(data, offset);
    [offset] = readVarInt(data, offset);
    [offset] = readVarInt(data, offset);
    // reversed_bytes9 (i16, 涨速/100) + active2 (u16) = 4 bytes
    offset += 4;

    results.push({
      exchange,
      code,
      lastClose,
      open,
      high,
      low,
      price,
      volume: totalVolume,
      amount,
      bid,
      ask,
    });
  }

  return results;
}
