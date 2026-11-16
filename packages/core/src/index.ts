/**
 * @wengu/core — main-thread entry. The app talks to the collection through `connectWengu(worker)`; the
 * database lives in the worker (`@wengu/core/worker`).
 */
export { connectWengu, WenguError } from "./rpc/client.js";
export type { WenguClient } from "./rpc/client.js";
export type { OpenOptions, Port } from "./rpc/protocol.js";
export { API_METHODS } from "./rpc/protocol.js";
export { mediaReferences, replaceMediaReferences } from "./media/refs.js";
export * from "./types.js";
