# API compatibility contracts

Every API in this Worker is backward compatible within its published major
version. This includes site APIs, authenticated APIs, internal sync APIs and the
WebSocket route; known third-party use is not a prerequisite for stability.

`api-surface.json` is the complete route inventory. The contract test compares
its Hono entries with the routes registered by the real application, validates
the dedicated API-host aliases, and checks that every referenced test and schema
exists. Adding, removing or changing a route therefore requires a deliberate
contract update.

The schemas under `schemas/v1` and `schemas/v2` describe historical client
assumptions. They intentionally allow unknown object properties so compatible
additions do not break old clients, while required fields, types, nullability and
enumerated values remain locked. Golden fixtures additionally lock defaults and
selected semantic values that JSON Schema cannot express.

Within an existing major version:

- do not remove or rename fields, change their types or nullability, or reinterpret them;
- do not change defaults, status codes, error codes, pagination, ordering or important headers;
- treat new response enum values as potentially breaking for exhaustive clients;
- add only optional request parameters and response fields old clients can ignore.

A breaking change gets a new versioned route. Keep the previous version and its
contracts until an explicit, documented deprecation period has completed. Never
make a failing contract check green by casually rewriting a historical schema or
golden fixture: those files require API-owner review.
