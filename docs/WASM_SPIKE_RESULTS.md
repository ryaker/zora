# WASM Sandbox Feasibility Spike

## Summary

We evaluated WebAssembly (WASM) as a sandboxing strategy for isolating tool execution in Zora's Node.js/TypeScript runtime. The approach is feasible for pure-computation tools but faces blockers for I/O-heavy operations.

## Runtimes Evaluated

**Wasmtime** (Bytecode Alliance): The most mature WASM runtime with strong WASI support. Node.js bindings exist via `@aspect-build/wasmtime`. Best candidate for server-side sandboxing due to active maintenance and capability-based security model.

**Wasmer**: Provides `wasmer-js` for both browser and Node.js. Supports WASI preview1 and experimental preview2. Slightly less stable than Wasmtime but offers broader platform reach.

**IronClaw Pattern**: Compile tool source to WASM, execute inside a sandboxed runtime with explicit capability grants (filesystem paths, network endpoints). This maps well to Zora's tool permission model where each tool declares required capabilities.

## What Works

- Pure computation tools (text processing, data transformation) can be compiled via Shopify's `javy` (JS-to-WASM compiler) and executed with minimal overhead.
- WASI preview1 provides filesystem read/write isolation sufficient for most tool sandboxing needs.
- Extism offers a plugin framework abstracting runtime differences, simplifying adoption.

## Blockers

- **No direct TypeScript-to-WASM path**: Requires TS -> JS -> WASM compilation pipeline.
- **WASI preview2 instability**: The component model is not finalized; preview1 has limitations around async I/O.
- **Native module exclusion**: Tools using `child_process`, `net`, or other Node.js native modules cannot run inside WASM and need host-side proxying.
- **Cold start overhead**: ~50-100ms per invocation may be unacceptable for latency-sensitive tool chains.

## Recommendation

Proceed to v2 prototype using Wasmtime with `javy`-compiled filesystem tools. Defer network-dependent tools to a host-proxy model. Revisit when WASI preview2 stabilizes.
