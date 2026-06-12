import * as iconv from 'iconv-lite';
import { CommandType, Exchange, EXCHANGE_PREFIXES } from '../protocol/constants';
import { decodeVolume } from '../protocol/encoding';
import type { FrameOptions } from '../protocol/frame';
import type { Price } from '../protocol/types';

// ─── 类型 ──────────────────────────────────────────────────────────────────────

export interface StockListItem {
  exchange: Exchange;
  /** 纯数字代码，如 600036 */
  code: string;
  /** 带前缀代码，如 sh600036 */
  fullCode: string;
  /** 证券名称 */
  name: string;
  /** 每手股数 */
  volUnit: number;
  /** 小数位数 */
  decimalPoint: number;
  /** 昨收价（厘） */
  preClose: Price;
}

/** 单页拉取的股票数量 */
export const CODE_LIST_PAGE_SIZE = 1000;

/** 单条记录字节数：code(6) + volUnit(2) + name(8) + reserved(4) + decimal(1) + preClose(4) + reserved(4) */
const RECORD_SIZE = 29;

// ─── 证券数量 (0x044E) ──────────────────────────────────────────────────────────

/** 构造证券数量请求 */
export function buildCountRequest(exchange: Exchange): Omit<FrameOptions, 'msgId'> {
  // 参考 Go injoyai/tdx: [exchange, 0x00, 0x75, 0xc7, 0x33, 0x01]，后 4 字节含义未知但必需
  const data = Buffer.from([exchange, 0x00, 0x75, 0xc7, 0x33, 0x01]);
  return { control: 0x01, type: CommandType.Count, data };
}

/** 解析证券数量响应（前 2 字节为数量 u16 LE） */
export function parseCountResponse(data: Buffer): number {
  if (data.length < 2) return 0;
  return data.readUInt16LE(0);
}

// ─── 证券列表 (0x0450) ──────────────────────────────────────────────────────────

/** 构造证券列表请求 */
export function buildCodeListRequest(
  exchange: Exchange,
  start: number,
): Omit<FrameOptions, 'msgId'> {
  const data = Buffer.alloc(4);
  data.writeUInt16LE(exchange, 0);
  data.writeUInt16LE(start, 2);
  return { control: 0x01, type: CommandType.CodeList, data };
}

/** 解析证券列表响应 */
export function parseCodeListResponse(data: Buffer, exchange: Exchange): StockListItem[] {
  if (data.length < 2) return [];

  let offset = 0;
  const count = data.readUInt16LE(offset);
  offset += 2;

  const prefix = EXCHANGE_PREFIXES[exchange];
  const items: StockListItem[] = [];

  for (let i = 0; i < count && offset + RECORD_SIZE <= data.length; i++) {
    const code = data
      .subarray(offset, offset + 6)
      .toString('ascii')
      .replace(/\0/g, '');
    offset += 6;

    const volUnit = data.readUInt16LE(offset);
    offset += 2;

    const nameRaw = data.subarray(offset, offset + 8);
    const name = iconv.decode(Buffer.from(nameRaw), 'gbk').replace(/\0/g, '').trim();
    offset += 8;

    offset += 4; // reserved1

    const decimalPoint = data.readUInt8(offset);
    offset += 1;

    // 昨收价：特殊浮点编码，× 1000 转为厘
    const preClose = Math.round(decodeVolume(data.readUInt32LE(offset)) * 1000);
    offset += 4;

    offset += 4; // reserved2

    items.push({
      exchange,
      code,
      fullCode: prefix + code,
      name,
      volUnit,
      decimalPoint,
      preClose,
    });
  }

  return items;
}
