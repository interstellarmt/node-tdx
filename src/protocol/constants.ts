/** 请求帧固定前缀 */
export const FRAME_PREFIX = 0x0c;

/** 响应帧头标识 (4 bytes BE / 网络序) */
export const RESP_PREFIX = 0xb1cb7400;

/** 默认端口 */
export const DEFAULT_PORT = 7709;

/** 心跳间隔 (ms) */
export const HEARTBEAT_INTERVAL = 30_000;

/** 连接超时 (ms) */
export const CONNECT_TIMEOUT = 5_000;

/** 命令请求超时 (ms) */
export const REQUEST_TIMEOUT = 10_000;

/** 测速超时 (ms) */
export const SPEED_TEST_TIMEOUT = 3_000;

// ─── 请求类型码 ───────────────────────────────────────────────────────────────

export const enum CommandType {
  /** 建立连接 */
  Connect = 0x000d,
  /** 心跳保活 */
  Heartbeat = 0x0004,
  /** 除权除息 */
  Gbbq = 0x000f,
  /** 证券数量 */
  Count = 0x044e,
  /** 证券代码列表 */
  CodeList = 0x0450,
  /** 五档盘口行情 */
  Quote = 0x053e,
  /** 当日分时数据 (旧版 0x051D 返回含代码头，0x0537 为纯分时) */
  Minute = 0x0537,
  /** 集合竞价 */
  CallAuction = 0x056a,
  /** 分笔成交 */
  Trade = 0x0fc5,
  /** 历史分时数据 */
  HistoryMinute = 0x0fb4,
  /** 历史分笔成交 */
  HistoryTrade = 0x0fb5,
  /** K 线 */
  Kline = 0x052d,
  /** 财务信息 */
  Finance = 0x0010,
  /** F10 公司资料分类 */
  CompanyCategory = 0x02cf,
  /** F10 公司资料正文 */
  CompanyContent = 0x02d0,
  /** 板块文件信息 */
  BlockInfoMeta = 0x02c5,
  /** 板块文件 */
  BlockInfo = 0x06b9,
}

// ─── K 线周期 ─────────────────────────────────────────────────────────────────

export const enum KlineCategory {
  Minute5 = 0,
  Minute15 = 1,
  Minute30 = 2,
  Minute60 = 3,
  /** 日线（需要价格 ÷100，和 Day 有区别） */
  Day2 = 4,
  Week = 5,
  Month = 6,
  Minute1 = 7,
  /** 1 分钟 K 线（另一种） */
  Minute1Alt = 8,
  /** 日线 */
  Day = 9,
  Quarter = 10,
  Year = 11,
}

/** 分钟级别的 K 线类型集合 */
export const MINUTE_KLINE_CATEGORIES = new Set<number>([
  KlineCategory.Minute1,
  KlineCategory.Minute1Alt,
  KlineCategory.Minute5,
  KlineCategory.Minute15,
  KlineCategory.Minute30,
  KlineCategory.Minute60,
]);

// ─── 交易所 ───────────────────────────────────────────────────────────────────

export enum Exchange {
  /** 深圳 */
  SZ = 0,
  /** 上海 */
  SH = 1,
  /** 北京 */
  BJ = 2,
}

export const EXCHANGE_NAMES: Record<number, string> = {
  [Exchange.SZ]: '深圳',
  [Exchange.SH]: '上海',
  [Exchange.BJ]: '北京',
};

export const EXCHANGE_PREFIXES: Record<number, string> = {
  [Exchange.SZ]: 'sz',
  [Exchange.SH]: 'sh',
  [Exchange.BJ]: 'bj',
};
