import * as iconv from 'iconv-lite';
import { CommandType } from '../protocol/constants';
import { encodeFrame, type DecodedResponse } from '../protocol/frame';

/** 构造心跳请求帧 */
export function buildHeartbeatFrame(msgId: number): Buffer {
  return encodeFrame({
    msgId,
    control: 0x01,
    type: CommandType.Heartbeat,
    data: Buffer.alloc(0),
  });
}

export interface ConnectResult {
  info: string;
}

/** 解析连接响应 */
export function parseConnectResponse(response: DecodedResponse): ConnectResult {
  const { data } = response;
  // 前 68 字节含义未知，跳过；后面是 GBK 编码的服务器信息
  if (data.length <= 68) return { info: '' };
  const raw = data.subarray(68);
  // 去掉尾部 \0 后用 GBK 解码
  const end = raw.indexOf(0x00);
  const trimmed = end >= 0 ? raw.subarray(0, end) : raw;
  const info = iconv.decode(Buffer.from(trimmed), 'gbk');
  return { info };
}
