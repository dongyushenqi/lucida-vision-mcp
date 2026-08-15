/**
 * SSRF 防护矩阵：DNS 解析策略与私有地址阻断（规格四.1 强制安全职责）。
 *
 * - 私有/保留/链路本地/环回/多播/文档地址一律阻断。
 * - 通过 https.Agent 的 lookup 钩子把关：**每一次**连接都经过本门禁，
 *   消除"先解析检查、后连接"的 DNS 重绑定（TOCTOU）窗口（Implementation Decision）。
 */
import { lookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";

/** 判断 IP 是否为应阻断的私有/保留/特殊地址。 */
export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const parts = ip.split(".").map((p) => Number(p));
    const [a, b, c, d] = parts as [number, number, number, number];
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24
    if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24 TEST-NET-1
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15
    if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24
    if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24
    if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
    return false;
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    if (lower.startsWith("::ffff:")) {
      // IPv4-mapped：递归检查内嵌 IPv4
      return isBlockedAddress(lower.slice("::ffff:".length));
    }
    if (/^f[cd]/i.test(lower)) return true; // fc00::/7 ULA
    if (/^fe[89ab]/i.test(lower)) return true; // fe80::/10 link-local
    if (lower.startsWith("2001:db8:")) return true; // 文档地址
    return false;
  }
  return false;
}

export interface ResolvedAddress {
  address: string;
  family: number;
}

/** 解析并门禁：任一解析结果落入阻断范围即抛错。allowPrivate=true 时放行私有/环回地址（本地取图，须显式开启）。 */
export async function resolveAndCheck(
  hostname: string,
  opts?: { allowPrivate?: boolean },
): Promise<ResolvedAddress[]> {
  const addrs = await lookup(hostname, { all: true });
  if (!opts?.allowPrivate) {
    const blocked = addrs.find((a) => isBlockedAddress(a.address));
    if (blocked) {
      throw new Error(
        `SSRF blocked: ${hostname} resolves to blocked address ${blocked.address}`,
      );
    }
  }
  return addrs.map((a) => ({ address: a.address, family: a.family }));
}

/** 构造受私有地址门禁约束的 lookup 函数（allowPrivate 仅本地显式放行场景使用）。 */
export function createLookup(allowPrivate: boolean): LookupFunction {
  return (hostname, options, callback) => {
    resolveAndCheck(hostname, { allowPrivate })
      .then((addrs) => {
        let filtered = addrs;
        if (options.family !== undefined) {
          const familyNum = options.family === "IPv4" ? 4 : options.family === "IPv6" ? 6 : options.family;
          filtered = addrs.filter((a) => a.family === familyNum);
        }
        if (options.all) {
          callback(null, filtered);
        } else {
          const first = filtered[0];
          if (!first) {
            callback(new Error(`no addresses for ${hostname}`), "", 0);
            return;
          }
          callback(null, first.address, first.family);
        }
      })
      .catch((err: Error) => callback(err, "", 0));
  };
}

/** 默认门禁：私有/保留地址一律阻断（SSRF 防护默认开启）。 */
export const blockingLookup: LookupFunction = createLookup(false);
