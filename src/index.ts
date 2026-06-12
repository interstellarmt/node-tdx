// ─── Client ───────────────────────────────────────────────────────────────────
export { TdxClient, type TdxClientOptions } from './client';

// ─── Protocol ─────────────────────────────────────────────────────────────────
export {
  CommandType,
  DEFAULT_PORT,
  EXCHANGE_NAMES,
  EXCHANGE_PREFIXES,
  Exchange,
  KlineCategory,
  MINUTE_KLINE_CATEGORIES,
} from './protocol/constants';

export {
  TradeDirection,
  addPrefix,
  inferExchange,
  isETF,
  isIndex,
  parseCode,
  priceToYuan,
  yuanToPrice,
  type FinanceInfo,
  type KlineBar,
  type MinuteItem,
  type Price,
  type PriceLevel,
  type QuoteData,
  type TradeItem,
} from './protocol/types';

// ─── Encoding ─────────────────────────────────────────────────────────────────
export {
  decodeDayTime,
  decodeHourMinute,
  decodeKlineOHLC,
  decodeMinuteTime,
  decodeVolume,
  readPrice,
  readVarInt,
} from './protocol/encoding';

// ─── Frame ────────────────────────────────────────────────────────────────────
export {
  decodeResponse,
  encodeFrame,
  extractFrame,
  type DecodedResponse,
  type FrameOptions,
} from './protocol/frame';

// ─── Commands ─────────────────────────────────────────────────────────────────
export {
  buildKlineRequest,
  parseKlineResponse,
  type KlineRequest,
  type KlineResponse,
} from './commands/kline';

export { buildQuoteRequest, parseQuoteResponse } from './commands/quote';

export {
  buildHistoryMinuteRequest,
  buildMinuteRequest,
  parseHistoryMinuteResponse,
  parseMinuteResponse,
  type MinuteResponse,
} from './commands/minute';

export {
  buildHistoryTradeRequest,
  buildTradeRequest,
  parseHistoryTradeResponse,
  parseTradeResponse,
  type TradeResponse,
} from './commands/trade';

export {
  CODE_LIST_PAGE_SIZE,
  buildCodeListRequest,
  buildCountRequest,
  parseCodeListResponse,
  parseCountResponse,
  type StockListItem,
} from './commands/codelist';

// ─── Server List ──────────────────────────────────────────────────────────────
export { ALL_HOSTS, getFastestHost, sortHostsBySpeed } from './server-list';
