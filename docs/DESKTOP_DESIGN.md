# Desktop Design

Updated: 2026-08-12

Vault Desk V1 is a calm, conversation-centered desktop agent inspired by the structural clarity of the Codex app without copying its branding or visual assets. The interface exposes work and context, not model infrastructure.

## Window Structure

```text
┌──────────────────────┬─────────────────────────────────────────────────────┐
│ Vault Desk           │                                                     │
│ Chats                │                                                     │
│ ＋ New chat          │               Conversation or welcome               │
│ Recent task          │                                                     │
│ Folders              │        messages, code activity, artifacts,          │
│ ＋ Add folder        │                                                     │
│ ▾ Client A           │             warnings, and progress                  │
│   Recent task        │                                                     │
│   Earlier task       │                                                     │
│   …3 more sessions   │                                                     │
│   Show more          │                                                     │
│ ▸ Contracts          │                                                     │
│ ▸ Research           │                                                     │
│                      ├─────────────────────────────────────────────────────┤
│                      │ context chips                                       │
│ Settings             │ Ask Vault Desk…                         Stop/Send    │
└──────────────────────┴─────────────────────────────────────────────────────┘
```

The two stable regions are a compact, horizontally resizable sidebar and a low-glare conversation workspace that share one continuous surface. The complete divider between them is the resize target, with keyboard resizing available from the same separator. Light appearance uses a `#FAFAFA` soft-white surface and dark ink. Dark appearance uses neutral graphite layers, soft ivory type, satin depth, and restrained jade accents rather than a green or blue wash. Subtle hairlines and a softly raised selection pill provide structure without a heavy chrome block or active-item edge rule. Teal identifies selection, progress, and ordinary actions, while ember is reserved for warnings and destructive actions. Self-hosted IBM Plex Sans carries interface and prose, Plex Serif distinguishes reading headings, and Plex Mono keeps code and technical evidence precise. The OFL-1.1 faces are bundled locally with no font service or runtime request. Focus colors remain visible against both appearance palettes.

On macOS the sidebar background extends beneath the native traffic-light controls, which use equal top and left insets and align vertically with the model title, and the native title text is hidden. The header remains draggable around its controls. The composer stays anchored to the bottom of the workspace. A lightweight conversation header shows the approved model name, on-device state, manual unload action, a compact appearance control, and Technical details without displacing folder navigation. Runtime memory budget, measured RAM and VRAM or unified-memory allocation, allocated context, hardware cap, and its reason appear only in Technical details. The appearance control sits between Unload and Technical details and cycles **System → Light → Dark**. System follows live operating-system appearance changes; explicit Light and Dark override them. The preference remains in UI memory and resets to System on reload, so the public demo adds no storage or persistence.

## Sidebar

The sidebar has separate **Chats** and **Folders** sections. **New chat** is the first option under Chats, followed by global sessions. **Add folder** is the first option under Folders, followed by folder groups.

Each folder group:

- Uses the selected folder's display name.
- Can collapse or expand without losing the active session.
- Shows its five most recently active sessions, newest first.
- Shows **Show more** only when older sessions exist; activation appends the next bounded page.
- Highlights the active session and may show concise running, failed, or unread status.
- Shows a reduced-motion-aware activity pulse for every queued or running conversation, including conversations working in the background.
- Opens the granted folder in Finder on macOS or Explorer on Windows when its folder icon is activated, without a confirmation step.
- Reveals a delete control on session hover or keyboard focus; deletion always requires explicit confirmation and is unavailable while that conversation is running.

Every remove or unmount action requires confirmation. Unmounting a folder removes its active grant but never deletes or changes host files. Existing session records remain visible with a clear unavailable-context state unless the user explicitly deletes them.

## New Chat

New chat prepares a blank composer with no folder grant; pressing it repeatedly does not persist placeholder conversations. The session is created when the user submits its first message or selects attachments. Users can attach one or more files through a native file dialog or by dropping them anywhere in the application window. Folders dropped anywhere in the window become scoped workspaces, then the last added workspace opens with a new blank conversation. During a native drag, a full-window animated affordance identifies whether release will attach files, add folder workspaces, or do both. Vault Core validates, copies, and verifies explicit files into session-owned read-only inputs before the agent can access them.

New chat must never silently inherit the previously selected folder. Attachments are clickable, removable chips before sending; after submission they move beneath the durable user message and remain clickable immutable input records. Opening an attachment materializes a verified owner-only temporary copy and delegates to the operating system. Removing a pending attachment requires confirmation and never changes the original host file.

## Folder Sessions

Adding a folder uses a native Tauri dialog or a sidebar drop and creates a scoped Vault Core grant. Folder groups can be reordered by drag handle or keyboard, and that order is persisted by Core. The webview receives opaque folder identifiers and display names, not unrestricted filesystem handles.

Starting a session under that folder gives its agent microVM a live read-only mount of the selected folder at `/source`. The hierarchy is preserved and host changes become visible immediately. The agent cannot write, rename, delete, or create files in the host folder.

Switching sessions restores conversation turns, agent activity summaries, generated-file deliverables, warnings, cancellation state, and unsent draft text.

## Conversation

The conversation timeline supports:

- User and assistant messages.
- All assistant responses render as GitHub Flavored Markdown, including single-line answers, tables, task lists, and strikethrough, while user messages remain literal text. User messages align right, and both user and assistant message containers shrink to their content up to the conversation width. Raw HTML and images are not rendered, and links remain non-navigating text.
- Streaming assistant text uses the same safe GitHub Flavored Markdown renderer as the completed response. A partial response hides isolated incomplete Markdown control markers and has no copy action until completion. Partial text stays in the active run only; only the accepted completed response enters conversation history.
- Concise model-planning, execution-purpose, completion, failure, and cancellation activity inline in chronological order. An expanded activity row can show a bounded, scrollable detail preview; exact process evidence remains in the separate Steps tab. Successful executions say **Finished this step** instead of naming runtimes or exit codes. A persistent **Working locally** card keeps the current action and completed execution count visible while a run is active.
- A compact **Generated files** section after the matching assistant Markdown and before its performance row. Each safe current-run artifact accepted with the response shows a recognizable type icon, filename, type, and size. A task-named output appears only after its safe current-run artifact check succeeds. The card opens a verified owner-only temporary copy in the default application, and its visible **Save As…** action uses a native dialog for a durable atomic copy. Opening and saving expose progress, cancellation or success feedback, accessible names, and concise errors. When no default application exists, Save As remains available. Restored conversations retain working cards; the public demo keeps cards visible with native actions disabled and its existing unavailable explanation.
- A top-right **Technical details** control that opens a wider right-side drawer. The drawer uses the application surface and reduces the conversation workspace instead of covering it. Its **Overview** tab contains separate live RAM and VRAM or unified-memory allocations, their total, the runtime memory budget, allocated context, hardware cap and rationale, limits, and guest capabilities. Its separate **Steps** tab contains the ordered step list, generated scripts or commands, and complete execution evidence. Generated-file metadata does not appear in Technical details.
- Technical details retains the local session ID and catalog path and identifies the snapshot as a handoff for AI coding agents such as Codex or Claude Code, including the selected session's SQLite-backed records and bounded microVM logs. It provides **Create debug snapshot** plus **Reveal snapshot**. The webview supplies only the session ID; the desktop host derives the catalog and can reveal only the latest snapshot it created for that session. The selectable result path and privacy warning reset when the conversation changes.
- Every inline activity step in the conversation is a button. Selecting one expands or collapses its bounded preview. The preview action opens Technical details directly to **Steps** with that step expanded and marks it as the current step. Opening the drawer from its header control starts on **Overview**, and the step list collapses all entries by default. Read-only step evidence boxes can resize vertically to a window-bounded maximum, wrap text on request, and copy their exact text to the local clipboard.
- An expanded step shows its purpose, generated code or command, termination and exit status, and one log stream at a time: Output, Errors, or typed VM diagnostics, with byte counts, explicit state text, and truncation text. Assigned Python and Node source files show their guest filename, language, and locally rendered syntax highlighting. When recorded inference detail is available it also shows the model and allocated context, the exact prompt sent, the requested result shape, and the model's decision. Prompts and decisions are read on demand for the selected step's run, never during run polling, and a task recorded before inference capture reports that its prompts are not recorded.
- While a step is generating, its current typed thought segment appears open within that step and follows the last streamed text row. When that segment ends, it stays in session-scoped desktop memory and collapses with the intermediate step. The user can open it again until Vault Desk closes. A restored application never shows it.
- Active output follows only while the viewer remains within 40 pixels of the bottom. Manual scrolling is preserved and exposes **Jump to latest**. Switching conversations clears the selected step.
- Plain-language running, cancelling, cancelled, timed-out, failed, and completed states.
- Security or unsupported-operation warnings.
- A compact performance row beneath the newest assistant response ordered as prompt-processing tokens per second, generation tokens per second, and total run time.

When the approved model and runtime expose a typed thought segment, the current segment may stream into the matching intermediate activity step while generation is active. The segment stays only in desktop memory, follows the last streamed text row while open, and collapses when the step ends. It is never restored after Vault Desk closes. Hidden or unsegmented internal reasoning is never inferred, exposed, or persisted. Activity describes observable actions and results only.

The empty state uses one short prompt and a few task suggestions relevant to the current context, such as exploring files, reviewing and suggesting improvements, comparing documents or data, or diagnosing a failure. Folder conversations include the folder name directly in the prompt; global chats use the prompt without folder context.

On wide windows, the welcome state, conversation, and composer share a 1,040-pixel maximum content width. Assistant responses may use that full width for code and tables. Long code blocks and tables use keyboard-accessible, window-bounded scroll areas. User messages remain right-aligned in a narrower warm-neutral bubble; narrow windows retain compact gutters and allow the bubble to expand without horizontal page overflow.

## Composer

The composer is multiline and anchored to the bottom of the conversation pane.

- The add button opens attachment actions; folder selection remains a separate grant action.
- Context chips show the active folder or explicit attachments.
- Send becomes Stop while a run is active.
- Command-Enter sends the current message on macOS; Enter remains available for multiline text.
- Switching conversations does not stop a run. Other conversations may start work up to the RAM-derived VM capacity; additional work stays queued without booting another guest.
- Drafts survive session and folder switching, daemon reconnect, and application restart.
- Submitting without a folder or attachment remains valid for conversational tasks.
- When the running agent asks a clarifying question, a question panel replaces the composer in the same bounded bottom slot without adding another workspace row. It shows the question, `N of M` paging for multi-question requests, numbered options with an optional Recommended badge, single-line descriptions that reveal full text on hover, a typed custom-answer row, and Skip. The panel keeps a Stop control so the blocked run stays cancellable while the composer is hidden. Arrow keys move between options, Enter selects, Command-Enter or Control-Enter advances or submits, and Escape dismisses. Answering or skipping returns the composer with its draft intact.

## Model Presentation

A build with one runnable generation model shows its human-readable name and current state in the conversation header. The model loads on first use, remains resident and ready between turns, and can be unloaded manually only while idle. An acknowledged Stop discards the partial response, returns the model to `ready`, and lets the next message continue the same session or start work in a different session without a model reload. A worker that does not acknowledge cancellation within one second is contained and unloaded. After unload, the next message loads the same approved model again. Hardware detection chooses the model-plus-context budget without a settings surface. On an 8 GB Mac the header and alert explain that local inference is unsupported, and the composer cannot submit agent work. There is no picker or arbitrary configuration affordance. A future multi-model build may show only installed, signed, hardware-compatible choices.

Runtime, quantization, context-window, endpoint, and model-file vocabulary stays out of the ordinary interface.

## Security Rules

- The webview has no generic shell, process, environment, network, local-endpoint, or unrestricted filesystem capability.
- Tauri commands are narrow, typed, capability-scoped, and delegated to Vault Core where product policy applies.
- Opening a granted folder passes only its opaque identifier; Vault Core resolves and revalidates the active grant before the Rust host asks the operating system to open it.
- Native dialogs return selections to the Rust host, which passes them through the typed grant or attachment command; arbitrary path strings from the webview are rejected.
- The model and guest never receive a writable host folder.
- Agent code and commands execute only in the session-scoped no-NIC microVM with fixed interpreters, libraries, and installed BusyBox tools.
- UI state never substitutes for Vault Core grants, policy, audit, resource limits, cancellation, or result validation.

## Accessibility And Platform Behavior

- Full keyboard navigation and visible focus, including arrow-key tab selection and button-operated execution rows.
- Screen-reader labels for folders, sessions, status, attachments, inline activity, Technical details, and composer actions. Each activity step names the step it reveals, and the expanded step is exposed as the current step.
- Focus restoration after dialogs, session switches, cancellation, and reconnect.
- Reduced-motion support.
- Usable at 200 percent scaling at the supported 1,120 × 700 minimum window size.
- Native title-bar and window controls appropriate to macOS and Windows.

## Revision History

| Date | Change |
|---|---|
| 2026-07-13 | Defined the initial Tauri desktop layout and security boundary. |
| 2026-07-20 | Reframed V1 around folder-grouped sessions, New chat attachments, and the generic offline dev agent. |
| 2026-07-22 | Grouped creation actions under Chats and Folders and standardized the white, low-contrast bordered shell. |
| 2026-07-22 | Added resident-model controls, transient supported thinking, and response performance presentation. |
| 2026-07-22 | Added hardware-derived inference budgets and the user-visible unsupported state for 8 GB Macs. |
| 2026-07-22 | Added safe CommonMark presentation for assistant responses. |
| 2026-07-22 | Restored concise activity and generated files to the conversation and reserved the renamed Technical details drawer for low-level evidence. |
| 2026-07-23 | Replaced folder snapshots and disposable scratch with the live read-only source mount and persistent session workspace. |
| 2026-07-23 | Added the Overview-first Technical details drawer with collapsed execution logs, selectable bounded streams, typed VM diagnostics, and scroll-follow controls. |
| 2026-07-24 | Added installed-app private debug snapshot creation and reveal without webview path or process authority. |
| 2026-07-25 | Added safe GFM tables and richer chat typography within a wider unified conversation layout. |
| 2026-07-25 | Replaced the high-glare white shell with website-aligned petroleum chrome, warm reading surfaces, and self-hosted IBM Plex typography. |
| 2026-07-25 | Unified the sidebar and conversation header with the warm reading surface while retaining petroleum for technical evidence. |
| 2026-07-25 | Added System, Light, and graphite Dark appearance modes and replaced the active sidebar edge rule with a softly raised selection pill. |
| 2026-07-25 | Added background conversation activity pulses, RAM-bounded parallel sessions, and clear memory budget versus live-allocation labels. |
| 2026-07-26 | Lightened the shared paper surface, made both side panels participate in layout, refined message sizing and alignment, and exposed runtime memory details in Technical details. |
| 2026-07-29 | Made inline activity steps selectable and replaced the Overview and Logs tabs with one ordered step list carrying code, logs, recorded prompts, requested result shape, and decisions. |
| 2026-07-29 | Separated the ordered step list into its own drawer tab, corrected expanded-step spacing, and added local syntax highlighting for assigned Python and Node source files. |
| 2026-07-29 | Replaced runtime and exit-code completion jargon in the conversation with plain-language step outcomes while retaining exact evidence in Steps. |
| 2026-08-14 | Kept typed thought segments in session-scoped desktop memory until application close, with live last-row following and completed-step collapse. |
| 2026-07-27 | Added visible active-run progress and a dismissible saved-progress continuation question for long XLSX work. |
| 2026-07-28 | Added clickable attachment transfer, whole-window file and folder drop routing with an animated affordance, and persistent accessible folder ordering. |
| 2026-08-01 | Added separate live RAM and VRAM or unified-memory allocations plus the allocated context, hardware cap, and hardware-derived rationale to Technical details. |
| 2026-08-04 | Grouped declared generated files beneath their assistant response with accessible Open and Save As actions, and removed file metadata from Technical details. |
| 2026-08-12 | Added the in-composer clarifying-question picker with paging, recommended and custom answers, hover text, Skip, Stop, keyboard control, and draft preservation. |
