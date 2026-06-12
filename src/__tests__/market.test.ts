/**
 * Phase 2 验证脚本：K 线 + 盘口 + 分时 + 分笔成交
 *
 * 运行: cd packages/node-tdx && npx tsx src/__tests__/market.test.ts
 */

import { TdxClient } from '../client';
import { KlineCategory } from '../protocol/constants';
import { priceToYuan } from '../protocol/types';

async function main() {
  console.log('=== Phase 2: 行情命令验证 ===\n');

  const client = new TdxClient();
  try {
    const host = await client.connect();
    console.log(`✅ 已连接: ${host}\n`);

    // ─── 1. K 线 (日线, 平安银行 sz000001) ─────────────────────────────────
    console.log('📊 测试 K 线 (sz000001 日线, 最近 5 根)...');
    const kline = await client.getKline({
      code: '000001',
      category: KlineCategory.Day,
      start: 0,
      count: 5,
    });
    console.log(`   返回 ${kline.count} 根 K 线:`);
    for (const bar of kline.bars) {
      const date = bar.time.toISOString().slice(0, 10);
      console.log(
        `   ${date}  O:${priceToYuan(bar.open).toFixed(2)}  H:${priceToYuan(bar.high).toFixed(2)}  L:${priceToYuan(bar.low).toFixed(2)}  C:${priceToYuan(bar.close).toFixed(2)}  V:${bar.volume}`,
      );
    }
    console.log();

    // ─── 2. K 线 (上证指数 sh000001) ───────────────────────────────────────
    console.log('📊 测试 K 线 (sh000001 上证指数日线, 最近 3 根)...');
    const indexKline = await client.getKline({
      code: 'sh000001',
      category: KlineCategory.Day,
      start: 0,
      count: 3,
    });
    console.log(`   返回 ${indexKline.count} 根:`);
    for (const bar of indexKline.bars) {
      const date = bar.time.toISOString().slice(0, 10);
      console.log(
        `   ${date}  O:${priceToYuan(bar.open).toFixed(2)}  H:${priceToYuan(bar.high).toFixed(2)}  L:${priceToYuan(bar.low).toFixed(2)}  C:${priceToYuan(bar.close).toFixed(2)}  V:${bar.volume}`,
      );
    }
    console.log();

    // ─── 3. 五档盘口 ──────────────────────────────────────────────────────
    console.log('📋 测试五档盘口 (sz000001 + sh600036)...');
    const quotes = await client.getQuote(['000001', '600036']);
    for (const q of quotes) {
      console.log(
        `   ${q.code}  现价:${priceToYuan(q.price).toFixed(2)}  昨收:${priceToYuan(q.lastClose).toFixed(2)}  开:${priceToYuan(q.open).toFixed(2)}  高:${priceToYuan(q.high).toFixed(2)}  低:${priceToYuan(q.low).toFixed(2)}`,
      );
      console.log('   买盘:');
      for (let i = 0; i < q.bid.length; i++) {
        console.log(
          `     买${i + 1}: ${priceToYuan(q.bid[i].price).toFixed(2)}  ${q.bid[i].volume}`,
        );
      }
      console.log('   卖盘:');
      for (let i = 0; i < q.ask.length; i++) {
        console.log(
          `     卖${i + 1}: ${priceToYuan(q.ask[i].price).toFixed(2)}  ${q.ask[i].volume}`,
        );
      }
    }
    console.log();

    // ─── 4. 当日分时 ──────────────────────────────────────────────────────
    console.log('📈 测试当日分时 (sz000001)...');
    const minute = await client.getMinute('000001');
    console.log(`   返回 ${minute.count} 条分时数据`);
    if (minute.items.length > 0) {
      const first = minute.items[0];
      const last = minute.items[minute.items.length - 1];
      console.log(
        `   首条: ${first.time}  价格:${priceToYuan(first.price).toFixed(2)}  量:${first.volume}`,
      );
      console.log(
        `   末条: ${last.time}  价格:${priceToYuan(last.price).toFixed(2)}  量:${last.volume}`,
      );
    }
    console.log();

    // ─── 5. 当日分笔成交 ─────────────────────────────────────────────────
    console.log('🔄 测试当日分笔成交 (sz000001, 前 10 笔)...');
    const trade = await client.getTrade('000001', 0, 10);
    console.log(`   返回 ${trade.count} 笔:`);
    const directionLabel = ['买', '卖', '中'];
    for (const t of trade.items.slice(0, 5)) {
      console.log(
        `   ${t.time}  ${priceToYuan(t.price).toFixed(2)}  量:${t.volume}  ${directionLabel[t.direction] ?? '?'}`,
      );
    }
    if (trade.items.length > 5) console.log(`   ... 还有 ${trade.items.length - 5} 笔`);
    console.log();

    // ─── 6. 历史分笔成交 ─────────────────────────────────────────────────
    console.log('🔄 测试历史分笔成交 (sz000001, 20260609, 前 10 笔)...');
    const histTrade = await client.getHistoryTrade('000001', 20260609, 0, 10);
    console.log(`   返回 ${histTrade.count} 笔:`);
    for (const t of histTrade.items.slice(0, 5)) {
      console.log(
        `   ${t.time}  ${priceToYuan(t.price).toFixed(2)}  量:${t.volume}  ${directionLabel[t.direction] ?? '?'}`,
      );
    }
    console.log();

    console.log('🏁 Phase 2 行情命令验证完成！');
  } catch (err) {
    console.error('❌ 错误:', err);
  } finally {
    client.destroy();
  }
}

main().catch(console.error);
