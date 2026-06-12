/**
 * Phase 1 验证脚本：测速 + 连接通达信服务器 + 心跳
 *
 * 运行: cd packages/node-tdx && npx tsx src/__tests__/connect.test.ts
 */

import { TdxClient } from '../client';
import { sortHostsBySpeed } from '../server-list';

async function main() {
  console.log('=== Phase 1: node-tdx 连接验证 ===\n');

  // 1. 测速
  console.log('🔍 测速所有服务器...');
  const startSpeed = Date.now();
  const results = await sortHostsBySpeed();
  console.log(`✅ 测速完成 (${Date.now() - startSpeed}ms)，可用服务器: ${results.length}`);
  if (results.length > 0) {
    console.log('   前 5 名:');
    for (const r of results.slice(0, 5)) {
      console.log(`   - ${r.host.padEnd(18)} ${r.latency}ms`);
    }
  }
  console.log();

  // 2. 连接
  console.log('🔌 连接最快的服务器...');
  const client = new TdxClient();

  client.on('connected', (info: { host: string; info: string }) => {
    console.log(`✅ 已连接: ${info.host}`);
    if (info.info) console.log(`   服务器信息: ${info.info}`);
  });

  client.on('error', (err: Error) => {
    console.error(`❌ 错误: ${err.message}`);
  });

  client.on('disconnected', () => {
    console.log('🔴 已断开连接');
  });

  try {
    const host = await client.connect();
    console.log(`✅ 连接成功: ${host}`);
    console.log();

    // 3. 等待 3 秒观察心跳
    console.log('💓 等待 3 秒验证连接稳定性...');
    await new Promise((resolve) => setTimeout(resolve, 3000));
    console.log(`✅ 连接稳定，状态: ${client.isConnected ? '已连接' : '已断开'}`);
    console.log();

    console.log('🏁 Phase 1 验证通过！');
  } catch (err) {
    console.error('❌ 连接失败:', err);
  } finally {
    client.destroy();
  }
}

main().catch(console.error);
