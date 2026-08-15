/** 可注入时钟：统一时间源，便于测试与审计一致性。 */
export type Clock = () => string;

/** 系统时钟：ISO 8601 UTC。 */
export const systemClock: Clock = () => new Date().toISOString();
