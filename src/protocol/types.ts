import { Exchange, EXCHANGE_PREFIXES } from './constants';

// ─── Price ────────────────────────────────────────────────────────────────────

/** 价格类型，单位厘（元 × 1000） */
export type Price = number;

/** 厘 → 元 */
export function priceToYuan(price: Price): number {
  return price / 1000;
}

/** 元 → 厘 */
export function yuanToPrice(yuan: number): Price {
  return Math.round(yuan * 1000);
}

// ─── K 线数据 ──────────────────────────────────────────────────────────────────

export interface KlineBar {
  time: Date;
  open: Price;
  high: Price;
  low: Price;
  close: Price;
  volume: number;
  amount: number;
}

// ─── 五档盘口 ──────────────────────────────────────────────────────────────────

export interface PriceLevel {
  price: Price;
  volume: number;
}

export interface QuoteData {
  exchange: Exchange;
  code: string;
  lastClose: Price;
  open: Price;
  high: Price;
  low: Price;
  price: Price;
  volume: number;
  amount: number;
  bid: PriceLevel[];
  ask: PriceLevel[];
}

// ─── 分时数据 ──────────────────────────────────────────────────────────────────

export interface MinuteItem {
  time: string;
  price: Price;
  avgPrice: Price;
  volume: number;
}

// ─── 分笔成交 ──────────────────────────────────────────────────────────────────

export const enum TradeDirection {
  Buy = 0,
  Sell = 1,
  Neutral = 2,
}

export interface TradeItem {
  time: string;
  price: Price;
  volume: number;
  direction: TradeDirection;
}

// ─── 财务信息 ──────────────────────────────────────────────────────────────────

export interface FinanceInfo {
  /** 流通股本（股） */
  liuTongGuBen: number;
  /** 总股本（股） */
  zongGuBen: number;
  /** 每股收益 */
  eps: number;
  /** 每股净资产 */
  netAssetPerShare: number;
  /** 净利润（元） */
  netProfit: number;
  /** 营业收入（元） */
  revenue: number;
  /** ROE（%） */
  roe: number;
  /** 股东人数 */
  shareholderCount: number;
  /** 上市日期 */
  listDate: string;
}

// ─── 股票代码工具 ──────────────────────────────────────────────────────────────

/**
 * 根据纯数字代码推断交易所
 *
 * 优先级: 股票 > ETF > 指数（与 Go 实现 AddPrefix 一致）
 * 注意: 000001 既是上证指数(sh)也是平安银行(sz)，按此优先级推断为 sz
 * 如需查询指数，请使用带前缀的代码如 'sh000001'
 */
export function inferExchange(code: string): Exchange {
  if (code.length !== 6) throw new Error(`Invalid code length: ${code}`);
  const prefix1 = code[0];
  const prefix2 = code.slice(0, 2);
  const prefix3 = code.slice(0, 3);

  // 1) 股票优先
  // 上海股票：6 开头
  if (prefix1 === '6') return Exchange.SH;
  // 深圳股票：0 开头 或 30 开头
  if (prefix1 === '0' || prefix2 === '30') return Exchange.SZ;
  // 北京股票：92 开头
  if (prefix2 === '92') return Exchange.BJ;

  // 2) ETF
  // 上海 ETF：50/51/52/53/56/58 开头
  if (['50', '51', '52', '53', '56', '58'].includes(prefix2)) return Exchange.SH;
  // 深圳 ETF：15/16 开头
  if (prefix2 === '15' || prefix2 === '16') return Exchange.SZ;

  // 3) 指数
  // 上海指数：000 开头 或 999999
  if (prefix3 === '000' || code === '999999') return Exchange.SH;
  // 深圳指数：399 开头
  if (prefix3 === '399') return Exchange.SZ;
  // 北京指数：899 开头
  if (prefix3 === '899') return Exchange.BJ;

  // 默认深圳
  return Exchange.SZ;
}

/** 添加交易所前缀，如 '600036' → 'sh600036' */
export function addPrefix(code: string): string {
  if (code.length === 8) return code.toLowerCase();
  if (code.length === 6) {
    const exchange = inferExchange(code);
    return EXCHANGE_PREFIXES[exchange] + code;
  }
  return code;
}

/** 解析带前缀的代码，如 'sh600036' → { exchange: 1, code: '600036' } */
export function parseCode(fullCode: string): { exchange: Exchange; code: string } {
  const normalized = addPrefix(fullCode);
  const prefix = normalized.slice(0, 2).toLowerCase();
  const code = normalized.slice(2);

  for (const [ex, p] of Object.entries(EXCHANGE_PREFIXES)) {
    if (prefix === p) {
      return { exchange: Number(ex) as Exchange, code };
    }
  }
  throw new Error(`Unknown exchange prefix: ${prefix}`);
}

/** 判断是否是 ETF */
export function isETF(code: string): boolean {
  const { exchange, code: rawCode } = parseCode(code);
  const p2 = rawCode.slice(0, 2);
  if (exchange === Exchange.SH) {
    return ['50', '51', '52', '53', '56', '58'].includes(p2);
  }
  if (exchange === Exchange.SZ) {
    return p2 === '15' || p2 === '16';
  }
  return false;
}

/** 判断是否是指数 */
export function isIndex(code: string): boolean {
  const { exchange, code: rawCode } = parseCode(code);
  const p3 = rawCode.slice(0, 3);
  if (exchange === Exchange.SH) return p3 === '000' || rawCode === '999999';
  if (exchange === Exchange.SZ) return p3 === '399';
  if (exchange === Exchange.BJ) return p3 === '899';
  return false;
}
