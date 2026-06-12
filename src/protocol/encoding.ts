import type { Price } from './types';

// ─── 变长整数解码 ──────────────────────────────────────────────────────────────
//
// 通达信 K 线价格使用变长整数编码：
// - 每个字节 bit7 = 1 表示后面还有数据，= 0 表示结束
// - 第一字节 bit6 = 1 表示负数，有效数据为低 6 位
// - 后续字节有效数据为低 7 位
// - 数据按从低位到高位排列

/**
 * 从 Buffer 的指定偏移读取一个变长整数，返回 [读取后的新偏移, 解码出的值]
 */
export function readVarInt(buffer: Buffer, offset: number): [number, number] {
  let data = 0;
  let i = 0;

  while (offset < buffer.length) {
    const byte = buffer[offset];
    offset++;

    if (i === 0) {
      // 第一字节：低 6 位是数据
      data += byte & 0x3f;
    } else {
      // 后续字节：低 7 位是数据，左移 6 + (i-1)*7 位
      data += (byte & 0x7f) << (6 + (i - 1) * 7);
    }

    i++;

    // bit7 = 0 表示结束
    if ((byte & 0x80) === 0) break;
  }

  // 第一字节 bit6 = 1 表示负数
  if (i > 0 && (buffer[offset - i] & 0x40) !== 0) {
    data = -data;
  }

  return [offset, data];
}

/**
 * 从 Buffer 读取一个变长价格值
 */
export function readPrice(buffer: Buffer, offset: number): [number, Price] {
  return readVarInt(buffer, offset);
}

// ─── K 线 OHLC 解码 ──────────────────────────────────────────────────────────
//
// K 线的 5 个价格按差分编码：
// close（绝对值），last = close + delta，open = close + delta，
// high = close + delta，low = close + delta
// 最终乘以 10 得到厘（股票最小单位 0.01 元 = 10 厘）

export interface DecodedOHLC {
  open: Price;
  high: Price;
  low: Price;
  close: Price;
  lastClose: Price;
}

/**
 * 解码 K 线的 OHLC 价格段，返回 [新偏移, OHLC]
 */
export function decodeKlineOHLC(buffer: Buffer, offset: number): [number, DecodedOHLC] {
  let close: number;
  let last: number;
  let open: number;
  let high: number;
  let low: number;

  [offset, close] = readVarInt(buffer, offset);
  [offset, last] = readVarInt(buffer, offset);
  last += close;
  [offset, open] = readVarInt(buffer, offset);
  open += close;
  [offset, high] = readVarInt(buffer, offset);
  high += close;
  [offset, low] = readVarInt(buffer, offset);
  low += close;

  // 乘以 10 转为厘
  return [
    offset,
    {
      open: open * 10,
      high: high * 10,
      low: low * 10,
      close: close * 10,
      lastClose: last * 10,
    },
  ];
}

// ─── 成交量解码 ────────────────────────────────────────────────────────────────
//
// 通达信对成交量使用特殊的浮点编码（4 字节）

export function decodeVolume(val: number): number {
  const ivol = val | 0; // 转 int32
  const logpoint = ivol >> 24; // byte[3]
  const hleax = (ivol >> 16) & 0xff; // byte[2]
  const lheax = (ivol >> 8) & 0xff; // byte[1]
  const lleax = ivol & 0xff; // byte[0]

  const dwEcx = logpoint * 2 - 0x7f;
  const baseExp = Math.pow(2, dwEcx);

  let xmm4: number;
  if (hleax > 0x80) {
    xmm4 = (baseExp * (64.0 + (hleax & 0x7f))) / 64.0;
  } else {
    xmm4 = (baseExp * hleax) / 128.0;
  }

  const scale = (hleax & 0x80) !== 0 ? 2.0 : 1.0;
  const xmm3 = ((baseExp * lheax) / 32768.0) * scale;
  const xmm1 = ((baseExp * lleax) / 8388608.0) * scale;

  return baseExp + xmm4 + xmm3 + xmm1;
}

// ─── 时间解码 ──────────────────────────────────────────────────────────────────

/**
 * 解码分钟级 K 线的 4 字节时间
 * 格式：前 2 字节 = 年月日编码，后 2 字节 = 时分编码
 */
export function decodeMinuteTime(buffer: Buffer, offset: number): Date {
  const yearMonthDay = buffer.readUInt16LE(offset);
  const hourMinute = buffer.readUInt16LE(offset + 2);

  const year = (yearMonthDay >> 11) + 2004;
  const month = (yearMonthDay % 2048) / 100;
  const day = (yearMonthDay % 2048) % 100;
  const hour = Math.floor(hourMinute / 60);
  const minute = hourMinute % 60;

  return new Date(year, Math.floor(month) - 1, Math.floor(day), hour, minute);
}

/**
 * 解码日线级 K 线的 4 字节时间
 * 格式：uint32 LE = YYYYMMDD
 */
export function decodeDayTime(buffer: Buffer, offset: number): Date {
  const yearMonthDay = buffer.readUInt32LE(offset);
  const year = Math.floor(yearMonthDay / 10000);
  const month = Math.floor((yearMonthDay % 10000) / 100);
  const day = yearMonthDay % 100;

  return new Date(year, month - 1, day, 15, 0);
}

/**
 * 解码小时:分钟 (2 字节 LE)
 */
export function decodeHourMinute(buffer: Buffer, offset: number): string {
  const n = buffer.readUInt16LE(offset);
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
