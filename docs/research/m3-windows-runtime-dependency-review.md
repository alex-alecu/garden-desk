# M3 Windows Runtime Dependency Review

Updated: 2026-07-28

## Dependency Review

- Capability and milestone: M3 needs one zero-download Windows x64 application package that runs the pinned Gemma worker through NVIDIA CUDA when supported and AMD-compatible Vulkan otherwise.
- Existing repository alternative: the pinned `node-llama-cpp` 3.19.0 packages contain CUDA 13.1, CUDA 12.4 fallback, and Vulkan bindings. The CUDA 13.1 binding dynamically imports cuBLAS and was observed falling back to CPU when those redistributable DLLs were absent. Vulkan worked on both the physical NVIDIA and AMD adapters but does not prove the required CUDA path.
- Candidate and pinned version or revision: official NVIDIA cuBLAS 13.2.0.9 from the CUDA 13.1.0 redistribution manifest. The archive URL, byte length, SHA-256, extracted DLL hashes, and license hash are pinned in `packages/desktop/windows-runtime-assets.json`.
- Primary sources: NVIDIA's [CUDA 13.1 redistribution manifest](https://developer.download.nvidia.com/compute/cuda/redist/redistrib_13.1.0.json), [CUDA 13 EULA](https://docs.nvidia.com/cuda/archive/13.0.2/eula/index.html), and [CUDA C++ Best Practices redistribution guidance](https://docs.nvidia.com/cuda/archive/13.0.1/cuda-c-best-practices-guide/index.html); the `node-llama-cpp` [v3.19.0 build workflow](https://github.com/withcatai/node-llama-cpp/blob/v3.19.0/.github/workflows/build.yml) and [CUDA guide](https://node-llama-cpp.withcat.ai/guide/CUDA).
- License and redistribution: the CUDA EULA lists the Windows cuBLAS runtime DLLs as redistributable with an application. The package includes the upstream license and records the component in notices, the SBOM, the resource manifest, and the repository inventory.
- Offline, telemetry, network, and credential behavior: the two math DLLs perform no installation or download. They load only inside the existing no-capability AppContainer inference worker, which has no credentials, network authority, shell, or arbitrary workspace access.
- Footprint, native code, and platforms: Windows x64 only; 532,263,136 bytes for `cublas64_13.dll` and `cublasLt64_13.dll` together. The NVIDIA display driver remains a supported-hardware prerequisite. Vulkan remains packaged for AMD and as the automatic fallback.
- Security and maintenance: packaging verifies the official archive and every shipped file before copying. The existing resource manifest hashes the final copies. A future `node-llama-cpp` or CUDA build change requires an explicit manifest and physical-GPU re-review.
- Adapter fit: the DLLs sit beside the dedicated packaged `node.exe`, which is within Windows' application DLL search path. TypeScript keeps backend order and fallback policy; the native AppContainer helper remains policy-free.
- Physical validation: the final package loaded CUDA and Vulkan explicitly on a Windows laptop with an NVIDIA RTX 4080 and AMD Radeon 610M, selected CUDA automatically for the real Gemma worker inside the AppContainer, and passed copy-install launch, restart, shutdown, and removal checks. A release-credential signature and a real-Gemma AMD-only machine remain separate distribution and compatibility evidence.
- Decision: **adopt** for the pinned Windows M3 package only.
