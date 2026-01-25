You are implementing or modifying a Telegram bot using the Telegram Bot API (HTTP endpoints under https://api.telegram.org/bot<token>/<METHOD>). Use the official docs as source of truth.  ￼

1) Core mental model
	•	Telegram delivers updates (messages, callback queries, inline queries, etc.) either by:
	•	Webhooks (setWebhook) — Telegram POSTs JSON updates to your HTTPS endpoint.
	•	Long polling (getUpdates) — your server fetches updates.
	•	Choose one mode at a time; do not mix in production.
	•	Always respond quickly (for webhooks): acknowledge with HTTP 200 and handle heavier work asynchronously if needed, otherwise Telegram retries.

(Primary reference: Bot API doc + webhook-related methods and behavior.)  ￼

⸻

2) Webhook essentials (setup, security, debugging)

Setup methods
	•	setWebhook with parameters commonly used:
	•	url: your HTTPS endpoint
	•	drop_pending_updates: reset backlog when changing deployments (useful during debugging)
	•	allowed_updates: restrict update types you want to receive (reduces noise / attack surface)
	•	getWebhookInfo: observe:
	•	url, pending_update_count, last_error_message, etc.
	•	deleteWebhook: optionally with drop_pending_updates.

Security
	•	Prefer webhook secret_token (if you use it): verify incoming header X-Telegram-Bot-Api-Secret-Token equals your configured secret to prevent spoofed calls.
	•	Validate the incoming JSON schema defensively.

(Official Bot API methods and changelog are canonical; community guidance often references these parameters.)  ￼

⸻

3) Basic “health check” methods
	•	getMe: confirms token validity and bot identity.
	•	getWebhookInfo: confirms whether Telegram can reach your endpoint and whether delivery is failing.

￼

⸻

4) Sending messages: sendMessage (high-frequency method)

Implement sendMessage with support for the most useful parameters:

Key parameters
	•	chat_id (or chat_id + message_thread_id for forum topics / threads)
	•	text
	•	parse_mode OR entities (choose one; entities are safer for user-provided text)
	•	reply_markup (keyboards)
	•	disable_notification (silent)
	•	protect_content (forward/save restriction where supported)
	•	disable_web_page_preview or newer link_preview_options depending on Bot API version
	•	reply_to_message_id / reply-related parameters
	•	allow_sending_without_reply

(Bot API defines these; libraries mirror them.)  ￼

Robustness
	•	Always log and handle non-200 responses (Telegram returns JSON with ok=false, error_code, description).
	•	Implement retry/backoff for transient errors; avoid retry loops on 4xx configuration errors.

￼

⸻

5) Formatting and styling text (MarkdownV2 / HTML / Entities)

Telegram supports formatted text via:
	•	parse_mode: "MarkdownV2" (preferred over legacy Markdown) or parse_mode: "HTML"
	•	or explicit entities (MessageEntity array), which is safest if you interpolate user text.

Supported formatting (common)
	•	bold, italic, underline, strikethrough, spoiler
	•	inline links
	•	inline code and pre blocks

Use correct escaping rules (especially for MarkdownV2); consider building entities instead of raw markup.

References:
	•	Bot API formatting notes and updates
	•	Official “styled text with message entities” reference.  ￼

⸻

6) Commands UX: set commands, scopes, localization

Implement command discoverability via:
	•	setMyCommands / getMyCommands / deleteMyCommands
	•	Support:
	•	scope: command sets per context (private chats, groups, admins, specific chat, etc.)
	•	language_code: localized command sets

This enables different command menus for private vs group, admin vs non-admin, and per-language.

(Reference: official API / changelog around command scopes; confirm against current Bot API.)  ￼

⸻

7) Reply keyboards and inline keyboards (interaction patterns)

Inline Keyboard (recommended for interactive flows)
	•	Send with reply_markup: InlineKeyboardMarkup
	•	Handle button presses via callback_query updates
	•	Answer presses via answerCallbackQuery (stops loading spinner; optional alert)

Reply Keyboard (less common, but useful)
	•	ReplyKeyboardMarkup: shows custom keyboard in chat
	•	ReplyKeyboardRemove: remove it
	•	ForceReply: force user reply to a message

(Defined in Bot API types and methods.)  ￼

⸻

8) Editing and deleting messages

Common lifecycle methods:
	•	editMessageText, editMessageReplyMarkup, editMessageCaption, etc.
	•	deleteMessage
	•	pinChatMessage / unpinChatMessage (where permitted)

Use edits for “status/progress” messages in longer workflows.

￼

⸻

9) File sending and downloads (media pipeline)

High-level approach:
	•	Send media: sendPhoto, sendDocument, sendAudio, sendVideo, sendAnimation, etc.
	•	Telegram returns a file_id you can reuse.
	•	To download: getFile → yields file path; fetch via file endpoint.

Be careful with file sizes and timeouts; stream where possible.

￼

⸻

10) Update handling: routing, filtering, state

Update types you may receive
	•	message (text/media)
	•	edited_message
	•	callback_query
	•	inline_query / chosen_inline_result
	•	membership updates (e.g., my_chat_member, chat_member)
	•	more depending on bot features

Implement a router:
	•	Detect update type
	•	Normalize into an internal event model
	•	Enforce idempotency if needed (webhook retries can deliver duplicates)

Use allowed_updates in webhook/polling setup to limit update types.

￼

⸻

11) Operational best practices
	•	Always return HTTP 200 quickly for webhooks; do not block on slow upstream calls.
	•	If webhook errors show in getWebhookInfo (last_error_message, pending_update_count), clear backlog using deleteWebhook(drop_pending_updates=true) then re-set webhook during debugging.
	•	Store bot token securely; rotate on leaks (BotFather).
	•	Validate user input; never trust callback data; keep payload sizes small.
	•	Log Telegram responses (ok, error_code, description) and request correlation IDs.

￼

⸻

12) Deliverables for this coding task

When modifying the codebase:
	1.	Implement a thin Telegram client wrapper that:
	•	constructs API URLs
	•	sends JSON
	•	parses and returns { ok, result, error_code, description }
	•	logs non-OK responses
	2.	Implement webhook/polling configuration utilities:
	•	getMe, getWebhookInfo, setWebhook, deleteWebhook
	•	include drop_pending_updates and allowed_updates support
	3.	Implement message send utilities:
	•	sendMessage with formatting (parse_mode and/or entities) and reply_markup
	4.	Implement command registration:
	•	setMyCommands with scope + language_code
	5.	Implement interaction primitives:
	•	inline keyboard + callback query handler + answerCallbackQuery
	6.	Add a formatting helper:
	•	safe escaping for MarkdownV2 OR entity-builder approach
	7.	Add structured logging:
	•	capture inbound update summary + outbound API response

Use official docs for method names, parameter names, and response schemas; check the API changelog if something appears missing or version-gated.  ￼

