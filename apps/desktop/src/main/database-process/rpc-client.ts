import { Context, Layer } from "effect";
import * as RpcClient from "effect/unstable/rpc/RpcClient";
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import type { WorkerError } from "effect/unstable/workers/WorkerError";
import type { UtilityProcess } from "electron";

import { DatabaseRpcs } from "../../shared/database-rpc";
import * as ElectronUtilityWorker from "./electron-utility-worker";

export class DatabaseRpcClient extends Context.Service<
  DatabaseRpcClient,
  RpcClient.RpcClient<RpcGroup.Rpcs<typeof DatabaseRpcs>, RpcClientError>
>()("kisa/main/database-process/DatabaseRpcClient") {
  static readonly layer = (
    spawn: (id: number) => UtilityProcess
  ): Layer.Layer<DatabaseRpcClient, WorkerError> =>
    Layer.effect(DatabaseRpcClient, RpcClient.make(DatabaseRpcs)).pipe(
      Layer.provide(RpcClient.layerProtocolWorker({ size: 1 })),
      Layer.provide(ElectronUtilityWorker.layer(spawn))
    );
}
