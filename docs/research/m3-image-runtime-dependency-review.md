# M3 Image Runtime Dependency Review

Reviewed: 2026-08-15

- Capability and milestone: M3 needs one bounded local process that can inspect one approved PNG or JPEG with the shipped Gemma 4 12B model and its official projector.
- Existing repository alternative: `node-llama-cpp` 3.19.0 remains the resident chat runtime, but its current adapter does not accept image input. A custom decoder, server, or separate vision stack would add more code, memory, and package surface.
- Candidate and pin: adopt the official `llama.cpp` b9842 `llama-mtmd-cli` artifacts for macOS arm64 and Windows Vulkan x64. `assets/vision-runtime.json` pins each official archive URL, byte length, SHA-256 digest, extracted file set, and final name.
- Primary sources: the official [b9842 release](https://github.com/ggml-org/llama.cpp/releases/tag/b9842), [multimodal tool documentation](https://github.com/ggml-org/llama.cpp/tree/b9842/tools/mtmd), [MIT license](https://github.com/ggml-org/llama.cpp/blob/b9842/LICENSE), and [Microsoft redistribution terms](https://learn.microsoft.com/en-us/visualstudio/releases/2026/redistribution).
- License and redistribution: `llama.cpp` is MIT licensed, and the package includes its license text. The Windows archive also supplies the Microsoft OpenMP runtime `libomp140.x86_64.dll`. Garden Desk adds the imported `msvcp140.dll`, `vcruntime140.dll`, and `vcruntime140_1.dll` as unmodified files from the hash-pinned official Microsoft desktop runtime package and records both Microsoft runtime components under the Microsoft Software License Terms.
- Offline, telemetry, network, and credentials: Core supplies local paths and a local prompt file. The runtime uses its offline option and a minimal environment. macOS denies network access with the operating-system sandbox. Windows uses the fixed no-capability AppContainer. The process receives no folder, attachment store, conversation, credential, or network authority.
- Footprint, native code, and platforms: the reviewed official archives are approximately 11 MiB for macOS arm64 and 32 MiB for Windows Vulkan x64 before extraction. They contain native executables and libraries. Only these two M3 product targets are supported.
- Security and maintenance: development fetch verifies the complete official archive before it extracts an allowlist of regular files. The final package manifest hashes every installed runtime file. Windows also verifies and read-locks those files before Core starts. A runtime revision change requires a new dependency and physical isolation review.
- Adapter fit: one thin TypeScript adapter owns bounded prompt scratch, process output, timeout, cancellation, final-channel parsing, and cleanup. Garden Desk Core retains image path authority, model selection, scheduling, audit, and policy.
- Research-derived claims to validate: image quality, exact memory use, Metal and Vulkan behavior, AppContainer operation, packaged startup, and cancellation need separate physical checks. macOS results do not certify Windows.

Decision: adopt b9842 for the current M3 direct-image path. Keep document OCR, image generation, servers, downloads, and other model or runtime adapters out of scope.
