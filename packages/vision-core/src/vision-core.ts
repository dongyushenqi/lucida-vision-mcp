/**
 * Vision Core 门面：装配核心服务。
 *
 * 本层**不 import 任何 MCP 协议包**（协议家族独立的物理保证）。
 * Provider 选择为显式指定（Agent 通过工具参数声明 provider_id），
 * 不存在任何"智能路由/自动故障转移"逻辑（规格一.1 禁区）。
 */
import type { Clock } from "./clock.js";
import { systemClock } from "./clock.js";
import { ArtifactService } from "./artifacts.js";
import { CapabilityRegistry } from "./capability-registry.js";
import { FetchBoundary } from "./fetch-boundary.js";
import { ObservationGraph } from "./graph.js";
import { OperationService } from "./operations.js";
import type { VLMProvider } from "./provider.js";
import { SessionService } from "./session-service.js";
import type { VisionStore } from "./store.js";
import { ApplicationErrorCode, VisionError } from "@mcp-vision/contracts";

export interface VisionCoreDeps {
  store: VisionStore;
  clock?: Clock;
  fetchBoundary: FetchBoundary;
  providers: VLMProvider[];
}

export class ProviderRegistry {
  constructor(private readonly providers: VLMProvider[]) {}

  get(providerId: string): VLMProvider {
    const p = this.providers.find((x) => x.providerId === providerId);
    if (!p) {
      throw new VisionError(ApplicationErrorCode.PROVIDER_UNAVAILABLE, `provider 未注册`, {
        provider: providerId,
      });
    }
    return p;
  }

  all(): VLMProvider[] {
    return [...this.providers];
  }
}

export class VisionCore {
  readonly sessions: SessionService;
  readonly graph: ObservationGraph;
  readonly operations: OperationService;
  readonly artifacts: ArtifactService;
  readonly capabilities: CapabilityRegistry;
  readonly providers: ProviderRegistry;
  readonly fetchBoundary: FetchBoundary;
  readonly store: VisionStore;
  readonly clock: Clock;

  constructor(deps: VisionCoreDeps) {
    this.store = deps.store;
    this.clock = deps.clock ?? systemClock;
    this.sessions = new SessionService(this.store, this.clock);
    this.graph = new ObservationGraph(this.store, this.clock);
    this.operations = new OperationService(this.store, this.clock);
    this.artifacts = new ArtifactService(this.store, this.clock);
    this.capabilities = new CapabilityRegistry(this.store, this.clock);
    this.providers = new ProviderRegistry(deps.providers);
    this.fetchBoundary = deps.fetchBoundary;
  }
}
