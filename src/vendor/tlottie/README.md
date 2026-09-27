# tlottie WebAssembly

`tlottie.wasm` and `tlottie.nosimd.wasm` are the browser Lottie renderers from
[`dkaraush/tlottie`](https://github.com/dkaraush/tlottie), pinned to commit
[`758c7cb74444f1c3c9923065c40fdb3aad8b7d60`](https://github.com/dkaraush/tlottie/commit/758c7cb74444f1c3c9923065c40fdb3aad8b7d60)
(MIT). The license notice is in [`LICENSE`](./LICENSE) and must stay next to the binaries.

They were taken as-is from the Telegram Web K vendor directory (`src/vendor/tlottie/`), which
builds them from [`examples/web/` at the pinned commit](https://github.com/dkaraush/tlottie/tree/758c7cb74444f1c3c9923065c40fdb3aad8b7d60/examples/web)
and strips only the DWARF and symbol-name custom sections.

Upstream builds the same sources twice, with and without `-C target-feature=simd128`.
`src/lib/expressions/lottie/tlottieWasm.ts` picks the SIMD build when `WebAssembly.validate`
accepts a SIMD probe module and the scalar one otherwise. Both builds also need bulk-memory,
sign-extension and non-trapping float-to-int, which the baseline probe in
`src/lib/expressions/lottie/support.ts` checks before either is fetched.

Checksums (SHA-256). The files here match the "stripped vendor binary" column:

| artifact | upstream | stripped vendor binary |
|---|---|---|
| `tlottie.wasm` | `adaca5c88e5df75abffc7b8bb43f145fc1dcfd0a6cf208164f3a16b1c5e998b3` | `2f3be462e448170ddf3682a0af40f527c45f03a2e3d566728001dc8909342534` |
| `tlottie.nosimd.wasm` | `1e2566386057eec9604ce4237bc220cd776b29137eb342e3e5bf70603bf270c6` | `22673f5ea917a018cdf23de9e14fc373a348d75e7f80a839bba762748ef7ed22` |

Verify with `sha256sum src/vendor/tlottie/*.wasm`.
