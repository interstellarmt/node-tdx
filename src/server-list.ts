import * as net from 'node:net';
import { DEFAULT_PORT, SPEED_TEST_TIMEOUT } from './protocol/constants';

/** 上海服务器 */
const SH_HOSTS = [
  '124.71.187.122',
  '122.51.120.217',
  '111.229.247.189',
  '122.51.232.182',
  '118.25.98.114',
  '124.70.199.56',
  '121.36.225.169',
  '123.60.70.228',
  '123.60.73.44',
  '124.70.133.119',
  '124.71.187.72',
  '123.60.84.66',
  '124.223.163.242',
  '150.158.160.2',
  '101.35.121.35',
  '111.231.113.208',
];

/** 北京服务器 */
const BJ_HOSTS = [
  '62.234.50.143',
  '81.70.151.186',
  '101.42.240.54',
  '101.43.159.194',
  '120.53.8.251',
  '152.136.191.169',
  '49.232.15.141',
  '82.156.174.84',
  '101.42.164.241',
];

/** 广州服务器 */
const GZ_HOSTS = [
  '124.71.9.153',
  '116.205.163.254',
  '116.205.171.132',
  '116.205.183.150',
  '111.230.186.52',
  '110.41.2.72',
  '110.41.147.114',
  '101.33.225.16',
  '175.178.112.197',
  '175.178.128.227',
  '43.139.95.83',
  '159.75.29.111',
  '43.139.18.171',
  '81.71.32.47',
  '129.204.230.128',
];

/** 武汉服务器 */
const WH_HOSTS = ['119.97.185.59'];

/** 所有服务器列表 */
export const ALL_HOSTS = [...SH_HOSTS, ...BJ_HOSTS, ...GZ_HOSTS, ...WH_HOSTS];

interface SpeedTestResult {
  host: string;
  latency: number;
}

/** 测试单个服务器的 TCP 连接延迟 */
function testHost(host: string, timeout: number): Promise<SpeedTestResult | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();

    const timer = setTimeout(() => {
      socket.destroy();
      resolve(null);
    }, timeout);

    socket.connect(DEFAULT_PORT, host, () => {
      clearTimeout(timer);
      const latency = Date.now() - start;
      socket.destroy();
      resolve({ host, latency });
    });

    socket.on('error', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(null);
    });
  });
}

/**
 * 并发测速所有服务器，返回按延迟排序的可用服务器列表
 */
export async function sortHostsBySpeed(
  hosts: string[] = ALL_HOSTS,
  timeout: number = SPEED_TEST_TIMEOUT,
): Promise<SpeedTestResult[]> {
  const results = await Promise.all(hosts.map((host) => testHost(host, timeout)));
  return results
    .filter((r): r is SpeedTestResult => r !== null)
    .sort((a, b) => a.latency - b.latency);
}

/**
 * 获取最快的服务器地址。
 *
 * 采用竞速策略：并发连接所有候选服务器，第一个成功建立 TCP 连接的即为延迟最低者，
 * 立即返回，无需等待其余（尤其是不可达）服务器走完超时。相比"全部测速后排序取首位"，
 * 可将首连耗时从固定的 timeout 降到最快服务器的实际延迟。
 */
export function getFastestHost(
  hosts: string[] = ALL_HOSTS,
  timeout: number = SPEED_TEST_TIMEOUT,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (hosts.length === 0) {
      reject(new Error('No available TDX server'));
      return;
    }
    let remaining = hosts.length;
    let settled = false;
    for (const host of hosts) {
      testHost(host, timeout).then((result) => {
        if (settled) return;
        if (result) {
          settled = true;
          resolve(result.host);
        } else if (--remaining === 0) {
          reject(new Error('No available TDX server'));
        }
      });
    }
  });
}
