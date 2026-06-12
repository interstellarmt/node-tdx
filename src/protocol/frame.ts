import { inflateSync } from 'node:zlib';
import { FRAME_PREFIX, RESP_PREFIX, type CommandType } from './constants';

// ─── 请求帧 ───────────────────────────────────────────────────────────────────
//
// 格式 (12 + N bytes):
// [0]     Prefix      0x0C
// [1:5]   MsgID       uint32 LE
// [5]     Control     uint8 (通常 0x01)
// [6:8]   Length      uint16 LE (= data.length + 2)
// [8:10]  Length      uint16 LE (重复)
// [10:12] Type        uint16 LE
// [12:]   Data

export interface FrameOptions {
  msgId: number;
  control?: number;
  type: CommandType;
  data?: Buffer;
}

export function encodeFrame(options: FrameOptions): Buffer {
  const { msgId, control = 0x01, type, data = Buffer.alloc(0) } = options;
  const length = data.length + 2;
  const frame = Buffer.alloc(12 + data.length);

  frame[0] = FRAME_PREFIX;
  frame.writeUInt32LE(msgId, 1);
  frame[5] = control;
  frame.writeUInt16LE(length, 6);
  frame.writeUInt16LE(length, 8);
  frame.writeUInt16LE(type, 10);
  if (data.length > 0) {
    data.copy(frame, 12);
  }

  return frame;
}

// ─── 响应帧 ───────────────────────────────────────────────────────────────────
//
// 格式 (16 + N bytes):
// [0:4]   Prefix      0xB1CB7400 (LE)
// [4]     Control     uint8 (bit4=1 表示成功)
// [5:9]   MsgID       uint32 LE
// [9]     Unknown     uint8
// [10:12] Type        uint16 LE
// [12:14] ZipLength   uint16 LE
// [14:16] Length      uint16 LE (解压后长度)
// [16:]   Data

export interface DecodedResponse {
  prefix: number;
  control: number;
  msgId: number;
  type: number;
  zipLength: number;
  unzipLength: number;
  data: Buffer;
}

export function decodeResponse(buffer: Buffer): DecodedResponse {
  if (buffer.length < 16) {
    throw new Error(`Response too short: ${buffer.length} bytes (need >= 16)`);
  }

  // 帧头是大端存储（网络序 B1 CB 74 00）
  const prefix = buffer.readUInt32BE(0);
  if (prefix !== RESP_PREFIX) {
    throw new Error(`Invalid response prefix: 0x${prefix.toString(16)}`);
  }

  const control = buffer[4];
  // MsgID 和 Type 仍是小端
  const msgId = buffer.readUInt32LE(5);
  const type = buffer.readUInt16LE(10);
  const zipLength = buffer.readUInt16LE(12);
  const unzipLength = buffer.readUInt16LE(14);
  let data = buffer.subarray(16);

  if (data.length < zipLength) {
    throw new Error(`Compressed data truncated: expected ${zipLength}, got ${data.length}`);
  }

  // 截取实际压缩数据
  data = data.subarray(0, zipLength);

  // zlib 解压
  if (zipLength !== unzipLength && zipLength > 0) {
    data = inflateSync(data);
    if (data.length !== unzipLength) {
      throw new Error(`Decompressed length mismatch: expected ${unzipLength}, got ${data.length}`);
    }
  }

  return { prefix, control, msgId, type, zipLength, unzipLength, data };
}

// ─── 粘包处理 ─────────────────────────────────────────────────────────────────

/**
 * 从累积的 Buffer 中尝试切出一个完整的响应帧。
 * 返回 [剩余 Buffer, 完整帧 Buffer | null]
 */
export function extractFrame(buffer: Buffer): [Buffer, Buffer | null] {
  // 寻找响应帧头（大端存储：B1 CB 74 00）
  const prefixBytes = Buffer.alloc(4);
  prefixBytes.writeUInt32BE(RESP_PREFIX, 0);

  const headerIndex = buffer.indexOf(prefixBytes);
  if (headerIndex === -1) return [buffer, null];

  // 跳过帧头前的垃圾数据
  if (headerIndex > 0) {
    buffer = buffer.subarray(headerIndex);
  }

  // 至少需要 16 字节的头部
  if (buffer.length < 16) return [buffer, null];

  // 读取压缩数据长度
  const zipLength = buffer.readUInt16LE(12);
  const totalLength = 16 + zipLength;

  // 数据不够一个完整帧
  if (buffer.length < totalLength) return [buffer, null];

  // 切出完整帧
  const frame = buffer.subarray(0, totalLength);
  const remaining = buffer.subarray(totalLength);

  return [remaining, frame];
}
